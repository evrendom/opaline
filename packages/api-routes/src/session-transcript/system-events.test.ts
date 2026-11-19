import { describe, expect, test } from "bun:test";
import { buildConversationTrace, parseConversations } from "../index.js";

const base = { sessionId: "s1", isSidechain: false };
const line = (entry: Record<string, unknown>) =>
	JSON.stringify({ ...base, ...entry });

const content = [
	line({
		type: "assistant",
		uuid: "a1",
		timestamp: "2026-10-16T17:25:19.447Z",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Compacting now." }],
		},
	}),
	line({
		type: "system",
		subtype: "compact_boundary",
		uuid: "c1",
		timestamp: "2026-10-16T17:26:53.985Z",
		content: "Conversation compacted",
		compactMetadata: {
			trigger: "manual",
			preTokens: 886588,
			durationMs: 94536,
		},
	}),
	line({
		type: "system",
		subtype: "stop_hook_summary",
		uuid: "h1",
		timestamp: "2026-10-16T17:27:00.000Z",
		hookCount: 2,
		hookInfos: [
			{ command: "agent-finished", durationMs: 183 },
			{ command: "notify", durationMs: 40 },
		],
	}),
].join("\n");

describe("system events in the trace", () => {
	const items = buildConversationTrace(parseConversations(content));
	const system = items.filter((item) => item.kind === "system");

	test("a compaction is a system item with how long it took", () => {
		expect(system[0]).toMatchObject({
			durationMs: 94536,
			id: "c1",
			systemType: "compaction",
			timestamp: "2026-10-16T17:26:53.985Z",
		});
	});

	test("stop hooks are one, their times summed", () => {
		expect(system[1]).toMatchObject({
			durationMs: 223,
			id: "h1",
			systemType: "hooks",
		});
	});
});
