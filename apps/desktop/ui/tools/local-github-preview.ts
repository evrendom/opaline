// Local-only GitHub outcomes for `bun run dev:demo`. The public demo
// workspace has no GitHub connection, so the server never offers merged pull
// requests or CI runs there. To work on that gated UI locally, the dev server
// adds deterministic synthetic GitHub metrics to the demo's dashboard
// response: same date range, the demo's own members and repositories.
// Nothing here ships; vite.local-demo.config.ts is the only importer.

import {
	type CostDashboard,
	type CostDashboardInput,
	CostDashboardSchema,
} from "@rudel/api-routes";
import {
	type ChartInterval,
	groupChartTrend,
} from "../src/features/costs/chart-interval";

export const GITHUB_PREVIEW_METRICS = [
	"mergedPullRequests",
	"ciFailuresPerPullRequest",
	"ciRuns",
] as const;
type GitHubMetric = (typeof GITHUB_PREVIEW_METRICS)[number];

export function isGitHubPreviewMetric(
	metric: string | undefined,
): metric is GitHubMetric {
	return GITHUB_PREVIEW_METRICS.includes(metric as GitHubMetric);
}

type Entry = {
	id: string;
	label: string;
	value: number;
	incomplete: false;
	image: null;
};

const entry = (id: string, label: string, value: number): Entry => ({
	id,
	label,
	value,
	incomplete: false,
	image: null,
});

// FNV-1a, mapped to [0, 1): stable per seed so reloads show the same data.
function random(seed: string) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index++) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) / 0x100000000;
}

