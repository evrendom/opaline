import type {
	CostDashboardInput,
	CostDimension,
	DashboardMetric,
	DashboardSignal,
} from "@rudel/api-routes";
import { AGENT_RUN_DURATIONS, AGENT_RUN_SIGNALS } from "@rudel/api-routes";
import { useSearchParams } from "react-router-dom";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { CHART_INTERVALS, type ChartInterval } from "./chart-interval";
import { DASHBOARD_METRICS } from "./cost-format";

export const COST_DIMENSIONS: CostDimension[] = [
	"members",
	"repositories",
	"models",
];
export const RUN_DIMENSIONS: CostDimension[] = [
	"runSignals",
	"durations",
	"skillsUsed",
];
export const SIGNAL_DIMENSIONS: CostDimension[] = ["signalTypes", "phrases"];
export const ALL_COST_DIMENSIONS = [
	...RUN_DIMENSIONS,
	...SIGNAL_DIMENSIONS,
	...COST_DIMENSIONS,
];
export const COST_LABELS = {
	members: "Members",
	repositories: "Repositories",
	models: "Models",
	signalTypes: "Signal types",
	phrases: "Verbatim",
	runSignals: "Follow-up signal",
	durations: "Run duration",
	skillsUsed: "Skills used",
};

export function useCostDashboard() {
	const { state: dates } = useDateRange();
	const { state: workspace } = useOrganization();
	const [params, setParams] = useSearchParams();
	const selectedMetric = params.get("metric");
	const metric =
		DASHBOARD_METRICS.find((value) => value === selectedMetric) ?? "cost";
	const interval =
		CHART_INTERVALS.find((option) => option.value === params.get("interval"))
			?.value ?? "daily";
	const dimensions =
		metric === "agentRuns"
			? [...RUN_DIMENSIONS, ...COST_DIMENSIONS]
			: metric === "signals"
				? [...SIGNAL_DIMENSIONS, ...COST_DIMENSIONS]
				: COST_DIMENSIONS;
	const split = params.get("split");
	const splitBy = dimensions.find((dimension) => dimension === split) ?? "none";
	const input: CostDashboardInput = {
		startDate: dates.startDate,
		endDate: dates.endDate,
		requestedMetric: metric,
		durationInterval: metric === "agentRuns" ? interval : undefined,
		splitBy,
		members: params.getAll("member").slice(0, 100).sort(),
		repositories: params.getAll("repo").slice(0, 100).sort(),
		models: params.getAll("model").slice(0, 100).sort(),

		signalTypes:
			metric === "signals"
				? params
						.getAll("signal")
						.filter(
							(value): value is DashboardSignal =>
								value === "modelApologies" ||
								value === "userPositive" ||
								value === "userNegative",
						)
						.slice(0, 3)
						.sort()
				: [],
		phrases:
			metric === "signals" ? params.getAll("phrase").slice(0, 100).sort() : [],
		runSignals:
			metric === "agentRuns"
				? AGENT_RUN_SIGNALS.filter(({ id }) =>
						params.getAll("feedback").includes(id),
					).map(({ id }) => id)
				: [],
		durations:
			metric === "agentRuns"
				? AGENT_RUN_DURATIONS.filter(({ id }) =>
						params.getAll("duration").includes(id),
					).map(({ id }) => id)
				: [],
		skillsUsed:
			metric === "agentRuns"
				? (["yes", "no"] as const).filter((id) =>
						params.getAll("skills").includes(id),
					)
				: [],
	};
	const query = useAnalyticsQuery({
		...orpc.analytics.overview.costs.queryOptions({ input }),
		staleTime: 60_000,
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[1] === workspace.activeOrg?.id &&
			previous?.requestedMetric === metric
				? previous
				: undefined,
		refetchOnWindowFocus: false,
		refetchInterval: (query) => {
			if (query.state.fetchFailureCount > 0) return false;
			const data = query.state.data;
			const needsRefresh =
				metric === "agentRuns"
					? (data?.metrics.agentRuns?.coverage?.indexingSessions ?? 0) > 0
					: metric === "signals" && data?.metrics.signals === null;
			if (!needsRefresh) return false;
			// Indexing normally resolves quickly. Retry twice with backoff, then leave
			// refresh under the user's control instead of polling forever.
			return [10_000, 30_000][query.state.dataUpdateCount - 1] ?? false;
		},
	});
	function update(action: (next: URLSearchParams) => void) {
		setParams((current) => {
			const next = new URLSearchParams(current);
			action(next);
			return next;
		});
	}
	function toggle(dimension: CostDimension, id: string) {
		const key = parameterFor(dimension);
		update((next) => {
			const values = next.getAll(key);
			next.delete(key);
			for (const value of values.includes(id)
				? values.filter((value) => value !== id)
				: [...values, id].slice(0, 100))
				next.append(key, value);
		});
	}
	function clear(dimension?: CostDimension) {
		update((next) => {
			for (const dim of dimension ? [dimension] : ALL_COST_DIMENSIONS)
				next.delete(parameterFor(dim));
		});
	}
	function setSplit(value: CostDashboardInput["splitBy"]) {
		update((next) => {
			if (value === "none") next.delete("split");
			else next.set("split", value);
		});
	}
	function setInterval(value: ChartInterval) {
		update((next) => {
			if (value === "daily") next.delete("interval");
			else next.set("interval", value);
		});
	}
	function setMetric(value: DashboardMetric) {
		update((next) => {
			if (value === "cost") next.delete("metric");
			else next.set("metric", value);
		});
	}
	return {
		query,
		input,
		metric,
		interval,
		setInterval,
		dimensions,
		toggle,
		clear,
		setSplit,
		setMetric,
	};
}

function parameterFor(dimension: CostDimension) {
	const parameters = {
		members: "member",
		repositories: "repo",
		models: "model",
		signalTypes: "signal",
		phrases: "phrase",
		runSignals: "feedback",
		durations: "duration",
		skillsUsed: "skills",
	};
	return parameters[dimension];
}
