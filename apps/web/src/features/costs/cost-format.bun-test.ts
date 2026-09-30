import { describe, expect, test } from "bun:test";
import { DASHBOARD_METRICS, listDashboardTabs } from "./cost-format";

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
