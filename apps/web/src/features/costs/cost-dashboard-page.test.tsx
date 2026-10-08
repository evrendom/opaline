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
import { CostDashboardView } from "./cost-dashboard-page";
import { githubOutcomesDashboardFixture } from "./github-outcomes-dashboard.fixture";
import { CI_DIMENSIONS, PR_DIMENSIONS } from "./use-cost-dashboard";

function Page({
	metric = "mergedPullRequests",
}: {
	metric?: "mergedPullRequests" | "ciRuns";
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
		queryKey: ["fixture"],
		queryFn: async () => githubOutcomesDashboardFixture(),
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
				metrics: ["cost", "mergedPullRequests", "ciRuns"],
				metricsPending: false,
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
function renderPage(metric?: "mergedPullRequests" | "ciRuns") {
	return render(
		<MemoryRouter>
			<QueryClientProvider client={new QueryClient()}>
				<DateRangeProvider>
					<TooltipProvider>
						<Page metric={metric} />
					</TooltipProvider>
				</DateRangeProvider>
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