function daysBetween(start: string, end: string) {
	const days: string[] = [];
	const cursor = new Date(`${start}T00:00:00Z`);
	const last = new Date(`${end}T00:00:00Z`);
	while (cursor <= last && days.length < 400) {
		days.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return days;
}

/** Splits `total` across weighted ids, largest remainder first. */
function distribute(total: number, weights: readonly number[]) {
	const sum = weights.reduce((acc, weight) => acc + weight, 0) || 1;
	const exact = weights.map((weight) => (total * weight) / sum);
	const parts = exact.map(Math.floor);
	let rest = total - parts.reduce((acc, part) => acc + part, 0);
	const order = exact
		.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
		.sort((a, b) => b.remainder - a.remainder);
	for (const { index } of order) {
		if (rest <= 0) break;
		parts[index] = (parts[index] ?? 0) + 1;
		rest--;
	}
	return parts;
}

type Dimension = { id: string; label: string; weight: number };

function dimension(
	labels: readonly string[],
	idFor: (label: string, index: number) => string,
	seed: string,
): Dimension[] {
	return labels.map((label, index) => ({
		id: idFor(label, index),
		label,
		weight: 0.4 + random(`${seed}:${label}`),
	}));
}

/** Share of the volume the active filters keep, so filtering feels real. */
function filterShare(
	dimensionValues: Dimension[],
	selected: readonly string[] | undefined,
) {
	if (!selected?.length) return 1;
	const total = dimensionValues.reduce((acc, item) => acc + item.weight, 0);
	const kept = dimensionValues
		.filter((item) => selected.includes(item.id))
		.reduce((acc, item) => acc + item.weight, 0);
	return total > 0 ? kept / total : 1;
}

function breakdown(dimensionValues: Dimension[], total: number) {
	const parts = distribute(
		total,
		dimensionValues.map((item) => item.weight),
	);
	return dimensionValues
		.map((item, index) => entry(item.id, item.label, parts[index] ?? 0))
		.sort((a, b) => b.value - a.value);
}

function bucketStats(
	days: readonly string[],
	interval: ChartInterval,
	perDay: (day: string) => { samples: number; median: number; tail: number },
) {
	const daily = days.map((date) => ({
		date,
		total: perDay(date).samples,
		values: {},
	}));
	return groupChartTrend(daily, interval).map((bucket) => {
		const inside = days.filter(
			(day) => day >= bucket.startDate && day <= bucket.endDate,
		);
		const stats = inside.map(perDay).filter((stat) => stat.samples > 0);
		const samples = stats.reduce((acc, stat) => acc + stat.samples, 0);
		const average = (pick: (stat: (typeof stats)[number]) => number) =>
			samples
				? Math.round(
						stats.reduce((acc, stat) => acc + pick(stat) * stat.samples, 0) /
							samples,
					)
				: null;
		return {
			date: bucket.date,
			startDate: bucket.startDate,
			endDate: bucket.endDate,
			sampleCount: samples,
			unknownCount: 0,
			median: average((stat) => stat.median),
			tail: average((stat) => stat.tail),
		};
	});
}

/**
 * Adds synthetic GitHub metrics to a demo dashboard response. Returns the
 * response unchanged if the result would not match the dashboard schema.
 */
export function withGitHubPreview(
	data: CostDashboard,
	input: Partial<CostDashboardInput> & { startDate: string; endDate: string },
): CostDashboard {
	const days = daysBetween(input.startDate, input.endDate);
	const cost = data.metrics.cost;
	const repoLabels =
		cost?.breakdowns.repositories.map((row) => row.label) ?? [];
	const memberRows = cost?.breakdowns.members ?? [];
	const repositories = dimension(
		repoLabels.length ? repoLabels : ["opalinehq/athena"],
		(_, index) => String(9001 + index),
		"repo",
	);
	const authors = dimension(
		memberRows.length ? memberRows.map((row) => row.label) : ["octocat"],
		(label) => `gh-${label.toLowerCase().replaceAll(/\W+/g, "-")}`,
		"author",
	);
	const members: Dimension[] = memberRows.map((row, index) => ({
		id: row.id,
		label: row.label,
		weight: authors[index]?.weight ?? 1,
	}));
	const share =
		filterShare(repositories, input.repositories) *
		filterShare(authors, input.githubAuthors) *
		filterShare(members, input.members);

	const scaled = (value: number) => Math.round(value * share);
	const weekday = (day: string) => {
		const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
		return dow !== 0 && dow !== 6;
	};
	const perDay = days.map((date) => {
		const prs = scaled(
			Math.floor(
				(weekday(date) ? 2.4 : 0.4) * (0.4 + random(`${date}:pr`) * 1.6),
			),
		);
		const ciPrs = Math.max(0, prs - (random(`${date}:noci`) < 0.15 ? 1 : 0));
		const failures = Array.from({ length: ciPrs }, (_, index) =>
			random(`${date}:fail:${index}`) < 0.35
				? 1 + Math.floor(random(`${date}:fails:${index}`) * 2)
				: 0,
		).reduce((acc, value) => acc + value, 0);
		const runs = scaled(
			prs * 3 + Math.floor(random(`${date}:push`) * (weekday(date) ? 5 : 1)),
		);
		return { date, prs, ciPrs, failures, runs };
	});
	const sum = (pick: (day: (typeof perDay)[number]) => number) =>
		perDay.reduce((acc, day) => acc + pick(day), 0);
	const totalPrs = sum((day) => day.prs);
	const totalCiPrs = sum((day) => day.ciPrs);
	const totalFailures = sum((day) => day.failures);
	const totalRuns = sum((day) => day.runs);
	const failedPrs = Math.round(totalCiPrs * 0.32);
	const interval = (input.durationInterval ?? "daily") as ChartInterval;
	const history = {
		pullRequestsFrom: "2024-10-01",
		ciFrom: "2025-06-01",
		ciUnavailablePullRequests: totalPrs - totalCiPrs,
		syncingRepositories: 0,
		unavailableRepositories: 0,
		lastSyncedAt: new Date().toISOString(),
		preview: false,
	};
	const emptyBreakdowns = {
		members: [],
		repositories: [],
		models: [],
		signalTypes: [],
		phrases: [],
		runSignals: [],
		durations: [],
		skillsUsed: [],
		pullRequestCi: [],
		githubAuthors: [],
		ciConclusions: [],
		ciEvents: [],
		ciWorkflows: [],
		ciAttempts: [],
	};
	const prBreakdowns = {
		...emptyBreakdowns,
		members: breakdown(members, totalPrs),
		repositories: breakdown(repositories, totalPrs),
		githubAuthors: breakdown(authors, totalPrs),
		pullRequestCi: [
			entry("failed", "Had CI failures", failedPrs),
			entry("passed", "No CI failures", totalCiPrs - failedPrs),
			entry("noCi", "No CI runs", Math.round((totalPrs - totalCiPrs) / 2)),
			entry(
				"unavailable",
				"CI history unavailable",
				totalPrs - totalCiPrs - Math.round((totalPrs - totalCiPrs) / 2),
			),
		],
	};
	const conclusions: Dimension[] = [
		{ id: "success", label: "Success", weight: 0.77 },
		{ id: "failure", label: "Failure", weight: 0.17 },
		{ id: "cancelled", label: "Cancelled", weight: 0.06 },
	];
	const workflows: Dimension[] = [
		{ id: "1", label: "CI", weight: 0.6 },
		{ id: "2", label: "Lint", weight: 0.25 },
		{ id: "3", label: "Deploy", weight: 0.15 },
	];
	const ciBreakdowns = {
		...emptyBreakdowns,
		repositories: breakdown(repositories, totalRuns),
		ciConclusions: breakdown(conclusions, totalRuns),
		ciEvents: breakdown(
			[
				{ id: "pull_request", label: "Pull request", weight: 0.7 },
				{ id: "push", label: "Push", weight: 0.3 },
			],
			totalRuns,
		),
		ciWorkflows: breakdown(workflows, totalRuns),
		ciAttempts: breakdown(
			[
				{ id: "first", label: "First attempt", weight: 0.88 },
				{ id: "rerun", label: "Re-run", weight: 0.12 },
			],
			totalRuns,
		),
	};

	// One series per entry of the split dimension, or a single total.
	const seriesFor = (
		metric: GitHubMetric,
		breakdowns: Record<string, Entry[]>,
		fallback: string,
	) => {
		const split =
			input.requestedMetric === metric ? (input.splitBy ?? "none") : "none";
		const entries = split === "none" ? [] : (breakdowns[split] ?? []);
		return entries.length
			? entries.slice(0, 8).map((item) => ({ id: item.id, label: item.label }))
			: [{ id: "total", label: fallback }];
	};
	const valuesFor = (
		series: { id: string }[],
		breakdowns: Record<string, Entry[]>,
		total: number,
	) => {
		if (series.length === 1 && series[0]?.id === "total") return { total };
		const split = input.splitBy ?? "none";
		const weights = series.map(
			(item) =>
				breakdowns[split]?.find((row) => row.id === item.id)?.value ?? 1,
		);
		const parts = distribute(total, weights);
		return Object.fromEntries(
			series.map((item, index) => [item.id, parts[index] ?? 0]),
		);
	};

	const prSeries = seriesFor("mergedPullRequests", prBreakdowns, "Merged PRs");
	const runSeries = seriesFor("ciRuns", ciBreakdowns, "CI runs");
	const cycle = bucketStats(days, interval, (day) => ({
		samples: perDay.find((item) => item.date === day)?.prs ?? 0,
		median: Math.round((0.6 + random(`${day}:cycle`) * 1.8) * 86_400),
		tail: Math.round((3 + random(`${day}:cycle90`) * 5) * 86_400),
	}));
	const durations = bucketStats(days, interval, (day) => ({
		samples: perDay.find((item) => item.date === day)?.runs ?? 0,
		median: Math.round(220 + random(`${day}:median`) * 200),
		tail: Math.round(700 + random(`${day}:p95`) * 500),
	}));
	const ciMinutesByDay = perDay.map((day) => ({
		date: day.date,
		minutes: Math.round(day.runs * (4 + random(`${day.date}:minutes`) * 3)),
	}));
	const ciMinutesTotal = ciMinutesByDay.reduce(
		(acc, day) => acc + day.minutes,
		0,
	);
	const ratio = (numerator: number, denominator: number) =>
		denominator > 0 ? numerator / denominator : 0;

	const preview = {
		...data,
		availableMetrics: [
			...data.availableMetrics.filter(
				(metric) => !isGitHubPreviewMetric(metric),
			),
			...GITHUB_PREVIEW_METRICS,
		],
		...(isGitHubPreviewMetric(input.requestedMetric)
			? {
					requestedMetric: input.requestedMetric,
					splitBy: input.splitBy ?? "none",
				}
			: {}),
		metrics: {
			...data.metrics,
			mergedPullRequests: {
				total: totalPrs,
				incomplete: false,
				hasUsage: totalPrs > 0,
				series: prSeries,
				trend: perDay.map((day) => ({
					date: day.date,
					total: day.prs,
					values: valuesFor(prSeries, prBreakdowns, day.prs),
				})),
				breakdowns: prBreakdowns,
				githubHistory: history,
				cycleTimeStats: {
					interval,
					sampleCount: totalPrs,
					unknownCount: 0,
					medianSeconds: 1.4 * 86_400,
					p90Seconds: 5.5 * 86_400,
					trend: cycle.map(({ median, tail, ...bucket }) => ({
						...bucket,
						medianSeconds: median,
						p95Seconds: tail,
						p90Seconds: tail,
					})),
				},
			},
			ciFailuresPerPullRequest: {
				total: ratio(totalFailures, totalCiPrs),
				numerator: totalFailures,
				denominator: totalCiPrs,
				incomplete: false,
				hasUsage: totalCiPrs > 0,
				series: [{ id: "total", label: "CI failures / PR" }],
				trend: perDay.map((day) => ({
					date: day.date,
					total: ratio(day.failures, day.ciPrs),
					numerator: day.failures,
					denominator: day.ciPrs,
					values: { total: ratio(day.failures, day.ciPrs) },
				})),
				breakdowns: prBreakdowns,
				githubHistory: history,
			},
			ciRuns: {
				total: totalRuns,
				incomplete: false,
				hasUsage: totalRuns > 0,
				series: runSeries,
				trend: perDay.map((day) => ({
					date: day.date,
					total: day.runs,
					values: valuesFor(runSeries, ciBreakdowns, day.runs),
				})),
				breakdowns: ciBreakdowns,
				githubHistory: { ...history, ciUnavailablePullRequests: 0 },
				durationStats: {
					interval,
					sampleCount: totalRuns,
					unknownCount: 0,
					medianSeconds: 312,
					p95Seconds: 1_004,
					trend: durations.map(({ median, tail, ...bucket }) => ({
						...bucket,
						medianSeconds: median,
						p95Seconds: tail,
					})),
				},
				ciMinutes: {
					total: ciMinutesTotal,
					trend: ciMinutesByDay,
					repositories: breakdown(repositories, ciMinutesTotal),
					workflows: breakdown(workflows, ciMinutesTotal),
				},
			},
		},
	};

	const parsed = CostDashboardSchema.safeParse(preview);
	if (!parsed.success) {
		console.warn(
			"[local-github-preview] synthetic data does not match the schema; serving the demo response unchanged.",
			parsed.error.issues.slice(0, 5),
		);
		return data;
	}
	return parsed.data;
}
