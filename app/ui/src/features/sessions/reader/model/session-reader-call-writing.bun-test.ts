import { describe, expect, test } from "bun:test";
import { getReaderWaterfall } from "./session-reader-model";
import { WRITTEN_CHARS_PER_SECOND } from "./session-reader-step-timing";

const ts = (second: number) =>
	new Date(Date.UTC(2026, 9, 17, 11, 13, 0) + second * 1_000).toISOString();

const written = (seconds: number) =>
	"x".repeat(seconds * WRITTEN_CHARS_PER_SECOND);

const bash = (id: string, at: number, resultAt: number, seconds = 0) => ({
	id,
	input: { command: `echo ${id} ${written(seconds)}` },
	kind: "tool" as const,
	nativeId: `toolu_${id}`,
	result: { content: "ok", isError: false, timestamp: ts(resultAt) },
	timestamp: ts(at),
	toolName: "Bash",
});

const waterfall = getReaderWaterfall(
	{
		userItems: [],
		responseItems: [
			{
				events: [
					{
						id: "think",
						kind: "reasoning",
						text: "Cleaning up the colours.",
						timestamp: ts(14),
					},
					bash("script", 23, 23.2, 9),
					bash("check", 26, 26.1, 3),
					bash("quick", 26.2, 26.3),
					{
						id: "file",
						input: { content: written(40), file_path: "/repo/globe3d.ts" },
						kind: "tool" as const,
						nativeId: "toolu_file",
						result: { content: "ok", isError: false, timestamp: ts(66.05) },
						timestamp: ts(66),
						toolName: "Write",
					},
					{
						id: "read",
						input: { file_path: "/tmp/glyphs/atc.png" },
						kind: "tool" as const,
						nativeId: "toolu_read",
						result: { content: "ok", isError: false, timestamp: ts(80.05) },
						timestamp: ts(80),
						toolName: "Read",
					},
				],
				executionMode: "default",
				id: "root",
				kind: "agent",
				timestamp: ts(0),
			},
		],
	},
	{ endedAt: ts(81), startedAt: ts(0), usageCalls: [] },
	null,
);
const step = (id: string) => waterfall?.steps.find((s) => s.id === id);
const writing = (callId: string) =>
	waterfall?.steps.find(
		(s) => s.writes === `toolu_${callId}` || s.writes === callId,
	);

describe("the time before a call", () => {
	test("is the model's: thinking that produced the call, from what came last", () => {
		const before = writing("script");
		expect(before?.kind).toBe("thinking");
		expect(before?.name).toBe("Thinking");
		expect(before?.text).toBeNull();
		expect(before?.startMs).toBe(Date.parse(ts(14)));
		expect(before?.endMs).toBe(Date.parse(ts(23)));
		const order = waterfall?.steps.map((s) => s.id) ?? [];
		expect(order.indexOf(before?.id ?? "")).toBe(order.indexOf("script") - 1);
	});

	test("after results it waited on, from the last of them", () => {
		expect(writing("check")?.startMs).toBe(Date.parse(ts(23.2)));
	});

	test("too short to matter isn't a step", () => {
		expect(writing("quick")).toBeUndefined();
	});

	test("a short input after a long pause: all of it the model's", () => {
		const before = writing("read");
		expect(before?.startMs).toBe(Date.parse(ts(66.05)));
		expect(before?.endMs).toBe(Date.parse(ts(80)));
	});

	test("writing a file is the Write call, with no step before it", () => {
		expect(step("file:thinking")).toBeUndefined();
		expect(step("file")?.startMs).toBe(Date.parse(ts(26.3)));
		expect(step("file")?.endMs).toBe(Date.parse(ts(66.05)));
	});
});
