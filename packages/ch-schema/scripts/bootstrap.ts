import { existsSync } from "node:fs";
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
	adaptExecutor,
	adaptStatement,
	type ClickHouseCapabilities,
	needsAdaptation,
	probeClickHouseCapabilities,
} from "../src/clickhouse-flavor.js";
import {
	appendJournalEntryWithReconciliation,
	createExecutor,
	createMigrationClient,
	F16_MIGRATIONS,
	type MigrationHttpClient,
	type MigrationJournal,
	type MigrationRuntime,
	runF16MigrationCore,
} from "./migrate-f16.js";

const DEFAULT_SCHEMA_DIR = resolve(import.meta.dir, "..");
const SUBAGENT_VIEW_MIGRATION = "20260911055631_auto.sql";
export const FORWARD_SCRIPTS = new Map([
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
	["20261011120000_l1_retention_removed.sql", "migrate-l1-retention.ts"],
	["20261011150000_weekly_totals.sql", "migrate-weekly-totals.ts"],
	["20261012120000_not_found_unknown.sql", "migrate-not-found-unknown.ts"],
	[
		"20261012140000_run_question_answers.sql",
		"migrate-run-question-answers.ts",
	],
	[
		"20261012150000_analysis_finding_runs.sql",
		"migrate-analysis-finding-runs.ts",
	],
	["20261012150000_run_requests.sql", "migrate-run-requests.ts"],
	["20261012150000_transcript_search.sql", "migrate-transcript-search.ts"],
	["20261012170000_run_index_messages.sql", "migrate-run-index-messages.ts"],
	["20261013120000_received_setup.sql", "migrate-received-setup.ts"],
	[
		"20261016120000_transcript_record_uuid.sql",
		"migrate-transcript-record-uuid.ts",
	],
	[
		"20261016130000_session_saved_outputs.sql",
		"migrate-session-saved-outputs.ts",
	],
	[
		"20261016150000_run_index_capture_gaps.sql",
		"migrate-run-index-capture-gaps.ts",
	],
	["20261016170000_run_index_approvals.sql", "migrate-run-index-approvals.ts"],
	[
		"20261016180000_evidence_setup_snapshot.sql",
		"migrate-repository-evidence-index.ts",
	],
	["20261016190000_session_images.sql", "migrate-session-images.ts"],
	["20261028150000_run_activity_end.sql", "migrate-run-activity-end.ts"],
	["20261104120000_mcp_tool_calls.sql", "migrate-mcp-tool-calls.ts"],
	["20261106120000_string_defaults.sql", "migrate-string-defaults.ts"],
	[
		"20261107120000_session_context_snapshots.sql",
		"migrate-session-context-snapshots.ts",
	],
	["20261107120000_session_inventory.sql", "migrate-session-inventory.ts"],
	["20261108120000_call_facts.sql", "migrate-call-facts.ts"],
	[
		"20261108150000_usage_session_rollups.sql",
		"migrate-usage-session-rollups.ts",
	],
	[
		"20261109200000_transcript_record_commands.sql",
		"migrate-transcript-record-commands.ts",
	],
]);

interface BootstrapMigration {
	name: string;
	sql: string;
	checksum: string;
}

type Environment = Record<string, string | undefined>;

export interface BootstrapOptions {
	readonly env?: Environment;
	readonly log?: (line: string) => void;
	readonly verbose?: boolean;
	readonly schemaDir?: string;
}

export interface BootstrapResult {
	readonly mode: "empty" | "upgrade" | "complete";
	readonly total: number;
	readonly applied: number;
	readonly capabilities: ClickHouseCapabilities;
	readonly ms: number;
	readonly summary: string;
}

interface BootstrapContext {
	readonly env: Environment;
	readonly url: string;
	readonly capabilities: ClickHouseCapabilities;
	readonly verbose: boolean;
	readonly schemaDir: string;
}

export function forwardScriptPath(schemaDir: string, script: string): string {
	const path = resolve(schemaDir, "scripts", script);
	return existsSync(path) ? path : path.replace(/\.ts$/u, ".js");
}

export function usesChkitForUpgrade(
	capabilities: ClickHouseCapabilities,
	chkitAvailable: boolean,
): boolean {
	return chkitAvailable && !needsAdaptation(capabilities);
}

