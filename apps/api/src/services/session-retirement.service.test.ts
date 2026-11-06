import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { runSessionRetirementPass } from "./session-retirement.service.js";

function executorReading(
	failWhen: (statement: ClickHouseStatement) => boolean = () => false,
) {
	const reads: string[] = [];
	const deletes: ClickHouseStatement[] = [];
	const executor = {
		async query(statement: ClickHouseStatement) {
			if (statement.query.includes("mergeTreeIndex")) return [];
			const table = /FROM (rudel\.\w+)/u.exec(statement.query)?.[1] ?? "";
			reads.push(table);
			if (failWhen(statement)) throw new Error(`census of ${table} failed`);
			return [];
		},
		async execute(statement: ClickHouseStatement) {
			deletes.push(statement);
		},
	} as unknown as ClickHouseExecutor;
	return { executor, reads, deletes };
}

const at = (hour: number) => {
	const now = Date.UTC(2026, 10, 6, hour, 40);
	return { deadlineAt: now + 270_000, now: () => now };
};

describe("runSessionRetirementPass", () => {
	test("with nothing superseded it reads each store once and deletes nothing", async () => {
		const run = executorReading();
		const result = await runSessionRetirementPass({
			executor: run.executor,
			deadline: at(0),
		});
		expect(run.reads).toEqual([
			"rudel.session_git_observations",
			"rudel.transcript_chunk_hits",
			"rudel.run_index",
			"rudel.transcript_records",
		]);
		expect(run.deletes).toHaveLength(0);
		for (const step of Object.values(result))
			expect(step).toMatchObject({
				status: "ok",
				retired: 0,
				deleteStatements: 0,
				hasMore: false,
			});
	});

	test("starts from a different store each hour so a backlog cannot starve the others", async () => {
		const run = executorReading();
		await runSessionRetirementPass({ executor: run.executor, deadline: at(2) });
		expect(run.reads).toEqual([
			"rudel.run_index",
			"rudel.transcript_records",
			"rudel.session_git_observations",
			"rudel.transcript_chunk_hits",
		]);
	});

	test("a failing store is reported and the others still run", async () => {
		const run = executorReading((statement) =>
			statement.query.includes("rudel.transcript_records"),
		);
		const result = await runSessionRetirementPass({
			executor: run.executor,
			deadline: at(0),
		});
		expect(result.transcriptRecords).toMatchObject({
			status: "failed",
			error: "census of rudel.transcript_records failed",
		});
		expect(result.gitObservations.status).toBe("ok");
		expect(result.chunkHits.status).toBe("ok");
		expect(result.runIndex.status).toBe("ok");
	});
});
