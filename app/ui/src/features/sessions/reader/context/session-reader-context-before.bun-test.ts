import { expect, test } from "bun:test";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import { getContextMap } from "./session-reader-context-map";

const step = (
	fields: Partial<SessionReaderStep> & Pick<SessionReaderStep, "kind">,
): SessionReaderStep =>
	({
		children: [],
		detail: null,
		endMs: 0,
		icon: null,
		id: Math.random().toString(),
		isError: false,
		name: "",
		nativeId: null,
		result: null,
		startMs: 0,
		text: null,
		toolEvent: null,
		...fields,
	}) as SessionReaderStep;

const chars = (count: number) => "x".repeat(count);

test("an earlier turn compacted: its summary among them, what it compacted listed at its size then", () => {
	const map = getContextMap({
		baseline: 20_000,
		compacted: {
			prompts: [chars(2_000)],
			steps: [step({ kind: "message", text: chars(6_000) })],
		},
		earlier: "Earlier turns",
		earlierRuns: {
			prompts: [chars(4_000)],
			steps: [
				step({
					files: [{ operation: "read", path: "src/payment.ts" }],
					kind: "tool",
					name: "Read",
					result: chars(400_000),
				}),
				step({
					compaction: { beforeTokens: 220_000, summary: chars(4_000) },
					harness: "compaction",
					kind: "tool",
					name: "compact",
				}),
				step({ kind: "message", text: chars(16_000) }),
			],
		},
		firstInput: 61_000,
		prompt: chars(4_000),
		steps: [step({ kind: "message", text: chars(8_000) })],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const parts = map?.parts ?? [];
	const summary = parts.find((part) => part.key === "earlier:summary");
	expect(summary).toMatchObject({
		before: "Earlier turns",
		kind: "summary",
		tokens: 6_667,
	});
	expect(summary?.items?.map((item) => item.label)).toEqual([
		"Read files · 1",
		"Agent messages",
		"Your prompt",
	]);
	expect(
		summary?.items?.reduce((sum, item) => sum + item.tokens, 0),
	).toBeCloseTo(200_000, -1);
	expect(parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(100_000);
});

test("the run compacted: its summary one block, what it compacted listed", () => {
	const map = getContextMap({
		baseline: 20_000,
		compacted: {
			prompts: [chars(4_000)],
			steps: [
				step({
					files: [{ operation: "read", path: "src/payment.ts" }],
					kind: "tool",
					name: "Read",
					result: chars(20_000),
				}),
			],
		},
		earlier: null,
		prompt: chars(4_000),
		steps: [
			step({ kind: "message", text: chars(40_000) }),
			step({
				compaction: { summary: chars(2_000) },
				harness: "compaction",
				kind: "tool",
				name: "compact",
			}),
			step({ kind: "message", text: chars(8_000) }),
		],
		until: null,
		use: { model: null, tokens: 100_000, window: 200_000 },
	});
	const summary = map?.parts.find((part) => part.key === "earlier");
	expect(map?.compacted).toBe(true);
	expect(summary?.kind).toBe("summary");
	expect(summary?.items).toEqual([
		{ count: 1, label: "Agent messages", tokens: 10_000 },
		{ count: 1, label: "Read files · 1", tokens: 5_000 },
		{ count: 1, label: "Your prompt", tokens: 1_000 },
	]);
});
