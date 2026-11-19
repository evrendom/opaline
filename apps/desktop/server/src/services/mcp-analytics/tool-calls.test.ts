import { expect, test } from "bun:test";
import {
	MCP_STATS_ACTIONS,
	MCP_STATS_COLUMNS,
	mcpStatsStatement,
	recordToolCall,
	toolCallRow,
} from "./tool-calls.js";

const facts = {
	tool: "find",
	userId: "u1",
	workspaceId: "w1",
	calledAt: new Date("2026-11-04T10:11:12.345Z"),
	context: "Listing a team's failed runs to find a recurring setup problem.",
	llmModel: "claude-opus-4-8",
	durationMs: 812.6,
	errorCode: null,
	outputChars: 1_234,
};

test("a call becomes one row; feedback is kept only for a call that succeeded", () => {
	const row = toolCallRow({ ...facts, feedback: { summary: "ok" } });
	expect(row).toMatchObject({
		organization_id: "w1",
		user_id: "u1",
		called_at: "2026-11-04 10:11:12.345",
		tool: "find",
		duration_ms: 813,
		is_error: 0,
		error_code: "",
		output_chars: 1_234,
		feedback: '{"summary":"ok"}',
	});
	expect(row.call_id).toMatch(/^[0-9a-f-]{36}$/u);
	expect(
		toolCallRow({ ...facts, errorCode: "BAD_REQUEST", feedback: { a: 1 } }),
	).toMatchObject({ is_error: 1, error_code: "BAD_REQUEST", feedback: "" });
	expect(toolCallRow({ ...facts, durationMs: -5 }).duration_ms).toBe(0);
});

test("recording never throws and gives up after its timeout", async () => {
	const inserted: unknown[] = [];
	await recordToolCall(
		{
			insert: async (params) => {
				inserted.push(params);
			},
		},
		toolCallRow(facts),
	);
	expect(inserted).toEqual([
		expect.objectContaining({
			table: "rudel.mcp_tool_calls",
			asyncInsert: true,
		}),
	]);
	await recordToolCall(
		{
			insert: () => Promise.reject(new Error("ClickHouse is down")),
		},
		toolCallRow(facts),
	);
	let aborted = false;
	await recordToolCall(
		{
			insert: ({ abortSignal }) =>
				new Promise((_, reject) =>
					abortSignal?.addEventListener("abort", () => {
						aborted = true;
						reject(new Error("aborted"));
					}),
				),
		},
		toolCallRow(facts),
		5,
	);
	expect(aborted).toBe(true);
});

test("each stats action reads the window and the tool as parameters and selects the columns it renders", () => {
	for (const action of MCP_STATS_ACTIONS) {
		const statement = mcpStatsStatement({
			action,
			from: "2026-10-29",
			to: "2026-11-04",
			tool: "find",
			limit: 20,
		});
		expect(statement.query).toContain("FROM rudel.mcp_tool_calls");
		expect(statement.query).toContain("{from:String}");
		expect(statement.query).toContain("LIMIT {limit:UInt32}");
		for (const column of MCP_STATS_COLUMNS[action])
			expect({
				action,
				column,
				selected: statement.query.includes(column),
			}).toEqual({
				action,
				column,
				selected: true,
			});
		expect(statement.query).not.toContain("2026-");
		expect(statement.query_params).toMatchObject({
			from: "2026-10-29",
			to: "2026-11-04",
			limit: 20,
		});
	}
	expect(
		mcpStatsStatement({
			action: "stats",
			from: "2026-10-29",
			to: "2026-11-04",
			limit: 100,
		}).query,
	).toContain("quantiles(0.5, 0.95)(duration_ms)");
	expect(
		mcpStatsStatement({
			action: "feedback",
			from: "2026-10-29",
			to: "2026-11-04",
			tool: "find",
			limit: 5,
		}).query,
	).toContain("tool = 'agent_feedback'");
});
