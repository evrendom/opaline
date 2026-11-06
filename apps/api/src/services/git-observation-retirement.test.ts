import { describe, expect, test } from "bun:test";
import type { TupleParam } from "@clickhouse/client-web";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { DELETE_KEYS_PER_STATEMENT } from "./clickhouse-batched-delete.js";
import { retireOlderGitObservations } from "./git-observation-extraction.service.js";
import { retireOlderTranscriptChunkHits } from "./transcript-search/session-index.service.js";

function generation(index: number, organizationId = "o1") {
	return {
		organization_id: organizationId,
		user_id: "u1",
		source: index % 2 === 0 ? "claude_code" : "codex",
		session_id: `s${String(index).padStart(4, "0")}`,
		revision: String(100 + index),
		parser_version: 773,
	};
}

function recording(older: ReturnType<typeof generation>[]) {
	const reads: ClickHouseStatement[] = [];
	const windows: ClickHouseStatement[] = [];
	const deletes: ClickHouseStatement[] = [];
	const executor = {
		query: async (statement: ClickHouseStatement) => {
			if (statement.query.includes("system.mutations")) return [{ pending: 0 }];
			if (statement.query.startsWith("SELECT 1 AS found"))
				return [{ found: 1 }];
			if (statement.query.includes("mergeTreeIndex")) {
				windows.push(statement);
				return [];
			}
			reads.push(statement);
			return older.slice(0, Number(statement.query_params?.limit));
		},
		execute: async (statement: ClickHouseStatement) => {
			deletes.push(statement);
		},
	} as unknown as ClickHouseExecutor;
	return { executor, reads, windows, deletes };
}

describe("retireOlderGitObservations", () => {
	test("deletes exactly the older generations it read, one keyed statement per organization and bounded batch", async () => {
		const older = [
			...Array.from({ length: DELETE_KEYS_PER_STATEMENT + 1 }, (_, index) =>
				generation(index),
			),
			generation(0, "o2"),
		];
		const run = recording(older);

		const retirement = await retireOlderGitObservations(run.executor);

		expect(retirement).toMatchObject({
			generations: older.length,
			retired: older.length,
			hasMore: false,
		});
		expect(run.reads[0]?.query).toContain(
			"max(tuple(revision, parser_version)) AS head",
		);
		expect(run.reads[0]?.query).toContain(
			"tuple(o.revision, o.parser_version) < h.head",
		);
		expect(run.reads[0]?.clickhouse_settings).toMatchObject({
			max_rows_to_read: "4000000",
			max_bytes_to_read: String(1024 ** 3),
			max_execution_time: 10,
		});
		expect(run.windows[0]?.query_params).toMatchObject({
			table: "session_git_observations",
			windowRows: 1_000_000,
		});
		expect(run.deletes).toHaveLength(3);
		for (const statement of run.deletes) {
			expect(statement.query).toBe(
				"DELETE FROM rudel.session_git_observations WHERE organization_id = {organizationId:String} AND (user_id, source, session_id, revision, parser_version) IN {keys:Array(Tuple(String, String, String, UInt64, UInt16))}",
			);
			expect(statement.clickhouse_settings).toMatchObject({
				lightweight_deletes_sync: "1",
				max_execution_time: 60,
			});
			expect(statement.query_id).toMatch(
				/^opaline-delete-session_git_observations-[0-9a-f]{20}-1$/u,
			);
		}
		expect(
			run.deletes.map((statement) => [
				statement.query_params?.organizationId,
				(statement.query_params?.keys as TupleParam[]).length,
			]),
		).toEqual([
			["o1", DELETE_KEYS_PER_STATEMENT],
			["o1", 1],
			["o2", 1],
		]);
		const [first] = run.deletes[0]?.query_params?.keys as TupleParam[];
		expect(first?.values).toEqual(["u1", "claude_code", "s0000", 100n, 773]);
	});

	test("reads every organization when none is named, one organization's when named", async () => {
		const all = recording([]);
		expect(await retireOlderGitObservations(all.executor)).toMatchObject({
			generations: 0,
			retired: 0,
		});
		expect(all.reads[0]?.query).not.toContain("{organizationId:String}");
		const one = recording([]);
		await retireOlderGitObservations(one.executor, { organizationId: "o1" });
		expect(one.reads[0]?.query_params).toMatchObject({ organizationId: "o1" });
		expect(one.deletes).toHaveLength(0);
	});

	test("stops before a statement the deadline cannot fit, and says more remain", async () => {
		const run = recording([generation(1)]);
		const retirement = await retireOlderGitObservations(run.executor, {
			deadline: { deadlineAt: 10_000, now: () => 0 },
		});
		expect(retirement).toMatchObject({ retired: 0, hasMore: true });
		expect(run.deletes).toHaveLength(0);
	});

	test("reports more when the census reaches its limit", async () => {
		const run = recording([generation(1), generation(2), generation(3)]);
		const retirement = await retireOlderGitObservations(run.executor, {
			limit: 2,
		});
		expect(run.reads[0]?.query_params).toMatchObject({ limit: 2 });
		expect(retirement).toMatchObject({
			generations: 2,
			retired: 2,
			hasMore: true,
		});
	});
});

describe("retireOlderTranscriptChunkHits", () => {
	test("keeps the source and generation of each hit generation it deletes", async () => {
		const run = recording([generation(1)]);
		await retireOlderTranscriptChunkHits(run.executor);
		expect(run.reads[0]?.query).toContain("FROM rudel.transcript_chunk_hits\n");
		expect(run.deletes[0]?.query).toBe(
			"DELETE FROM rudel.transcript_chunk_hits WHERE organization_id = {organizationId:String} AND (user_id, source, session_id, revision, parser_version) IN {keys:Array(Tuple(String, String, String, UInt64, UInt16))}",
		);
		const [key] = run.deletes[0]?.query_params?.keys as TupleParam[];
		expect(key?.values).toEqual(["u1", "codex", "s0001", 101n, 773]);
	});
});
