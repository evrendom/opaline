import { expect, test } from "bun:test";
import type { CostDashboard, CostDashboardInput } from "@rudel/api-routes";
import { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { costsQueryScope, dashboardPlaceholder } from "./use-cost-dashboard";

const base = {
	startDate: "2026-09-01",
	endDate: "2026-09-30",
	requestedMetric: "cost",
	durationInterval: undefined,
} as const;

function cache(
	client: QueryClient,
	input: Partial<CostDashboardInput>,
	requestedMetric = input.requestedMetric,
) {
	const data = { requestedMetric } as CostDashboard;
	client.setQueryData(
		[
			"org",
			"org-1",
			...orpc.analytics.overview.costs.queryKey({
				input: input as CostDashboardInput,
			}),
		],
		data,
	);
	return data;
}

test("a filter change stands in the latest answer for the same metric and dates", () => {
	const client = new QueryClient();
	const answer = cache(client, { ...base, models: [] });
	const placeholder = dashboardPlaceholder(
		client,
		costsQueryScope("org-1"),
		base,
	);
	expect(placeholder()).toBe(answer);
});

test("a new date range has no stand-in, so the chart and cards load together", () => {
	const client = new QueryClient();
	cache(client, base);
	const placeholder = dashboardPlaceholder(client, costsQueryScope("org-1"), {
		...base,
		startDate: "2026-08-01",
	});
	expect(placeholder()).toBeUndefined();
});

test("another metric, workspace or a metric answered as cost never stands in", () => {
	const client = new QueryClient();
	cache(client, { ...base, requestedMetric: "sessions" });
	cache(client, { ...base, requestedMetric: "mergedPullRequests" }, "cost");
	expect(
		dashboardPlaceholder(client, costsQueryScope("org-1"), {
			...base,
			requestedMetric: "mergedPullRequests",
		})(),
	).toBeUndefined();
	expect(
		dashboardPlaceholder(client, costsQueryScope("org-2"), {
			...base,
			requestedMetric: "sessions",
		})(),
	).toBeUndefined();
});
