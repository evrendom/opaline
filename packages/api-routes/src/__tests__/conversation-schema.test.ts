import { describe, expect, test } from "bun:test";
import { buildConversationTrace, parseConversations } from "../index.js";

describe("conversation schema", () => {
	test("keeps user entries whose tool results omit image source or structured value", () => {
		const line = JSON.stringify({
			type: "user",
			uuid: "user-1",
			parentUuid: null,
			sessionId: "session-1",
			timestamp: "2026-10-02T10:00:00.000Z",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: [{ type: "image" }, { type: "structured" }],
					},
				],
			},
		});

		expect(parseConversations(line)).toHaveLength(1);
	});

	test("pairs MCP and error results whatever shape their toolUseResult has", () => {
		const entry = (uuid: string, value: Record<string, unknown>) =>
			JSON.stringify({
				uuid,
				parentUuid: null,
				sessionId: "session-1",
				timestamp: "2026-10-02T10:00:00.000Z",
				...value,
			});
		const toolUse = (id: string, name: string) => ({
			type: "tool_use",
			id,
			name,
			input: {},
		});
		const toolResult = (
			uuid: string,
			toolUseId: string,
			text: string,
			toolUseResult: unknown,
			isError = false,
		) =>
			entry(uuid, {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: toolUseId,
							content: [{ type: "text", text }],
							is_error: isError,
						},
					],
				},
				toolUseResult,
			});
		const lines = [
			entry("prompt", {
				type: "user",
				message: { role: "user", content: "Look it up" },
			}),
			entry("calls", {
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						toolUse("tool-mcp", "mcp__opaline__find"),
						toolUse("tool-bash", "Bash"),
					],
				},
			}),
			// MCP tools record their content blocks as an array.
			toolResult("result-mcp", "tool-mcp", "mcp output", [
				{ type: "text", text: "mcp output" },
			]),
			// Some failed calls record the error as a string.
			toolResult(
				"result-bash",
				"tool-bash",
				"Exit code 1",
				"Error: Exit code 1",
				true,
			),
		].join("\n");

		const conversations = parseConversations(lines);
		expect(conversations).toHaveLength(4);

		const tools = buildConversationTrace(conversations).flatMap((item) =>
			item.kind === "agent"
				? item.events.filter((event) => event.kind === "tool")
				: [],
		);
		expect(
			tools.map((event) => [event.toolName, event.result?.content]),
		).toEqual([
			["mcp__opaline__find", [{ type: "text", text: "mcp output" }]],
			["Bash", [{ type: "text", text: "Exit code 1" }]],
		]);
		expect(tools[1]?.result?.isError).toBe(true);
	});
});
