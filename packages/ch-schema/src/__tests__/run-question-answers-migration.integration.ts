import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	RUN_QUESTION_ANSWERS_MIGRATION,
	runRunQuestionAnswersMigration,
} from "../../scripts/migrate-run-question-answers.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const connect = (database: string) =>
	createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database,
	});
const executor = connect("default");
const database = `opaline_run_question_answers_${Date.now()}`;
const drifted = `${database}_drifted`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${drifted} SYNC`);
	await executor.execute(`DROP DATABASE IF EXISTS ${database} SYNC`);
	await executor.close();
});

test("creates the answers table once, journals it, keeps the newest answer per question and run, and refuses a changed migration", async () => {
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalExecutor = connect(database);
	const journalStore = createJournalStore(journalExecutor);
	const migrationSql = (
		await readFile(
			resolve(
				import.meta.dir,
				"../../chx/migrations",
				RUN_QUESTION_ANSWERS_MIGRATION,
			),
			"utf8",
		)
	).replaceAll("rudel.", `${database}.`);
	const run = (sql = migrationSql) =>
		runRunQuestionAnswersMigration({
			executor,
			journalStore,
			migrationSql: sql,
			targetDatabase: database,
			expectedEngine: "ReplacingMergeTree",
			expectedStoragePolicy: "s3",
			readBack: { attempts: 2, delayMs: 10 },
		});
	try {
		await run();
		await run();
		const journal = await journalStore.readJournal();
		expect(
			journal.applied
				.filter((entry) => entry.name === RUN_QUESTION_ANSWERS_MIGRATION)
				.map((entry) => entry.checksum),
		).toEqual([checksumSQL(migrationSql)]);

		const answer = (probability: number, at: string) =>
			`('ws', 'u1', 's1', '', 1, 7, 'rq_1', 'Did it?', ${probability}, 'subq', 'run', 'subq-snap-1', 0.002, '${at}')`;
		await executor.execute(
			`INSERT INTO ${database}.run_question_answers
				(organization_id, user_id, session_id, agent_id, turn_idx, revision, question_id, question,
					probability, provider, input, model, cost_usd, answered_at)
				VALUES ${answer(0.2, "2026-10-12 10:00:00.000")}, ${answer(0.7, "2026-10-12 11:00:00.000")}`,
		);
		expect(
			await executor.query<{ probability: number }>(
				`SELECT probability FROM ${database}.run_question_answers FINAL`,
			),
		).toEqual([{ probability: 0.7 }]);

		await expect(run(`${migrationSql}\n-- changed`)).rejects.toThrow(
			"Run question answers migration checksum mismatch",
		);
	} finally {
		await journalExecutor.close();
	}
});

test("a table that differs from the definition fails the migration and is never journaled", async () => {
	await executor.execute(`CREATE DATABASE ${drifted}`);
	const journalExecutor = connect(drifted);
	const journalStore = createJournalStore(journalExecutor);
	const migrationSql = (
		await readFile(
			resolve(
				import.meta.dir,
				"../../chx/migrations",
				RUN_QUESTION_ANSWERS_MIGRATION,
			),
			"utf8",
		)
	).replaceAll("rudel.", `${drifted}.`);
	try {
		// An older shape: no cost column.
		await executor.execute(
			migrationSql
				.slice(migrationSql.indexOf("CREATE TABLE"))
				.replace(/\n\s*`cost_usd`[^\n]*/u, "")
				.replace(/;\s*$/u, ""),
		);
		await expect(
			runRunQuestionAnswersMigration({
				executor,
				journalStore,
				migrationSql,
				targetDatabase: drifted,
				expectedEngine: "ReplacingMergeTree",
				expectedStoragePolicy: "s3",
				readBack: { attempts: 2, delayMs: 10 },
			}),
		).rejects.toThrow("Run question answers columns mismatch: cost_usd");
		expect(
			(await journalStore.readJournal()).applied.filter(
				(entry) => entry.name === RUN_QUESTION_ANSWERS_MIGRATION,
			),
		).toEqual([]);
	} finally {
		await journalExecutor.close();
	}
});
