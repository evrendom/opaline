import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type ClickHouseExecutor,
	createClickHouseExecutor,
} from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	isLocalClickHouseEndpoint,
	resolveClickHouseUsername,
} from "../src/clickhouse-connection.js";
import {
	RUN_INDEX_TEXT_COLUMNS,
	runIndexTable,
} from "../src/db/schema/run-index.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { runIndexNotFoundStatement } from "./migrate-not-found-unknown.js";
import { runIndexMessagesStatement } from "./migrate-run-index-messages.js";

/** The L1 run index (docs/l1-literal-schema.md, "Scale"). */
export const RUN_INDEX_MIGRATION = "20261010120000_run_index.sql";
const TABLE = runIndexTable as unknown as {
	name: string;
	columns: { name: string; type: string; comment: string }[];
	orderBy: string[];
	comment: string;
};
const SETTINGS = [
	"index_granularity = 1024",
	"index_granularity_bytes = 1048576",
	"non_replicated_deduplication_window = 1000",
];

type Engine = "ReplacingMergeTree" | "SharedReplacingMergeTree";

/**
 * Comments the retention migration rewrites (`migrate-l1-retention.ts`): the
 * table is created with the original wording, so this runner leaves them to
 * the retention runner, which verifies them.
 */
const RETENTION_COMMENT_COLUMNS: ReadonlySet<string> = new Set([
	"session_date",
	...RUN_INDEX_TEXT_COLUMNS,
]);

/**
 * Creates `rudel.run_index` once and journals it only after every replica
 * serves the exact schema: columns, comments, engine and key. ClickHouse
 * Cloud applies DDL to replicas asynchronously, and a writer routed to a
 * lagging replica would otherwise fail after the journal says the migration
 * ran. The table is created with the TTLs the retention migration removes,
 * so TTLs are not checked here (`migrate-l1-retention.ts` checks that none
 * is installed).
 */
