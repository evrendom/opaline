import { expect, test } from "bun:test";
import { DemoSeedSchema } from "./demo-runtime";
import fixture from "./seed.json";

test("static demo rows use the production analytics contract without runtime lookups", () => {
	const seed = DemoSeedSchema.parse(fixture);
	expect(seed.sessions).toHaveLength(30);
	for (const session of seed.sessions) {
		expect(session.error_count).toBeDefined();
		expect(session.subagent_count).toBeDefined();
		expect(session.native_subagents).toBeDefined();
		expect(session.native_subagents?.length).toBeLessThanOrEqual(
			session.subagent_count ?? 0,
		);
	}
	expect(seed.sessions.some((session) => (session.error_count ?? 0) > 0)).toBe(
		true,
	);
	expect(
		seed.sessions.some((session) => session.member_swear_matches.length > 0),
	).toBe(true);
});

test("the default dashboard seed includes a populated daily cost chart for its range", () => {
	const { dashboard } = DemoSeedSchema.parse(fixture);
	expect(dashboard.input.requestedMetric).toBe("cost");
	expect(dashboard.data.requestedMetric).toBe("cost");
	expect(dashboard.data.metrics.cost.total).toBeGreaterThan(0);
	expect(dashboard.data.metrics.cost.trend[0]?.date).toBe(
		dashboard.input.startDate,
	);
	expect(dashboard.data.metrics.cost.trend.at(-1)?.date).toBe(
		dashboard.input.endDate,
	);
});
