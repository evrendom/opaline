import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { TRANSCRIPT_RECORDS_RETIRE_GRACE_MS } from "./transcript-records-ingest.service.js";
import {
	buildRetirementDelete,
	drainTranscriptRecordsRetirement,
	type RetirementGenerationRow,
	selectSessionRetirements,
} from "./transcript-records-retirement-drain.service.js";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function receipt(publishedAt: string, rowCount = 10): string {
	return JSON.stringify({
		contentSha256: "x",
		lineCount: 1,
		oversizedLineCount: 0,
		parserVersion: 8,
		publishedAt,
		rowCount,
		streamCount: 1,
		textTruncated: false,
		unparseableLineCount: 0,
	});
}

function generation(
	sessionId: string,
	revision: string,
	parserVersion: number,
	head: string,
	userId = "u1",
): RetirementGenerationRow {
	return {
		user_id: userId,
		session_id: sessionId,
		revision_text: revision,
		parser_version: parserVersion,
		receipt_head: head,
	};
}

/** Answers the census and page reads; records every statement. */
function fakeExecutor(input: {
	census: { organization_id: string; user_id: string; session_id: string }[];
	generations: RetirementGenerationRow[];
}) {
	const queries: ClickHouseStatement[] = [];
	const executes: ClickHouseStatement[] = [];
	let inserts = 0;
	const executor: ClickHouseExecutor = {
		close: async () => {},
		async execute(statement) {
			executes.push(statement);
		},
		async insert() {
			inserts++;
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			queries.push(statement);
			if (statement.query.includes("HAVING uniqExact")) {
				const limit = Number(statement.query_params?.maxSessions);
				return input.census.slice(0, limit) as T[];
			}
			const sessionIds = statement.query_params?.sessionIds as string[];
			return input.generations.filter((row) =>
				sessionIds.includes(row.session_id),
			) as T[];
		},
	};
	return { executor, queries, executes, inserts: () => inserts };
}

const past = -TRANSCRIPT_RECORDS_RETIRE_GRACE_MS - 60_000;

describe("selectSessionRetirements", () => {
	test("retires what the committed generation superseded past the grace, never it or a newer build", () => {
		const retired = selectSessionRetirements(
			[
				// A build in flight above the committed generation.
				generation("s", "20", 9, ""),
				generation("s", "20", 8, receipt(iso(past))),
				generation("s", "20", 7, receipt(iso(past - 1_000), 5)),
				generation("s", "10", 8, ""),
			],
			NOW,
		);
		expect(
			retired.map((entry) => [
				entry.generation.revision,
				entry.generation.parserVersion,
				entry.rows,
			]),
		).toEqual([
			["20", 7, 5],
			["10", 8, null],
		]);
	});

	test("keeps a committed generation superseded inside the grace; crashed ones go at once", () => {
		const retired = selectSessionRetirements(
			[
				generation("s", "20", 8, receipt(iso(-60_000))),
				generation("s", "20", 7, receipt(iso(past))),
				generation("s", "19", 8, ""),
			],
			NOW,
		);
		expect(retired.map((entry) => entry.generation)).toEqual([
			{ revision: "19", parserVersion: 8 },
		]);
	});

	test("orders revisions numerically, not as text", () => {
		const retired = selectSessionRetirements(
			[
				generation("s", "9", 8, receipt(iso(past - 1_000))),
				generation("s", "10", 8, receipt(iso(past))),
			],
			NOW,
		);
		expect(retired.map((entry) => entry.generation.revision)).toEqual(["9"]);
	});

	test("retires nothing without a readable committed receipt", () => {
		expect(
			selectSessionRetirements(
				[generation("s", "2", 8, "not json"), generation("s", "1", 8, "")],
				NOW,
			),
		).toEqual([]);
	});
});

