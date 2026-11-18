import {
	type CostDashboard,
	type CostDashboardInput,
	CostDashboardInputSchema,
} from "@rudel/api-routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { orpc } from "@/lib/orpc";
import { githubOutcomesDashboardFixture } from "./github-outcomes-dashboard.fixture";
import { useMetricPreviews } from "./use-metric-previews";

const input = CostDashboardInputSchema.parse({
	startDate: "2026-09-01",
	endDate: "2026-09-30",
	requestedMetric: "cost",
});
const inputFor = (requestedMetric: CostDashboardInput["requestedMetric"]) => ({
	...input,
	requestedMetric,
});
const splitInput = { ...inputFor("signals"), splitBy: "signalTypes" as const };

function keyOf(request: CostDashboardInput) {
	return [
		"org",
		"org-1",
		...orpc.analytics.overview.costs.queryOptions({ input: request }).queryKey,
	];
}

function render(client: QueryClient) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<WorkspaceStateProvider
				value={{
					state: {
						activeOrg: { id: "org-1" } as never,
						organizations: [],
						isLoading: false,
					},
					actions: { switchOrganization: async () => {} },
					meta: { isOrgAdmin: false, readsEverySession: true },
				}}
			>
				{children}
			</WorkspaceStateProvider>
		</QueryClientProvider>
	);
	return renderHook(
		() => useMetricPreviews(inputFor, ["cost", "signals"], input),
		{ wrapper },
	);
}

function chartAnswer(languageSplit?: CostDashboard["languageSplit"]) {
	const answer = githubOutcomesDashboardFixture({
		requestedMetric: "cost",
	}) as CostDashboard;
	return languageSplit === undefined ? answer : { ...answer, languageSplit };
}

test("the language split comes from the charted answer, with no second request", () => {
	const client = new QueryClient();
	const split = chartAnswer().metrics.cost;
	client.setQueryData(keyOf(input), chartAnswer(split));
	const { result } = render(client);
	expect(result.current.languageSplit).toBe(split);
	expect(client.getQueryCache().find({ queryKey: keyOf(splitInput) })).toBe(
		undefined,
	);
});

test("an indexing split is known to be unknown, not loading", () => {
	const client = new QueryClient();
	client.setQueryData(keyOf(input), chartAnswer(null));
	const { result } = render(client);
	expect(result.current.languageSplit).toBeNull();
});

test("an answer without the split falls back to the signals request", () => {
	const client = new QueryClient();
	const separate = githubOutcomesDashboardFixture({
		requestedMetric: "signals",
		splitBy: "signalTypes",
	}) as CostDashboard;
	client.setQueryData(keyOf(input), chartAnswer());
	client.setQueryData(keyOf(splitInput), separate);
	const { result } = render(client);
	expect(result.current.languageSplit).toBe(separate.metrics.signals);
});
