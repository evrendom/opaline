import {
	CostDashboardInputSchema,
	type CostDimension,
} from "@rudel/api-routes";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";
import { TooltipProvider } from "@/app/ui/tooltip";
import { DateRangeProvider } from "@/features/analytics/date-range/DateRangeProvider";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { CostDashboardView } from "./cost-dashboard-page";
import { githubOutcomesDashboardFixture } from "./github-outcomes-dashboard.fixture";
import { CI_DIMENSIONS, PR_DIMENSIONS } from "./use-cost-dashboard";

function Page({
	metric = "mergedPullRequests",
	pending = false,
}: {
	metric?: "cost" | "mergedPullRequests" | "ciRuns";
	/** The server has not yet said which metrics this scope offers. */
	pending?: boolean;
}) {
	const [input, setInput] = useState(
		CostDashboardInputSchema.parse({
			startDate: "2026-09-01",
			endDate: "2026-10-01",
			members: ["alice"],
			models: ["sonnet"],
		}),
	);
	const query = useQuery({
		queryKey: ["fixture", pending],
		queryFn: pending
			? () => new Promise<never>(() => {})
			: async () => githubOutcomesDashboardFixture(),
	});
	function toggle(dimension: CostDimension, id: string) {
		setInput((previous) =>
			CostDashboardInputSchema.parse({
				...previous,
				[dimension]: previous[dimension].filter((value) => value !== id),
			}),
		);
	}
	return (
		<CostDashboardView
			dashboard={{
				input,
				inputFor: (requestedMetric) => ({ ...input, requestedMetric }),
				metric,
				metrics: pending
					? ["cost", "sessions", "agentRuns", "signals"]
					: ["cost", "mergedPullRequests", "ciRuns"],
				metricsPending: pending,
				interval: "daily",
				query,
				dimensions: metric === "ciRuns" ? CI_DIMENSIONS : PR_DIMENSIONS,
				toggle,
				clear: () => {},
				setSplit: () => {},
				setMetric: () => {},
				setInterval: () => {},
			}}
		/>
	);
}
function renderPage(
	metric?: "cost" | "mergedPullRequests" | "ciRuns",
	pending = false,
) {
	return render(
		<MemoryRouter>
			<QueryClientProvider client={new QueryClient()}>
				<WorkspaceStateProvider
					value={{
						state: { activeOrg: null, organizations: [], isLoading: false },
						actions: { switchOrganization: async () => {} },
						meta: { isOrgAdmin: false, readsEverySession: true },
					}}
				>
					<DateRangeProvider>
						<TooltipProvider>
							<Page metric={metric} pending={pending} />
						</TooltipProvider>
					</DateRangeProvider>
				</WorkspaceStateProvider>
			</QueryClientProvider>
		</MemoryRouter>,
	);
}
test("GitHub breakdowns hide Members and Models, show GitHub author", async () => {
	renderPage();
	expect(
		await screen.findByRole("region", { name: "GitHub author" }),
	).toBeInTheDocument();
	expect(
		screen.queryByRole("region", { name: "Members" }),
	).not.toBeInTheDocument();
	expect(
		screen.queryByRole("region", { name: "Models" }),
	).not.toBeInTheDocument();
});
test("inactive member chip is focusable, explains the ignored filter, and removes on Enter", async () => {
	const user = userEvent.setup();
	renderPage("ciRuns");
	const chip = await screen.findByRole("button", {
		name: "Remove member filter alice (not applied to CI runs)",
	});
	expect(chip).toHaveAttribute("data-inactive", "true");
	await user.tab();
	chip.focus();
	expect(await screen.findByRole("tooltip")).toHaveTextContent(
		"Merged PRs and CI runs include every pull request and run, so member and model filters don't apply here yet. They still filter cost, sessions, agent runs and signals.",
	);
	await user.keyboard("{Enter}");
	expect(
		screen.queryByRole("button", {
			name: "Remove member filter alice (not applied to CI runs)",
		}),
	).not.toBeInTheDocument();
});
test("the always-offered stat cards load before the server lists the scope's metrics", () => {
	renderPage("cost", true);
	const row = screen.getByRole("group", { name: "Chart metric" });
	expect(row).toHaveAttribute("aria-busy", "true");
	for (const label of ["Cost", "Sessions", "Agent runs", "Frustrations"])
		expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
	expect(
		screen.queryByRole("button", { name: "Merged PRs" }),
	).not.toBeInTheDocument();
});