describe("drainTranscriptRecordsRetirement", () => {
	const census = [
		{ organization_id: "o1", user_id: "u1", session_id: "a" },
		{ organization_id: "o1", user_id: "u1", session_id: "b" },
		{ organization_id: "o1", user_id: "u1", session_id: "c" },
		{ organization_id: "o2", user_id: "u1", session_id: "d" },
	];
	const generations = ["a", "b", "c", "d"].flatMap((sessionId) => [
		generation(sessionId, "5", 8, receipt(iso(past))),
		generation(sessionId, "5", 7, receipt(iso(past - 1_000), 7)),
	]);
	const options = {
		maxSessions: 100,
		pageSize: 2,
		pauseMs: 0,
		now: () => NOW,
	};

	test("a preview reads but never writes", async () => {
		const fake = fakeExecutor({ census, generations });
		const result = await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: false,
		});
		expect(fake.executes).toEqual([]);
		expect(fake.inserts()).toBe(0);
		expect(result).toMatchObject({
			status: "preview",
			sessionCount: 4,
			sessionsRetired: 4,
			generations: 4,
			committedGenerations: 4,
			rows: 28,
			deleteStatements: 0,
			hasMore: false,
		});
	});

	test("executes one DELETE per page, never mixing organizations", async () => {
		const fake = fakeExecutor({ census, generations });
		const pauses: number[] = [];
		const result = await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
			pauseMs: 5,
			sleep: async (ms) => {
				pauses.push(ms);
			},
		});
		expect(result).toMatchObject({
			status: "completed",
			generations: 4,
			deleteStatements: 3,
		});
		// Pages: [a, b] and [c] of o1, then [d] of o2.
		expect(
			fake.executes.map((statement) => [
				statement.query_params?.organizationId,
				statement.query_params?.sessionIds,
			]),
		).toEqual([
			["o1", ["a", "b"]],
			["o1", ["c"]],
			["o2", ["d"]],
		]);
		expect(pauses).toEqual([5, 5, 5]);
		for (const statement of fake.executes) {
			expect(statement.query).toContain("DELETE FROM rudel.transcript_records");
			expect(statement.clickhouse_settings).toMatchObject({
				lightweight_deletes_sync: "1",
			});
		}
	});

	test("is bounded by maxSessions and reports what is left", async () => {
		const fake = fakeExecutor({ census, generations });
		const result = await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
			maxSessions: 3,
		});
		expect(fake.queries[0]?.query_params?.maxSessions).toBe(4);
		expect(fake.queries[0]?.clickhouse_settings).toMatchObject({
			max_result_rows: "4",
			result_overflow_mode: "throw",
		});
		expect(result).toMatchObject({ sessionCount: 3, hasMore: true });
		expect(fake.executes).toHaveLength(2);
	});

	test("counts sessions held back instead of deleting nothing", async () => {
		const fake = fakeExecutor({
			census: [{ organization_id: "o1", user_id: "u1", session_id: "a" }],
			generations: [
				generation("a", "5", 8, receipt(iso(-1_000))),
				generation("a", "5", 7, receipt(iso(past))),
			],
		});
		const result = await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
		});
		expect(result).toMatchObject({ sessionsHeld: 1, generations: 0 });
		expect(fake.executes).toEqual([]);
	});

	test("ignores generations of other sessions the page read matched", async () => {
		const fake = fakeExecutor({
			census: [
				{ organization_id: "o1", user_id: "u1", session_id: "a" },
				{ organization_id: "o1", user_id: "u2", session_id: "b" },
			],
			generations: [
				generation("a", "5", 8, receipt(iso(past)), "u1"),
				generation("a", "5", 7, receipt(iso(past - 1)), "u1"),
				// (u2, a) is not in the census: never retired.
				generation("a", "5", 8, receipt(iso(past)), "u2"),
				generation("a", "5", 7, receipt(iso(past - 1)), "u2"),
			],
		});
		await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
		});
		expect(fake.executes).toHaveLength(1);
		expect(fake.executes[0]?.query_params).toMatchObject({ userId0: "u1" });
		expect(fake.executes[0]?.query_params).not.toHaveProperty("userId1");
	});

	test("rejects unbounded or invalid options before reading", async () => {
		const fake = fakeExecutor({ census, generations });
		for (const invalid of [
			{ maxSessions: 0 },
			{ pageSize: 0 },
			{ pageSize: 101 },
			{ pauseMs: -1 },
			{ organizationId: "" },
		])
			await expect(
				drainTranscriptRecordsRetirement(fake.executor, {
					...options,
					execute: false,
					...invalid,
				}),
			).rejects.toThrow();
		expect(fake.queries).toEqual([]);
	});
});

describe("buildRetirementDelete", () => {
	test("deletes exactly the named generations of one organization", () => {
		const statement = buildRetirementDelete("o1", [
			{
				userId: "u1",
				sessionId: "a",
				generation: { revision: "5", parserVersion: 7 },
				rows: 1,
			},
		]);
		expect(statement.query).toContain(
			"(user_id = {userId0:String} AND session_id = {sessionId0:String} AND revision = {revision0:UInt64} AND parser_version = {parserVersion0:UInt16})",
		);
		expect(statement.query_params).toEqual({
			organizationId: "o1",
			sessionIds: ["a"],
			userId0: "u1",
			sessionId0: "a",
			revision0: "5",
			parserVersion0: 7,
		});
	});
});
