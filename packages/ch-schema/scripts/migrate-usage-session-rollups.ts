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
	USAGE_SESSION_ROLLUP_COLUMNS,
	USAGE_SESSION_ROLLUPS_COMMENT,
	USAGE_SESSION_ROLLUPS_KEY,
	USAGE_SESSION_ROLLUPS_VERSION,
} from "../src/usage-session-rollups.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

export const USAGE_SESSION_ROLLUPS_MIGRATION =
	"20261108150000_usage_session_rollups.sql";
export const USAGE_SESSION_ROLLUP_COSTS_MIGRATION =
	"20261109120000_usage_session_rollup_costs.sql";
export const USAGE_SESSION_ROLLUPS_MIGRATIONS = [
	USAGE_SESSION_ROLLUPS_MIGRATION,
	USAGE_SESSION_ROLLUP_COSTS_MIGRATION,
] as const;

const TABLE = "usage_session_rollups";
const KEY = USAGE_SESSION_ROLLUPS_KEY.join(", ");
const SETTINGS = [
	"index_granularity = 1024",
	"non_replicated_deduplication_window = 1000",
];

type Engine = "ReplacingMergeTree" | "SharedReplacingMergeTree";

export interface UsageSessionRollupsMigration {
	readonly name: string;
	readonly sql: string;
}

export async function runUsageSessionRollupsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrations: readonly UsageSessionRollupsMigration[];
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const journal = (await options.journalStore.readJournal()).applied;
	const pending = options.migrations.filter((migration) => {
		const checksum = checksumSQL(migration.sql);
		const applied = journal.filter((entry) => entry.name === migration.name);
		if (applied.some((entry) => entry.checksum !== checksum))
			throw new Error(
				`Usage session rollups migration checksum mismatch: ${migration.name}`,
			);
		return applied.length === 0;
	});
	const apply = async () => {
		for (const migration of pending)
			for (const statement of extractExecutableStatements(migration.sql))
				await options.executor.execute(statement);
	};
	await apply();

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	const replicas = await countReplicas(
		options.executor,
		"the usage session rollups table",
	);
	for (let attempt = 1; ; attempt++) {
		const mismatch = await schemaMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		if (pending.length > 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	for (const migration of pending)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: migration.name,
			checksum: checksumSQL(migration.sql),
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

interface InstalledColumn {
	host: string;
	name: string;
	type: string;
	comment: string;
	default_kind: string;
}
interface InstalledTable {
	host: string;
	engine_full: string;
	sorting_key: string;
	primary_key: string;
	partition_key: string;
	storage_policy: string;
	comment: string;
}

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
		WHERE database = '${options.targetDatabase}' AND table = '${TABLE}'
		ORDER BY host, position LIMIT 128 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const tables = await options.executor.query<InstalledTable>(`
		SELECT hostName() AS host, engine_full, sorting_key, primary_key, partition_key,
			storage_policy, comment
		FROM ${read("system.tables")}
		WHERE database = '${options.targetDatabase}' AND name = '${TABLE}'
		ORDER BY host LIMIT 2 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const hosts = new Set([
		...columns.map((column) => column.host),
		...tables.map((table) => table.host),
	]);
	if (hosts.size < Math.max(1, replicas))
		return `${TABLE} table visible on ${hosts.size} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const installed = columns.filter((column) => column.host === host);
		const [table, ...extra] = tables.filter((row) => row.host === host);
		const wrong = USAGE_SESSION_ROLLUP_COLUMNS.filter((column, index) => {
			const found = installed[index];
			return (
				found?.name !== column.name ||
				found.type !== column.type ||
				found.comment !== column.comment ||
				found.default_kind !== (column.default === undefined ? "" : "DEFAULT")
			);
		});
		const engine = table?.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
		const engineMatches =
			options.expectedEngine === "ReplacingMergeTree"
				? engine === `ReplacingMergeTree(${USAGE_SESSION_ROLLUPS_VERSION})`
				: new RegExp(
						`^SharedReplacingMergeTree\\((?:'[^']*',\\s*'[^']*',\\s*)?${USAGE_SESSION_ROLLUPS_VERSION}\\)$`,
						"u",
					).test(engine);
		const mismatch =
			wrong.length > 0 ||
			installed.length !== USAGE_SESSION_ROLLUP_COLUMNS.length
				? `${TABLE} columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`
				: !table || extra.length > 0
					? `${TABLE} table is missing`
					: !engineMatches ||
							table.sorting_key !== KEY ||
							table.primary_key !== KEY ||
							table.partition_key !== "" ||
							table.storage_policy !== options.expectedStoragePolicy ||
							table.comment !== USAGE_SESSION_ROLLUPS_COMMENT ||
							!SETTINGS.every((setting) => table.engine_full.includes(setting))
						? `${TABLE} table mismatch (engine_full, key, settings, comment)`
						: null;
		if (mismatch !== null)
			return replicas > 1 ? `${mismatch} on replica ${host}` : mismatch;
	}
	return null;
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
		await runUsageSessionRollupsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrations: await Promise.all(
				USAGE_SESSION_ROLLUPS_MIGRATIONS.map(async (name) => ({
					name,
					sql: await readFile(
						resolve(import.meta.dir, "../chx/migrations", name),
						"utf8",
					),
				})),
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "ReplacingMergeTree"
				: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(
			`Applied/validated: ${USAGE_SESSION_ROLLUPS_MIGRATIONS.join(", ")}`,
		);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
