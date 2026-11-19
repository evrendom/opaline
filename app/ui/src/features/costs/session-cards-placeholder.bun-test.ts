import { expect, test } from "bun:test";
import {
	type CostDashboard,
	type CostDashboardInput,
	CostDashboardInputSchema,
} from "@rudel/api-routes";
import { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { costsQueryScope } from "./use-cost-dashboard";
import { sessionCardsPlaceholder } from "./use-metric-previews";

const base = CostDashboardInputSchema.parse({
	startDate: "2026-09-01",
	endDate: "2026-09-30",
	requestedMetric: "cost",
});

function cache(
	client: QueryClient,
	input: CostDashboardInput,
	metrics: Partial<CostDashboard["metrics"]> = {},
) {
	const data = {
		requestedMetric: input.requestedMetric,
		metrics: { cost: {}, ...metrics },
	} as CostDashboard;
	client.setQueryData(
		["org", "org-1", ...orpc.analytics.overview.costs.queryKey({ input })],
		data,
	);
	return data;
}

test("charting another session metric keeps the cards on the cached answer", () => {
	const client = new QueryClient();
	const answer = cache(client, base);
	const placeholder = sessionCardsPlaceholder(
		client,
		costsQueryScope("org-1"),
		{ ...base, requestedMetric: "agentRuns", durationInterval: "daily" },
	);
	expect(placeholder()).toBe(answer);
});

test("another metric's answer under different filters never stands in", () => {
	const client = new QueryClient();
	cache(client, { ...base, requestedMetric: "sessions", members: ["u1"] });
	const placeholder = sessionCardsPlaceholder(
		client,
		costsQueryScope("org-1"),
		base,
	);
	expect(placeholder()).toBeUndefined();
});

test("a filter change falls back to the same metric's previous answer", () => {
	const client = new QueryClient();
	const answer = cache(client, { ...base, models: ["claude-sonnet-4-5"] });
	const placeholder = sessionCardsPlaceholder(
		client,
		costsQueryScope("org-1"),
		base,
	);
	expect(placeholder()).toBe(answer);
});

test("a pull request answer, without session metrics, never stands in", () => {
	const client = new QueryClient();
	cache(
		client,
		{ ...base, requestedMetric: "mergedPullRequests" },
		{ cost: null },
	);
	const placeholder = sessionCardsPlaceholder(
		client,
		costsQueryScope("org-1"),
		base,
	);
	expect(placeholder()).toBeUndefined();
});
