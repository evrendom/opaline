import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { CostDashboard } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/app/ui/tooltip";
import {
	getChartSeriesValue,
	groupChartTrend,
	isCiHistoryAvailable,
} from "./chart-interval";
import { CostChart, GitHubHistoryNotes } from "./cost-chart";
import { githubOutcomesDashboardFixture } from "./github-outcomes-dashboard.fixture";

function renderCiChart(data: CostDashboard) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<CostChart
				data={data}
				pending={false}
				metric="ciRuns"
				metrics={["mergedPullRequests", "ciRuns"]}
				runSignals={[]}
				signalTypes={[]}
				interval="daily"
				onMetricChange={() => {}}
				onRefresh={() => {}}
				refreshing={false}
				splitBy="none"
				onResetSplit={() => {}}
			/>
		</TooltipProvider>,
	);
}

test.each([
	{ preview: true, syncingRepositories: 1, unavailableRepositories: 0 },
	{ preview: false, syncingRepositories: 0, unavailableRepositories: 1 },
	{ preview: false, syncingRepositories: 0, unavailableRepositories: 0 },
])("unknown CI history is unavailable with $syncingRepositories pending and $unavailableRepositories inaccessible repos", (coverage) => {
	const data = githubOutcomesDashboardFixture();
	const ciRuns = data.metrics.ciRuns;
	assert(ciRuns?.githubHistory && ciRuns.ciMinutes);
	ciRuns.githubHistory = { ...ciRuns.githubHistory, ciFrom: null, ...coverage };
	ciRuns.total = 0;
	ciRuns.hasUsage = false;
	ciRuns.ciMinutes.total = 0;
	ciRuns.trend = [{ date: "2026-09-30", total: 0, values: { total: 0 } }];
	const html = renderCiChart(data);
	expect(html).toContain('data-unavailable="true"');
	expect(html).toMatch(
		/<span class="cost-metric-value">(<small[^>]*>[^<]*<\/small>)?—<\/span>/,
	);
	expect(html).toContain("CI minutes (approximate billed Actions minutes): —");
	expect(html).toContain("CI history is unavailable");
	expect(html).not.toContain(
		"CI minutes (approximate billed Actions minutes): 0",
	);
	expect(html).not.toContain("No CI runs in this selection");
	const point = groupChartTrend(ciRuns.trend, "daily")[0];
	assert(point);
	expect(isCiHistoryAvailable(ciRuns.githubHistory, point.endDate)).toBe(false);
	expect(
		getChartSeriesValue(
			point,
			"total",
			"2026-10-01",
			"sum",
			ciRuns.githubHistory.ciFrom,
			isCiHistoryAvailable(ciRuns.githubHistory, point.endDate),
		),
	).toBeNull();
});

test("fully covered no-Actions repositories retain genuine zero CI runs and minutes", () => {
	const data = githubOutcomesDashboardFixture();
	const ciRuns = data.metrics.ciRuns;
	assert(ciRuns?.githubHistory && ciRuns.ciMinutes);
	ciRuns.githubHistory = { ...ciRuns.githubHistory, ciFrom: "2024-10-01" };
	ciRuns.total = 0;
	ciRuns.hasUsage = false;
	ciRuns.ciMinutes.total = 0;
	ciRuns.trend = [{ date: "2026-09-30", total: 0, values: { total: 0 } }];
	const html = renderCiChart(data);
	expect(html).toContain('<span class="cost-metric-value">0</span>');
	expect(html).toContain("CI minutes (approximate billed Actions minutes): 0");
	expect(html).toContain("No CI runs in this selection");
	expect(html).not.toContain('data-unavailable="true"');
	const point = groupChartTrend(ciRuns.trend, "daily")[0];
	assert(point);
	expect(isCiHistoryAvailable(ciRuns.githubHistory, point.endDate)).toBe(true);
	expect(
		getChartSeriesValue(
			point,
			"total",
			"2026-10-01",
			"sum",
			ciRuns.githubHistory.ciFrom,
			isCiHistoryAvailable(ciRuns.githubHistory, point.endDate),
		),
	).toBe(0);
});

test.each([1, 2])("pluralizes %i excluded PRs", (count) => {
	const data = githubOutcomesDashboardFixture();
	const history = data.metrics.mergedPullRequests?.githubHistory;
	assert(history);
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<GitHubHistoryNotes
				history={{ ...history, ciUnavailablePullRequests: count }}
				metric="mergedPullRequests"
				startDate="2026-09-29"
			/>
		</TooltipProvider>,
	);
	expect(html).toContain(`${count} ${count === 1 ? "PR" : "PRs"} excluded`);
});
