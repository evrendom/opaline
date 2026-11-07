import { beforeEach, describe, expect, test } from "bun:test";
import type { DataChunk } from "@rudel/api-routes/cli-data";
import {
	clickHouseError,
	collect,
	contextOf,
	failure,
	fakeClickHouse,
	isSummary,
	type Sent,
	summaryRow,
} from "./cli-data.fixtures.js";
import { forgetReaches, pullTable } from "./pull-table.js";

const SECRET = "ghp_0123456789abcdefghijABCDEFGHIJ012345";

const recordRow = (sessionId: string, recordIdx: number, text = "hi") =>
	JSON.stringify({
		session_id: sessionId,
		agent_id: "",
		turn_idx: 1,
		record_idx: recordIdx,
		block_idx: 0,
		ts: "2026-11-01 10:00:00.000",
		kind: "assistant_text",
		subtype: "",
		tool_name: "",
		command_class: "",
		call_id: "",
		is_error: 0,
		exit_code: null,
		file_path: "",
		file_op: "",
		spawned_agent_id: "",
		shown: text,
		shown_chars: text.length,
		text_chars: text.length,
		fork_replayed: 0,
	});

const isRecords = (sent: Sent) =>
	sent.statement.query.includes("rudel.transcript_records");
const linesOf = (chunks: DataChunk[]) =>
	chunks
		.map((chunk) => (chunk.type === "lines" ? chunk.text : ""))
		.join("")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
const doneOf = (chunks: DataChunk[]) => chunks.at(-1);

beforeEach(() => forgetReaches());

