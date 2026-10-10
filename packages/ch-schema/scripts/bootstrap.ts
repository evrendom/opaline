import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
	listMigrations,
} from "chkit/dist/bin/lib.js";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import {
	appendJournalEntryWithReconciliation,
	createExecutor,
	createMigrationClient,
	F16_MIGRATIONS,
	type MigrationJournal,
	type MigrationRuntime,
	runF16MigrationCore,
} from "./migrate-f16.js";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../chx/migrations");
const SUBAGENT_VIEW_MIGRATION = "20260911055631_auto.sql";
const FORWARD_SCRIPTS = new Map([
	["20261001120000_github_outcomes.sql", "migrate-github-outcomes.ts"],
	["20260913190000_product_launch.sql", "migrate-product-launch.ts"],
	[
		"20260916120000_dependency_health_probes.sql",
		"migrate-dependency-health.ts",
	],
	["20260916193000_member_negative_signals.sql", "migrate-language-signals.ts"],
	["20260916210000_signal_phrase_counts.sql", "migrate-language-signals.ts"],
	["20260918120000_agent_run_summaries.sql", "migrate-language-signals.ts"],
	["20260930105809_transcript_records.sql", "migrate-transcript-records.ts"],
	[
		"20261009150000_transcript_records_facts.sql",
		"migrate-transcript-records.ts",
	],
	[
		"20261001160000_session_git_observations.sql",
		"migrate-session-git-observations.ts",
	],
	[
		"20261007180000_session_git_observation_run_ids.sql",
		"migrate-session-git-observations.ts",
	],
	[
		"20260930120000_repository_evidence_index.sql",
		"migrate-repository-evidence-index.ts",
	],
	[
		"20261008120000_session_analytics_retired_writes.sql",
		"migrate-session-analytics-retirement.ts",
	],
	["20261009120000_l1_edges.sql", "migrate-l1-edges.ts"],
	["20261010120000_run_index.sql", "migrate-run-index.ts"],
	["20261010130000_parser_v9.sql", "migrate-parser-v9.ts"],
]);

interface BootstrapMigration {
	name: string;
	sql: string;
	checksum: string;
}

