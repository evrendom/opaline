import type {
	AdminCostDashboardInput,
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	CostDimension,
	DashboardMetric,
	DashboardSignal,
} from "@rudel/api-routes";
import {
	AGENT_RUN_DURATIONS,
	AGENT_RUN_SIGNALS,
	CI_RUN_CONCLUSIONS,
	PULL_REQUEST_CI,
} from "@rudel/api-routes";
import { type Query, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { CHART_INTERVALS, type ChartInterval } from "./chart-interval";
import { DASHBOARD_METRICS, listDashboardTabs } from "./cost-format";

export const COST_DIMENSIONS: CostDimension[] = [
	"members",
	"repositories",
	"models",
];
// The all-users admin view is anonymous: no member or repository facets. The
// API rejects both too.
const ADMIN_COST_DIMENSIONS: CostDimension[] = ["models"];
export const RUN_DIMENSIONS: CostDimension[] = [
	"runSignals",
	"durations",
	"skillsUsed",
];
export const SIGNAL_DIMENSIONS: CostDimension[] = ["signalTypes", "phrases"];
export const PR_DIMENSIONS: CostDimension[] = [
	"repositories",
	"githubAuthors",
	"pullRequestCi",
];
export const CI_DIMENSIONS: CostDimension[] = [
	"ciConclusions",
	"ciEvents",
	"ciAttempts",
	"ciWorkflows",
	"repositories",
];
export const ALL_COST_DIMENSIONS = [
	...RUN_DIMENSIONS,
	...SIGNAL_DIMENSIONS,
	...COST_DIMENSIONS,
	...PR_DIMENSIONS,
	...CI_DIMENSIONS,
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
	pullRequestCi: "CI status",
	githubAuthors: "GitHub author",
	ciConclusions: "Conclusion",
	ciEvents: "Event",
	ciWorkflows: "Workflow",
	ciAttempts: "Attempt",
};

type RequestedMetric = NonNullable<CostDashboardInput["requestedMetric"]>;

export type CostDashboardController = ReturnType<typeof useCostDashboard>;

export function useCostDashboard() {
	const { state: workspace } = useOrganization();
	const state = useCostDashboardState(COST_DIMENSIONS);
	const { input, metric } = state;
	const query = useAnalyticsQuery({
		...orpc.analytics.overview.costs.queryOptions({ input }),
		staleTime: 60_000,
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[1] === workspace.activeOrg?.id &&
			previous?.requestedMetric === metric
				? previous
				: undefined,
		refetchOnWindowFocus: false,
		refetchInterval: (query) => indexingRefetchInterval(query, metric),
	});
	const metrics = useServerDashboardTabs(
		state,
		query.data,
		workspace.activeOrg?.id,
	);
	return { ...state, metrics, query };
}

export function useAdminCostDashboard(): CostDashboardController {
	const state = useCostDashboardState(ADMIN_COST_DIMENSIONS);
	const { input, metric } = state;
	const adminInput: AdminCostDashboardInput = {
		startDate: input.startDate,
		endDate: input.endDate,
		// The anonymous view has no repository scope, so the server never offers
		// pull request metrics there.
		requestedMetric:
			metric === "mergedPullRequests" || metric === "ciRuns" ? "cost" : metric,
		durationInterval: input.durationInterval,
		splitBy:
			input.splitBy === "models" ||
			input.splitBy === "signalTypes" ||
			input.splitBy === "phrases" ||
			input.splitBy === "runSignals" ||
			input.splitBy === "durations" ||
			input.splitBy === "skillsUsed"
				? input.splitBy
				: "none",
		models: input.models,
		signalTypes: input.signalTypes,
		phrases: input.phrases,
		runSignals: input.runSignals,
		durations: input.durations,
		skillsUsed: input.skillsUsed,
	};
	const query = useQuery({
		...orpc.admin.dashboard.queryOptions({ input: adminInput }),
		staleTime: 60_000,
		placeholderData: (previous) =>
			previous?.requestedMetric === metric ? previous : undefined,
		refetchOnWindowFocus: false,
		refetchInterval: (query) => indexingRefetchInterval(query, metric),
	});
	const metrics = useServerDashboardTabs(state, query.data, "admin");
	return { ...state, metrics, query };
}

/**
 * The server lists the metrics a scope offers. Keep the last answer while a
 * different metric loads so tabs do not flicker, and move a stale link to a
 * metric the server does not offer (such as a dark-launched one) back to cost.
 */
function useServerDashboardTabs(
	state: Pick<DashboardState, "metric" | "setMetric">,
	data: CostDashboard | undefined,
	scope: string | undefined,
) {
	const [known, setKnown] = useState<{
		scope: string | undefined;
		metrics: readonly CostDashboardRequestedMetric[];
	} | null>(null);
	const current = data?.availableMetrics;
	useEffect(() => {
		if (!current) return;
		setKnown((previous) =>
			previous !== null &&
			previous.scope === scope &&
			previous.metrics.length === current.length &&
			previous.metrics.every((metric, index) => metric === current[index])
				? previous
				: { scope, metrics: current },
		);
	}, [current, scope]);
	const { metric, setMetric } = state;
	const unavailable = current !== undefined && !current.includes(metric);
	useEffect(() => {
		if (unavailable) setMetric("cost", { replace: true });
	}, [setMetric, unavailable]);
	return listDashboardTabs(
		current ?? (known?.scope === scope ? known?.metrics : undefined),
	);
}

function indexingRefetchInterval(
	query: Query<CostDashboard, Error, CostDashboard, readonly unknown[]>,
	metric: DashboardMetric,
): number | false {
	if (query.state.fetchFailureCount > 0) return false;
	const data = query.state.data;
	const needsRefresh =
		metric === "agentRuns"
			? (data?.metrics.agentRuns?.coverage?.indexingSessions ?? 0) > 0
			: metric === "signals"
				? data?.metrics.signals === null
				: metric === "mergedPullRequests"
					? data?.availableMetrics.includes(metric) === true &&
						data.metrics[metric] === null
					: false;
	if (!needsRefresh) return false;
	// Indexing normally resolves quickly. Retry twice with backoff, then leave
	// refresh under the user's control instead of polling forever.
	return [10_000, 30_000][query.state.dataUpdateCount - 1] ?? false;
}

type DashboardState = ReturnType<typeof useCostDashboardState>;

function useCostDashboardState(costDimensions: CostDimension[]) {
	const { state: dates } = useDateRange();
	const [params, setParams] = useSearchParams();
	const selectedMetric = params.get("metric");
	// Request the linked metric directly; the server answers a metric its scope
	// does not offer as cost and useServerDashboardTabs then corrects the URL.
	const metric: RequestedMetric =
		selectedMetric === "ciFailuresPerPullRequest"
			? "mergedPullRequests"
			: (DASHBOARD_METRICS.find((value) => value === selectedMetric) ?? "cost");
	useEffect(() => {
		if (selectedMetric !== "ciFailuresPerPullRequest") return;
		setParams(
			(current) => {
				const next = new URLSearchParams(current);
				next.set("metric", "mergedPullRequests");
				return next;
			},
			{ replace: true },
		);
	}, [selectedMetric, setParams]);
	const interval =
		CHART_INTERVALS.find((option) => option.value === params.get("interval"))
			?.value ?? "daily";
	const dimensions =
		metric === "mergedPullRequests"
			? PR_DIMENSIONS
			: metric === "ciRuns"
				? CI_DIMENSIONS
				: metric === "agentRuns"
					? [...RUN_DIMENSIONS, ...costDimensions]
					: metric === "signals"
						? [...SIGNAL_DIMENSIONS, ...costDimensions]
						: costDimensions;
	const split = params.get("split");
	const splitBy = dimensions.find((dimension) => dimension === split) ?? "none";
	const input: CostDashboardInput = {
		startDate: dates.startDate,
		endDate: dates.endDate,
		requestedMetric: metric,
		durationInterval:
			metric === "agentRuns" ||
			metric === "ciRuns" ||
			metric === "mergedPullRequests"
				? interval
				: undefined,
		splitBy,
		members: costDimensions.includes("members")
			? params.getAll("member").slice(0, 100).sort()
			: [],
		repositories: costDimensions.includes("repositories")
			? params.getAll("repo").slice(0, 100).sort()
			: [],
		models: params.getAll("model").slice(0, 100).sort(),
		pullRequestCi: PULL_REQUEST_CI.filter(({ id }) =>
			params.getAll("prCi").includes(id),
		).map(({ id }) => id),
		githubAuthors: params.getAll("author").slice(0, 100).sort(),
		ciConclusions: CI_RUN_CONCLUSIONS.filter(({ id }) =>
			params.getAll("conclusion").includes(id),
		).map(({ id }) => id),
		ciEvents: params.getAll("event").slice(0, 100).sort(),
		ciWorkflows: params.getAll("workflow").slice(0, 100).sort(),
		ciAttempts: (["first", "rerun"] as const).filter((id) =>
			params.getAll("attempt").includes(id),
		),

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
	// Reads the current metric from the URL, not this render, so it stays
	// referentially stable for effects that correct the selected metric.
	const setMetric = useCallback(
		(value: DashboardMetric, options?: { replace?: boolean }) => {
			setParams((current) => {
				const next = new URLSearchParams(current);
				if (
					usesGitHubRepositories(current.get("metric")) !==
					usesGitHubRepositories(value)
				) {
					next.delete(parameterFor("repositories"));
					if (next.get("split") === "repositories") next.delete("split");
				}
				if (value === "cost") next.delete("metric");
				else next.set("metric", value);
				return next;
			}, options);
		},
		[setParams],
	);
	return {
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

// Pull request metrics filter by GitHub repository ID rather than the session
// repository URL, so repository filters do not carry across that boundary.
function usesGitHubRepositories(metric: string | null) {
	return (
		metric === "mergedPullRequests" ||
		metric === "ciFailuresPerPullRequest" ||
		metric === "ciRuns"
	);
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
		pullRequestCi: "prCi",
		githubAuthors: "author",
		ciConclusions: "conclusion",
		ciEvents: "event",
		ciWorkflows: "workflow",
		ciAttempts: "attempt",
	};
	return parameters[dimension];
}
