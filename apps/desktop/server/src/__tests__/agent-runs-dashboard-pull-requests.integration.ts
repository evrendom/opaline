import { expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { setUpAgentRunsDashboard } from "./helpers/agent-runs-dashboard-fixture.js";

// Session headlines next to the pull request metrics, scoped by GitHub
// repository ID and by model, in both usage-event cutover modes. Mixed-case
// repository names are in agent-runs-dashboard-repository-case.integration.ts.
setDefaultTimeout(60_000);
const { bothModes, dashboard, seedPullRequestActivity } =
	setUpAgentRunsDashboard(["owner", "outsider", "model-owner"]);

test("PR repository IDs scope every headline like the default metric in both cutover modes", async () => {
	const repository = await seedPullRequestActivity("148001");
	await seedPullRequestActivity("148001", "claude-sonnet-4-5", 1);
	await seedPullRequestActivity("148002");
	await seedPullRequestActivity("148003", "claude-sonnet-4-5", 1);
	const requestedMetrics = [
		"mergedPullRequests",
		"ciFailuresPerPullRequest",
		"ciRuns",
	] as const;
	const unmatchedRepositories = [["148003"], ["999999"], ["148003", "999999"]];
	// Every view is read-only, so both endpoints answer them all at once.
	const views = await Promise.all(
		bothModes().map((endpoint) =>
			Promise.all([
				dashboard(
					{ requestedMetric: "cost", repositories: [repository] },
					0,
					endpoint,
				),
				Promise.all(
					requestedMetrics.map((requestedMetric) =>
						Promise.all([
							dashboard(
								{ requestedMetric, repositories: ["148001"] },
								0,
								endpoint,
							),
							dashboard(
								{
									requestedMetric,
									repositories: ["148001"],
									sessionMetrics: false,
								},
								0,
								endpoint,
							),
							Promise.all(
								unmatchedRepositories.map((repositories) =>
									dashboard({ requestedMetric, repositories }, 0, endpoint),
								),
							),
							dashboard(
								{
									requestedMetric,
									repositories: ["148001", "148002", "999999"],
								},
								0,
								endpoint,
							),
						]),
					),
				),
			]),
		),
	);
	for (const [baseline, perMetric] of views) {
		expect(baseline.metrics.cost?.total).toBeGreaterThan(0);
		expect(baseline.metrics.sessions?.total).toBe(1);
		expect(baseline.metrics.signals?.total).toBe(0);
		expect(baseline.metrics.agentRuns?.total).toBe(1);
		for (const [result, card, unmatchedViews, multiple] of perMetric) {
			for (const metric of [
				"cost",
				"sessions",
				"signals",
				"agentRuns",
			] as const) {
				expect(result.metrics[metric]?.total).toBe(
					baseline.metrics[metric]?.total,
				);
				expect(result.metrics[metric]?.incomplete).toBe(
					baseline.metrics[metric]?.incomplete,
				);
			}
			expect(result.metrics.mergedPullRequests?.total).toBe(1);
			expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
			expect(
				result.metrics.mergedPullRequests?.breakdowns.repositories[0]?.id,
			).toBe("148001");
			// A stat card's request leaves the session metrics out.
			for (const metric of [
				"cost",
				"sessions",
				"signals",
				"agentRuns",
			] as const)
				expect(card.metrics[metric]).toBeNull();
			expect(card.metrics.mergedPullRequests).toEqual(
				result.metrics.mergedPullRequests,
			);
			for (const unmatched of unmatchedViews) {
				for (const metric of [
					"cost",
					"sessions",
					"signals",
					"agentRuns",
					"mergedPullRequests",
					"ciFailuresPerPullRequest",
				] as const)
					expect(unmatched.metrics[metric]?.total).toBe(0);
			}
			expect(multiple.metrics.sessions?.total).toBe(2);
			expect(multiple.metrics.mergedPullRequests?.total).toBe(2);
			expect(multiple.metrics.ciFailuresPerPullRequest?.total).toBe(2);
		}
	}
});

test("PR canonical model filters retain legacy aliases and unknown identities in both cutover modes", async () => {
	await seedPullRequestActivity("148004", "claude-sonnet-4-5", 2);
	await seedPullRequestActivity("148005", "mystery-model", 2);
	const identities = [
		["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],
		["mystery-model", "mystery-model"],
	] as const;
	const requestedMetrics = [
		"mergedPullRequests",
		"ciFailuresPerPullRequest",
	] as const;
	// Every view is read-only, so both endpoints answer them all at once.
	const views = await Promise.all(
		bothModes().map((endpoint) =>
			Promise.all(
				identities.map(([alias, canonical]) =>
					Promise.all([
						dashboard(
							{ requestedMetric: "cost", models: [alias] },
							2,
							endpoint,
						),
						Promise.all(
							[canonical, alias].flatMap((model) =>
								requestedMetrics.map((requestedMetric) =>
									dashboard({ requestedMetric, models: [model] }, 2, endpoint),
								),
							),
						),
					]),
				),
			),
		),
	);
	for (const perIdentity of views) {
		for (const [index, [baseline, results]] of perIdentity.entries()) {
			const [alias, canonical] = identities[index] ?? [];
			assert(alias && canonical);
			expect(baseline.metrics.sessions?.total).toBe(1);
			expect(baseline.metrics.signals?.total).toBe(0);
			expect(baseline.metrics.agentRuns?.total).toBe(1);
			if (alias !== canonical)
				expect(baseline.metrics.cost?.total).toBeGreaterThan(0);
			expect(results).toHaveLength(4);
			for (const result of results) {
				for (const metric of [
					"cost",
					"sessions",
					"signals",
					"agentRuns",
				] as const) {
					expect(result.metrics[metric]?.total).toBe(
						baseline.metrics[metric]?.total,
					);
					expect(result.metrics[metric]?.incomplete).toBe(
						baseline.metrics[metric]?.incomplete,
					);
				}
				expect(result.metrics.mergedPullRequests?.total).toBe(2);
				expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
			}
		}
	}
});
