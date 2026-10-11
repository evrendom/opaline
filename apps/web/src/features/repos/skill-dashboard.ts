import type {
	CostBreakdownEntry,
	CostDashboard,
	CostDashboardInput,
	CostDimension,
	DashboardMetricData,
	DashboardSignal,
	SessionAnalytics,
} from "@rudel/api-routes";

// The server's split: this many named series, the rest folded into "Other".
const MAX_NAMED_SERIES = 7;
const SIGNAL_LABELS: Record<DashboardSignal, string> = {
	userNegative: "Negative",
	userPositive: "Positive",
	modelApologies: "Model apologies",
};
const SIGNAL_TYPES = Object.keys(SIGNAL_LABELS) as DashboardSignal[];

type Metric = "cost" | "sessions" | "signals";
type Dimension = Extract<
	CostDimension,
	"members" | "models" | "signalTypes" | "phrases"
>;
export type MemberLabels = {
	names: Readonly<Record<string, string>>;
	avatars: Readonly<Record<string, string>>;
};

/** One signal occurrence, as the dashboard counts them. */
type Occurrence = { type: DashboardSignal; phrase: string };

function occurrences(session: SessionAnalytics): Occurrence[] {
	const of = (
		type: DashboardSignal,
		count: number,
		matches: readonly string[] | undefined,
	) => {
		const phrases = matches?.length ? matches : [];
		// Counts can run past the matched phrases listed; those count unnamed.
		return Array.from({ length: Math.max(count, phrases.length) }, (_, i) => ({
			type,
			phrase: phrases[i] ?? "",
		}));
	};
	return [
		...of("userNegative", session.member_swears, session.member_swear_matches),
		...of(
			"userPositive",
			session.member_positive,
			session.member_positive_matches,
		),
		...of(
			"modelApologies",
			session.model_apologies,
			session.model_apology_matches,
		),
	];
}

const sessionDate = (session: SessionAnalytics) =>
	session.session_date.slice(0, 10);

/** Every date in the inclusive range, so the chart plots measured zeros. */
function listDates(startDate: string, endDate: string) {
	const dates: string[] = [];
	for (
		let stamp = Date.parse(startDate);
		stamp <= Date.parse(endDate);
		stamp += 86_400_000
	)
		dates.push(new Date(stamp).toISOString().slice(0, 10));
	return dates;
}

/**
 * The workspace dashboard's response, computed from session rows: cost,
 * sessions and language signals, each with its daily trend (split like the
 * server's), totals and breakdowns. Each breakdown counts with every other
 * filter applied but its own, as the server's facets do.
 */