async function runMigrationCommand(
	args: readonly string[],
	environment: Record<string, string> = {},
): Promise<void> {
	const child = Bun.spawn([process.execPath, ...args], {
		cwd: resolve(import.meta.dir, ".."),
		env: {
			...process.env,
			...environment,
			CLICKHOUSE_DB: "default",
			CLICKHOUSE_URL:
				process.env.CLICKHOUSE_URL?.trim() || "http://localhost:8123",
		},
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0) {
		throw new Error(`Bootstrap migration command failed: ${args.join(" ")}`);
	}
}

async function applyForwardMigration(
	migration: BootstrapMigration,
): Promise<void> {
	const script = FORWARD_SCRIPTS.get(migration.name);
	if (script) {
		await runMigrationCommand(
			[resolve(import.meta.dir, script)],
			script === "migrate-repository-evidence-index.ts"
				? { REPOSITORY_EVIDENCE_INDEX_EXPECTED_ENGINE: "ReplacingMergeTree" }
				: {},
		);
		return;
	}
	const directory = await mkdtemp(resolve(tmpdir(), "opaline-ch-upgrade-"));
	try {
		await writeFile(resolve(directory, migration.name), migration.sql);
		const configPath = resolve(directory, "clickhouse.config.ts");
		await writeFile(
			configPath,
			`import config from ${JSON.stringify(resolve(import.meta.dir, "../clickhouse.config.ts"))};\nexport default { ...config, migrationsDir: ${JSON.stringify(directory)} };\n`,
		);
		await runMigrationCommand([
			"--bun",
			resolve(import.meta.dir, "../node_modules/chkit/dist/bin/chkit.js"),
			"migrate",
			"--apply",
			"--allow-destructive",
			"--config",
			configPath,
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function run(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL?.trim() || "http://localhost:8123";
	const username = resolveClickHouseUsername(process.env, url);
	const password = process.env.CLICKHOUSE_PASSWORD ?? "";
	const executor = createClickHouseExecutor({
		url,
		username,
		password,
		database: "default",
	});
	try {
		const migrations = await Promise.all(
			(await listMigrations(MIGRATIONS_DIR)).map(async (name) => {
				const sql = await readFile(resolve(MIGRATIONS_DIR, name), "utf8");
				return { name, sql, checksum: checksumSQL(sql) };
			}),
		);
		const journalName =
			process.env.CHKIT_JOURNAL_TABLE?.trim() || "_chkit_migrations";
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(journalName)) {
			throw new Error("Invalid CHKIT_JOURNAL_TABLE identifier");
		}
		const tables = await executor.query<{ database: string; name: string }>(`
			SELECT database, name FROM system.tables
			WHERE database = 'rudel' OR (database = 'default' AND name = '${journalName}')
			ORDER BY database, name LIMIT 2 SETTINGS max_execution_time = 10
		`);
		const journalStore = createJournalStore(executor);
		const journalExists = tables.some(
			(table) => table.database === "default" && table.name === journalName,
		);
		const journal: MigrationJournal = {
			applied: journalExists
				? (
						await executor.query<{
							name: string;
							applied_at: string;
							checksum: string;
						}>(`
							SELECT name, applied_at, checksum FROM default.${journalName}
							ORDER BY applied_at, name SETTINGS max_execution_time = 10
						`)
					).map((entry) => ({
						name: entry.name,
						appliedAt: entry.applied_at,
						checksum: entry.checksum,
					}))
				: [],
		};
		const tableCount = tables.filter(
			(table) => table.database === "rudel",
		).length;
		const [f16State] = await executor.query<{
			artifacts: number;
			unfinished: number;
		}>(`
			SELECT count() AS artifacts,
				countIf(name LIKE '%_f16_backfill_source_20260826'
					OR name LIKE '%_f16_uint64_backup_20260826'
					OR name IN ('f16_revision_cutover_lease_20260826',
						'session_analytics_f16_rebuilt_identities_20260826',
						'session_analytics_f16_expected_rows_20260826')) AS unfinished
			FROM system.tables WHERE database = 'rudel' AND position(name, 'f16') > 0
			SETTINGS max_execution_time = 10
		`);
		const mode = getBootstrapMode(migrations, journal, tableCount, f16State);
		if (mode === "complete") {
			console.log(
				`Nothing pending (${migrations.length} migrations; checksums verified).`,
			);
			return;
		}
		const pending = migrations.slice(journal.applied.length);
		console.log(
			`Bootstrap ${mode}: ${pending.length} pending migrations (${journal.applied.length} applied; checksums verified).`,
		);
		const runId = crypto.randomUUID();
		const topology = { mode: "single-node" } as const;
		const primaryClient = createMigrationClient({
			url,
			username,
			password,
			database: "default",
			ddlTimeoutSeconds: 180,
			requestTimeoutMs: 600_000,
			maxBytesBeforeExternalGroupBy: 268_435_456,
			maxBytesBeforeExternalSort: 268_435_456,
			maxMemoryUsage: 2_147_483_648,
			maxTemporaryDataOnDiskBytes: 4_294_967_296,
			runQueryPrefix: `rudel-f16-${runId}`,
			topology,
		});
		const runtime: MigrationRuntime = {
			autoApproveCheckpoints: true,
			backfillBucketCount: 2,
			barrierClients: [primaryClient],
			barrierTimeoutMs: 120_000,
			executor: createExecutor(primaryClient),
			leaseAcquiredAt: new Date().toISOString(),
			leaseOwnerRunId: runId,
			primaryClient,
			runQueryPrefix: `rudel-f16-${runId}`,
			sleep: (milliseconds) => Bun.sleep(milliseconds),
			timeNow: Date.now,
			topology,
		};
		try {
			for (const migration of pending) {
				if (migration.name === F16_MIGRATIONS[0]) {
					await runF16MigrationCore(runtime, {
						journalStore,
						loadMigration: (name) =>
							readFile(resolve(MIGRATIONS_DIR, name), "utf8"),
						log: console.log,
						phaseNames: F16_MIGRATIONS,
					});
				}
				if (F16_MIGRATIONS.includes(migration.name)) continue;
				if (migration.name === SUBAGENT_VIEW_MIGRATION) {
					await executor.execute(
						"ALTER TABLE rudel.session_analytics ADD COLUMN IF NOT EXISTS subagent_count UInt32 DEFAULT 0",
					);
					console.log("Established subagent_count prerequisite.");
				}
				if (
					mode === "upgrade" ||
					migration.name === "20261001120000_github_outcomes.sql"
				) {
					const currentJournal = await journalStore.readJournal();
					if (
						currentJournal.applied.some(
							(entry) => entry.name === migration.name,
						)
					)
						continue;
					await applyForwardMigration(migration);
					continue;
				}
				for (const statement of extractExecutableStatements(migration.sql)) {
					await executor.execute(statement);
				}
				await appendJournalEntryWithReconciliation(journalStore, {
					name: migration.name,
					checksum: migration.checksum,
					appliedAt: new Date().toISOString().replace("Z", ""),
				});
				console.log(`Applied: ${migration.name}`);
			}
			if (
				getBootstrapMode(
					migrations,
					await journalStore.readJournal(),
					tableCount,
				) !== "complete"
			) {
				throw new Error(
					"Bootstrap did not complete the checked-in migration history",
				);
			}
			console.log(
				`Bootstrap complete (${migrations.length} migrations; ${pending.length} applied).`,
			);
		} finally {
			await primaryClient.close();
		}
	} finally {
		await executor.close();
	}
}

export function getBootstrapMode(
	migrations: readonly Pick<BootstrapMigration, "name" | "checksum">[],
	journal: MigrationJournal,
	tableCount: number,
	f16State = { artifacts: 0, unfinished: 0 },
): "empty" | "upgrade" | "complete" {
	if (migrations.length === 0)
		throw new Error("No ClickHouse migrations found");
	for (const [index, entry] of journal.applied.entries()) {
		const migration = migrations[index];
		if (!migration || entry.name !== migration.name) {
			throw new Error(
				`Applied migration history is not a prefix of checked-in history at ${entry.name}`,
			);
		}
		if (entry.checksum !== migration.checksum) {
			throw new Error(
				`Applied migration checksum mismatch for ${migration.name}`,
			);
		}
	}
	const appliedF16Count = journal.applied.filter((entry) =>
		F16_MIGRATIONS.includes(entry.name),
	).length;
	if (
		(appliedF16Count > 0 && appliedF16Count < F16_MIGRATIONS.length) ||
		(appliedF16Count === 0 && f16State.artifacts > 0) ||
		f16State.unfinished > 0
	) {
		throw new Error(
			"Partial F16 state; use the controlled F16 recovery procedure before bootstrap",
		);
	}
	if (journal.applied.length === migrations.length) {
		return "complete";
	}
	if (journal.applied.length > 0) return "upgrade";
	if (tableCount > 0) {
		throw new Error(
			"Bootstrap refuses unjournaled rudel tables. Use controlled forward migrations for existing installations. For a failed disposable bootstrap, drop the database and journal before retrying.",
		);
	}
	return "empty";
}

if (import.meta.main) {
	run().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
