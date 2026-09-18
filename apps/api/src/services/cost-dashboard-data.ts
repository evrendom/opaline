import type {
	CostBreakdownEntry,
	CostDashboard,
	CostDashboardInput,
	CostDimension,
	DashboardMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import { AGENT_RUN_DURATIONS, AGENT_RUN_SIGNALS } from "@rudel/api-routes";

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
];
const SIGNAL_LABELS: Record<string, string> = {
	modelApologies: "Model apologies",
	userNegative: "Negative user",
	userPositive: "Positive user",
};
const MAX_NAMED_SERIES = 7;

export function buildCostDashboard(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	durationStats?: NonNullable<DashboardMetricData["durationStats"]>,
): CostDashboard {
	// Signal-only splits do not alter cost/session totals in the metric strip.
	const baseInput = !["none", "members", "repositories", "models"].includes(
		input.splitBy,
	)
		? { ...input, splitBy: "none" as const }
		: input;
	return {
		requestedMetric: input.requestedMetric,
		splitBy: input.splitBy,
		metrics: {
			cost: buildMetric(
				rows.filter((row) => row.metric === "cost"),
				baseInput,
				members,
				"API Cost",
			),
			sessions: buildMetric(
				rows.filter((row) => row.metric === "sessions"),
				baseInput,
				members,
				"Sessions",
			),
			commits: null,
			signals: buildSignal(
				rows,
				input.splitBy === "runSignals" ||
					input.splitBy === "durations" ||
					input.splitBy === "skillsUsed"
					? baseInput
					: input,
				members,
			),
			agentRuns: buildAgentRuns(rows, input, members, durationStats),
		},
	};
}

function buildAgentRuns(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	durationStats: NonNullable<DashboardMetricData["durationStats"]> | undefined,
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

function buildSignal(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
): DashboardMetricData | null {
	const signalRows = rows.filter((row) => row.metric === "signals");
	const signalHeadlineRows = signalRows.some(
		(row) => row.dimension === "headline",
	)
		? signalRows.filter((row) => row.dimension === "headline")
		: signalRows;
	if (signalHeadlineRows.some((row) => Number(row.matched_incomplete) > 0))
		return null;
	const result = buildMetric(signalRows, input, members, "Language signals");
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

function buildMetric(
	rows: CostAggregateRow[],
	input: CostDashboardInput,
	members: ReadonlyMap<string, MemberLabel>,
	label: string,
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
	const splitBy = input.splitBy;
	const chartDimension = splitBy === "none" ? "members" : splitBy;
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
			: MAX_NAMED_SERIES;
	const named = ranked.slice(0, limit);
	const series =
		splitBy === "none"
			? [{ id: "total", label }]
			: named.map(([id], index) => ({
					id: `series-${index}`,
					label: labelFor(chartDimension, id, members),
				}));
	if (splitBy !== "none" && ranked.length > limit)
		series.push({ id: "other", label: "Other" });
	const seriesId = new Map(named.map(([id], index) => [id, `series-${index}`]));
	const trend: DashboardMetricData["trend"] = [];
	for (
		let stamp = Date.parse(input.startDate);
		stamp <= Date.parse(input.endDate);
		stamp += 86_400_000
	) {
		trend.push({
			date: new Date(stamp).toISOString().slice(0, 10),
			total: 0,
			values: Object.fromEntries(series.map((entry) => [entry.id, 0])),
		});
	}
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
