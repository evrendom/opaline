import { describe, expect, test } from "bun:test";
import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { runNodeId } from "../l1-edges/l1-edge-ids.js";
import { openRun } from "./run-view.service.js";
import { createMemorySqlQuota } from "./sql-results.js";

const SESSION = "0f3c2a1e-5b6d-4c7e-8f90-a1b2c3d4e5f6";
const OWNER = "user-1";

const row = (
	agentId: string,
	turn: number,
	start: number,
	prompt: string,
): RudelRunIndexRow =>
	({
		organization_id: "ws-1",
		user_id: OWNER,
		session_id: SESSION,
		revision: "3",
		parser_version: 12,
		index_version: 4,
		build_revision: "7",
		agent_id: agentId,
		start_record: start,
		end_record: start + 10,
		row_kind: "run",
		source: "claude_code",
		turn_idx: turn,
		started_at: `2026-11-13 17:${String(start).padStart(2, "0")}:00.000`,
		prompt_head: prompt,
		prompt_subtype: "",
		minutes: 2,
		cost_usd: 0.1,
		uncached_input_tokens: null,
		cache_read_input_tokens: null,
		cache_write_5m_input_tokens: null,
		cache_write_1h_input_tokens: null,
		output_tokens: null,
	}) as unknown as RudelRunIndexRow;

const RUNS = [
	row("", 1, 10, "add a limiter"),
	row("", 2, 40, "fix the login test"),
	row("sub1", 1, 20, "find where login is tested"),
];

function environment(queries = 10) {
	const statements: ClickHouseStatement[] = [];
	const owners: string[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			if (!statement.query.includes("row_kind")) return [] as T[];
			const params = statement.query_params as { sessionIds: string[] };
			return RUNS.filter((run) =>
				params.sessionIds.includes(run.session_id),
			) as T[];
		},
	};
	return {
		statements,
		owners,
		env: {
			executor,
			ownerOf: async (sessionId: string) => {
				owners.push(sessionId);
				return OWNER;
			},
			quota: createMemorySqlQuota({ queries, windowMs: 3_600_000 }),
		},
	};
}

const open = (id: string, env: ReturnType<typeof environment>["env"]) =>
	openRun("ws-1", { id, sections: ["header"], maxChars: 4_000 }, env);

const identity = { userId: OWNER, source: "claude_code", sessionId: SESSION };

describe("run takes a session#turn", () => {
	test("session_id#turn opens that run of the main stream in the session's committed build", async () => {
		const { env, owners } = environment();
		const view = await open(`${SESSION}#2`, env);
		expect(view.ref).toEqual({ sessionId: SESSION, agentId: "", turn: 2 });
		expect(view.text).toStartWith(
			`run ${runNodeId(identity, "", 40)} · claude_code · "fix the login test"`,
		);
		expect(owners).toEqual([SESSION]);
	});

	test("session_id:agent_id#turn opens that run of the subagent's stream", async () => {
		const { env } = environment();
		const view = await open(`${SESSION}:sub1#1`, env);
		expect(view.ref).toEqual({ sessionId: SESSION, agentId: "sub1", turn: 1 });
		expect(view.text).toStartWith(
			`run ${runNodeId(identity, "sub1", 20)} · claude_code · "find where login is tested"`,
		);
	});

	test("an unknown turn, stream or session is not found and says which run is missing", async () => {
		const { env } = environment();
		for (const [id, where] of [
			[`${SESSION}#9`, "no indexed run 9 in its main stream"],
			[`${SESSION}:sub2#1`, "no indexed run 1 in stream sub2"],
			["9e8d7c6b-0000-4000-8000-000000000000#1", "no indexed run 1"],
		] as const)
			await expect(open(id, env)).rejects.toMatchObject({
				code: "NOT_FOUND",
				message: expect.stringContaining(where),
			});
	});
});

describe("run and the workspace quota", () => {
	test("each run call takes one query of the quota, a session#turn lookup included", async () => {
		const { env, statements } = environment(1);
		await open(`${SESSION}#2`, env);
		const sent = statements.length;
		expect(sent).toBeGreaterThan(1);
		await expect(open(`${SESSION}#1`, env)).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: expect.stringContaining(
				"used its SQL quota of 1 queries (sql and run calls)",
			),
		});
		expect(statements.length).toBe(sent);
	});

	test("a spent quota refuses run before any statement", async () => {
		const { env, statements } = environment(0);
		await expect(open(`${SESSION}#2`, env)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(statements).toEqual([]);
	});
});
