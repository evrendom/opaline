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
import { GITHUB_OUTCOME_TABLES } from "../src/github-outcomes.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

export const GITHUB_OUTCOMES_MIGRATION = "20261001120000_github_outcomes.sql";

export async function runGitHubOutcomesMigration(input: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	local: boolean;
}): Promise<void> {
	const checksum = checksumSQL(input.migrationSql);
	const entries = (await input.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === GITHUB_OUTCOMES_MIGRATION,
	);
	if (entries.some((entry) => entry.checksum !== checksum))
		throw new Error("GitHub outcomes migration checksum mismatch");
	if (entries.length === 0) {
		const sql = input.local
			? input.migrationSql
					.replaceAll("SharedReplacingMergeTree", "ReplacingMergeTree")
					.replaceAll(
						/SETTINGS storage_policy = 's3', non_replicated_deduplication_window = 1000/g,
						"",
					)
			: input.migrationSql;
		for (const statement of extractExecutableStatements(sql))
			await input.executor.execute(statement);
	}
	await assertGitHubOutcomesSchema(input.executor, input.local);
	if (entries.length === 0)
		await appendJournalEntryWithReconciliation(input.journalStore, {
			name: GITHUB_OUTCOMES_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

export async function assertGitHubOutcomesSchema(
	executor: ClickHouseExecutor,
	local: boolean,
): Promise<void> {
	for (const definition of GITHUB_OUTCOME_TABLES) {
		const columns = await executor.query<{
			name: string;
			type: string;
			default_kind: string;
			default_expression: string;
			comment: string;
		}>(
			`SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = 'rudel' AND table = '${definition.name}' ORDER BY position LIMIT 100 SETTINGS max_execution_time = 10`,
		);
		const tables = await executor.query<{
			engine_full: string;
			sorting_key: string;
			primary_key: string;
			partition_key: string;
			storage_policy: string;
			create_table_query: string;
		}>(
			`SELECT engine_full, sorting_key, primary_key, partition_key, storage_policy, create_table_query FROM system.tables WHERE database = 'rudel' AND name = '${definition.name}' LIMIT 2 SETTINGS max_execution_time = 10`,
		);
		const observed = tables[0];
		const engine = observed?.engine_full.split(" PRIMARY KEY ")[0] ?? "";
		const engineMatches = local
			? engine === "ReplacingMergeTree(version)"
			: engine === "SharedReplacingMergeTree(version)" ||
				(engine.startsWith("SharedReplacingMergeTree(") &&
					engine.endsWith(", version)"));
		const key = definition.orderBy.join(", ");
		if (
			columns.length !== definition.columns.length ||
			!columns.every((column, index) => {
				const expected = definition.columns[index];
				return (
					expected &&
					column.name === expected.name &&
					column.type === expected.type &&
					column.default_kind === "" &&
					column.default_expression === "" &&
					column.comment === expected.comment
				);
			}) ||
			tables.length !== 1 ||
			!observed ||
			!engineMatches ||
			observed.sorting_key !== key ||
			observed.primary_key !== key ||
			observed.partition_key !== "" ||
			observed.storage_policy !== (local ? "default" : "s3") ||
			(!local &&
				!/non_replicated_deduplication_window\s*=\s*1000/u.test(
					observed.create_table_query,
				)) ||
			/\bTTL\b|\bPROJECTION\b/u.test(observed.create_table_query)
		)
			throw new Error(
				`GitHub outcomes schema validation failed for ${definition.name}; do not deploy writers until drift is resolved: ${JSON.stringify({ columns, tables })}`,
			);
	}
}

async function run(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const executor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: "default",
	});
	try {
		await runGitHubOutcomesMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					GITHUB_OUTCOMES_MIGRATION,
				),
				"utf8",
			),
			local: isLocalClickHouseEndpoint(url),
		});
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	run().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
