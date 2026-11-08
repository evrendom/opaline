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
	CALL_FACTS_COLUMNS,
	CALL_FACTS_COMMENT,
	CALL_FACTS_KEY,
	CALL_FACTS_MIGRATION,
	CALL_FACTS_STARTED_AT_INDEX,
} from "../src/call-facts.js";
import {
	isLocalClickHouseEndpoint,
	resolveClickHouseUsername,
} from "../src/clickhouse-connection.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

export { CALL_FACTS_MIGRATION };
const TABLE = "call_facts";
const KEY = CALL_FACTS_KEY.join(", ");
const SETTINGS = [
	"index_granularity = 1024",
	"index_granularity_bytes = 1048576",
	"non_replicated_deduplication_window = 1000",
];

type Engine = "ReplacingMergeTree" | "SharedReplacingMergeTree";

export async function runCallFactsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === CALL_FACTS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Call facts migration checksum mismatch");
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	const replicas = await countReplicas(
		options.executor,
		"the call facts table",
	);
	for (let attempt = 1; ; attempt++) {
		const mismatch = await schemaMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: CALL_FACTS_MIGRATION,
			checksum,
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
interface InstalledIndex {
	host: string;
	name: string;
	expr: string;
	type_full: string;
	granularity: string;
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
		ORDER BY host, position LIMIT 256 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const tables = await options.executor.query<InstalledTable>(`
		SELECT hostName() AS host, engine_full, sorting_key, primary_key, partition_key,
			storage_policy, comment
		FROM ${read("system.tables")}
		WHERE database = '${options.targetDatabase}' AND name = '${TABLE}'
		ORDER BY host LIMIT 2 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const indexes = await options.executor.query<InstalledIndex>(`
		SELECT hostName() AS host, name, expr, type_full, toString(granularity) AS granularity
		FROM ${read("system.data_skipping_indices")}
		WHERE database = '${options.targetDatabase}' AND table = '${TABLE}'
		ORDER BY host LIMIT 8 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const hosts = new Set([
		...columns.map((column) => column.host),
		...tables.map((table) => table.host),
	]);
	if (hosts.size < Math.max(1, replicas))
		return `Call facts table visible on ${hosts.size} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const installed = columns.filter((column) => column.host === host);
		const [table, ...extra] = tables.filter((row) => row.host === host);
		const wrong = CALL_FACTS_COLUMNS.filter((column, index) => {
			const found = installed[index];
			return (
				found?.name !== column.name ||
				found.type !== column.type ||
				found.comment !== column.comment ||
				found.default_kind !== ""
			);
		});
		const index = indexes.filter((row) => row.host === host);
		const indexMatches =
			index.length === 1 &&
			index[0]?.name === CALL_FACTS_STARTED_AT_INDEX.name &&
			index[0].expr === CALL_FACTS_STARTED_AT_INDEX.expression &&
			index[0].type_full === CALL_FACTS_STARTED_AT_INDEX.type &&
			index[0].granularity === String(CALL_FACTS_STARTED_AT_INDEX.granularity);
		const engine = table?.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
		const engineMatches =
			options.expectedEngine === "ReplacingMergeTree"
				? engine === "ReplacingMergeTree(build_revision)"
				: /^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*',\s*)?build_revision\)$/u.test(
						engine,
					);
		const mismatch =
			wrong.length > 0 || installed.length !== CALL_FACTS_COLUMNS.length
				? `Call facts columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`
				: !table || extra.length > 0
					? "Call facts table is missing"
					: !engineMatches ||
							table.sorting_key !== KEY ||
							table.primary_key !== KEY ||
							table.partition_key !== "" ||
							table.storage_policy !== options.expectedStoragePolicy ||
							table.comment !== CALL_FACTS_COMMENT ||
							!SETTINGS.every((setting) => table.engine_full.includes(setting))
						? "Call facts table mismatch (engine_full, key, settings, comment)"
						: !indexMatches
							? "Call facts started_at skip index mismatch"
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
		await runCallFactsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", CALL_FACTS_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "ReplacingMergeTree"
				: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(`Applied/validated: ${CALL_FACTS_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