async function runMigrationCommand(
	context: BootstrapContext,
	args: readonly string[],
): Promise<void> {
	const child = Bun.spawn([process.execPath, ...args], {
		cwd: context.schemaDir,
		env: {
			...context.env,
			CLICKHOUSE_DB: "default",
			CLICKHOUSE_URL: context.url,
		},
		stdout: context.verbose ? "inherit" : "pipe",
		stderr: context.verbose ? "inherit" : "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		context.verbose ? "" : new Response(child.stdout as ReadableStream).text(),
		context.verbose ? "" : new Response(child.stderr as ReadableStream).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(
			[
				`Bootstrap migration command failed: ${args.join(" ")}`,
				stdout.trim(),
				stderr.trim(),
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
}

async function applyMigrationStatements(
	executor: Pick<ClickHouseExecutorLike, "execute">,
	migration: BootstrapMigration,
): Promise<void> {
	for (const statement of extractExecutableStatements(migration.sql))
		await executor.execute(statement);
}

type ClickHouseExecutorLike = ReturnType<typeof createClickHouseExecutor>;

function adaptMigrationClient(
	client: MigrationHttpClient,
	capabilities: ClickHouseCapabilities,
): MigrationHttpClient {
	if (!needsAdaptation(capabilities)) return client;
	return {
		close: () => client.close(),
		query: (query, timeoutMs) => client.query(query, timeoutMs),
		async command(query, timeoutMs) {
			const statement = adaptStatement(query, capabilities);
			if (statement !== null) await client.command(statement, timeoutMs);
		},
	};
}

async function applyForwardMigration(
	context: BootstrapContext,
	executor: ClickHouseExecutorLike,
	journalStore: ReturnType<typeof createJournalStore>,
	migration: BootstrapMigration,
): Promise<void> {
	const script = FORWARD_SCRIPTS.get(migration.name);
	if (script) {
		await runMigrationCommand(context, [
			forwardScriptPath(context.schemaDir, script),
		]);
		return;
	}
	const chkit = resolve(
		context.schemaDir,
		"node_modules/chkit/dist/bin/chkit.js",
	);
	if (!usesChkitForUpgrade(context.capabilities, existsSync(chkit))) {
		await applyMigrationStatements(executor, migration);
		await appendJournalEntryWithReconciliation(journalStore, {
			name: migration.name,
			checksum: migration.checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
		return;
	}
	const directory = await mkdtemp(resolve(tmpdir(), "opaline-ch-upgrade-"));
	try {
		await writeFile(resolve(directory, migration.name), migration.sql);
		const configPath = resolve(directory, "clickhouse.config.ts");
		await writeFile(
			configPath,
			`import config from ${JSON.stringify(resolve(context.schemaDir, "clickhouse.config.ts"))};\nexport default { ...config, migrationsDir: ${JSON.stringify(directory)} };\n`,
		);
		await runMigrationCommand(context, [
			"--bun",
			chkit,
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

export async function bootstrapClickHouseSchema(
	options: BootstrapOptions = {},
): Promise<BootstrapResult> {
	const startedAt = performance.now();
	const env = options.env ?? process.env;
	const verbose = options.verbose ?? false;
	const schemaDir = options.schemaDir ?? DEFAULT_SCHEMA_DIR;
	const migrationsDir = resolve(schemaDir, "chx/migrations");
	const detail = verbose ? (options.log ?? console.log) : () => {};
	const url = env.CLICKHOUSE_URL?.trim() || "http://localhost:8123";
	const username = resolveClickHouseUsername(env, url);
	const password = env.CLICKHOUSE_PASSWORD ?? "";
	const raw = createClickHouseExecutor({
		url,
		username,
		password,
		database: "default",
	});
	try {
		const capabilities = await probeClickHouseCapabilities(
			(sql) => raw.query<Record<string, unknown>>(sql),
			env,
		);
		const executor = adaptExecutor(raw, capabilities);
		const context: BootstrapContext = {
			env,
			url,
			capabilities,
			verbose,
			schemaDir,
		};
		const migrations = await Promise.all(
			(await listMigrations(migrationsDir)).map(async (name) => {
				const sql = await readFile(resolve(migrationsDir, name), "utf8");
				return { name, sql, checksum: checksumSQL(sql) };
			}),
		);
		const journalName = env.CHKIT_JOURNAL_TABLE?.trim() || "_chkit_migrations";
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
		const finish = (
			finalMode: BootstrapResult["mode"],
			applied: number,
			summary: string,
		): BootstrapResult => {
			const ms = Math.round(performance.now() - startedAt);
			return {
				mode: finalMode,
				total: migrations.length,
				applied,
				capabilities,
				ms,
				summary: `${summary} in ${(ms / 1000).toFixed(1)}s`,
			};
		};
		const mode = getBootstrapMode(migrations, journal, tableCount, f16State);
		const flavor = `${capabilities.flavor}, storage policy ${capabilities.storagePolicy}`;
		if (mode === "complete") {
			return finish(
				"complete",
				0,
				`ClickHouse schema up to date (${migrations.length} migrations, ${flavor})`,
			);
		}
		const pending = migrations.slice(journal.applied.length);
		detail(
			`Bootstrap ${mode}: ${pending.length} pending migrations (${journal.applied.length} applied; checksums verified).`,
		);
		const runId = crypto.randomUUID();
		const topology = { mode: "single-node" } as const;
		const primaryClient = adaptMigrationClient(
			createMigrationClient({
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
			}),
			capabilities,
		);
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
							readFile(resolve(migrationsDir, name), "utf8"),
						log: detail,
						phaseNames: F16_MIGRATIONS,
					});
				}
				if (F16_MIGRATIONS.includes(migration.name)) continue;
				if (migration.name === SUBAGENT_VIEW_MIGRATION) {
					await executor.execute(
						"ALTER TABLE rudel.session_analytics ADD COLUMN IF NOT EXISTS subagent_count UInt32 DEFAULT 0",
					);
					detail("Established subagent_count prerequisite.");
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
					await applyForwardMigration(
						context,
						executor,
						journalStore,
						migration,
					);
					continue;
				}
				await applyMigrationStatements(executor, migration);
				await appendJournalEntryWithReconciliation(journalStore, {
					name: migration.name,
					checksum: migration.checksum,
					appliedAt: new Date().toISOString().replace("Z", ""),
				});
				detail(`Applied: ${migration.name}`);
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
			return finish(
				mode,
				pending.length,
				`ClickHouse schema ${mode === "empty" ? "created" : "upgraded"}: ${pending.length} of ${migrations.length} migrations applied (${flavor})`,
			);
		} finally {
			await primaryClient.close();
		}
	} finally {
		await raw.close();
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
	bootstrapClickHouseSchema({ verbose: process.argv.includes("--verbose") })
		.then((result) => console.log(result.summary))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
