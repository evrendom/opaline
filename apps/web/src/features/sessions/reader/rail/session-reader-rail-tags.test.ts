import {
	SESSION_TURN_STEP_KINDS,
	type SessionDetailTurnSummary,
} from "@rudel/api-routes";
import { describe, expect, test } from "vitest";
import { RAIL_TAGS } from "./session-reader-rail-tags";

describe("the rail's tags", () => {
	test("one per step kind the payload counts, reading its count", () => {
		for (const [index, kind] of SESSION_TURN_STEP_KINDS.entries()) {
			const tag = RAIL_TAGS.find((candidate) => candidate.key === kind);
			const turn = {
				stepKinds: { [kind]: index + 2 },
			} as unknown as SessionDetailTurnSummary;
			expect([kind, tag?.count(turn)]).toEqual([kind, index + 2]);
		}
	});
});
