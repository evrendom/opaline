import { describe, expect, test } from "bun:test";
import {
	DASHBOARD_METRICS,
	listDashboardTabs,
	METRIC_LABELS,
} from "./cost-format";

test("CI runs is opt-in and the failure companion uses the stage-1 label", () => {
	expect(listDashboardTabs(["cost", "ciRuns"])).toEqual(["cost", "ciRuns"]);
	expect(listDashboardTabs(undefined)).not.toContain("ciRuns");
	expect(METRIC_LABELS.ciFailuresPerPullRequest).toBe("CI failures / PR");
});

describe("dashboard metric tabs", () => {
	test("renders only the metrics the server offers, in presentation order", () => {
		expect(
			listDashboardTabs([
				"signals",
				"cost",
				"sessions",
				"agentRuns",
				"ciFailuresPerPullRequest",
				"mergedPullRequests",
			]),
		).toEqual([
			"cost",
			"sessions",
			"agentRuns",
			"signals",
			"mergedPullRequests",
		]);
	});

	test("never renders a Merged PRs tab the server does not offer", () => {
		const tabs = listDashboardTabs([
			"cost",
			"sessions",
			"agentRuns",
			"signals",
		]);

		expect(tabs).toEqual(["cost", "sessions", "agentRuns", "signals"]);
		expect(tabs).not.toContain("mergedPullRequests");
	});

	test("waits for the server before showing optional metrics", () => {
		expect(listDashboardTabs(undefined)).toEqual([
			"cost",
			"sessions",
			"agentRuns",
			"signals",
		]);
	});

	test("draws the CI errors companion inside the Merged PRs chart, never as a tab", () => {
		expect(DASHBOARD_METRICS).not.toContain("ciFailuresPerPullRequest");
	});
});
