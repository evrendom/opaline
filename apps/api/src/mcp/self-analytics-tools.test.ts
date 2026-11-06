import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ClickHouseStatement } from "../clickhouse.js";
import type { McpToolContext } from "./mcp-tools.js";
import { agentFeedbackTool, mcpStatsTool } from "./self-analytics-tools.js";

const saved = process.env.VITE_ADMIN_ORGANIZATION_ID;
beforeEach(() => {
	process.env.VITE_ADMIN_ORGANIZATION_ID = "team";
});
afterEach(() => {
	if (saved === undefined) delete process.env.VITE_ADMIN_ORGANIZATION_ID;
	else process.env.VITE_ADMIN_ORGANIZATION_ID = saved;
});

const context = (id: string): McpToolContext => ({
	userId: "u",
	workspace: { id, slug: id },
	authSession: {} as McpToolContext["authSession"],
});
const client = {} as Parameters<typeof agentFeedbackTool.run>[0];

test("agent_feedback answers with a receipt that says to keep going, and refuses PostHog's scout type", async () => {
	const receipt = JSON.parse(
		`${await agentFeedbackTool.run(
			client,
			{
				summary: "find hid the failing command behind its fingerprint",
				feedback_type: "mcp",
				sentiment: "mixed",
				category: "tool_output_format",
				tools_used: ["find", "run"],
				workspace: "acme",
			},
			context("w"),
		)}`,
	);
	expect(receipt).toMatchObject({
		received: true,
		feedback_type: "mcp",
		sentiment: "mixed",
	});
	expect(receipt.message).toContain("keep going and finish the user's task");
	await expect(
		agentFeedbackTool.run(
			client,
			{ summary: "x", feedback_type: "scout", sentiment: "neutral" },
			context("w"),
		),
	).rejects.toThrow();
	expect(agentFeedbackTool.recordsInput).toBe(true);
});

test("mcp_stats runs only in the team's workspace, over the last 7 days by default", async () => {
	const statements: ClickHouseStatement[] = [];
	const tool = mcpStatsTool(
		() => ({
			query: async <T>(statement: ClickHouseStatement) => {
				statements.push(statement);
				return [
					{
						tool: "find",
						calls: 10,
						errors: 1,
						p50_ms: 120,
						p95_ms: 900,
						users: 2,
						workspaces: 1,
						with_intent: 9,
					},
				] as T[];
			},
		}),
		() => Date.parse("2026-11-04T12:00:00Z"),
	);
	await expect(
		tool.run(client, { action: "stats" }, context("customer")),
	).rejects.toThrow("only available in the Opaline team's own workspace");
	expect(statements).toEqual([]);
	const text = await tool.run(client, { action: "stats" }, context("team"));
	expect(text).toBe(
		"mcp_stats action=stats 2026-10-29..2026-11-04 rows=1\ntool\tcalls\terrors\tp50_ms\tp95_ms\tusers\tworkspaces\twith_intent\nfind\t10\t1\t120\t900\t2\t1\t9",
	);
	expect(statements[0]?.query_params).toEqual({
		from: "2026-10-29",
		to: "2026-11-04",
		limit: 100,
	});
	await expect(
		tool.run(
			client,
			{ action: "failures", from: "2026-11-05", to: "2026-11-04" },
			context("team"),
		),
	).rejects.toThrow("after");
});
