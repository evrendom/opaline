import { expect, setDefaultTimeout, test } from "bun:test";
import {
	setUpAgentRunsDashboard,
	transcript,
} from "./helpers/agent-runs-dashboard-fixture.js";

// Session headlines next to the pull request metrics when the GitHub binding
// and the session's remote spell the repository in different case, in both
// usage-event cutover modes.
setDefaultTimeout(60_000);
const { run, bothModes, ingest, dashboard, seedPullRequestActivity } =
	setUpAgentRunsDashboard(["owner"]);

for (const requestedMetric of [
	"mergedPullRequests",
	"ciFailuresPerPullRequest",
] as const) {
	test(`PR ${requestedMetric} mixed-case GitHub repository filters retain every headline in both cutover modes`, async () => {
		for (const [index, repositoryId] of (requestedMetric ===
		"mergedPullRequests"
			? ["148006", "148007"]
			: ["148008", "148009"]
		).entries()) {
			const fullName = `opalinehq/headline-${repositoryId}-${run}`;
			const repository = await seedPullRequestActivity(
				repositoryId,
				"claude-sonnet-4-5",
				0,
				index === 0 ? fullName.toUpperCase() : fullName,
				index === 0 ? fullName : fullName.toUpperCase(),
			);
			await ingest(
				`local-case-${repositoryId}-${run}`,
				transcript(60, "Great"),
				0,
				true,
				repository.toUpperCase(),
			);
			const views = await Promise.all(
				bothModes().map((endpoint) =>
					Promise.all([
						dashboard(
							{ requestedMetric: "cost", repositories: [repository] },
							0,
							endpoint,
						),
						dashboard(
							{
								requestedMetric: "cost",
								repositories: [repository.replace("github.com", "GitHub.com")],
							},
							0,
							endpoint,
						),
						dashboard(
							{ requestedMetric, repositories: [repositoryId] },
							0,
							endpoint,
						),
					]),
				),
			);
			for (const [baseline, wrongCase, result] of views) {
				expect(baseline.metrics.cost?.total).toBeGreaterThan(0);
				expect(baseline.metrics.sessions?.total).toBe(1);
				expect(baseline.metrics.signals?.total).toBe(0);
				expect(baseline.metrics.agentRuns?.total).toBe(1);
				for (const metric of [
					"cost",
					"sessions",
					"signals",
					"agentRuns",
				] as const) {
					expect(wrongCase.metrics[metric]?.total).toBe(0);
					expect(result.metrics[metric]?.total).toBe(
						baseline.metrics[metric]?.total,
					);
					expect(result.metrics[metric]?.incomplete).toBe(
						baseline.metrics[metric]?.incomplete,
					);
				}
				expect(result.metrics.mergedPullRequests?.total).toBe(1);
				expect(result.metrics.ciFailuresPerPullRequest?.total).toBe(2);
			}
		}
	});
}
