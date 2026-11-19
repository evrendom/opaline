import { expect, test } from "bun:test";
import { SessionOverviewAnalyticsSchema } from "../schemas/analytics.js";

const enrichment = SessionOverviewAnalyticsSchema.pick({
	error_count: true,
	subagent_count: true,
	native_subagents: true,
	member_swear_matches: true,
	member_apology_matches: true,
	member_positive_matches: true,
	model_swear_matches: true,
	model_apology_matches: true,
	model_positive_matches: true,
});

test("live overview data must explicitly include words, errors, and subagent models", () => {
	const row = {
		error_count: 2,
		subagent_count: 1,
		native_subagents: [{ subagent_id: "child", model: "gpt-5.6-sol" }],
		member_swear_matches: ["shit"],
		member_apology_matches: [],
		member_positive_matches: ["great"],
		model_swear_matches: [],
		model_apology_matches: ["Sorry"],
		model_positive_matches: [],
	};
	expect(enrichment.parse(row)).toEqual(row);
	for (const key of Object.keys(row)) {
		const incomplete = Object.fromEntries(
			Object.entries(row).filter(([name]) => name !== key),
		);
		expect(enrichment.safeParse(incomplete).success).toBe(false);
	}
});

test("confirmed zeroes and empty matches remain valid, unlike omitted data", () => {
	expect(
		enrichment.safeParse({
			error_count: 0,
			subagent_count: 0,
			native_subagents: [],
			member_swear_matches: [],
			member_apology_matches: [],
			member_positive_matches: [],
			model_swear_matches: [],
			model_apology_matches: [],
			model_positive_matches: [],
		}).success,
	).toBe(true);
});
