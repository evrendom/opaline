import { describe, expect, test } from "bun:test";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { getAttempts } from "./trace-attempts";

let clock = 0;

function step(
	id: string,
	kind: SessionReaderStep["kind"],
	extra: Partial<SessionReaderStep> = {},
): SessionReaderStep {
	clock += 1000;
	return {
		children: [],
		detail: null,
		endMs: clock + 500,
		icon: null,
		id,
		isError: false,
		kind,
		name: kind,
		nativeId: null,
		result: null,
		startMs: clock,
		text: kind === "message" || kind === "thinking" ? id : null,
		toolEvent: null,
		...extra,
	};
}

const tsc = (id: string, isError = false) =>
	step(id, "tool", {
		command: { chain: "tsc", kind: "typecheck", lead: "tsc" },
		isError,
		name: "tsc",
	});

const ids = (steps: readonly SessionReaderStep[]) =>
	steps.map((each) => each.id);

describe("an attempt's time", () => {
	test("the thinking before a message is the time of the attempt before", () => {
		const attempts = getAttempts([
			step("think-1", "thinking"),
			step("say-1", "message"),
			step("read", "tool", { name: "Read" }),
			step("think-2", "thinking"),
			step("say-2", "message"),
			step("grep", "tool", { name: "Grep" }),
			step("answer", "message"),
		]);
		expect(attempts.map((attempt) => ids(attempt.steps))).toEqual([
			["think-1", "say-1", "read", "think-2"],
			["say-2", "grep"],
			["answer"],
		]);
		expect(ids(attempts[0]?.thoughtSteps ?? [])).toEqual(["think-1"]);
		expect(attempts[1]?.thoughtSteps).toEqual([]);
		expect(attempts[0]?.endMs).toBe(
			attempts[0]?.steps.at(-1)?.endMs ?? Number.NaN,
		);
	});

	test("a call sent to the background counts to its hand-off", () => {
		const say = step("say", "message");
		const monitor = step("monitor", "tool", { name: "Monitor" });
		monitor.backgroundFromMs = monitor.endMs;
		monitor.endMs += 3_600_000;
		const attempt = getAttempts([say, monitor]).find((each) =>
			each.steps.includes(monitor),
		);
		expect(attempt?.endMs).toBe(monitor.backgroundFromMs ?? Number.NaN);
	});

	test("a check ends its attempt, with the thinking after it", () => {
		const attempts = getAttempts([
			step("say-1", "message"),
			tsc("check-1", true),
			step("think", "thinking"),
			step("say-2", "message"),
			tsc("check-2"),
			step("answer", "message"),
		]);
		expect(attempts.map((attempt) => ids(attempt.steps))).toEqual([
			["say-1", "check-1", "think"],
			["say-2", "check-2"],
			["answer"],
		]);
		expect(attempts[0]?.check?.id).toBe("check-1");
		expect(attempts[0]?.outcome).toBe("failed");
		expect(attempts[1]?.outcome).toBe("passed");
	});
});
