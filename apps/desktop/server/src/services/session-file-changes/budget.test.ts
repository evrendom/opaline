import { describe, expect, test } from "bun:test";
import type { SessionFileChanges } from "@rudel/api-routes";
import { capSessionFileChanges } from "./budget.js";

const change = (before: string, after: string) => ({
	after,
	agentId: "",
	at: "2026-10-21T10:00:00.000Z",
	before,
	cut: false,
	eventId: "e1",
	failed: false,
	line: null,
	operation: "edited" as const,
	tool: "write" as const,
	turnId: "t1",
});

const answer = (seen: string, content: string, before: string) =>
	({
		files: [
			{
				changes: [change(before, "new")],
				content,
				contentCut: false,
				movedTo: null,
				path: "/r/a.ts",
				readBy: [],
				readTurns: [],
				reads: 1,
			},
		],
		runs: [
			{
				steps: [
					{
						agentId: "",
						at: "2026-10-21T10:00:00.000Z",
						check: null,
						eventId: "r1",
						failed: false,
						kind: "read" as const,
						label: "a.ts",
						launched: null,
						paths: ["/r/a.ts"],
						seen: { cut: false, line: 1, text: seen },
						verb: "Read",
					},
				],
				turnId: "t1",
			},
		],
	}) as unknown as SessionFileChanges;

describe("capSessionFileChanges", () => {
	test("under the budget, the answer as it was", () => {
		const whole = answer("a", "b", "c");
		expect(capSessionFileChanges(whole, 100)).toBe(whole);
	});

	test("past it, cuts what reads saw first, then contents, saying so", () => {
		const big = "x".repeat(10_000);
		const capped = capSessionFileChanges(answer(big, big, "c"), 13_000);
		const step = capped.runs[0]?.steps[0];
		const file = capped.files[0];
		expect(step?.seen).toMatchObject({ cut: true });
		expect(step?.seen?.text.length).toBe(2_000);
		expect(file?.content?.length).toBe(10_000);
		expect(file?.contentCut).toBe(false);
		expect(file?.changes[0]?.cut).toBe(false);
	});

	test("then a write's previous text, flagging the change", () => {
		const big = "x".repeat(10_000);
		const capped = capSessionFileChanges(answer(big, big, big), 7_000);
		const file = capped.files[0];
		expect(file?.contentCut).toBe(true);
		expect(file?.changes[0]).toMatchObject({ cut: true });
		expect(file?.changes[0]?.before.length).toBe(2_000);
	});
});