describe("pullTable", () => {
	test("re-checks visibility: only sessions the runs view returns are read, the rest are named in a notice", async () => {
		const { env, sent } = fakeClickHouse((query) =>
			isSummary(query)
				? [summaryRow("s-1")]
				: isRecords(query)
					? [recordRow("s-1", 1, `key ${SECRET}`), recordRow("s-1", 2)]
					: [],
		);
		const chunks = await collect(
			pullTable(contextOf(env), "records", ["s-1", "s-2"]),
		);
		const records = sent.find(isRecords);
		expect(records?.statement.query_params).toMatchObject({
			ws: "ws-1",
			ids: ["s-1"],
			owners: ["user-1"],
		});
		expect(
			JSON.stringify(sent.map((s) => s.statement.query_params)),
		).not.toContain('"s-2"]');
		const lines = linesOf(chunks);
		expect(lines.map((line) => [line.session_id, line.record_idx])).toEqual([
			["s-1", 1],
			["s-1", 2],
		]);
		expect(String(lines[0]?.text)).not.toContain(SECRET);
		expect(doneOf(chunks)).toMatchObject({
			type: "done",
			rows: 2,
			notices: [expect.stringContaining("1 of 2 sessions")],
		});
	});

	test("reads nothing more when none of the sessions is readable", async () => {
		const { env, sent } = fakeClickHouse(() => []);
		const chunks = await collect(pullTable(contextOf(env), "calls", ["s-9"]));
		expect(sent.filter((s) => !isSummary(s))).toEqual([]);
		expect(doneOf(chunks)).toMatchObject({ rows: 0, bytes: 0, columns: [] });
	});

	test("holds a member to their own sessions in every view read", async () => {
		const { env, sent } = fakeClickHouse((query) =>
			isSummary(query) ? [summaryRow("s-1")] : ['{"session_id":"s-1"}'],
		);
		await collect(
			pullTable(
				contextOf(env, {
					reader: { userId: "user-1", role: "member", ownSessionsOnly: true },
				}),
				"runs",
				["s-1"],
			),
		);
		for (const { statement } of sent)
			expect(statement.query_params).toMatchObject({
				opaline_member: "user-1",
				opaline_workspace: "ws-1",
			});
	});

	test("runs every statement with the export limits and no row cap", async () => {
		const { env, sent } = fakeClickHouse((query) =>
			isSummary(query) ? [summaryRow("s-1")] : [],
		);
		await collect(pullTable(contextOf(env), "records", ["s-1"]));
		for (const { statement } of sent) {
			expect(statement.clickhouse_settings).toMatchObject({
				readonly: "1",
				max_execution_time: 60,
				max_memory_usage: String(512 * 1024 * 1024),
				max_result_bytes: String(256 * 1024 * 1024),
			});
			expect(statement.clickhouse_settings).not.toHaveProperty("limit");
		}
	});

	test("takes no quota", async () => {
		const { env } = fakeClickHouse(
			(query) => (isSummary(query) ? [summaryRow("s-1")] : []),
			{ queries: 0 },
		);
		const chunks = await collect(
			pullTable(contextOf(env, { charged: false }), "runs", ["s-1"]),
		);
		expect(doneOf(chunks)).toMatchObject({ type: "done" });
	});

	test("splits a batch that passes the memory limit and retries the halves", async () => {
		const ids = ["s-1", "s-2", "s-3", "s-4"];
		const { env, sent } = fakeClickHouse((query) => {
			if (isSummary(query)) return ids.map((id) => summaryRow(id));
			const named = ids.filter((id) =>
				query.statement.query.includes(`'${id}'`),
			);
			if (named.length > 2)
				return clickHouseError(
					"MEMORY_LIMIT_EXCEEDED",
					"Memory limit (for query) exceeded: would use 600.00 MiB",
				);
			return named.map((id) => `{"session_id":"${id}"}`);
		});
		const chunks = await collect(pullTable(contextOf(env), "calls", ids));
		expect(linesOf(chunks).map((line) => line.session_id)).toEqual(ids);
		expect(sent.filter((s) => !isSummary(s))).toHaveLength(3);
	});

	test("says EXPORT_TOO_LARGE when ClickHouse's result cap is passed", async () => {
		const { env } = fakeClickHouse((query) =>
			isSummary(query)
				? [summaryRow("s-1")]
				: clickHouseError(
						"TOO_MANY_ROWS_OR_BYTES",
						"Limit for result exceeded",
					),
		);
		const refused = await failure(() =>
			collect(pullTable(contextOf(env), "runs", ["s-1"])),
		);
		expect(refused.code).toBe("EXPORT_TOO_LARGE");
	});

	test("says BUSY when no query slot comes free", async () => {
		const { env } = fakeClickHouse(() => [], { busy: true });
		const refused = await failure(() =>
			collect(pullTable(contextOf(env), "runs", ["s-1"])),
		);
		expect(refused.code).toBe("BUSY");
		expect(refused.status).toBe(503);
	});

	test("follows edges once for the edge and GitHub tables of the same sessions", async () => {
		const edge = JSON.stringify({
			from_id: "run-1",
			from_kind: "run",
			to_id: "101/7",
			to_kind: "pull_request",
			relation: "opened_pr",
			evidence_id: "e-1",
			session_id: "s-1",
			agent_id: "",
		});
		const { env, sent } = fakeClickHouse((query) => {
			const text = query.statement.query;
			if (isSummary(query)) return [summaryRow("s-1")];
			if (
				text.includes("github_pull_requests FINAL") &&
				text.includes("synced_text")
			)
				return [
					JSON.stringify({
						repository_id: "101",
						number: 7,
						head_repository_id: "101",
						title: `PR ${SECRET}`,
						state: "open",
						draft: 0,
						created_text: "2026-11-01 10:00:00",
						merged_text: null,
						closed_text: null,
						head_ref: "feature",
						head_sha: "a".repeat(40),
						merge_commit_sha: "",
						synced_text: "2026-11-01 11:00:00",
					}),
				];
			if (text.includes("session_id IN ('s-1')") && text.includes("relation"))
				return [edge];
			return [];
		});
		const context = contextOf(env);
		const edges = await collect(pullTable(context, "edges", ["s-1"]));
		const before = sent.length;
		const prs = await collect(pullTable(context, "github_prs", ["s-1"]));
		expect(linesOf(edges)).toHaveLength(1);
		expect(sent.length - before).toBe(1);
		const [pr] = linesOf(prs);
		expect(pr).toMatchObject({ node_id: "101/7", number: 7 });
		expect(String(pr?.title)).not.toContain(SECRET);
		const read = sent.find((s) =>
			s.statement.query.includes("github_pull_requests FINAL"),
		);
		expect(read?.statement.query_params).toMatchObject({
			ws: "ws-1",
			repos: ["101"],
			pnA: ["101"],
			pnB: [7],
		});
	});

	test("lists the workspace's connected repositories", async () => {
		const { env } = fakeClickHouse((query) =>
			isSummary(query) ? [summaryRow("s-1")] : [],
		);
		const chunks = await collect(
			pullTable(contextOf(env), "github_repositories", ["s-1"]),
		);
		expect(linesOf(chunks)).toEqual([
			{ repository_id: "101", full_name: "acme/app" },
		]);
	});
});
