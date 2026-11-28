import { describe, expect, test } from "bun:test";
import {
	buildDateRangeWindowSql,
	buildPricedUsageGroupsCtes,
	buildSubagentUsageCte,
	buildUsageEventAnalyticsCte,
	staleSessionsSql,
	type UsageSource,
} from "./usage-event-analytics.service.js";
import { buildUsageSessionRollupInsertSql } from "./usage-session-rollup.service.js";

const RATE_CARD_TYPE =
	"Array(Tuple(String, String, String, Date, Date, Float64, Float64, Float64, Float64, Float64))";
const MODIFIER_RULES_TYPE =
	"Array(Tuple(String, Array(String), Date, Date, String))";

const count = (sql: string, fragment: string) => sql.split(fragment).length - 1;
const cte = (
	usageSource: UsageSource,
	staleSessions: Parameters<typeof staleSessionsSql>[0] = [],
) =>
	buildUsageEventAnalyticsCte(
		{
			window: {
				includeNativeDescendants: false,
				sessionsSql: buildDateRangeWindowSql,
			},
		},
		false,
		usageSource,
		staleSessions,
	);
const STALE = [
	{ userId: "user-a", source: "codex", sessionId: "thread-1" },
	{ userId: "user-b", source: "claude_code", sessionId: "it's\\odd" },
];

describe("usage analytics SQL shape", () => {
	test("the rollup path carries no rate card, model patterns or modifier rules", () => {
		const rollups = cte("rollups");
		for (const fragment of [
			"extractGroups(",
			"match(lowerUTF8(",
			RATE_CARD_TYPE,
			MODIFIER_RULES_TYPE,
			"usage_event_pricing_rate_card",
			"FROM rudel.usage_events FINAL",
		])
			expect(count(rollups, fragment)).toBe(0);
		expect(rollups.match(/(?<![a-z_])priced_usage_groups AS \(/g)).toHaveLength(
			1,
		);
		// About 3 KB of it is the pending requests of live sessions.
		expect(rollups.length).toBeLessThan(18_000);
	});

	test("the events path and the rollup build each define the pricing once", () => {
		const events = cte("events");
		const insert = buildUsageSessionRollupInsertSql();
		for (const [sql, output] of [
			[events, "stored_priced_usage_groups"],
			[insert, "priced_usage_groups"],
		] as const) {
			expect(
				count(
					sql,
					buildPricedUsageGroupsCtes("usage_event_pricing_candidates", output),
				),
			).toBe(1);
			expect(count(sql, "extractGroups(")).toBe(1);
			expect(count(sql, RATE_CARD_TYPE)).toBe(1);
			expect(count(sql, MODIFIER_RULES_TYPE)).toBe(3);
		}
		expect(cte("rollups").length * 2).toBeLessThan(events.length);
	});

	test("stale sessions are priced from their events and left out of the rollups", () => {
		const stale = staleSessionsSql(STALE);
		expect(stale).toBe(
			"(user_id, source, session_id) IN (SELECT arrayJoin(CAST([('user-a', 'codex', 'thread-1'), ('user-b', 'claude_code', 'it\\'s\\\\odd')], 'Array(Tuple(String, String, String))')))",
		);
		const hybrid = cte("rollups", STALE);
		expect(count(hybrid, `AND ${stale}`)).toBe(1);
		expect(count(hybrid, `AND NOT ${stale}`)).toBe(1);
		expect(
			count(hybrid, "UNION ALL") - count(cte("rollups"), "UNION ALL"),
		).toBe(1);
		expect(hybrid.match(/(?<![a-z_])priced_usage_groups AS \(/g)).toHaveLength(
			1,
		);
		expect(count(hybrid, RATE_CARD_TYPE)).toBe(1);
		expect(cte("rollups", [])).toBe(cte("rollups"));
		expect(staleSessionsSql([])).toBe("");

		const subagents = buildSubagentUsageCte("parents", "rollups", STALE);
		expect(count(subagents, `AND NOT ${stale}`)).toBe(1);
		expect(count(subagents, `AND ${stale}`)).toBe(1);
		expect(buildSubagentUsageCte("parents", "rollups", [])).not.toContain(
			"UNION ALL",
		);
	});
});
