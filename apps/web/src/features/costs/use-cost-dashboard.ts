import type {
	AdminCostDashboardInput,
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	CostDimension,
	DashboardMetric,
	DashboardSignal,
	SessionAnalytics,
} from "@rudel/api-routes";
import {
	AGENT_RUN_DURATIONS,
	AGENT_RUN_SIGNALS,
	CI_RUN_CONCLUSIONS,
	CostDashboardRequestedMetricSchema,
	PULL_REQUEST_CI,
} from "@rudel/api-routes";
import {
	keepPreviousData,
	type Query,
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { DASHBOARD_METRICS, listDashboardTabs } from "./cost-format";
import { readChartInterval, useChartInterval } from "./use-chart-interval";

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
	const queryClient = useQueryClient();
	const state = useCostDashboardState(COST_DIMENSIONS);
	const { input, metric } = state;
	const query = useAnalyticsQuery({
		...orpc.analytics.overview.costs.queryOptions({ input }),
		staleTime: 60_000,
		placeholderData: dashboardPlaceholder(
			queryClient,
			costsQueryScope(workspace.activeOrg?.id),
			input,
		),
		refetchOnWindowFocus: false,
		refetchInterval: (query) => indexingRefetchInterval(query, metric),
	});
	const tabs = useServerDashboardTabs(
		state,
		query.data,
		workspace.activeOrg?.id,
	);
	return { ...state, ...tabs, query };
}

export function useAdminCostDashboard(): CostDashboardController {
	const queryClient = useQueryClient();
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
		placeholderData: dashboardPlaceholder(
			queryClient,
			orpc.admin.dashboard.key(),
			adminInput,
		),
		refetchOnWindowFocus: false,
		refetchInterval: (query) => indexingRefetchInterval(query, metric),
	});
	const tabs = useServerDashboardTabs(state, query.data, "admin");
	return { ...state, ...tabs, query };
}

// A repository's own dashboard has no repository facet: the repository is
// the scope.
const REPOSITORY_COST_DIMENSIONS: CostDimension[] = ["members", "models"];

/**
 * The workspace dashboard scoped to one repository. Session metrics filter by
 * the dashboard's repository ids for it; pull request and CI metrics by its
 * GitHub repository ids, and stay off when it has none. Either list is
 * undefined while it resolves.
 */
export function useRepositoryCostDashboard(
	repositories: readonly string[] | undefined,
	githubRepositories: readonly string[] | undefined,
): CostDashboardController {
	const { state: workspace } = useOrganization();
	const [, setParams] = useSearchParams();
	const state = useCostDashboardState(REPOSITORY_COST_DIMENSIONS);
	const hasGitHub = (githubRepositories?.length ?? 0) > 0;
	const scoped = (input: CostDashboardInput): CostDashboardInput => {
		const github = usesGitHubRepositories(input.requestedMetric ?? null);
		const ids = github && hasGitHub ? githubRepositories : repositories;
		return {
			...input,
			requestedMetric: github && !hasGitHub ? "cost" : input.requestedMetric,
			repositories: [...(ids ?? [])].slice(0, 100).sort(),
			splitBy: input.splitBy === "repositories" ? "none" : input.splitBy,
		};
	};
	const input = scoped(state.input);
	const offGitHub = usesGitHubRepositories(state.metric) && !hasGitHub;
	const metric: DashboardMetric = offGitHub ? "cost" : state.metric;
	// Only ever touches `metric`: the page's own `repo` parameter names the
	// repository, so the shared setter's repository reset must not run.
	const setMetric = useCallback(
		(value: DashboardMetric, options?: { replace?: boolean }) => {
			setParams((current) => {
				const next = new URLSearchParams(current);
				if (value === "cost") next.delete("metric");
				else next.set("metric", value);
				return next;
			}, options);
		},
		[setParams],
	);
	const query = useAnalyticsQuery({
		...orpc.analytics.overview.costs.queryOptions({ input }),
		staleTime: 60_000,
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
		refetchInterval: (query) => indexingRefetchInterval(query, metric),
		enabled: input.repositories.length > 0,
	});
	const tabs = useServerDashboardTabs(
		{ metric, setMetric },
		query.data,
		`${workspace.activeOrg?.id}:repository`,
	);
	return {
		...state,
		...tabs,
		metrics: DASHBOARD_METRICS.filter(
			(value) =>
				(tabs.metrics.includes(value) ||
					(tabs.metricsPending &&
						hasGitHub &&
						usesGitHubRepositories(value))) &&
				(githubRepositories === undefined ||
					hasGitHub ||
					!usesGitHubRepositories(value)),
		),
		dimensions: (offGitHub
			? REPOSITORY_COST_DIMENSIONS
			: state.dimensions
		).filter((dimension) => dimension !== "repositories"),
		input,
		inputFor: (value: RequestedMetric) => scoped(state.inputFor(value)),
		metric,
		setMetric,
		query,
	};
}

