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
import { RUN_REQUEST_COLUMNS } from "../src/run-index.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

/** The requests of each run index build (docs/l1-literal-schema.md, "Scale"). */
export const RUN_REQUESTS_MIGRATION = "20261012150000_run_requests.sql";
const TABLE = "run_requests";
const KEY =
	"organization_id, user_id, session_id, revision, parser_version, index_version, build_revision, agent_id, start_record";
const COMMENT =
	"L1 requests (one model response and its calls) of each run index build, committed by the build's run index receipt; written only by the reconciliation worker.";
const SETTINGS = [
	"index_granularity = 1024",
	"index_granularity_bytes = 1048576",
	"non_replicated_deduplication_window = 1000",
];

type Engine = "ReplacingMergeTree" | "SharedReplacingMergeTree";

/**
 * Creates `rudel.run_requests` once and journals it only after every replica
 * serves the exact schema (columns, comments, engine, key, settings), as the
 * run index runner does: ClickHouse Cloud applies DDL to replicas
 * asynchronously, and the worker writes requests in the same build as runs.
 */
export async function runRunRequestsMigration(options: {
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
		(entry) => entry.name === RUN_REQUESTS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Run requests migration checksum mismatch");
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
		"the run requests tables",
	);
	for (let attempt = 1; ; attempt++) {
		const mismatch = await schemaMismatch(options, replicas);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		// Halfway, apply the idempotent statement again in case it did not land.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: RUN_REQUESTS_MIGRATION,
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

/** Why the installed table differs from its definition on any replica, or null. */
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
		return `Run requests table visible on ${hosts.size} of ${Math.max(1, replicas)} replicas`;
	for (const host of hosts) {
		const installed = columns.filter((column) => column.host === host);
		const [table, ...extra] = tables.filter((row) => row.host === host);
		const wrong = RUN_REQUEST_COLUMNS.filter((column, index) => {
			const found = installed[index];
			return (
				found?.name !== column.name ||
				found.type !== column.type ||
				found.comment !== column.comment ||
				found.default_kind !== ""
			);
		});
		const engine = table?.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
		const engineMatches =
			options.expectedEngine === "ReplacingMergeTree"
				? engine === "ReplacingMergeTree(build_revision)"
				: /^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*',\s*)?build_revision\)$/u.test(
						engine,
					);
		const mismatch =
			wrong.length > 0 || installed.length !== RUN_REQUEST_COLUMNS.length
				? `Run requests columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`
				: !table || extra.length > 0
					? "Run requests table is missing"
					: !engineMatches ||
							table.sorting_key !== KEY ||
							table.primary_key !== KEY ||
							table.partition_key !== "" ||
							table.storage_policy !== options.expectedStoragePolicy ||
							table.comment !== COMMENT ||
							!SETTINGS.every((setting) => table.engine_full.includes(setting))
						? "Run requests table mismatch (engine_full, key, settings, comment)"
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
		await runRunRequestsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(import.meta.dir, "../chx/migrations", RUN_REQUESTS_MIGRATION),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "ReplacingMergeTree"
				: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(`Applied/validated: ${RUN_REQUESTS_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
