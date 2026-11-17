import type {
	CostBreakdownEntry,
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	CostDimension,
	DashboardMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import { AGENT_RUN_DURATIONS, AGENT_RUN_SIGNALS } from "@rudel/api-routes";
import type { GitHubReadiness } from "./github-outcomes-readiness.service.js";

export interface CostAggregateRow {
	metric: Exclude<DashboardMetric, "commits"> | "agentRunCoverage";
	date: string;
	dimension: CostDimension | "headline" | "coverage";
	id: string;
	value: number;
	incomplete: number;
	matched_value: number;
	matched_rows: number;
	matched_incomplete: number;
}
interface MemberLabel {
	label: string;
	image: string | null;
}
const DIMENSIONS: CostDimension[] = [
	"members",
	"repositories",
	"models",
	"signalTypes",
	"phrases",
	"runSignals",
	"durations",
	"skillsUsed",
	"pullRequestCi",
	"githubAuthors",
	"ciConclusions",
	"ciEvents",
	"ciWorkflows",
	"ciAttempts",
];
const SIGNAL_LABELS: Record<string, string> = {
	modelApologies: "Model apologies",
	userNegative: "Negative user",
};
const MAX_NAMED_SERIES = 7;

/** Where a metric's trend comes from: its chart facet (the members facet
 * unless split), or its headline rows when the facets were not queried. */
type TrendSource = "chart" | "headline";

/** Metrics every dashboard scope serves. */
export const BASE_DASHBOARD_METRICS = [
	"cost",
	"sessions",
	"agentRuns",
	"signals",
] as const satisfies readonly CostDashboardRequestedMetric[];
const PULL_REQUEST_DASHBOARD_METRICS = [
	"mergedPullRequests",
	"ciFailuresPerPullRequest",
	"ciRuns",
] as const satisfies readonly CostDashboardRequestedMetric[];

export interface DashboardMetricAvailabilityOptions {
	/** `GITHUB_EVIDENCE_UI_ENABLED`; the GitHub evidence UI is dark-launched. */
	readonly githubEvidenceUiEnabled: boolean;
	readonly githubVisibility?: "hidden" | "visible" | "preview";
	readonly githubReadiness?: GitHubReadiness | null;
}

/**
 * The server-side source of truth for which dashboard metrics exist. Pull
 * request metrics need a workspace repository scope, so the anonymous
 * all-users view never offers them, and they stay hidden until the GitHub
 * evidence UI is enabled for the deployment.
 */
export function listAvailableDashboardMetrics(
	tenant: "organization" | "allOrganizations",
	options: DashboardMetricAvailabilityOptions,
): CostDashboardRequestedMetric[] {
	return tenant === "organization" &&
		options.githubEvidenceUiEnabled &&
		(options.githubVisibility === "visible" ||
			options.githubVisibility === "preview")
		? [...BASE_DASHBOARD_METRICS, ...PULL_REQUEST_DASHBOARD_METRICS]
		: [...BASE_DASHBOARD_METRICS];
}

/**
 * Answer a request for a metric the scope does not offer as the default cost
 * view, so a stale link never reaches a hidden metric's query path.
 */
export function resolveAvailableDashboardInput(
	input: CostDashboardInput,
	availableMetrics: readonly CostDashboardRequestedMetric[],
): CostDashboardInput {
	const resolved: CostDashboardInput =
		input.requestedMetric === undefined ||
		availableMetrics.includes(input.requestedMetric)
			? input
			: { ...input, requestedMetric: "cost" };
	if (
		["mergedPullRequests", "ciFailuresPerPullRequest", "ciRuns"].includes(
			resolved.requestedMetric ?? "",
		) &&
		(resolved.splitBy === "members" || resolved.splitBy === "models")
	)
		return { ...resolved, splitBy: "none" };
	return resolved;
}

/** Every UTC date in the inclusive range, so charts plot measured zeros. */
export function listDashboardDates(
	input: Pick<CostDashboardInput, "endDate" | "startDate">,
): string[] {
	const dates: string[] = [];
	for (
		let stamp = Date.parse(input.startDate);
		stamp <= Date.parse(input.endDate);
		stamp += 86_400_000
	) {
		dates.push(new Date(stamp).toISOString().slice(0, 10));
	}
	return dates;
}

export interface CostDashboardBuildOptions {
	/** Defaults to the base metrics, keeping optional metrics hidden. */
	readonly availableMetrics?: readonly CostDashboardRequestedMetric[];
	readonly pullRequests?: Readonly<{
		mergedPullRequests: DashboardMetricData | null;
		ciFailuresPerPullRequest: DashboardMetricData | null;
		ciRuns?: DashboardMetricData | null;
	}>;
	/** False when the session metrics were not queried (a pull request or CI
	 * answer): they are then null rather than zero. */
	readonly sessionMetrics?: boolean;
}

export function buildCostDashboard(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	durationStats?: NonNullable<DashboardMetricData["durationStats"]>,
	options: CostDashboardBuildOptions = {},
): CostDashboard {
	const availableMetrics = options.availableMetrics ?? BASE_DASHBOARD_METRICS;
	const pullRequestsAvailable = availableMetrics.includes("mergedPullRequests");
	const sessionMetrics = options.sessionMetrics ?? true;
	// Only the requested metric has breakdown rows. The others carry their
	// headline by date, enough for a stat card's total and trend.
	const trendFrom = (metric: CostDashboardRequestedMetric): TrendSource =>
		input.requestedMetric === undefined || input.requestedMetric === metric
			? "chart"
			: "headline";
	// Signal-only splits do not alter cost/session totals in the metric strip.
	const baseInput = !["none", "members", "repositories", "models"].includes(
		input.splitBy,
	)
		? { ...input, splitBy: "none" as const }
		: input;
	return {
		requestedMetric: input.requestedMetric,
		splitBy: input.splitBy,
		availableMetrics: [...availableMetrics],
		metrics: {
			cost: sessionMetrics
				? buildMetric(
						rows.filter((row) => row.metric === "cost"),
						baseInput,
						members,
						"API Cost",
						trendFrom("cost"),
					)
				: null,
			sessions: sessionMetrics
				? buildMetric(
						rows.filter((row) => row.metric === "sessions"),
						baseInput,
						members,
						"Sessions",
						trendFrom("sessions"),
					)
				: null,
			commits: null,
			signals: sessionMetrics
				? buildSignal(
						rows,
						input.splitBy === "runSignals" ||
							input.splitBy === "durations" ||
							input.splitBy === "skillsUsed"
							? baseInput
							: input,
						members,
						trendFrom("signals"),
					)
				: null,
			agentRuns: sessionMetrics
				? buildAgentRuns(
						rows,
						input,
						members,
						durationStats,
						trendFrom("agentRuns"),
					)
				: null,
			mergedPullRequests: pullRequestsAvailable
				? (options.pullRequests?.mergedPullRequests ?? null)
				: null,
			ciFailuresPerPullRequest: pullRequestsAvailable
				? (options.pullRequests?.ciFailuresPerPullRequest ?? null)
				: null,
			ciRuns: pullRequestsAvailable
				? (options.pullRequests?.ciRuns ?? null)
				: null,
		},
	};
}

function buildAgentRuns(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	durationStats: NonNullable<DashboardMetricData["durationStats"]> | undefined,
	trendFrom: TrendSource = "chart",
): DashboardMetricData | null {
	const runs = rows.filter((row) => row.metric === "agentRuns");
	const runHeadlineRows = rows.some(
		(row) => row.metric === "agentRuns" && row.dimension === "headline",
	)
		? runs.filter((row) => row.dimension === "headline")
		: runs;
	// Preserve the original all-or-nothing contract for deployed clients that do
	// not send requestedMetric. Current clients can render fresh runs alongside
	// explicit scan coverage.
	if (
		input.requestedMetric === undefined &&
		runHeadlineRows.some((row) => Number(row.matched_incomplete) > 0)
	)
		return null;
	const result = buildMetric(
		runs,
		input.splitBy === "signalTypes" || input.splitBy === "phrases"
			? { ...input, splitBy: "none" }
			: input,
		members,
		"Agent runs",
		trendFrom,
	);
	result.durationStats = durationStats;
	const coverageRows = rows.filter(
		(row) => row.metric === "agentRunCoverage" && row.dimension === "coverage",
	);
	if (coverageRows.length > 0) {
		const coverage = {
			indexedSessions: 0,
			indexingSessions: 0,
			unavailableSessions: 0,
		};
		for (const row of coverageRows) {
			const count = Number(row.matched_value);
			if (row.id === "indexed") coverage.indexedSessions += count;
			else if (row.id === "indexing") coverage.indexingSessions += count;
			else if (row.id === "unavailable") coverage.unavailableSessions += count;
		}
		result.coverage = coverage;
		result.incomplete ||=
			coverage.indexingSessions > 0 || coverage.unavailableSessions > 0;
	}
	const fixed = {
		runSignals: AGENT_RUN_SIGNALS,
		durations: AGENT_RUN_DURATIONS,
		skillsUsed: [
			{ id: "yes", label: "Yes" },
			{ id: "no", label: "No" },
		],
	};
	for (const dimension of ["runSignals", "durations", "skillsUsed"] as const) {
		result.breakdowns[dimension] = fixed[dimension].map(
			({ id, label }) =>
				result.breakdowns[dimension].find((entry) => entry.id === id) ?? {
					id,
					label,
					value: 0,
					incomplete: false,
					image: null,
				},
		);
	}
	return result;
}

export function buildLanguageSplit(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
): DashboardMetricData | null {
	const split = buildSignal(
		rows,
		{ ...input, requestedMetric: "signals", splitBy: "signalTypes" },
		members,
	);
	if (!split) return null;
	const breakdowns = Object.fromEntries(
		Object.keys(split.breakdowns).map((dimension) => [dimension, []]),
	) as unknown as DashboardMetricData["breakdowns"];
	breakdowns.signalTypes = split.breakdowns.signalTypes;
	return { ...split, breakdowns };
}

function buildSignal(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	trendFrom: TrendSource = "chart",
): DashboardMetricData | null {
	const signalRows = rows.filter((row) => row.metric === "signals");
	const signalHeadlineRows = signalRows.some(
		(row) => row.dimension === "headline",
	)
		? signalRows.filter((row) => row.dimension === "headline")
		: signalRows;
	if (signalHeadlineRows.some((row) => Number(row.matched_incomplete) > 0))
		return null;
	const result = buildMetric(
		signalRows,
		input,
		members,
		"Frustrations",
		trendFrom,
	);
	// Keep the three known categories selectable even when another filter leaves
	// one at zero. Phrase choices remain limited to actual matched text.
	for (const [id, label] of Object.entries(SIGNAL_LABELS)) {
		if (!result.breakdowns.signalTypes.some((entry) => entry.id === id))
			result.breakdowns.signalTypes.push({
				id,
				label,
				value: 0,
				incomplete: false,
				image: null,
			});
	}
	result.breakdowns.signalTypes.sort(
		(a, b) => b.value - a.value || a.label.localeCompare(b.label),
	);
	// An old/unscanned summary is unknown, not a measured zero.
	return result.incomplete ? null : result;
}

const DAILY_DIMENSIONS = new Set<CostDimension>(
	DIMENSIONS.filter((dimension) => dimension !== "phrases"),
);

function dailyBreakdownsOf(
	rows: readonly CostAggregateRow[],
	breakdowns: DashboardMetricData["breakdowns"],
): NonNullable<DashboardMetricData["dailyBreakdowns"]> {
	const daily: Record<string, Record<string, Record<string, number>>> = {};
	for (const row of rows) {
		const dimension = row.dimension as CostDimension;
		if (!DAILY_DIMENSIONS.has(dimension) || !row.date) continue;
		if (!breakdowns[dimension]?.length) continue;
		const value = Number(row.value);
		if (!value) continue;
		const byDate = daily[dimension] ?? {};
		daily[dimension] = byDate;
		const byId = byDate[row.date] ?? {};
		byDate[row.date] = byId;
		byId[row.id] = (byId[row.id] ?? 0) + value;
	}
	return daily;
}

export function buildMetric(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	label: string,
	trendFrom: TrendSource = "chart",
): DashboardMetricData {
	const breakdowns: DashboardMetricData["breakdowns"] = {
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
	for (const dimension of DIMENSIONS) {
		const entries = new Map<string, CostBreakdownEntry>();
		for (const row of rows) {
			if (row.dimension !== dimension || (dimension === "phrases" && !row.id))
				continue;
			const entry = entries.get(row.id) ?? {
				id: row.id,
				label: labelFor(dimension, row.id, members),
				image:
					dimension === "members" ? (members.get(row.id)?.image ?? null) : null,
				value: 0,
				incomplete: false,
			};
			entry.value += Number(row.value);
			entry.incomplete ||= Number(row.incomplete) > 0;
			entries.set(row.id, entry);
		}
		breakdowns[dimension] = [...entries.values()].sort(
			(a, b) => b.value - a.value || a.label.localeCompare(b.label),
		);
	}
	const splitBy = trendFrom === "headline" ? "none" : input.splitBy;
	const chartDimension =
		trendFrom === "headline"
			? "headline"
			: splitBy === "none"
				? "members"
				: splitBy;
	const chartRows = rows.filter(
		(row) =>
			row.dimension === chartDimension &&
			Number(row.matched_rows) > 0 &&
			(chartDimension !== "phrases" || Boolean(row.id)),
	);
	const headlineRows = rows.some((row) => row.dimension === "headline")
		? rows.filter((row) => row.dimension === "headline")
		: chartRows;
	const totals = new Map<string, number>();
	for (const row of chartRows)
		totals.set(row.id, (totals.get(row.id) ?? 0) + Number(row.matched_value));
	const ranked =
		chartDimension === "durations"
			? AGENT_RUN_DURATIONS.map(({ id }) => [id, totals.get(id) ?? 0] as const)
			: [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const limit =
		chartDimension === "durations"
			? AGENT_RUN_DURATIONS.length
			: chartDimension === "ciConclusions"
				? 8
				: MAX_NAMED_SERIES;
	const named = ranked.slice(0, limit);
	const series =
		splitBy === "none"
			? [{ id: "total", label }]
			: named.map(([id], index) => ({
					id: `series-${index}`,
					label: labelFor(splitBy, id, members),
				}));
	if (splitBy !== "none" && ranked.length > limit)
		series.push({ id: "other", label: "Other" });
	const seriesId = new Map(named.map(([id], index) => [id, `series-${index}`]));
	const trend: DashboardMetricData["trend"] = listDashboardDates(input).map(
		(date) => ({
			date,
			total: 0,
			values: Object.fromEntries(series.map((entry) => [entry.id, 0])),
		}),
	);
	const byDate = new Map(trend.map((point) => [point.date, point]));
	for (const row of chartRows) {
		const point = byDate.get(row.date);
		if (!point) continue;
		const id = splitBy === "none" ? "total" : (seriesId.get(row.id) ?? "other");
		point.total += Number(row.matched_value);
		point.values[id] = (point.values[id] ?? 0) + Number(row.matched_value);
	}
	return {
		breakdowns,
		dailyBreakdowns: dailyBreakdownsOf(rows, breakdowns),
		trend,
		series,
		total: headlineRows.reduce(
			(sum, row) => sum + Number(row.matched_value),
			0,
		),
		incomplete: headlineRows.some((row) => Number(row.matched_incomplete) > 0),
		hasUsage: headlineRows.some((row) => Number(row.matched_rows) > 0),
	};
}

function labelFor(
	dimension: CostDimension,
	id: string,
	members: ReadonlyMap<string, MemberLabel>,
): string {
	if (dimension === "members")
		return (
			members.get(id)?.label ?? (id ? "Former member" : "Unattributed member")
		);
	if (dimension === "repositories")
		return id
			? id
					.replace(/^(?:github\.com|gitlab\.com|bitbucket\.org)\//u, "")
					.replace(/\/$/u, "")
					.split("/")
					.slice(-2)
					.join("/")
			: "No repository";
	if (dimension === "signalTypes") return SIGNAL_LABELS[id] ?? id;
	if (dimension === "phrases") return id;
	if (dimension === "runSignals")
		return AGENT_RUN_SIGNALS.find((entry) => entry.id === id)?.label ?? id;
	if (dimension === "durations")
		return AGENT_RUN_DURATIONS.find((entry) => entry.id === id)?.label ?? id;
	if (dimension === "skillsUsed") return id === "yes" ? "Yes" : "No";
	return id || "Unknown model";
}