// A dashboard computed from session rows offers the session metrics.
const SESSION_ROW_METRICS = ["cost", "sessions", "signals"] as const;
const SESSION_ROW_COST_DIMENSIONS: CostDimension[] = ["members", "models"];

/**
 * The workspace dashboard over a set of session rows the API can't scope its
 * dashboard to (one skill in one repo, say): the same URL state and view,
 * with the response computed in the browser by `build` from the rows
 * `fetchRows` returns for the date range.
 */
export function useSessionRowsCostDashboard({
	key,
	fetchRows,
	build,
}: {
	/** Identifies the rows apart from the date range; the query key is this
	 * plus the range's start and end dates. */
	key: readonly unknown[];
	fetchRows: (
		range: { startDate: string; endDate: string },
		signal: AbortSignal,
	) => Promise<SessionAnalytics[]>;
	build: (
		rows: readonly SessionAnalytics[],
		input: CostDashboardInput,
	) => CostDashboard;
}): CostDashboardController {
	const [, setParams] = useSearchParams();
	const state = useCostDashboardState(SESSION_ROW_COST_DIMENSIONS);
	const offered = SESSION_ROW_METRICS.some((value) => value === state.metric);
	const metric: DashboardMetric = offered ? state.metric : "cost";
	const input: CostDashboardInput = offered
		? state.input
		: state.inputFor("cost");
	// Only ever touches `metric`: the page's own parameters must survive.
	const setMetric = useCallback(
		(value: DashboardMetric, options?: { replace?: boolean }) => {
			setParams((current) => {
				const next = new URLSearchParams(current);
				if (value === "cost") next.delete("metric");
				else next.set("metric", value);
				return next;
			}, options);
		},
		[setParams],
	);
	const inputKey = JSON.stringify(input);
	// biome-ignore lint/correctness/useExhaustiveDependencies: input is keyed by its JSON
	const select = useCallback(
		(rows: SessionAnalytics[]) => build(rows, input),
		[build, inputKey],
	);
	const { startDate, endDate } = input;
	const query = useAnalyticsQuery({
		queryKey: [...key, startDate, endDate],
		queryFn: ({ signal }) => fetchRows({ startDate, endDate }, signal),
		select,
		placeholderData: keepPreviousData,
		staleTime: 60_000,
	});
	return {
		...state,
		metrics: listDashboardTabs(SESSION_ROW_METRICS),
		metricsPending: false,
		dimensions: offered ? state.dimensions : SESSION_ROW_COST_DIMENSIONS,
		input,
		inputFor: state.inputFor,
		metric,
		setMetric,
		query,
	};
}

/** Every cached dashboard answer for one workspace, whatever its request. */
export function costsQueryScope(orgId: string | undefined) {
	return ["org", orgId, ...orpc.analytics.overview.costs.key()];
}

/**
 * What stands in while a dashboard request loads: the latest cached answer
 * for the same metric, date range and interval. A filter or split change then
 * updates the chart and the stat cards in place, while a new date range has
 * no stand-in, so the chart and every card play their loading animation
 * together. Read from the cache rather than the observer's previous query:
 * the stat cards' observers are replaced whenever their request changes.
 */
export function dashboardPlaceholder(
	queryClient: QueryClient,
	scope: readonly unknown[],
	input: Pick<
		CostDashboardInput,
		"startDate" | "endDate" | "requestedMetric" | "durationInterval"
	>,
) {
	return () => {
		let latest: { data: CostDashboard; updatedAt: number } | undefined;
		for (const query of queryClient
			.getQueryCache()
			.findAll({ queryKey: scope })) {
			const data = query.state.data as CostDashboard | undefined;
			const cached = (
				query.queryKey.at(-1) as { input?: typeof input } | undefined
			)?.input;
			if (
				!data ||
				!cached ||
				// The server answers a metric the scope does not offer as cost.
				data.requestedMetric !== input.requestedMetric ||
				cached.requestedMetric !== input.requestedMetric ||
				cached.startDate !== input.startDate ||
				cached.endDate !== input.endDate ||
				cached.durationInterval !== input.durationInterval
			)
				continue;
			if (!latest || query.state.dataUpdatedAt > latest.updatedAt)
				latest = { data, updatedAt: query.state.dataUpdatedAt };
		}
		return latest?.data;
	};
}

