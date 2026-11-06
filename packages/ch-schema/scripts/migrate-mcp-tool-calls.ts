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
	MCP_TOOL_CALL_COLUMNS,
	MCP_TOOL_CALLS_COMMENT,
	MCP_TOOL_CALLS_MIGRATION,
	MCP_TOOL_CALLS_ORDER_BY,
	MCP_TOOL_CALLS_PARTITION_BY,
	MCP_TOOL_CALLS_TTL,
} from "../src/mcp-tool-calls.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

export { MCP_TOOL_CALLS_MIGRATION };

const TABLE = "mcp_tool_calls";
const KEY = MCP_TOOL_CALLS_ORDER_BY.join(", ");
const SETTINGS = ["index_granularity = 8192", "ttl_only_drop_parts = 1"];

type Engine = "MergeTree" | "SharedMergeTree";

export async function runMcpToolCallsMigration(options: {
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
		(entry) => entry.name === MCP_TOOL_CALLS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("MCP tool calls migration checksum mismatch");
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
		"the MCP tool calls table",
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
			name: MCP_TOOL_CALLS_MIGRATION,
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
interface InstalledTable {
	host: string;
	engine_full: string;
	sorting_key: string;
	primary_key: string;
	partition_key: string;
	storage_policy: string;
	comment: string;
}

export function engineMatches(engineFull: string, expected: Engine): boolean {
	const engine =
		engineFull.split(/ (?:PARTITION BY|PRIMARY KEY|ORDER BY) /u, 1)[0] ?? "";
	return expected === "MergeTree"
		? engine === "MergeTree"
		: /^SharedMergeTree(?:\('[^']*',\s*'[^']*'\))?$/u.test(engine);
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
		ORDER BY host, position LIMIT 64 BY host
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
		const wrong = MCP_TOOL_CALL_COLUMNS.filter((column, index) => {
			const found = installed[index];
			return (
				found?.name !== column.name ||
				found.type !== column.type ||
				found.comment !== column.comment ||
				found.default_kind !== ""
			);
		});
		const mismatch =
			wrong.length > 0 || installed.length !== MCP_TOOL_CALL_COLUMNS.length
				? `${TABLE} columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`
				: !table || extra.length > 0
					? `${TABLE} table is missing`
					: !engineMatches(table.engine_full, options.expectedEngine) ||
							table.sorting_key !== KEY ||
							table.primary_key !== KEY ||
							table.partition_key !== MCP_TOOL_CALLS_PARTITION_BY ||
							table.storage_policy !== options.expectedStoragePolicy ||
							table.comment !== MCP_TOOL_CALLS_COMMENT ||
							!table.engine_full.includes(`TTL ${MCP_TOOL_CALLS_TTL}`) ||
							!SETTINGS.every((setting) => table.engine_full.includes(setting))
						? `${TABLE} table mismatch (engine_full, key, partition, TTL, settings, comment)`
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
		await runMcpToolCallsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", MCP_TOOL_CALLS_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "MergeTree"
				: "SharedMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(`Applied/validated: ${MCP_TOOL_CALLS_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