export function buildSessionsDashboard(
	sessions: readonly SessionAnalytics[],
	input: CostDashboardInput,
	labels: MemberLabels,
): CostDashboard {
	const dates = listDates(input.startDate, input.endDate);
	const selected: Record<Dimension, readonly string[]> = {
		members: input.members,
		models: input.models,
		signalTypes: input.signalTypes,
		phrases: input.phrases,
	};
	const keyOf: Record<"members" | "models", (s: SessionAnalytics) => string> = {
		members: (s) => s.user_id,
		models: (s) => s.model_used,
	};
	const passes = (session: SessionAnalytics, except?: Dimension) =>
		(["members", "models"] as const).every(
			(dimension) =>
				dimension === except ||
				selected[dimension].length === 0 ||
				selected[dimension].includes(keyOf[dimension](session)),
		);
	const countsOccurrence = (occurrence: Occurrence, except?: Dimension) =>
		(except === "signalTypes" ||
			selected.signalTypes.length === 0 ||
			selected.signalTypes.includes(occurrence.type)) &&
		(except === "phrases" ||
			selected.phrases.length === 0 ||
			selected.phrases.includes(occurrence.phrase));
	const sessionValue = (
		metric: Metric,
		session: SessionAnalytics,
		except?: Dimension,
	) =>
		metric === "cost"
			? (session.estimated_cost ?? 0)
			: metric === "sessions"
				? 1
				: occurrences(session).filter((o) => countsOccurrence(o, except))
						.length;
	const labelOf = (dimension: Dimension, id: string) =>
		dimension === "members"
			? (labels.names[id] ?? "Former member")
			: dimension === "signalTypes"
				? (SIGNAL_LABELS[id as DashboardSignal] ?? id)
				: id || (dimension === "models" ? "Unknown model" : "Unnamed");

	function breakdown(metric: Metric, dimension: Dimension) {
		const entries = new Map<string, CostBreakdownEntry>();
		const add = (id: string, value: number, incomplete: boolean) => {
			const entry = entries.get(id) ?? {
				id,
				label: labelOf(dimension, id),
				value: 0,
				incomplete: false,
				image: dimension === "members" ? (labels.avatars[id] ?? null) : null,
			};
			entry.value += value;
			entry.incomplete ||= incomplete;
			entries.set(id, entry);
		};
		for (const session of sessions) {
			if (!passes(session, dimension)) continue;
			if (dimension === "members" || dimension === "models") {
				add(
					keyOf[dimension](session),
					sessionValue(metric, session),
					metric === "cost" && session.estimated_cost == null,
				);
				continue;
			}
			for (const occurrence of occurrences(session))
				if (countsOccurrence(occurrence, dimension))
					add(
						dimension === "signalTypes" ? occurrence.type : occurrence.phrase,
						1,
						false,
					);
		}
		if (dimension === "signalTypes")
			for (const type of SIGNAL_TYPES)
				if (!entries.has(type)) add(type, 0, false);
		return [...entries.values()]
			.filter((entry) => dimension !== "phrases" || entry.id)
			.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
	}

	function metricData(metric: Metric, label: string): DashboardMetricData {
		const matching = sessions.filter((session) => passes(session));
		const splitBy = input.splitBy as Dimension | "none";
		const splitKey = (session: SessionAnalytics) =>
			splitBy === "members" || splitBy === "models"
				? keyOf[splitBy](session)
				: "";
		// Split by a signal facet: each occurrence goes to its type or phrase.
		const parts = (session: SessionAnalytics) =>
			splitBy === "signalTypes" || splitBy === "phrases"
				? occurrences(session)
						.filter((o) => countsOccurrence(o))
						.map((o) => ({
							id: splitBy === "signalTypes" ? o.type : o.phrase,
							value: metric === "signals" ? 1 : 0,
						}))
				: [{ id: splitKey(session), value: sessionValue(metric, session) }];
		const totals = new Map<string, number>();
		for (const session of matching)
			for (const part of parts(session))
				totals.set(part.id, (totals.get(part.id) ?? 0) + part.value);
		const ranked = [...totals].sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
		);
		const named = ranked.slice(0, MAX_NAMED_SERIES);
		const series =
			splitBy === "none"
				? [{ id: "total", label }]
				: named.map(([id], index) => ({
						id: `series-${index}`,
						label: labelOf(splitBy, id),
					}));
		if (splitBy !== "none" && ranked.length > MAX_NAMED_SERIES)
			series.push({ id: "other", label: "Other" });
		const seriesId = new Map(named.map(([id], i) => [id, `series-${i}`]));
		const trend = dates.map((date) => ({
			date,
			total: 0,
			values: Object.fromEntries(series.map((entry) => [entry.id, 0])),
		}));
		const byDate = new Map(trend.map((point) => [point.date, point]));
		for (const session of matching) {
			const point = byDate.get(sessionDate(session));
			if (!point) continue;
			for (const part of parts(session)) {
				const id =
					splitBy === "none" ? "total" : (seriesId.get(part.id) ?? "other");
				point.total += part.value;
				point.values[id] = (point.values[id] ?? 0) + part.value;
			}
		}
		const empty: CostBreakdownEntry[] = [];
		return {
			total: matching.reduce((sum, s) => sum + sessionValue(metric, s), 0),
			incomplete:
				metric === "cost" && matching.some((s) => s.estimated_cost == null),
			hasUsage: matching.length > 0,
			series,
			trend,
			breakdowns: {
				members: breakdown(metric, "members"),
				models: breakdown(metric, "models"),
				repositories: empty,
				signalTypes:
					metric === "signals" ? breakdown(metric, "signalTypes") : empty,
				phrases: metric === "signals" ? breakdown(metric, "phrases") : empty,
				runSignals: empty,
				durations: empty,
				skillsUsed: empty,
				pullRequestCi: empty,
				githubAuthors: empty,
				ciConclusions: empty,
				ciEvents: empty,
				ciWorkflows: empty,
				ciAttempts: empty,
			},
		};
	}

	return {
		requestedMetric: input.requestedMetric,
		splitBy: input.splitBy,
		availableMetrics: ["cost", "sessions", "signals"],
		metrics: {
			cost: metricData("cost", "Cost"),
			sessions: metricData("sessions", "Sessions"),
			signals: metricData("signals", "Signals"),
			commits: null,
			agentRuns: null,
			mergedPullRequests: null,
			ciFailuresPerPullRequest: null,
			ciRuns: null,
		},
	};
}
