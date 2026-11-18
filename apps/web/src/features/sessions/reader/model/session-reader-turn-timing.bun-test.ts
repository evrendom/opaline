import { describe, expect, test } from "bun:test";
import {
	getReaderWaterfall,
	type SessionReaderBody,
} from "./session-reader-model";

const ts = (second: number) =>
	new Date(Date.UTC(2026, 9, 16, 13, 0, 0) + second * 1_000).toISOString();

const call = (
	id: string,
	toolName: string,
	at: number,
	resultAt: number,
	input: Record<string, unknown> = {},
) => ({
	id,
	input,
	kind: "tool" as const,
	nativeId: `toolu_${id}`,
	result: { content: "ok", isError: false, timestamp: ts(resultAt) },
	timestamp: ts(at),
	toolName,
});

const think = (id: string, at: number) => ({
	id,
	kind: "reasoning" as const,
	text: "…",
	timestamp: ts(at),
});

const build = (
	events: unknown[],
	extra: SessionReaderBody["responseItems"] = [],
	endedAt = 400,
) =>
	getReaderWaterfall(
		{
			userItems: [],
			responseItems: [
				{
					events,
					executionMode: "default",
					id: "root",
					kind: "agent",
					timestamp: ts(0),
				} as SessionReaderBody["responseItems"][number],
				...extra,
			],
		},
		{ endedAt: ts(endedAt), startedAt: ts(0), usageCalls: [] },
		null,
	);

const find = (built: ReturnType<typeof build>, id: string) =>
	built?.steps.find((step) => step.id === id);

describe("time that isn't running or thinking", () => {
	test("a question put to the member waits on them", () => {
		const built = build([
			think("t", 2),
			call("ask", "AskUserQuestion", 3, 112),
		]);
		expect(find(built, "ask")?.waitsOnYou).toBe(true);
	});

	test("a message sent or a list put up is its writing, one step", () => {
		const built = build([
			think("t", 2),
			call("send", "SendMessage", 10, 10.04, { message: "x".repeat(2400) }),
			call("todo", "TodoWrite", 20, 20.03, { todos: ["x".repeat(2988)] }),
		]);
		expect(built?.steps.some((step) => step.writes)).toBe(false);
		expect(find(built, "send")?.startMs).toBe(Date.parse(ts(2)));
		expect(find(built, "todo")?.startMs).toBe(Date.parse(ts(10.04)));
	});

	test("a call queued behind the one before it runs from its turn", () => {
		const built = build([
			think("t", 2),
			call("bash", "Bash", 3, 54, { command: "sleep 50" }),
			call("read", "Read", 3.2, 54.009, { file_path: "/a.png" }),
		]);
		expect(find(built, "read")?.queuedUntilMs).toBe(Date.parse(ts(54)));
		expect(find(built, "bash")?.queuedUntilMs).toBeUndefined();
	});

	test("calls that only read run together; one that changes something waits", () => {
		const built = build([
			think("t", 2),
			call("grep", "Bash", 3, 9, { command: 'cd /src; grep -n "a\\|b" x.ts' }),
			call("glob", "Glob", 3.1, 9.5, { pattern: "*.ts" }),
			call("fetch", "Bash", 3.2, 12, { command: "git fetch -q origin" }),
			call("read", "Read", 3.3, 12.5, { file_path: "/a.ts" }),
		]);
		expect(find(built, "glob")?.queuedUntilMs).toBeUndefined();
		expect(find(built, "fetch")?.queuedUntilMs).toBe(Date.parse(ts(9.5)));
		expect(find(built, "read")?.queuedUntilMs).toBe(Date.parse(ts(12)));
	});

	test("a compaction is a step, and what follows starts after it", () => {
		const built = build(
			[think("before", 10), think("after", 120)],
			[
				{
					compaction: {
						afterTokens: 15_094,
						beforeTokens: 780_901,
						summary: "Summary:",
						trigger: "manual",
					},
					durationMs: 94_536,
					id: "compact",
					kind: "system",
					systemType: "compaction",
					text: "Conversation compacted",
					timestamp: ts(110),
				},
			],
		);
		const compact = find(built, "compact");
		expect(compact?.name).toBe("Compaction");
		expect(compact?.detail).toBe("/compact · 780.9K → 15.1K tokens");
		expect(compact?.compaction?.summary).toBe("Summary:");
		expect(compact?.harness).toBe("compaction");
		expect(compact?.endMs).toBe(Date.parse(ts(110)));
		expect(compact?.startMs).toBe(Date.parse(ts(110)) - 94_536);
		expect(find(built, "after")?.startMs).toBe(Date.parse(ts(110)));
	});

	test("a compaction with no recorded time is a moment", () => {
		const built = build(
			[think("before", 10)],
			[
				{
					id: "compact",
					kind: "system",
					systemType: "compaction",
					text: "Conversation compacted",
					timestamp: ts(8),
				},
			],
		);
		const compact = find(built, "compact");
		expect(compact?.startMs).toBe(Date.parse(ts(8)));
		expect(compact?.endMs).toBe(Date.parse(ts(8)));
		expect(compact?.detail).toBe("Conversation compacted");
	});

	test("what the agent writes after a notification woke it starts there", () => {
		const built = build(
			[
				{
					content: "CI is running.",
					id: "before",
					kind: "message",
					text: "CI is running.",
					timestamp: ts(5),
				},
				{
					content: "Still waiting.",
					id: "after",
					kind: "message",
					text: "Still waiting.",
					timestamp: ts(570),
				},
			],
			[
				{
					id: "woke",
					kind: "system",
					systemType: "notification",
					text: '<task-notification>\n<task-id>a72c</task-id>\n<status>completed</status>\n<summary>Agent "review" finished</summary>\n</task-notification>',
					timestamp: ts(566),
				},
			],
			600,
		);
		expect(find(built, "after")?.startMs).toBe(Date.parse(ts(566)));
	});

	test("stop hooks after the answer leave it the answer", () => {
		const built = build(
			[
				think("t", 2),
				{
					content: "Done.",
					id: "answer",
					kind: "message",
					text: "Done.",
					timestamp: ts(5),
				},
			],
			[
				{
					durationMs: 223,
					id: "hooks",
					kind: "system",
					systemType: "hooks",
					text: "Stop hooks ran",
					timestamp: ts(5.4),
				},
			],
		);
		expect(find(built, "answer")?.name).toBe("Response");
		expect(find(built, "hooks")?.name).toBe("Hooks");
	});
});
