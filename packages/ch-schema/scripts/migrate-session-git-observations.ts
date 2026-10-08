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
	SESSION_GIT_OBSERVATIONS_KEY,
	sessionGitObservationsTable,
} from "../src/db/schema/session-git-observations.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

export const SESSION_GIT_OBSERVATIONS_MIGRATION =
	"20261001160000_session_git_observations.sql";
/** Additive `run_id` column (git extractor version 3). */
export const SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION =
	"20261007180000_session_git_observation_run_ids.sql";

export async function runSessionGitObservationsMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	runIdsMigrationSql: string;
	targetDatabase: string;
	expectedEngine: "ReplacingMergeTree" | "SharedReplacingMergeTree";
	expectedStoragePolicy: string;
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const journal = (await options.journalStore.readJournal()).applied;
	const ordered: readonly (readonly [string, string])[] = [
		[SESSION_GIT_OBSERVATIONS_MIGRATION, options.migrationSql],
		[SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION, options.runIdsMigrationSql],
	];
	const steps = ordered.map(([name, sql]) => {
		const checksum = checksumSQL(sql);
		const applied = journal.filter((entry) => entry.name === name);
		if (applied.some((entry) => entry.checksum !== checksum))
			throw new Error(`Git observations migration checksum mismatch: ${name}`);
		return { name, sql, checksum, applied: applied.length > 0 };
	});
	for (const step of steps)
		if (!step.applied)
			for (const statement of extractExecutableStatements(step.sql))
				await options.executor.execute(statement);
	const columns = await options.executor.query<{
		name: string;
		type: string;
		comment: string;
		default_kind: string;
	}>(`
		SELECT name, type, comment, default_kind FROM system.columns
		WHERE database = '${options.targetDatabase}' AND table = 'session_git_observations'
		ORDER BY position LIMIT 30 SETTINGS max_execution_time = 10`);
	const tables = await options.executor.query<{
		engine_full: string;
		sorting_key: string;
		primary_key: string;
		partition_key: string;
		storage_policy: string;
		comment: string;
	}>(`
		SELECT engine_full, sorting_key, primary_key, partition_key, storage_policy, comment FROM system.tables
		WHERE database = '${options.targetDatabase}' AND name = 'session_git_observations'
		LIMIT 2 SETTINGS max_execution_time = 10`);
	const definition = sessionGitObservationsTable;
	const table = tables[0];
	const engine = table?.engine_full.split(" PRIMARY KEY ", 1)[0];
	const engineMatches =
		options.expectedEngine === "ReplacingMergeTree"
			? engine === "ReplacingMergeTree" || engine === "ReplacingMergeTree()"
			: engine === "SharedReplacingMergeTree" ||
				/^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*')?\)$/u.test(
					engine ?? "",
				);
	if (
		columns.length !== definition.columns.length ||
		!columns.every((column, index) => {
			const expected = definition.columns[index];
			return (
				expected &&
				column.name === expected.name &&
				column.type === expected.type &&
				column.comment === expected.comment &&
				column.default_kind === ""
			);
		}) ||
		tables.length !== 1 ||
		!table ||
		!engineMatches ||
		table.sorting_key !== SESSION_GIT_OBSERVATIONS_KEY.join(", ") ||
		table.primary_key !== table.sorting_key ||
		table.partition_key !== "" ||
		table.storage_policy !== options.expectedStoragePolicy ||
		table.comment !== definition.comment ||
		![
			"index_granularity = 1024",
			"index_granularity_bytes = 1048576",
			"non_replicated_deduplication_window = 1000",
		].every((setting) => table.engine_full.includes(setting))
	) {
		throw new Error(
			"Session git observations schema mismatch (including engine_full, key, settings and COMMENTs)",
		);
	}
	for (const step of steps)
		if (!step.applied)
			await appendJournalEntryWithReconciliation(options.journalStore, {
				name: step.name,
				checksum: step.checksum,
				appliedAt: new Date().toISOString().replace("Z", ""),
			});
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
		await runSessionGitObservationsMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					SESSION_GIT_OBSERVATIONS_MIGRATION,
				),
				"utf8",
			),
			runIdsMigrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					SESSION_GIT_OBSERVATION_RUN_IDS_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "ReplacingMergeTree"
				: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(`Applied/validated: ${SESSION_GIT_OBSERVATIONS_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
