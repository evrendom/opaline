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
import { runQuestionAnswersTable } from "../src/db/schema/run-question-answers.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

/** Run question answers (CONTEXT.md "Run question"). */
export const RUN_QUESTION_ANSWERS_MIGRATION =
	"20261012140000_run_question_answers.sql";
const TABLE = runQuestionAnswersTable as unknown as {
	name: string;
	columns: { name: string; type: string; comment: string }[];
	orderBy: string[];
	comment: string;
};

type Engine = "ReplacingMergeTree" | "SharedReplacingMergeTree";

/**
 * Creates `rudel.run_question_answers` once and journals it only after the
 * endpoint serves the exact schema (columns, comments, engine, key, storage
 * policy, comment). ClickHouse Cloud applies DDL to replicas asynchronously,
 * so the read-back retries while the endpoint's replica lags; the API only
 * writes answers after an operator configures a provider.
 */
export async function runRunQuestionAnswersMigration(options: {
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
		(entry) => entry.name === RUN_QUESTION_ANSWERS_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Run question answers migration checksum mismatch");
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const mismatch = await schemaMismatch(options);
		if (mismatch === null) break;
		if (attempt >= attempts) throw new Error(mismatch);
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: RUN_QUESTION_ANSWERS_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why the installed table differs from its definition, or null. */
async function schemaMismatch(options: {
	executor: ClickHouseExecutor;
	targetDatabase: string;
	expectedEngine: Engine;
	expectedStoragePolicy: string;
}): Promise<string | null> {
	const database = options.targetDatabase;
	const columns = await options.executor.query<{
		name: string;
		type: string;
		comment: string;
		default_kind: string;
	}>(`
		SELECT name, type, comment, default_kind FROM system.columns
		WHERE database = '${database}' AND table = '${TABLE.name}'
		ORDER BY position LIMIT 256 SETTINGS max_execution_time = 10`);
	const wrong = TABLE.columns.filter((expected, index) => {
		const column = columns[index];
		return (
			!column ||
			column.name !== expected.name ||
			column.type !== expected.type ||
			column.comment !== expected.comment ||
			column.default_kind !== ""
		);
	});
	if (wrong.length > 0 || columns.length !== TABLE.columns.length)
		return `Run question answers columns mismatch: ${wrong.map((column) => column.name).join(", ") || "unexpected columns"}`;
	const [table] = await options.executor.query<{
		engine_full: string;
		sorting_key: string;
		primary_key: string;
		partition_key: string;
		storage_policy: string;
		comment: string;
	}>(`
		SELECT engine_full, sorting_key, primary_key, partition_key, storage_policy, comment
		FROM system.tables
		WHERE database = '${database}' AND name = '${TABLE.name}'
		LIMIT 1 SETTINGS max_execution_time = 10`);
	if (!table) return "Run question answers table is missing";
	const engine = table.engine_full.split(" PRIMARY KEY ", 1)[0] ?? "";
	const engineMatches =
		options.expectedEngine === "ReplacingMergeTree"
			? engine === "ReplacingMergeTree(answered_at)"
			: /^SharedReplacingMergeTree\((?:'[^']*',\s*'[^']*',\s*)?answered_at\)$/u.test(
					engine,
				);
	if (
		!engineMatches ||
		table.sorting_key !== TABLE.orderBy.join(", ") ||
		table.primary_key !== table.sorting_key ||
		table.partition_key !== "" ||
		table.storage_policy !== options.expectedStoragePolicy ||
		table.comment !== TABLE.comment
	)
		return "Run question answers table mismatch (engine_full, key, storage policy, comment)";
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
		await runRunQuestionAnswersMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					RUN_QUESTION_ANSWERS_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
			expectedEngine: isLocalClickHouseEndpoint(url)
				? "ReplacingMergeTree"
				: "SharedReplacingMergeTree",
			expectedStoragePolicy: "s3",
		});
		console.log(`Applied/validated: ${RUN_QUESTION_ANSWERS_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
