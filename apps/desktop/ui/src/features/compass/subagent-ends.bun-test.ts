import { describe, expect, test } from "bun:test";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { withSubagentEnds } from "./subagent-ends";

function launch(id: string, startMs: number, endMs: number): SessionReaderStep {
	return {
		children: [],
		detail: null,
		endMs,
		icon: null,
		id,
		isError: false,
		kind: "agent",
		name: "Agent",
		nativeId: `toolu_${id}`,
		result: null,
		startMs,
		text: null,
		toolEvent: {
			input: { description: id },
			result: { subagentId: `sub-${id}` },
		} as unknown as SessionReaderStep["toolEvent"],
	};
}

const finishedRows = (steps: readonly SessionReaderStep[]) =>
	steps.filter((each) => each.id.endsWith(":finished")).map((each) => each.id);

describe("where a subagent was done", () => {
	test("one done within the run has a row of its own there", () => {
		const ends = withSubagentEnds([launch("a", 1_000, 5_000)], 10_000);
		expect(finishedRows(ends.steps)).toEqual(["a:finished"]);
		expect(ends.finishedRow.get("a")).toBe("a:finished");
	});

	test("one done after the run has none: it works on past it", () => {
		const ends = withSubagentEnds([launch("a", 1_000, 30_000)], 10_000);
		expect(finishedRows(ends.steps)).toEqual([]);
		expect(ends.finishedRow.has("a")).toBe(false);
	});

	test("a report in the run before a later run messaged it again isn't where it was done", () => {
		const notice = {
			...launch("n", 6_000, 6_000),
			harness: "notification",
			kind: "tool",
			notification: { agent: true, taskId: "sub-a", toolUseId: null },
			toolEvent: null,
		} as SessionReaderStep;
		const reported = withSubagentEnds(
			[launch("a", 1_000, 6_000), notice],
			10_000,
		);
		expect(reported.finishedRow.get("a")).toBe("n");
		const resumed = withSubagentEnds(
			[launch("a", 1_000, 6_000), notice],
			10_000,
			new Map([["sub-a", 40_000]]),
		);
		expect(resumed.finishedRow.has("a")).toBe(false);
		expect(finishedRows(resumed.steps)).toEqual([]);
	});

	test("its call ends where the session has it finish, what it did still to come", () => {
		const ends = withSubagentEnds(
			[launch("a", 1_000, 1_200)],
			10_000,
			new Map([["sub-a", 40_000]]),
		);
		expect(ends.steps[0]?.endMs).toBe(40_000);
		expect(finishedRows(ends.steps)).toEqual([]);
	});

	test("a finish before what its call says leaves it as it is", () => {
		const given = launch("a", 1_000, 5_000);
		const ends = withSubagentEnds([given], 10_000, new Map([["sub-a", 2_000]]));
		expect(ends.steps[0]).toBe(given);
	});
});
