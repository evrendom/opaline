import type {
	CostDashboard,
	CostDashboardInput,
	CostDashboardRequestedMetric,
	DashboardMetric,
	DashboardMetricData,
} from "@rudel/api-routes";
import {
	type QueryClient,
	useQueries,
	useQueryClient,
} from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { costsQueryScope, dashboardPlaceholder } from "./use-cost-dashboard";

/**
 * Each stat card's own answer: its total, availability and daily trend (the
 * chart groups it by the picked interval). Undefined while it loads.
 */
export type MetricPreviews = Partial<Record<DashboardMetric, CostDashboard>> & {
	/** Language signals split by type, for the per-run language rates. */
	languageSplit?: DashboardMetricData | null;
	pending?: boolean;
};

/**
 * The answers behind the stat cards. Every dashboard answer carries the
 * session metrics' totals and daily trends, so the cost, sessions, signals
 * and agent runs cards read the chart's own answer (its cache entry, not
 * another request). The pull request and CI cards each ask for their metric
 * without the session metrics, which skips the expensive session query.
 */
export function useMetricPreviews(
	inputFor: (metric: CostDashboardRequestedMetric) => CostDashboardInput,
	metrics: readonly DashboardMetric[],
	/** The charted request, exactly as the chart sends it. */
	chartInput: CostDashboardInput,
	enabled = true,
): MetricPreviews {
	const { state } = useOrganization();
	const queryClient = useQueryClient();
	const demo = useDemoRuntime();
	const scope = costsQueryScope(state.activeOrg?.id);
	const githubCards = metrics.filter(
		(metric): metric is "mergedPullRequests" | "ciRuns" =>
			metric === "mergedPullRequests" || metric === "ciRuns",
	);
	const language = metrics.includes("signals");
	const charted = queryClient.getQueryData<CostDashboard>([
		"org",
		state.activeOrg?.id,
		...orpc.analytics.overview.costs.queryOptions({ input: chartInput })
			.queryKey,
	]);
	const separateLanguage =
		language && charted !== undefined && charted.languageSplit === undefined;
	const requests = [
		{ input: chartInput, placeholder: sessionCardsPlaceholder },
		...githubCards.map((metric) => ({
			input: { ...inputFor(metric), sessionMetrics: false },
			placeholder: dashboardPlaceholder,
		})),
		...(separateLanguage
			? [
					{
						input: { ...inputFor("signals"), splitBy: "signalTypes" as const },
						placeholder: dashboardPlaceholder,
					},
				]
			: []),
	];
	const answers = useQueries({
		queries: requests.map(({ input, placeholder }) => {
			const options = orpc.analytics.overview.costs.queryOptions({ input });
			return {
				...options,
				queryKey: ["org", state.activeOrg?.id, ...options.queryKey],
				enabled: enabled && !!state.activeOrg?.id && demo?.live !== false,
				placeholderData: placeholder(queryClient, scope, input),
				staleTime: 60_000,
				refetchOnWindowFocus: false,
			};
		}),
	});
	const [chart, ...rest] = answers;
	const github = rest.slice(0, githubCards.length);
	return {
		...Object.fromEntries(
			metrics.map((metric) => {
				const index = githubCards.indexOf(
					metric as (typeof githubCards)[number],
				);
				return [metric, index === -1 ? chart?.data : github[index]?.data];
			}),
		),
		languageSplit: !language
			? undefined
			: separateLanguage
				? rest[githubCards.length]?.data?.metrics.signals
				: chart?.data?.languageSplit,
		pending: answers.some((answer) => answer.isPending),
	};
}

/**
 * Loads the chart a stat card would show, when a pointer or focus lands on it,
 * so a click usually renders from cache.
 */
export function usePrefetchDashboardMetric(
	inputFor: (metric: CostDashboardRequestedMetric) => CostDashboardInput,
	enabled = true,
) {
	const { state } = useOrganization();
	const queryClient = useQueryClient();
	const demo = useDemoRuntime();
	const orgId = state.activeOrg?.id;
	return (metric: DashboardMetric) => {
		if (
			!enabled ||
			!orgId ||
			demo?.live === false ||
			metric === "commits" ||
			metric === "ciFailuresPerPullRequest"
		)
			return;
		const options = orpc.analytics.overview.costs.queryOptions({
			input: inputFor(metric),
		});
		void queryClient.prefetchQuery({
			...options,
			queryKey: ["org", orgId, ...options.queryKey],
			staleTime: 60_000,
		});
	};
}

const SESSION_FILTERS = [
	"members",
	"repositories",
	"models",
	"signalTypes",
	"phrases",
	"runSignals",
	"durations",
	"skillsUsed",
] as const;

/**
 * What stands in while the session cards' answer loads; only an answer that
 * carries the session metrics qualifies. Charting another metric changes the
 * request but not the session cards' numbers, so a cached answer for the
 * same date range and filters stands in and the cards stay put. Otherwise the
 * usual rule applies: after a filter change the previous answer for the same
 * metric stands in, and a new date range loads.
 */
export function sessionCardsPlaceholder(
	queryClient: QueryClient,
	scope: readonly unknown[],
	input: CostDashboardInput,
) {
	return () => {
		let sameFilters: Cached | undefined;
		let sameMetric: Cached | undefined;
		for (const query of queryClient
			.getQueryCache()
			.findAll({ queryKey: scope })) {
			const data = query.state.data as CostDashboard | undefined;
			const cached = (
				query.queryKey.at(-1) as { input?: CostDashboardInput } | undefined
			)?.input;
			if (
				!data ||
				!cached ||
				!data.metrics.cost ||
				cached.startDate !== input.startDate ||
				cached.endDate !== input.endDate
			)
				continue;
			const candidate = { data, updatedAt: query.state.dataUpdatedAt };
			if (
				SESSION_FILTERS.every(
					(filter) =>
						JSON.stringify(cached[filter] ?? []) ===
						JSON.stringify(input[filter]),
				)
			)
				sameFilters = newer(sameFilters, candidate);
			if (
				cached.requestedMetric === input.requestedMetric &&
				cached.durationInterval === input.durationInterval
			)
				sameMetric = newer(sameMetric, candidate);
		}
		return (sameFilters ?? sameMetric)?.data;
	};
}

type Cached = { data: CostDashboard; updatedAt: number };

function newer(current: Cached | undefined, candidate: Cached) {
	return !current || candidate.updatedAt > current.updatedAt
		? candidate
		: current;
}
