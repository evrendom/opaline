import { describe, expect, test } from "bun:test";
import {
	buildDateRangeWindowSql,
	buildPricedUsageGroupsCtes,
	buildUsageEventAnalyticsCte,
	type UsageSource,
} from "./usage-event-analytics.service.js";
import { buildUsageSessionRollupInsertSql } from "./usage-session-rollup.service.js";

const RATE_CARD_TYPE =
	"Array(Tuple(String, String, String, Date, Date, Float64, Float64, Float64, Float64, Float64))";
const MODIFIER_RULES_TYPE =
	"Array(Tuple(String, Array(String), Date, Date, String))";

const count = (sql: string, fragment: string) => sql.split(fragment).length - 1;
const cte = (usageSource: UsageSource) =>
	buildUsageEventAnalyticsCte(
		{
			window: {
				includeNativeDescendants: false,
				sessionsSql: buildDateRangeWindowSql,
			},
		},
		false,
		usageSource,
	);

describe("usage analytics SQL shape", () => {
	test("the rollup path carries no rate card, model patterns or modifier rules", () => {
		const rollups = cte("rollups");
		for (const fragment of [
			"extractGroups(",
			"match(lowerUTF8(",
			RATE_CARD_TYPE,
			MODIFIER_RULES_TYPE,
			"usage_event_pricing_rate_card",
			"rudel.usage_events",
		])
			expect(count(rollups, fragment)).toBe(0);
		expect(count(rollups, "priced_usage_groups AS (")).toBe(1);
		expect(rollups.length).toBeLessThan(16_000);
	});

	test("the events path and the rollup build each define the pricing once", () => {
		const events = cte("events");
		const insert = buildUsageSessionRollupInsertSql();
		const pricing = buildPricedUsageGroupsCtes(
			"usage_event_pricing_candidates",
		);
		for (const sql of [events, insert]) {
			expect(count(sql, pricing)).toBe(1);
			expect(count(sql, "extractGroups(")).toBe(1);
			expect(count(sql, RATE_CARD_TYPE)).toBe(1);
			expect(count(sql, MODIFIER_RULES_TYPE)).toBe(3);
		}
		expect(cte("rollups").length * 2).toBeLessThan(events.length);
	});
});
