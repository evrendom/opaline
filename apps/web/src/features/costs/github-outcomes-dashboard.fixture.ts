import {
	type CostDashboardInput,
	CostDashboardSchema,
} from "@rudel/api-routes";

export function githubOutcomesDashboardFixture(
	input: Partial<
		Pick<CostDashboardInput, "requestedMetric" | "splitBy" | "durationInterval">
	> = {},
) {
	const entry = (id: string, label: string, value: number) => ({
		id,
		label,
		value,
		incomplete: false,
		image: null,
	});
	const breakdowns = {
		members: [entry("alice", "Alice", 4)],
		repositories: [],
		models: [],
		signalTypes: [],
		phrases: [],
		runSignals: [],
		durations: [],
		skillsUsed: [],
	};
	const trend = ["2026-08-31", "2026-09-29", "2026-09-30", "2026-10-01"].map(
		(date, index) => ({
			date,
			total: [0, 0, 2, 1][index] ?? 0,
			values: { total: [0, 0, 2, 1][index] ?? 0 },
		}),
	);
	const base = {
		total: 3,
		incomplete: false,
		hasUsage: true,
		series: [{ id: "total", label: "Merged PRs" }],
		trend,
		breakdowns,
	};
	const history = {
		pullRequestsFrom: "2024-10-01",
		ciFrom: "2026-09-01",
		ciUnavailablePullRequests: 1,
		syncingRepositories: 0,
		unavailableRepositories: 0,
		lastSyncedAt: "2026-10-01T12:00:00Z",
		preview: false,
	};
	const stats = {
		interval: input.durationInterval ?? "daily",
		sampleCount: 2,
		unknownCount: 1,
		medianSeconds: 120,
		p95Seconds: 174,
		trend: [
			{
				date: "2026-09-29",
				startDate: "2026-08-31",
				endDate: "2026-10-01",
				sampleCount: 2,
				unknownCount: 1,
				medianSeconds: 120,
				p95Seconds: 174,
			},
		],
	};
	const prBreakdowns = {
		...breakdowns,
		members: [],
		repositories: [entry("201", "opalinehq/athena", 3)],
		githubAuthors: [
			entry("alice-gh", "Alice", 1),
			entry("octocat", "octocat", 2),
		],
		pullRequestCi: [
			entry("failed", "Had CI failures", 1),
			entry("passed", "No CI failures", 0),
			entry("noCi", "No CI runs", 1),
			entry("unavailable", "CI history unavailable", 1),
		],
	};
	const conclusion = [
		entry("failure", "Failure", 1),
		entry("success", "Success", 1),
		entry("inProgress", "In progress", 1),
	];
	return CostDashboardSchema.parse({
		requestedMetric: input.requestedMetric ?? "mergedPullRequests",
		splitBy: input.splitBy ?? "none",
		availableMetrics: [
			"cost",
			"sessions",
			"agentRuns",
			"signals",
			"mergedPullRequests",
			"ciFailuresPerPullRequest",
			"ciRuns",
		],
		metrics: {
			cost: { ...base, total: 12.5 },
			sessions: { ...base, total: 4 },
			commits: null,
			agentRuns: { ...base, total: 6 },
			signals: { ...base, total: 3 },
			mergedPullRequests: {
				...base,
				githubHistory: history,
				breakdowns: prBreakdowns,
				cycleTimeStats: {
					...stats,
					medianSeconds: 172800,
					p90Seconds: 6350400,
					trend: stats.trend.map((point) => ({
						...point,
						p90Seconds: point.p95Seconds,
					})),
				},
			},
			ciFailuresPerPullRequest: {
				...base,
				total: 2,
				numerator: 2,
				denominator: 1,
				breakdowns: prBreakdowns,
				githubHistory: history,
				trend: trend.map((point) => ({
					...point,
					total: point.date === "2026-09-30" ? 2 : 0,
					numerator: point.date === "2026-09-30" ? 2 : 0,
					denominator: point.date === "2026-09-30" ? 1 : 0,
					values: { total: point.date === "2026-09-30" ? 2 : 0 },
				})),
			},
			ciRuns: {
				...base,
				githubHistory: { ...history, ciUnavailablePullRequests: 0 },
				durationStats: stats,
				ciMinutes: {
					total: 4,
					trend: [{ date: "2026-09-29", minutes: 4 }],
					repositories: [entry("201", "opalinehq/athena", 4)],
					workflows: [entry("1", "CI", 4)],
				},
				breakdowns: {
					...breakdowns,
					members: [],
					repositories: [entry("201", "opalinehq/athena", 3)],
					ciConclusions: conclusion,
					ciEvents: [
						entry("pull_request", "Pull request", 2),
						entry("push", "Push", 1),
					],
					ciWorkflows: [entry("1", "CI", 2), entry("2", "Deploy", 1)],
					ciAttempts: [
						entry("first", "First attempt", 2),
						entry("rerun", "Re-run", 1),
					],
				},
				series:
					input.splitBy === "ciConclusions"
						? conclusion.map((item, index) => ({
								id: `series-${index}`,
								label: item.label,
							}))
						: [{ id: "total", label: "CI runs" }],
				trend: trend.map((point) => ({
					...point,
					total: point.date === "2026-09-29" ? 3 : 0,
					values:
						input.splitBy === "ciConclusions"
							? {
									"series-0": point.date === "2026-09-29" ? 1 : 0,
									"series-1": point.date === "2026-09-29" ? 1 : 0,
									"series-2": point.date === "2026-09-29" ? 1 : 0,
								}
							: { total: point.date === "2026-09-29" ? 3 : 0 },
				})),
			},
		},
	});
}
