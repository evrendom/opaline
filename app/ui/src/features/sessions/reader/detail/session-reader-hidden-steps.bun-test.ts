import { describe, expect, test } from "bun:test";
import type { SessionReaderWaterfall } from "../model/session-reader-model";
import type { SessionReaderStep } from "../model/session-reader-run-steps";
import { railTagKeysOf } from "../model/session-reader-step-lanes";
import { withoutHiddenSteps } from "./session-reader-hidden-steps";

const step = (id: string, extra: Record<string, unknown> = {}) =>
	({
		children: [],
		detail: null,
		endMs: 10,
		icon: null,
		id,
		isError: false,
		kind: "tool",
		name: "Bash",
		nativeId: null,
		result: null,
		startMs: 0,
		text: null,
		...extra,
	}) as unknown as SessionReaderStep;

const run = (steps: SessionReaderStep[]): SessionReaderWaterfall => ({
	allSteps: steps,
	endMs: 10,
	model: null,
	startMs: 0,
	steps,
});

describe("hiding steps from a run", () => {
	test("nothing hidden keeps the very same run", () => {
		const waterfall = run([step("a")]);
		expect(withoutHiddenSteps(waterfall, new Set())).toBe(waterfall);
	});

	test("thinking and messages go by their kind", () => {
		const waterfall = run([
			step("think", { kind: "thinking" }),
			step("say", { kind: "message" }),
			step("ls", { name: "Grep" }),
		]);
		const ids = (hidden: string[]) =>
			withoutHiddenSteps(waterfall, new Set(hidden))?.allSteps.map(
				(each) => each.id,
			);
		expect(ids(["thinking"])).toEqual(["say", "ls"]);
		expect(ids(["messages"])).toEqual(["think", "ls"]);
	});

	test("a call goes with its tag, out of a subagent's steps too", () => {
		const shell = step("ls", { name: "Grep" });
		const tags = railTagKeysOf(shell);
		expect(tags).toEqual(["search"]);
		const launch = step("agent", {
			children: [shell, step("think", { kind: "thinking" })],
		});
		const kept = withoutHiddenSteps(run([launch]), new Set(tags));
		expect(kept?.allSteps.map((each) => each.id)).not.toContain("ls");
		expect(kept?.allSteps.map((each) => each.id)).toContain("think");
	});

	test("the trace hidden takes the whole run; Other, the untagged calls", () => {
		const waterfall = run([
			step("think", { kind: "thinking" }),
			step("grep", { name: "Grep" }),
			step("todo", { name: "TodoWrite" }),
		]);
		expect(withoutHiddenSteps(waterfall, new Set(["toolCalls"]))).toBeNull();
		expect(
			withoutHiddenSteps(waterfall, new Set(["otherCalls"]))?.allSteps.map(
				(each) => each.id,
			),
		).toEqual(["think", "grep"]);
	});
});
