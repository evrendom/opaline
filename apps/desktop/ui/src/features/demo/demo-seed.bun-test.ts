import { expect, test } from "bun:test";
import { DemoSeedSchema } from "./demo-runtime";
import fixture from "./seed.json";

test("static demo rows use the production analytics contract without runtime lookups", () => {
	const seed = DemoSeedSchema.parse(fixture);
	expect(seed.sessions).toHaveLength(30);
	for (const session of seed.sessions.filter(
		(row) => !("subagent_of" in row),
	)) {
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
});

test("the default dashboard seed includes a populated daily cost chart for its range", () => {
	const { dashboard } = DemoSeedSchema.parse(fixture);
	expect(dashboard.input.requestedMetric).toBe("cost");
	expect(dashboard.data.requestedMetric).toBe("cost");
	expect(dashboard.data.metrics.cost?.total).toBeGreaterThan(0);
	expect(dashboard.data.metrics.cost?.trend[0]?.date).toBe(
		dashboard.input.startDate,
	);
	expect(dashboard.data.metrics.cost?.trend.at(-1)?.date).toBe(
		dashboard.input.endDate,
	);
});

test("the demo seed carries a populated trend for every other stat card", () => {
	const { dashboard, previews } = DemoSeedSchema.parse(fixture);
	const cards = previews.filter((preview) => preview.input.splitBy === "none");
	const offered = dashboard.data.availableMetrics;
	expect(cards.map((preview) => preview.input.requestedMetric)).toEqual([
		"sessions",
		"agentRuns",
		"signals",
		...(["mergedPullRequests", "ciRuns"] as const).filter((metric) =>
			offered.includes(metric),
		),
	]);
	for (const { input, data } of cards) {
		const metric = input.requestedMetric ?? "cost";
		expect(input.startDate).toBe(dashboard.input.startDate);
		expect(input.endDate).toBe(dashboard.input.endDate);
		expect(data.requestedMetric).toBe(metric);
		expect(data.metrics[metric]?.trend.some((point) => point.total > 0)).toBe(
			true,
		);
	}
});

test("the demo seed names a member as the signed-in viewer", () => {
	const { members, viewerUserId } = DemoSeedSchema.parse(fixture);
	expect(members.map((member) => member.userId)).toContain(viewerUserId);
});