/**
 * The server lists the metrics a scope offers. Keep the last answer while a
 * different metric loads so tabs do not flicker, and move a stale link to a
 * metric the server does not offer (such as a dark-launched one) back to cost.
 * Before this page load's first answer, the scope's answer from the previous
 * visit stands in, so the stat cards (GitHub ones included) show straight
 * away. With neither, `metricsPending` is true and `metrics` lists the
 * always-offered ones: their cards load straight away, and any optional ones
 * join at the end when the server answers.
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
	const stored = useStoredDashboardTabs(scope);
	useEffect(() => {
		if (!current) return;
		writeStoredDashboardTabs(scope, current);
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
	const available =
		current ?? (known?.scope === scope ? known?.metrics : stored);
	return {
		metrics: listDashboardTabs(available),
		metricsPending: available === undefined,
	};
}

const DASHBOARD_TABS_STORAGE_KEY = "opaline:dashboard-metrics:";
const StoredDashboardTabsSchema = z.array(CostDashboardRequestedMetricSchema);

/**
 * The metrics the server offered this scope last time. Read through an
 * external store so the server-rendered demo hydrates with nothing stored
 * and picks the stored list up right after, instead of mismatching.
 */
function useStoredDashboardTabs(scope: string | undefined) {
	const raw = useSyncExternalStore(
		subscribeToStorage,
		() => readStoredDashboardTabs(scope),
		() => null,
	);
	return useMemo(() => {
		if (raw === null) return undefined;
		try {
			const parsed = StoredDashboardTabsSchema.safeParse(JSON.parse(raw));
			return parsed.success ? parsed.data : undefined;
		} catch {
			return undefined;
		}
	}, [raw]);
}

function subscribeToStorage(onChange: () => void) {
	window.addEventListener("storage", onChange);
	return () => window.removeEventListener("storage", onChange);
}

function readStoredDashboardTabs(scope: string | undefined) {
	if (!scope) return null;
	try {
		return window.localStorage.getItem(DASHBOARD_TABS_STORAGE_KEY + scope);
	} catch {
		return null; // Blocked storage: wait for the server instead.
	}
}

function writeStoredDashboardTabs(
	scope: string | undefined,
	metrics: readonly CostDashboardRequestedMetric[],
) {
	if (!scope) return;
	try {
		window.localStorage.setItem(
			DASHBOARD_TABS_STORAGE_KEY + scope,
			JSON.stringify(metrics),
		);
	} catch {
		// Blocked storage: the next visit waits for the server.
	}
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
	const { input, dimensions, interval } = buildDashboardInput(
		params,
		dates,
		metric,
		costDimensions,
	);
	// The request the dashboard would send if `value` were the charted metric.
	// Stat card previews use it so switching cards is a cache hit.
	const inputFor = (value: RequestedMetric) =>
		buildDashboardInput(params, dates, value, costDimensions).input;
	const [, setInterval] = useChartInterval();
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
		inputFor,
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

/**
 * The dashboard request for one metric, from the URL state and date range.
 * Shared by the charted query and the stat card previews.
 */
function buildDashboardInput(
	params: URLSearchParams,
	dates: { startDate: string; endDate: string },
	metric: RequestedMetric,
	costDimensions: CostDimension[],
) {
	const interval = readChartInterval(params);
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
		// Sent with every metric: the server applies each to its own metric
		// only, and the session stat cards read their totals from one answer.
		signalTypes: params
			.getAll("signal")
			.filter(
				(value): value is DashboardSignal =>
					value === "modelApologies" || value === "userNegative",
			)
			.slice(0, 2)
			.sort(),
		phrases: params.getAll("phrase").slice(0, 100).sort(),
		runSignals: AGENT_RUN_SIGNALS.filter(({ id }) =>
			params.getAll("feedback").includes(id),
		).map(({ id }) => id),
		durations: AGENT_RUN_DURATIONS.filter(({ id }) =>
			params.getAll("duration").includes(id),
		).map(({ id }) => id),
		skillsUsed: (["yes", "no"] as const).filter((id) =>
			params.getAll("skills").includes(id),
		),
	};
	return { input, dimensions, interval };
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
