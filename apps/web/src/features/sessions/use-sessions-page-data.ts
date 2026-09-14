import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import {
	type PageViewSection,
	useTrackProductPageView,
} from "@/features/analytics/tracking/useTrackProductPageView";
import { buildDashboardSessionTabMetrics } from "@/features/dashboard/data/dashboard-tab-adapters";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { resolveActiveSessionDateRangeOptionId } from "@/features/sessions/session-date-ranges";
import { orderSessionsForDisplay } from "@/features/sessions/session-ordering";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import {
	buildSessionsListQueryInput,
	SESSION_PAGE_SIZE,
	SESSION_QUERY_STALE_TIME,
} from "@/features/sessions/sessions-list-query";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

export function useSessionsPageData({
	trackPageView,
	paginated = true,
}: {
	paginated?: boolean;
	trackPageView: boolean;
}) {
	const demo = useDemoRuntime();
	const { state: organization } = useOrganization();
	const {
		meta,
		state: { endDate, startDate },
	} = useDateRange();
	const previewSeed =
		startDate === "2026-08-01" && endDate === "2026-08-31"
			? demo?.seed
			: undefined;
	const activeDateRangeOptionId = resolveActiveSessionDateRangeOptionId({
		endDate,
		startDate,
	});
	const { data: overviewKpis } = useAnalyticsQuery({
		...orpc.analytics.overview.kpis.queryOptions({
			input: { endDate, startDate },
		}),
		refetchOnMount: true,
		refetchOnReconnect: true,
		refetchOnWindowFocus: true,
		staleTime: SESSION_QUERY_STALE_TIME,
	});

	const {
		data: summaryComparison,
		isPending: isSummaryPending,
		isError: isSummaryError,
	} = useAnalyticsQuery({
		...orpc.analytics.sessions.summaryComparison.queryOptions({
			input: { days: meta.dayCount },
		}),
		refetchOnMount: true,
		refetchOnReconnect: true,
		refetchOnWindowFocus: true,
		staleTime: SESSION_QUERY_STALE_TIME,
	});

	const input = {
		...buildSessionsListQueryInput({
			dayCount: meta.dayCount,
			endDate,
			startDate,
		}),
		limit: paginated ? SESSION_PAGE_SIZE : 1000,
	};
	const options = orpc.analytics.sessions.list.infiniteOptions({
		input: (offset: number) => ({ ...input, offset }),
		initialPageParam: 0,
		getNextPageParam: (lastPage, _pages, offset) =>
			paginated && lastPage.length === SESSION_PAGE_SIZE
				? offset + lastPage.length
				: undefined,
	});
	const sessionPages = useInfiniteQuery({
		...options,
		queryKey: ["org", organization.activeOrg?.id, ...options.queryKey],
		enabled: !!organization.activeOrg?.id && demo?.live !== false,
		initialData: previewSeed
			? { pages: [previewSeed.sessions], pageParams: [0] }
			: undefined,
		// Retain rows during date changes, but never carry them to another org.
		placeholderData: (previous, previousQuery) =>
			organization.activeOrg?.id &&
			previousQuery?.queryKey[1] === organization.activeOrg.id
				? previous
				: undefined,
		staleTime: SESSION_QUERY_STALE_TIME,
		refetchOnWindowFocus: true,
	});
	const snapshotSessionsData = useMemo(() => {
		if (!sessionPages.data) return undefined;
		// Keep demo seed identities: their preview maxima describe the full cohort.
		if (previewSeed && sessionPages.data.pages[0] === previewSeed.sessions)
			return previewSeed.sessions;
		const rows = sessionPages.data.pages.flatMap(parseSessionOverviewRows);
		// Concurrent uploads can move an offset boundary. Do not show a row twice.
		return [
			...new Map(
				rows.map((row) => [`${row.source}:${row.session_id}`, row]),
			).values(),
		];
	}, [sessionPages.data, previewSeed]);
	const isSnapshotSessionsPending = sessionPages.isPending;
	const isSnapshotSessionsError = sessionPages.isError && !sessionPages.data;
	const pagination = {
		hasNextPage: demo?.live !== false && sessionPages.hasNextPage,
		isFetching: sessionPages.isFetching,
		isError: sessionPages.isFetchNextPageError,
		loadMore: () => {
			void sessionPages.fetchNextPage({ cancelRefetch: false });
		},
	};

	const headlineMetrics = useMemo(
		() => buildDashboardSessionTabMetrics(summaryComparison),
		[summaryComparison],
	);
	const sessionsSections = useMemo<PageViewSection[]>(
		() => [
			{
				id: "summary_cards",
				state:
					isSummaryError || isSnapshotSessionsError
						? "error"
						: headlineMetrics.length > 0 &&
								(snapshotSessionsData?.length ?? 0) > 0
							? "populated"
							: "empty",
				itemCount: headlineMetrics.length,
			},
		],
		[
			headlineMetrics.length,
			isSnapshotSessionsError,
			isSummaryError,
			snapshotSessionsData,
		],
	);

	useTrackProductPageView({
		isLoading: !trackPageView || isSummaryPending || isSnapshotSessionsPending,
		isError: trackPageView && (isSummaryError || isSnapshotSessionsError),
		hasData: trackPageView && (snapshotSessionsData?.length ?? 0) > 0,
		sections: trackPageView ? sessionsSections : [],
		metrics: trackPageView
			? [
					{
						id: "total_sessions",
						value: summaryComparison?.current.total_sessions,
					},
					{
						id: "avg_session_duration_min",
						value: summaryComparison?.current.avg_session_duration_min,
					},
					{
						id: "avg_response_time_sec",
						value: summaryComparison?.current.avg_response_time_sec,
					},
				]
			: [],
	});

	const useRolling24Hours = activeDateRangeOptionId === "24-hours";
	const rangeSessionCount =
		summaryComparison?.current.total_sessions ??
		previewSeed?.totalSessionCount ??
		snapshotSessionsData?.length ??
		0;
	const orderedSessions = useMemo(
		() =>
			orderSessionsForDisplay({
				sessions: snapshotSessionsData,
				useRolling24Hours,
			}),
		[snapshotSessionsData, useRolling24Hours],
	);

	return {
		organizationId: organization.activeOrg?.id,
		pagination,
		dateRangeDays: meta.dayCount,
		endDate,
		headlineMetrics,
		organizationSessionCount: overviewKpis?.total_sessions ?? rangeSessionCount,
		isSnapshotSessionsError,
		isSnapshotSessionsPending,
		isSummaryError,
		isSummaryPending,
		orderedSessions,
		snapshotSessionsData,
		startDate,
		totalSessionCount: rangeSessionCount,
		useRolling24Hours,
	};
}

export type SessionsPageData = ReturnType<typeof useSessionsPageData>;
