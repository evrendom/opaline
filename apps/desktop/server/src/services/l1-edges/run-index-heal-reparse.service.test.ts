import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { readTranscriptRecordsExtractionConfig } from "../transcript-records-extraction.service.js";
import type { HealRow } from "./run-index-heal.service.js";
import { createReparser } from "./run-index-heal-reparse.service.js";

const target: HealRow = {
	organization_id: "o",
	user_id: "u",
	session_id: "s",
	source: "claude_code",
	revision_text: "7",
	parser_version: 1,
	session_date: "2026-11-01 10:00:00.000",
	reason: "index_version",
};

function fakeClickHouse(bytes: number | null) {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {
			throw new Error("unexpected write");
		},
		insert: async () => {
			throw new Error("unexpected write");
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			statements.push(statement);
			if (statement.query.includes("AS content_bytes"))
				return (
					bytes === null ? [] : [{ content_bytes: String(bytes) }]
				) as T[];
			return [] as T[];
		},
	};
	return { executor, statements };
}

const sql = {} as postgres.Sql;
const context = (runBytes = 0) => ({
	deadline: { deadlineAt: Date.now() + 120_000, now: Date.now },
	runBytes,
});

describe("the run index heal reparse", () => {
	test("reads only the size of a session it will not reparse", async () => {
		const cases = [
			{ bytes: null, runBytes: 0, outcome: "missing" },
			{ bytes: 65, runBytes: 0, outcome: "oversized" },
			{ bytes: 40, runBytes: 70, outcome: "deferred" },
		];
		for (const { bytes, runBytes, outcome } of cases) {
			const clickhouse = fakeClickHouse(bytes);
			const reparser = createReparser({
				executor: clickhouse.executor,
				sql,
				maxSessionBytes: 64,
				maxRunBytes: 100,
			});
			expect(await reparser.reparse(target, context(runBytes))).toEqual({
				outcome: outcome as "missing",
				bytes: 0,
			});
			expect(clickhouse.statements).toHaveLength(1);
			expect(clickhouse.statements[0]?.clickhouse_settings).toMatchObject({
				readonly: "2",
			});
			expect(clickhouse.statements[0]?.query_params).toMatchObject({
				organizationId: "o",
				revision: "7",
				sessionId: "s",
				userId: "u",
			});
		}
	});

	test("a raw revision gone since the size probe is missing, and extraction turned off never reads", async () => {
		const gone = fakeClickHouse(10);
		expect(
			await createReparser({
				executor: gone.executor,
				sql,
				maxSessionBytes: 64,
				maxRunBytes: 100,
			}).reparse(target, context()),
		).toEqual({ outcome: "missing", bytes: 0 });
		expect(gone.statements).toHaveLength(2);

		const off = fakeClickHouse(10);
		expect(
			await createReparser({
				executor: off.executor,
				sql,
				config: { ...readTranscriptRecordsExtractionConfig(), enabled: false },
			}).reparse(target, context()),
		).toEqual({ outcome: "failed", bytes: 0 });
		expect(off.statements).toHaveLength(0);
	});
});