export async function runRunIndexMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
	/** The read-back reads every replica and retries this often while one lags. */
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === RUN_INDEX_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Run index migration checksum mismatch");
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();
	for (const name of ["failed_edits", "refused_edits"]) {
		const column = TABLE.columns.find((column) => column.name === name);
		if (column === undefined)
			throw new Error(`Missing parser 9 column: ${name}`);
		await options.executor.execute(
			`ALTER TABLE ${options.targetDatabase}.${TABLE.name} ADD COLUMN IF NOT EXISTS ${name} ${column.type} COMMENT '${column.comment.replaceAll("'", "\\'")}'`,
		);
	}
	// The not-found migration's column changes (OPL-384), which the read-back
	// below checks.
	await options.executor.execute(
		runIndexNotFoundStatement(options.targetDatabase),
	);
	// The run index messages migration's columns (OPL-387).
	await options.executor.execute(
		runIndexMessagesStatement(options.targetDatabase),
	);

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	const replicas = await countReplicas(options.executor);
	for (let attempt = 1; ; attempt++) {
		const mismatch = await schemaMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		// Halfway, apply the idempotent statement again in case it did not land.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: RUN_INDEX_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/**
 * Replicas of the `default` cluster: every ClickHouse Cloud replica that can
 * serve an insert. 0 or 1 on a single server.
 */
async function countReplicas(executor: ClickHouseExecutor): Promise<number> {
	try {
		const [row] = await executor.query<{ replicas: string | number }>(
			`SELECT count() AS replicas FROM system.clusters WHERE cluster = 'default' SETTINGS max_execution_time = 10`,
		);
		return Number(row?.replicas ?? 0);
	} catch (error) {
		// The production user may not read system.clusters. The read-back then
		// checks the endpoint it reaches, retried for replica lag.
		if (
			!(
				error instanceof Error &&
				/Not enough privileges|ACCESS_DENIED/u.test(error.message)
			)
		)
			throw error;
		console.warn(
			"Cannot list the cluster's replicas (no privilege); validating run_index through the endpoint with retries",
		);
		return 0;
	}
}

type InstalledColumn = {
	host: string;
	name: string;
	type: string;
	comment: string;
	default_kind: string;
};
type InstalledTable = {
	host: string;
	engine_full: string;
	sorting_key: string;
	primary_key: string;
	partition_key: string;
	storage_policy: string;
	comment: string;
	create_table_query: string;
};

/** Why the run index differs from its definition on any replica, or null once every replica has it. */
async function schemaMismatch(
	options: {
		executor: ClickHouseExecutor;
		targetDatabase: string;
		expectedEngine: Engine;
		expectedStoragePolicy: string;
	},
	replicas: number,
): Promise<string | null> {
	const read = (table: string) =>
		replicas > 1 ? `clusterAllReplicas('default', ${table})` : table;
	const columns = await options.executor.query<InstalledColumn>(`
		SELECT hostName() AS host, name, type, comment, default_kind
		FROM ${read("system.columns")}
		WHERE database = '${options.targetDatabase}' AND table = '${TABLE.name}'
		ORDER BY host, position LIMIT 256 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const tables = await options.executor.query<InstalledTable>(`
		SELECT hostName() AS host, engine_full, sorting_key, primary_key, partition_key,
			storage_policy, comment, create_table_query
		FROM ${read("system.tables")}
		WHERE database = '${options.targetDatabase}' AND name = '${TABLE.name}'
		ORDER BY host LIMIT 2 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const byHost = new Map<string, InstalledColumn[]>();
	for (const column of columns)
		byHost.set(column.host, [...(byHost.get(column.host) ?? []), column]);
	const hosts = new Set([...byHost.keys(), ...tables.map((row) => row.host)]);
	if (byHost.size < Math.max(1, replicas) || tables.length < hosts.size)
		return `Run index table visible on ${Math.min(byHost.size, tables.length)} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const tableRows = tables.filter((row) => row.host === host);
		const mismatch = hostMismatch(
			options,
			byHost.get(host) ?? [],
			tableRows.length === 1 ? tableRows[0] : undefined,
		);
		if (mismatch !== null)
			return replicas > 1 ? `${mismatch} on replica ${host}` : mismatch;
	}
	return null;
}

function hostMismatch(
	expected: { expectedEngine: Engine; expectedStoragePolicy: string },
	columns: readonly InstalledColumn[],
	table: InstalledTable | undefined,
): string | null {
	const wrong = TABLE.columns.filter((column) => {
		const found = columns.find((found) => found.name === column.name);
		return (
			!found ||
			found.name !== column.name ||
			found.type !== column.type ||
			(found.comment !== column.comment &&
				!RETENTION_COMMENT_COLUMNS.has(column.name)) ||
			found.default_kind !== ""
		);
	});
	if (wrong.length > 0 || columns.length !== TABLE.columns.length)
		return `Run index columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`;
	if (!table) return "Run index table is missing";
	const engine = table.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
	const engineMatches =
		expected.expectedEngine === "ReplacingMergeTree"
			? engine === "ReplacingMergeTree(build_revision)"
			: /^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*',\s*)?build_revision\)$/u.test(
					engine,
				);
	if (
		!engineMatches ||
		table.sorting_key !== TABLE.orderBy.join(", ") ||
		table.primary_key !== table.sorting_key ||
		table.partition_key !== "" ||
		table.storage_policy !== expected.expectedStoragePolicy ||
		table.comment !== TABLE.comment ||
		!SETTINGS.every((setting) => table.engine_full.includes(setting))
	)
		return "Run index table mismatch (engine_full, key, settings, comment)";
	return null;
}

/**
 * The declaration of one column in a CREATE TABLE query, up to the next
 * column or the end of the column list. Comments hold no backticks, so a
 * backtick after `, ` starts the next column.
 */
export function columnDeclaration(createQuery: string, name: string): string {
	const start = createQuery.indexOf(`\`${name}\` `);
	if (start < 0) return "";
	const rest = createQuery.slice(start + name.length + 3);
	const ends = [rest.search(/,\s*`/u), rest.search(/\)\s*ENGINE\s/u)].filter(
		(index) => index >= 0,
	);
	return rest.slice(0, ends.length > 0 ? Math.min(...ends) : undefined);
}

async function main(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const executor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: "default",
	});
	try {
		await runRunIndexMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", RUN_INDEX_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "ReplacingMergeTree"
				: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(`Applied/validated: ${RUN_INDEX_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
