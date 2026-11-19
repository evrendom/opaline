import { describe, expect, test } from "bun:test";
import {
	buildConversationTrace,
	extractSessionCompactionMetadata,
	groupTraceIntoTurns,
	parseConversations,
} from "../index.js";

describe("conversation schema", () => {
	test("keeps a prompt sent with a pasted image: its text, the image beside it", () => {
		const line = JSON.stringify({
			type: "user",
			uuid: "prompt-1",
			parentUuid: null,
			sessionId: "session-1",
			timestamp: "2026-10-02T10:00:00.000Z",
			message: {
				role: "user",
				content: [
					{
						type: "image",
						source: { type: "base64", media_type: "image/png", data: "iVBOR" },
					},
					{ type: "text", text: "where is this bar on the right" },
				],
			},
		});

		const [entry] = parseConversations(line);
		expect(entry?.type).toBe("user");
		const turns = groupTraceIntoTurns(
			buildConversationTrace(parseConversations(line)),
		);
		expect(turns[0]?.userItems[0]?.id).toBe("prompt-1");
		expect(JSON.stringify(turns[0]?.userItems[0])).toContain(
			"where is this bar on the right",
		);
	});

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

	test("a compaction carries what it recorded, and joins the turn after it", () => {
		const entry = (uuid: string, at: number, value: Record<string, unknown>) =>
			JSON.stringify({
				uuid,
				parentUuid: null,
				sessionId: "session-1",
				timestamp: new Date(Date.UTC(2026, 9, 20, 13, 0, at)).toISOString(),
				...value,
			});
		const said = (uuid: string, at: number, text: string) =>
			entry(uuid, at, {
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text }] },
			});
		const asked = (uuid: string, at: number, content: string) =>
			entry(uuid, at, { type: "user", message: { role: "user", content } });
		const content = [
			asked("prompt-1", 0, "Fix the rail"),
			said("answer-1", 5, "Fixed."),
			entry("boundary", 50, {
				type: "system",
				subtype: "compact_boundary",
				content: "Conversation compacted",
				compactMetadata: {
					trigger: "manual",
					preTokens: 780_901,
					postTokens: 15_094,
					durationMs: 40_000.4,
					preservedMessages: { uuids: ["answer-1", "a", "b"] },
					preCompactDiscoveredTools: ["mcp__t3-code__preview_open"],
				},
			}),
			entry("summary", 50, {
				type: "user",
				isCompactSummary: true,
				message: { role: "user", content: "Summary:\n1. Fixed the rail." },
			}),
			entry("caveat", 10, {
				type: "user",
				isMeta: true,
				message: {
					role: "user",
					content:
						"<local-command-caveat>Run in Claude Code</local-command-caveat>",
				},
			}),
			asked("command", 10, "<command-name>/compact</command-name>"),
			asked("prompt-2", 60, "Now the minimap"),
			said("answer-2", 70, "Done."),
		].join("\n");

		const hidden = extractSessionCompactionMetadata(content).hiddenTraceItemIds;
		expect([...hidden]).toEqual(["summary"]);
		const trace = buildConversationTrace(parseConversations(content)).filter(
			(item) => !hidden.has(item.id),
		);
		const compaction = trace.find((item) => item.id === "boundary");
		expect(compaction).toMatchObject({
			kind: "system",
			systemType: "compaction",
			durationMs: 40_000,
			compaction: {
				afterTokens: 15_094,
				beforeTokens: 780_901,
				keptMessages: 3,
				loadedTools: ["mcp__t3-code__preview_open"],
				summary: "Summary:\n1. Fixed the rail.",
				trigger: "manual",
			},
		});

		const turns = groupTraceIntoTurns(trace);
		expect(
			turns.map((turn) => turn.responseItems.map((item) => item.id)),
		).toEqual([
			["answer-1", "caveat"],
			["boundary", "answer-2"],
		]);
		expect(turns[1]?.userItems.map((item) => item.id)).toEqual([
			"command",
			"prompt-2",
		]);
	});

	test("a message to a subagent is answered by its next notification", () => {
		const entry = (uuid: string, at: number, value: Record<string, unknown>) =>
			JSON.stringify({
				uuid,
				parentUuid: null,
				sessionId: "session-1",
				timestamp: new Date(Date.UTC(2026, 9, 16, 10, 0, at)).toISOString(),
				...value,
			});
		const content = [
			entry("prompt", 0, {
				type: "user",
				message: { role: "user", content: "Keep a72c going" },
			}),
			entry("send", 5, {
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_send",
							name: "SendMessage",
							input: { to: "a72c", message: "Use the new schema" },
						},
					],
				},
			}),
			entry("queued", 6, {
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_send",
							content: "queued",
						},
					],
				},
			}),
			entry("next", 30, {
				type: "user",
				message: { role: "user", content: "and now?" },
			}),
			entry("answer", 50, {
				type: "user",
				message: {
					role: "user",
					content:
						"<task-notification>\n<task-id>a72c</task-id>\n<tool-use-id>toolu_launch</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>",
				},
			}),
		].join("\n");
		const send = buildConversationTrace(parseConversations(content))
			.flatMap((item) => (item.kind === "agent" ? item.events : []))
			.find(
				(event) => event.kind === "tool" && event.toolName === "SendMessage",
			);
		expect(send).toMatchObject({
			background: {
				finishedAt: new Date(Date.UTC(2026, 9, 16, 10, 0, 50)).toISOString(),
				status: "completed",
				taskId: "a72c",
			},
		});
	});

	test("a notification queued while the agent worked counts, once", () => {
		const notice =
			"<task-notification>\n<task-id>a72c</task-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n<result>Waiting.</result>\n</task-notification>";
		const at = (second: number) =>
			new Date(Date.UTC(2026, 9, 16, 10, 0, second)).toISOString();
		const base = { parentUuid: null, sessionId: "session-1" };
		const content = [
			JSON.stringify({
				...base,
				uuid: "prompt",
				timestamp: at(0),
				type: "user",
				message: { role: "user", content: "Go" },
			}),
			JSON.stringify({
				...base,
				uuid: "queued",
				timestamp: at(10),
				type: "attachment",
				attachment: { type: "queued_command", prompt: notice },
			}),
			JSON.stringify({
				...base,
				uuid: "again",
				timestamp: at(11),
				type: "user",
				message: { role: "user", content: notice },
			}),
			JSON.stringify({
				...base,
				uuid: "reminder",
				timestamp: at(12),
				type: "attachment",
				attachment: { type: "total_tokens_reminder" },
			}),
		].join("\n");
		const notifications = buildConversationTrace(
			parseConversations(content),
		).filter(
			(item) => item.kind === "system" && item.systemType === "notification",
		);
		expect(notifications.map((item) => [item.id, item.timestamp])).toEqual([
			["queued", at(10)],
		]);
	});

	test("a message the member wrote while the agent worked redirects the run", () => {
		const at = (second: number) =>
			new Date(Date.UTC(2026, 9, 16, 18, 58, second)).toISOString();
		const base = { parentUuid: null, sessionId: "session-1" };
		const said = (uuid: string, second: number, content: unknown[]) =>
			JSON.stringify({
				...base,
				uuid,
				timestamp: at(second),
				type: "assistant",
				message: { role: "assistant", content },
			});
		const content = [
			JSON.stringify({
				...base,
				uuid: "prompt",
				timestamp: at(0),
				type: "user",
				message: { role: "user", content: "Merge what's green" },
			}),
			said("call", 1, [
				{
					type: "tool_use",
					id: "toolu_1",
					name: "Bash",
					input: { command: "gh pr list" },
				},
			]),
			JSON.stringify({
				...base,
				uuid: "queued",
				timestamp: at(3),
				type: "attachment",
				attachment: {
					type: "queued_command",
					prompt: [{ type: "text", text: "for the ones i can merge" }],
				},
			}),
			JSON.stringify({
				...base,
				uuid: "result",
				timestamp: at(5),
				type: "user",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_1", content: "#1 #2" },
					],
				},
			}),
			said("answer", 9, [{ type: "text", text: "Merging #1." }]),
		].join("\n");
		const turns = groupTraceIntoTurns(
			buildConversationTrace(parseConversations(content)),
		);
		expect(turns).toHaveLength(1);
		expect(
			turns[0]?.responseItems.find((item) => item.id === "queued"),
		).toMatchObject({
			kind: "system",
			systemType: "member",
			text: "for the ones i can merge",
			timestamp: at(3),
		});
	});
});
