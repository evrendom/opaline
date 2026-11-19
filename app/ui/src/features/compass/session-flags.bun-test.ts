import { describe, expect, test } from "bun:test";
import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { flagsByTurn } from "./session-flags";

const turn = (turnId: string, startedAt: string, compactions?: number) =>
	({
		turnId,
		startedAt,
		...(compactions ? { compactions } : {}),
	}) as SessionDetailTurnSummary;

describe("session flags", () => {
	const turns = [
		turn("before", "2026-10-20T13:14:00.000Z"),
		turn("compact", "2026-10-20T14:55:00.000Z", 1),
		turn("after", "2026-10-20T15:14:00.000Z"),
	];

	test("a compaction goes to the turn that holds it, other flags stay", () => {
		const byTurn = flagsByTurn(
			[
				{
					flags: [{ kind: "compaction" }, { kind: "user_frustrated" }],
					startedAt: "2026-10-20T13:14:29.000Z",
				},
			],
			turns,
			true,
		);
		expect(Object.fromEntries(byTurn)).toEqual({
			before: ["user_frustrated"],
			compact: ["compaction"],
		});
	});

	test("turns that don't say keep it on the run's turn", () => {
		const byTurn = flagsByTurn(
			[
				{
					flags: [{ kind: "compaction" }],
					startedAt: "2026-10-20T13:14:29.000Z",
				},
			],
			turns.map((each) => turn(each.turnId, each.startedAt as string)),
			true,
		);
		expect(Object.fromEntries(byTurn)).toEqual({ before: ["compaction"] });
	});
});
