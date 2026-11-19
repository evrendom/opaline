import { expect, test } from "bun:test";
import { buildConversationTrace, parseConversations } from "../index.js";

test("a ToolSearch result of tool references is kept, with how many tools it searched", () => {
	const lines = [
		{
			type: "user",
			uuid: "p1",
			timestamp: "2026-10-21T09:00:00.000Z",
			message: { role: "user", content: "load the sql tool" },
		},
		{
			type: "assistant",
			uuid: "a1",
			timestamp: "2026-10-21T09:00:05.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_search",
						name: "ToolSearch",
						input: { query: "select:mcp__opaline__sql", max_results: 1 },
					},
				],
			},
		},
		{
			type: "user",
			uuid: "r1",
			timestamp: "2026-10-21T09:00:06.000Z",
			toolUseResult: {
				matches: ["mcp__opaline__sql"],
				query: "select:mcp__opaline__sql",
				total_deferred_tools: 47,
			},
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_search",
						content: [
							{ type: "tool_reference", tool_name: "mcp__opaline__sql" },
						],
					},
				],
			},
		},
	]
		.map((line) => JSON.stringify({ sessionId: "session-1", ...line }))
		.join("\n");
	const search = buildConversationTrace(parseConversations(lines))
		.flatMap((item) => (item.kind === "agent" ? item.events : []))
		.find((event) => event.kind === "tool");
	expect(search?.kind === "tool" ? search.toolSearch : null).toEqual({
		deferredTools: 47,
	});
	expect(search?.kind === "tool" ? search.result?.content : null).toEqual([
		{
			rawType: "tool_reference",
			type: "structured",
			value: { tool_name: "mcp__opaline__sql", type: "tool_reference" },
		},
	]);
});
