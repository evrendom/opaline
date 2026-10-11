import type { SessionListFilters } from "@rudel/api-routes";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { mergeSessionUploadFailures } from "./session-upload-failure";

export function useSessionsPageData({
	trackPageView,
	paginated = true,
}: {
	paginated?: boolean;
	trackPageView: boolean;
}) {
	const demo = useDemoRuntime();
	const [filterState, setFilterState] = useState<{
		scope: string;
		filters: SessionListFilters;
	} | null>(null);
	const { state: organization } = useOrganization();
	const {
		meta,
		state: { endDate, startDate },
	} = useDateRange();
	const filterScope = JSON.stringify([
		organization.activeOrg?.id,
		startDate,
		endDate,
	]);
	const filters =
		filterState?.scope === filterScope ? filterState.filters : undefined;
	const setSessionFilters = useCallback(
		(filters: SessionListFilters) => {
			const active =
				Object.values(filters.excluded).some((values) => values.length > 0) ||
				Object.values(filters.ranges).some(
					(range) => range.minimum !== null || range.maximum !== null,
				);
			setFilterState(active ? { scope: filterScope, filters } : null);
		},
		[filterScope],
	);
	const catalogQuery = useAnalyticsQuery({
		...orpc.analytics.sessions.filterCatalog.queryOptions({
			input: { startDate, endDate, days: meta.dayCount },
		}),
		staleTime: SESSION_QUERY_STALE_TIME,
	});
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
		filters,
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
		initialDataUpdatedAt: previewSeed ? 0 : undefined,
		// Retain rows during date changes, but never carry them to another org.
		placeholderData: (previous, previousQuery) =>
			organization.activeOrg?.id &&
			previousQuery?.queryKey[1] === organization.activeOrg.id
				? previous
				: undefined,
		staleTime: SESSION_QUERY_STALE_TIME,
		refetchOnWindowFocus: true,
	});
	const failureOptions = orpc.analytics.sessions.uploadFailures.infiniteOptions(
		{
			input: (offset: number) => ({
				offset,
				limit: SESSION_PAGE_SIZE,
				startDate: input.startDate ?? startDate,
				endDate: input.endDate ?? endDate,
			}),
			initialPageParam: 0,
			getNextPageParam: (lastPage, _pages, offset) =>
				lastPage.hasMore ? offset + SESSION_PAGE_SIZE : undefined,
		},
	);
	const failurePages = useInfiniteQuery({
		...failureOptions,
		queryKey: ["org", organization.activeOrg?.id, ...failureOptions.queryKey],
		enabled: !!organization.activeOrg?.id && demo?.live !== false,
		refetchInterval: import.meta.env.MODE === "plugin" ? false : 10_000,
	});
	const previousFailures = useRef<
		{ scope: string; ids: Set<string> } | undefined
	>(undefined);
	useEffect(() => {
		if (!failurePages.data) return;
		const ids = new Set(
			failurePages.data.pages.flatMap((page) =>
				page.failures.map((failure) => failure.id),
			),
		);
		const previous = previousFailures.current;
		if (
			previous?.scope === filterScope &&
			[...previous.ids].some((id) => !ids.has(id))
		) {
			void sessionPages.refetch();
		}
		previousFailures.current = {
			scope: filterScope,
			ids,
		};
	}, [failurePages.data, filterScope, sessionPages.refetch]);
	const snapshotSessionsData = useMemo(() => {
		if (!sessionPages.data && !failurePages.data) return undefined;
		// Keep demo seed identities: their preview maxima describe the full cohort.
		if (previewSeed && sessionPages.data?.pages[0] === previewSeed.sessions)
			return previewSeed.sessions;
		const rows =
			sessionPages.data?.pages.flatMap(parseSessionOverviewRows) ?? [];
		// Concurrent uploads can move an offset boundary. Do not show a row twice.
		return mergeSessionUploadFailures(
			[
				...new Map(
					rows.map((row) => [`${row.source}:${row.session_id}`, row]),
				).values(),
			],
			failurePages.data?.pages.flatMap((page) => page.failures) ?? [],
		);
	}, [sessionPages.data, failurePages.data, previewSeed]);
	const isSnapshotSessionsPending =
		sessionPages.isPending ||
		(demo?.live !== false &&
			failurePages.isPending &&
			!snapshotSessionsData?.length);
	const isSnapshotSessionsError =
		sessionPages.isError &&
		!isSnapshotSessionsPending &&
		!snapshotSessionsData?.length;
	const pagination = {
		hasNextPage:
			demo?.live !== false &&
			(sessionPages.hasNextPage || failurePages.hasNextPage),
		isFetching: sessionPages.isFetching || failurePages.isFetching,
		isError:
			sessionPages.isFetchNextPageError || failurePages.isFetchNextPageError,
		loadMore: () => {
			if (sessionPages.isPlaceholderData) return;
			if (sessionPages.hasNextPage)
				void sessionPages.fetchNextPage({ cancelRefetch: false });
			if (failurePages.hasNextPage)
				void failurePages.fetchNextPage({ cancelRefetch: false });
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
				]
			: [],
	});

	const useRolling24Hours = activeDateRangeOptionId === "24-hours";
	const rangeSessionCount =
		catalogQuery.data?.sessionCount ??
		summaryComparison?.current.total_sessions ??
		previewSeed?.totalSessionCount ??
		sessionPages.data?.pages.flat().length ??
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
		uploadFailuresError: failurePages.isError,
		retryUploadFailures: () => {
			void failurePages.refetch();
		},
		organizationId: organization.activeOrg?.id,
		filterCatalog: catalogQuery.data,
		filterCatalogPending: !demo && catalogQuery.isPending,
		filterCatalogError: !demo && catalogQuery.isError && !catalogQuery.data,
		retryFilterCatalog: () => {
			void catalogQuery.refetch();
		},
		setSessionFilters,
		/** The list query's range and filters, for a session ID search. */
		listInput: input,
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
		totalSessionCount:
			rangeSessionCount + (failurePages.data?.pages[0]?.totalCount ?? 0),
		useRolling24Hours,
	};
}

export type SessionsPageData = ReturnType<typeof useSessionsPageData>;
