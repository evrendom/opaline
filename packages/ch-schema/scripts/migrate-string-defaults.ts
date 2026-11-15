import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import { DROPPED_SESSION_ANALYTICS_COLUMNS } from "../src/session-analytics-mv.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

export const STRING_DEFAULTS_MIGRATION = "20261106120000_string_defaults.sql";

export const STRING_DEFAULTS = {
	session_analytics: {
		source: "claude_code",
		git_remote: "",
		package_name: "",
		package_type: "",
		model_used: "",
	},
	claude_sessions: { git_remote: "", package_name: "", package_type: "" },
	codex_sessions: { git_remote: "", package_name: "", package_type: "" },
} as const satisfies Record<string, Record<string, string>>;

type Table = keyof typeof STRING_DEFAULTS;

/**
 * The migration's statements without the columns that
 * `20261109150000_session_analytics_drop_retired.sql` drops after it, so a
 * re-apply never names a dropped column.
 */
export function stringDefaultsStatements(migrationSql: string): string[] {
	const dropped = new RegExp(
		`,\\s*MODIFY COLUMN (?:${DROPPED_SESSION_ANALYTICS_COLUMNS.join("|")}) DEFAULT '[^']*'`,
		"gu",
	);
	return extractExecutableStatements(migrationSql).map((statement) =>
		statement.replace(dropped, ""),
	);
}

/** How ClickHouse reports a string default in `system.columns`. */
export function stringDefaultExpression(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

interface InstalledDefault {
	host: string;
	table: string;
	name: string;
	default_kind: string;
	default_expression: string;
}

// A replica restart has reloaded older table metadata before (2026-10-20).
export async function runStringDefaultsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === STRING_DEFAULTS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("String defaults migration checksum mismatch");
	const replicas = await countReplicas(options.executor, "the string defaults");
	const statements = stringDefaultsStatements(options.migrationSql);
	const apply = async () => {
		for (const statement of statements)
			await options.executor.execute(statement);
	};
	const journaled = applied.length > 0;
	if (!journaled) await apply();
	else {
		const reverted = await defaultsMismatch(options, replicas);
		if (reverted !== null) {
			console.warn(
				`${STRING_DEFAULTS_MIGRATION}: defaults reverted since the migration was journaled; re-applying (${reverted})`,
			);
			await apply();
		}
	}

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const mismatch = await defaultsMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		if (attempt === Math.ceil(attempts / 2)) await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (!journaled)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: STRING_DEFAULTS_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

async function defaultsMismatch(
	options: { executor: ClickHouseExecutor; targetDatabase: string },
	replicas: number,
): Promise<string | null> {
	const tables = Object.keys(STRING_DEFAULTS) as Table[];
	const columns = [
		...new Set(tables.flatMap((table) => Object.keys(STRING_DEFAULTS[table]))),
	];
	const installed = await options.executor.query<InstalledDefault>(`
		SELECT hostName() AS host, table, name, default_kind, default_expression
		FROM ${replicas > 1 ? "clusterAllReplicas('default', system.columns)" : "system.columns"}
		WHERE database = '${options.targetDatabase}'
			AND table IN (${tables.map((table) => `'${table}'`).join(", ")})
			AND name IN (${columns.map((name) => `'${name}'`).join(", ")})
		ORDER BY host, table, name LIMIT 64 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const hosts = new Set(installed.map((row) => row.host));
	if (hosts.size < Math.max(1, replicas))
		return `String defaults visible on ${hosts.size} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const wrong = tables.flatMap((table) =>
			Object.entries(STRING_DEFAULTS[table])
				.filter(([name, value]) => {
					const found = installed.find(
						(row) =>
							row.host === host && row.table === table && row.name === name,
					);
					return (
						found?.default_kind !== "DEFAULT" ||
						found.default_expression !== stringDefaultExpression(value)
					);
				})
				.map(([name]) => `${table}.${name}`),
		);
		if (wrong.length > 0)
			return `String defaults mismatch: ${wrong.join(", ")}${replicas > 1 ? ` on replica ${host}` : ""}`;
	}
	return null;
}

async function main(): Promise<void> {
	const target = await openMigrationTarget();
	const { executor } = target;
	try {
		await runStringDefaultsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					STRING_DEFAULTS_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${STRING_DEFAULTS_MIGRATION}`);
	} finally {
		await target.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
