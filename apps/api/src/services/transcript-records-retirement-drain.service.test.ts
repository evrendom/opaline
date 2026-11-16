import { afterEach, describe, expect, test } from "bun:test";
import type { TupleParam } from "@clickhouse/client-web";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { RETIREMENT_GRACE_MS } from "./generation-retirement/retirement.js";
import {
	drainTranscriptRecordsRetirement,
	RETIREMENT_DELETE_MAX_EXECUTION_SECONDS,
	RETIREMENT_DRAIN_REQUEST_TIMEOUT_MS,
} from "./transcript-records-retirement-drain.service.js";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const past = -RETIREMENT_GRACE_MS - 60_000;

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

interface GenerationRow {
	user_id: string;
	session_id: string;
	revision_text: string;
	parser_version: number;
	receipt_head: string;
}

function generation(
	sessionId: string,
	revision: string,
	parserVersion: number,
	head: string,
	userId = "u1",
): GenerationRow {
	return {
		user_id: userId,
		session_id: sessionId,
		revision_text: revision,
		parser_version: parserVersion,
		receipt_head: head,
	};
}

function fakeExecutor(input: {
	census: { organization_id: string; user_id: string; session_id: string }[];
	generations: GenerationRow[];
}) {
	const queries: ClickHouseStatement[] = [];
	const executes: ClickHouseStatement[] = [];
	const executor = {
		async execute(statement: ClickHouseStatement) {
			executes.push(statement);
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			if (statement.query.includes("system.mutations"))
				return [{ pending: 0 }] as T[];
			if (statement.query.includes("SELECT 1 AS found"))
				return [{ found: 1 }] as T[];
			queries.push(statement);
			if (statement.query.includes("HAVING uniqExact"))
				return input.census.slice(
					0,
					Number(statement.query_params?.limit),
				) as T[];
			const sessionIds = (statement.query_params?.sessions as TupleParam[]).map(
				(tuple) => tuple.values[1],
			);
			return input.generations
				.filter((row) => sessionIds.includes(row.session_id))
				.map((row) => ({
					...row,
					receipts: row.receipt_head ? 1 : 0,
					published_ms: 0,
					written_ms: 0,
				})) as T[];
		},
	} as unknown as ClickHouseExecutor;
	return { executor, queries, executes };
}

const sessionsOf = (statement: ClickHouseStatement) =>
	(statement.query_params?.keys as TupleParam[]).map(
		(key) => `${key.values[0]}/${key.values[1]}`,
	);

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
	const selfHosted = process.env.OPALINE_SELF_HOSTED;
	afterEach(() => {
		if (selfHosted === undefined) delete process.env.OPALINE_SELF_HOSTED;
		else process.env.OPALINE_SELF_HOSTED = selfHosted;
	});

	test("a preview reads but never writes", async () => {
		const fake = fakeExecutor({ census, generations });
		const result = await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: false,
		});
		expect(fake.executes).toEqual([]);
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

	test("deletes page by page, never mixing organizations, and waits for each mutation", async () => {
		delete process.env.OPALINE_SELF_HOSTED;
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
		expect(
			fake.executes.map((statement) => [
				statement.query_params?.organizationId,
				sessionsOf(statement),
			]),
		).toEqual([
			["o1", ["u1/a", "u1/b"]],
			["o1", ["u1/c"]],
			["o2", ["u1/d"]],
		]);
		expect(pauses).toEqual([5, 5, 5]);
		for (const statement of fake.executes) {
			expect(statement.query).toContain("DELETE FROM rudel.transcript_records");
			expect(statement.clickhouse_settings).toMatchObject({
				lightweight_deletes_sync: "1",
				max_execution_time: RETIREMENT_DELETE_MAX_EXECUTION_SECONDS,
			});
		}
		expect(RETIREMENT_DRAIN_REQUEST_TIMEOUT_MS).toBeGreaterThan(
			RETIREMENT_DELETE_MAX_EXECUTION_SECONDS * 1000,
		);
	});

	test("deletes the retired generations' record commands before their records", async () => {
		process.env.OPALINE_SELF_HOSTED = "1";
		const fake = fakeExecutor({
			census: census.slice(0, 1),
			generations: generations.slice(0, 2),
		});
		await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
		});
		expect(
			fake.executes.map((statement) => [
				/DELETE FROM (\S+)/u.exec(statement.query)?.[1],
				sessionsOf(statement),
			]),
		).toEqual([
			["rudel.transcript_record_commands", ["u1/a"]],
			["rudel.transcript_records", ["u1/a"]],
		]);
	});

	test("is bounded by maxSessions and reports what is left", async () => {
		const fake = fakeExecutor({ census, generations });
		const result = await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
			maxSessions: 3,
		});
		expect(fake.queries[0]?.query_params?.limit).toBe(4);
		expect(fake.queries[0]?.clickhouse_settings).toMatchObject({
			max_result_rows: "4",
			result_overflow_mode: "throw",
		});
		expect(result).toMatchObject({ sessionCount: 3, hasMore: true });
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

	test("never retires a session the census did not name", async () => {
		delete process.env.OPALINE_SELF_HOSTED;
		const fake = fakeExecutor({
			census: [
				{ organization_id: "o1", user_id: "u1", session_id: "a" },
				{ organization_id: "o1", user_id: "u2", session_id: "b" },
			],
			generations: [
				generation("a", "5", 8, receipt(iso(past)), "u1"),
				generation("a", "5", 7, receipt(iso(past - 1)), "u1"),
				generation("a", "5", 8, receipt(iso(past)), "u2"),
				generation("a", "5", 7, receipt(iso(past - 1)), "u2"),
			],
		});
		await drainTranscriptRecordsRetirement(fake.executor, {
			...options,
			execute: true,
		});
		expect(fake.executes.map(sessionsOf)).toEqual([["u1/a"]]);
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
