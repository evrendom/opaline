import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@/app/ui/tooltip";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { CostChart } from "./cost-chart";
import { githubOutcomesDashboardFixture } from "./github-outcomes-dashboard.fixture";

function present<T>(value: T | null): T {
	if (value === null) throw new Error("The fixture has no such metric.");
	return value;
}

function chart(
	data = githubOutcomesDashboardFixture(),
	metric: "mergedPullRequests" | "ciRuns" = "mergedPullRequests",
) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<WorkspaceStateProvider
				value={{
					state: { activeOrg: null, organizations: [], isLoading: false },
					actions: { switchOrganization: async () => {} },
					meta: { isOrgAdmin: false, readsEverySession: true },
				}}
			>
				<TooltipProvider>
					<CostChart
						data={data}
						pending={false}
						metric={metric}
						metrics={[
							"cost",
							"sessions",
							"agentRuns",
							"signals",
							"mergedPullRequests",
							"ciRuns",
						]}
						runSignals={[]}
						signalTypes={[]}
						interval="daily"
						onMetricChange={() => {}}
						onRefresh={() => {}}
						refreshing={false}
						splitBy="none"
						onResetSplit={() => {}}
					/>
				</TooltipProvider>
			</WorkspaceStateProvider>
		</QueryClientProvider>,
	);
}

describe("GitHub chart", () => {
	test("shows retention exclusions, accessible CI legend and cycle time", () => {
		chart();
		expect(
			screen.getByText("CI history from Sep 1, 2026 · 1 PR excluded"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "CI failures per PR" }),
		).toHaveTextContent("2");
		expect(
			screen.getByRole("region", {
				name: "Merged pull requests with CI failures per pull request over time",
			}),
		).toBeInTheDocument();
		expect(screen.getByText(/PR cycle time · Median/)).toHaveTextContent("P90");
	});
	test("shows preview qualifier and every coverage note in order", () => {
		const data = githubOutcomesDashboardFixture();
		data.metrics.mergedPullRequests = {
			...present(data.metrics.cost),
			githubHistory: {
				pullRequestsFrom: "2026-09-01",
				ciFrom: "2026-09-01",
				ciUnavailablePullRequests: 1,
				syncingRepositories: 1,
				unavailableRepositories: 2,
				lastSyncedAt: "2026-09-28T00:00:00Z",
				preview: true,
			},
		};
		chart(data);
		expect(screen.getByText("preview")).toBeInTheDocument();
		expect(
			screen.getByText(
				"Preview: GitHub history is still syncing, so totals may be incomplete.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("PR history from Sep 1, 2026")).toBeInTheDocument();
		expect(
			screen.getByText("1 repository is still syncing and isn't included yet."),
		).toBeInTheDocument();
		expect(
			screen.getByText("2 repositories couldn't be read from GitHub."),
		).toBeInTheDocument();
		expect(
			screen.getByText("Last synced with GitHub Sep 28, 2026"),
		).toBeInTheDocument();
	});
	test("uses the merged PR empty copy and unavailable refresh state", () => {
		const data = githubOutcomesDashboardFixture();
		data.metrics.mergedPullRequests = {
			...present(data.metrics.cost),
			total: 0,
			hasUsage: false,
		};
		const view = chart(data);
		expect(
			screen.getByText("No merged pull requests in this selection"),
		).toBeInTheDocument();
		view.unmount();
		data.metrics.mergedPullRequests = null;
		chart(data);
		expect(
			screen.getAllByText("Pull request data is unavailable").length,
		).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
	});
	test("empty CI history shows unknown history, not a measured zero", () => {
		const data = githubOutcomesDashboardFixture();
		if (!data.metrics.ciRuns) throw new Error("Missing CI fixture");
		data.metrics.ciRuns.githubHistory = {
			pullRequestsFrom: "2024-10-01",
			ciFrom: "2026-10-02",
			ciUnavailablePullRequests: 0,
			syncingRepositories: 0,
			unavailableRepositories: 0,
			lastSyncedAt: null,
			preview: false,
		};
		chart(data, "ciRuns");
		expect(
			screen.getByText("No GitHub history for these dates"),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"CI history starts Oct 2, 2026. GitHub had already deleted older runs when this workspace connected.",
			),
		).toBeInTheDocument();
	});
	test("CI run duration toggles and approximate billed minutes are labelled", () => {
		chart(githubOutcomesDashboardFixture(), "ciRuns");
		expect(
			screen.getByRole("button", { name: "Median duration" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(
			screen.getByRole("button", { name: "P95 duration" }),
		).toHaveAttribute("title", "Duration from run start to its last update.");
		expect(
			screen.getByText("CI minutes (approximate billed Actions minutes): 4"),
		).toBeInTheDocument();
	});
});
