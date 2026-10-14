import { describe, expect, test } from "bun:test";
import { toAgentRunsFilters } from "./confidence-filters";

describe("toAgentRunsFilters", () => {
	test("sends each active confidence range as probabilities, open ends at the bounds", () => {
		expect(
			toAgentRunsFilters({
				rq_b: { minimum: 70, maximum: null },
				rq_a: { minimum: null, maximum: 35 },
				rq_c: { minimum: null, maximum: null },
			}),
		).toEqual([
			{ questionId: "rq_a", min: 0, max: 0.35 },
			{ questionId: "rq_b", min: 0.7, max: 1 },
		]);
	});
});
