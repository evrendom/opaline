import { describe, expect, test } from "bun:test";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../model/session-reader-model";
import { findStepCall } from "./session-reader-step-breakdown";

const T0 = Date.parse("2026-10-20T10:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const call = (seconds: number) => ({
	at: at(seconds),
	cacheCreationInputTokens: 0,
	cacheReadInputTokens: 0,
	contextWindow: null,
	freshInputTokens: 10,
	model: "claude-opus-4-6",
	outputTokens: 5,
});

const step = (fields: Record<string, unknown>) =>
	({ children: [], ...fields }) as unknown as SessionReaderStep;

const thinking = step({ endMs: T0 + 2000, kind: "thinking", startMs: T0 });
const edit = step({
	endMs: T0 + 9000,
	kind: "tool",
	startMs: T0 + 2000,
	writtenUntilMs: T0 + 4000,
});
const answer = step({
	endMs: T0 + 12_000,
	kind: "message",
	startMs: T0 + 10_000,
});

const waterfall = {
	allSteps: [thinking, edit, answer],
	endMs: T0 + 12_000,
	model: null,
	startMs: T0,
	steps: [thinking, edit, answer],
} as SessionReaderWaterfall;

const turn = (resolution: "bucketed" | "exact") =>
	({
		activityResolution: resolution,
		usageCalls: [call(2), call(12)],
	}) as unknown as SessionDetailTurnSummary;

describe("findStepCall", () => {
	test("a step comes of the last call made at or before its moment", () => {
		expect(findStepCall(thinking, turn("exact"), waterfall)?.at).toBe(at(2));
		expect(findStepCall(edit, turn("exact"), waterfall)?.at).toBe(at(2));
		expect(findStepCall(answer, turn("exact"), waterfall)?.at).toBe(at(12));
	});

	test("none where the calls were bucketed, or for a subagent's step", () => {
		expect(findStepCall(thinking, turn("bucketed"), waterfall)).toBeNull();
		const nested = step({ endMs: T0 + 3000, kind: "thinking", startMs: T0 });
		expect(findStepCall(nested, turn("exact"), waterfall)).toBeNull();
	});
});
