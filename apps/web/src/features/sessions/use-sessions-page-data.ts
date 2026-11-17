import type { SessionListFilters } from "@rudel/api-routes";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import {
	type PageViewSection,
	useTrackProductPageView,
} from "@/features/analytics/tracking/useTrackProductPageView";
import {
	sessionUsageShares,
	usePlanUsage,
} from "@/features/costs/plan-usage/use-plan-usage";
import { buildDashboardSessionTabMetrics } from "@/features/dashboard/data/dashboard-tab-adapters";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { mergeLiveSessionRows } from "@/features/sessions/live-session-rows";
import { resolveActiveSessionDateRangeOptionId } from "@/features/sessions/session-date-ranges";
import { orderSessionsForDisplay } from "@/features/sessions/session-ordering";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import {
	buildSessionsListQueryInput,
	SESSION_PAGE_SIZE,
	SESSION_QUERY_STALE_TIME,
} from "@/features/sessions/sessions-list-query";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { getInclusiveDateRangeDays } from "@/lib/analytics-date-range";
import { orpc } from "@/lib/orpc";
import {
	pollUnlessPushed,
	useSessionArrivalsLive,
} from "./session-arrivals-live";
import {
	type DayRange,
	isOnUtcDays,
	SLICE_MAX_DAYS,
	SLICE_ROW_LIMIT,
	sessionsOnUtcDays,
	useSettledFocus,
} from "./session-day-slice";
import { sessionRowKey, transcriptSubagentId } from "./session-row-key";
import { mergeSessionUploadFailures } from "./session-upload-failure";
import { useLiveSessionList } from "./use-live-sessions";
import { useSessionCostMaximum } from "./use-session-cost-maximum";

const FAILURES_PUSHED_POLL_MS = 5 * 60_000;

export function useSessionsPageData({
	detail = false,
	detailReady = false,
	focus = null,
	trackPageView,
	paginated = true,
}: {
	detail?: boolean;
	detailReady?: boolean;
	/** Days to list within the range: the desktop app slices them from the
	 * whole range it already holds; otherwise they are asked for. */
	focus?: DayRange | null;
	paginated?: boolean;
	trackPageView: boolean;
}) {
	const demo = useDemoRuntime();
	const queryClient = useQueryClient();
	const pushed = useSessionArrivalsLive();
	const listed = !detail;
	const [idleAfterDetail, setIdleAfterDetail] = useState(false);
	useEffect(() => {
		if (!detail || !detailReady || idleAfterDetail) return;
		const done = () => setIdleAfterDetail(true);
		if (typeof requestIdleCallback !== "function") {
			const timer = window.setTimeout(done, 200);
			return () => window.clearTimeout(timer);
		}
		const handle = requestIdleCallback(done, { timeout: 2_000 });
		return () => cancelIdleCallback(handle);
	}, [detail, detailReady, idleAfterDetail]);
	const [filterState, setFilterState] = useState<{
		scope: string;
		filters: SessionListFilters;
	} | null>(null);
	const { state: organization } = useOrganization();
	const dateRange = useDateRange();
	const desktop = useLocalDesktopApp();
	const fullScope = JSON.stringify([
		organization.activeOrg?.id,
		dateRange.state.startDate,
		dateRange.state.endDate,
	]);
	const [overflowScope, setOverflowScope] = useState<string | null>(null);
	const slicing =
		desktop &&
		listed &&
		dateRange.meta.dayCount <= SLICE_MAX_DAYS &&
		overflowScope !== fullScope;
	const range = useSettledFocus(slicing ? null : focus, !slicing);
	const sliced = slicing ? focus : null;
	const pagedList = paginated && !slicing;
	const startDate = range?.start ?? dateRange.state.startDate;
	const endDate = range?.end ?? dateRange.state.endDate;
	const meta = range
		? {
				...dateRange.meta,
				dayCount: getInclusiveDateRangeDays(range.start, range.end),
			}
		: dateRange.meta;
	const [coldDetail] = useState(
		() =>
			detail &&
			!queryClient
				.getQueriesData({
					queryKey: [
						"org",
						organization.activeOrg?.id,
						...orpc.analytics.sessions.list.key(),
					],
				})
				.some(([, data]) => data !== undefined),
	);
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
	const costMaximum = useSessionCostMaximum();
	const catalogQuery = useAnalyticsQuery({
		...orpc.analytics.sessions.filterCatalog.queryOptions({
			input: { startDate, endDate, days: meta.dayCount },
		}),
		enabled: listed,
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
		enabled: listed,
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
		enabled: listed,
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
		limit: pagedList ? SESSION_PAGE_SIZE : SLICE_ROW_LIMIT,
	};
	const options = orpc.analytics.sessions.list.infiniteOptions({
		input: (offset: number) => ({ ...input, offset }),
		initialPageParam: 0,
		getNextPageParam: (lastPage, _pages, offset) =>
			pagedList && lastPage.length === SESSION_PAGE_SIZE
				? offset + lastPage.length
				: undefined,
	});
	const sessionPages = useInfiniteQuery({
		...options,
		queryKey: ["org", organization.activeOrg?.id, ...options.queryKey],
		enabled:
			!!organization.activeOrg?.id &&
			demo?.live !== false &&
			(listed || !coldDetail || idleAfterDetail),
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
		refetchOnMount: listed,
		refetchOnWindowFocus: listed,
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
		enabled:
			(listed || !coldDetail || idleAfterDetail) &&
			!!organization.activeOrg?.id &&
			demo?.live !== false,
		refetchInterval:
			import.meta.env.MODE === "plugin" || !listed
				? false
				: pollUnlessPushed(pushed, 10_000, FAILURES_PUSHED_POLL_MS),
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
			[...new Map(rows.map((row) => [sessionRowKey(row), row])).values()],
			failurePages.data?.pages.flatMap((page) => page.failures) ?? [],
		);
	}, [sessionPages.data, failurePages.data, previewSeed]);
	const fullRangeRows = slicing
		? sessionPages.data?.pages[0]?.length
		: undefined;
	useEffect(() => {
		if (fullRangeRows !== undefined && fullRangeRows >= SLICE_ROW_LIMIT)
			setOverflowScope(fullScope);
	}, [fullRangeRows, fullScope]);
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
	const liveSessions = useLiveSessionList({
		enabled: listed || !coldDetail || idleAfterDetail,
		poll: listed,
	});
	const rangeSessionCount =
		catalogQuery.data?.sessionCount ??
		summaryComparison?.current.total_sessions ??
		previewSeed?.totalSessionCount ??
		sessionPages.data?.pages.flat().length ??
		0;
	// The sessions running right now lead the list, whatever the range; a
	// focused day keeps only those active on it. Days are UTC, as the list
	// query counts them.
	const shownDays = sliced ?? range;
	const shownStart = shownDays?.start;
	const shownEnd = shownDays?.end;
	const shownLiveSessions = useMemo(() => {
		if (!shownStart || !shownEnd) return liveSessions.sessions;
		const days = { start: shownStart, end: shownEnd };
		return liveSessions.sessions.filter((live) =>
			isOnUtcDays(live.lastActivityAt, days),
		);
	}, [liveSessions.sessions, shownStart, shownEnd]);
	const sliceStart = sliced?.start;
	const sliceEnd = sliced?.end;
	const slicedSessions = useMemo(() => {
		if (!sliceStart || !sliceEnd || !snapshotSessionsData)
			return snapshotSessionsData;
		return sessionsOnUtcDays(snapshotSessionsData, {
			start: sliceStart,
			end: sliceEnd,
		});
	}, [snapshotSessionsData, sliceStart, sliceEnd]);
	const orderedSessions = useMemo(
		() =>
			mergeLiveSessionRows(
				orderSessionsForDisplay({
					sessions: slicedSessions,
					useRolling24Hours,
				}),
				shownLiveSessions,
				liveSessions.updatedAt,
			),
		[
			shownLiveSessions,
			liveSessions.updatedAt,
			slicedSessions,
			useRolling24Hours,
		],
	);
	const slicedCount = useMemo(
		() =>
			sliced && slicedSessions
				? slicedSessions.filter(
						(session) => transcriptSubagentId(session) === null,
					).length
				: null,
		[sliced, slicedSessions],
	);

	const planUsage = usePlanUsage(desktop && listed, { startDate, endDate });
	const freshShares = useMemo(
		() => (desktop ? sessionUsageShares(planUsage.data) : null),
		[desktop, planUsage.data],
	);
	// Rows, their range and their plan shares change together: a new range
	// keeps the last loaded view until its rows and shares have both arrived.
	const settled =
		!sessionPages.isPlaceholderData &&
		(!desktop ||
			(planUsage.status !== "pending" && !planUsage.isPlaceholderData));
	const fresh = {
		orderedSessions,
		startDate: sliced?.start ?? startDate,
		endDate: sliced?.end ?? endDate,
		usageShares: freshShares,
		loaded: true,
	};
	const [held, setHeld] = useState({ ...fresh, loaded: false });
	if (
		settled &&
		(!held.loaded ||
			held.orderedSessions !== fresh.orderedSessions ||
			held.usageShares !== fresh.usageShares ||
			held.startDate !== fresh.startDate ||
			held.endDate !== fresh.endDate)
	)
		setHeld(fresh);
	const shown = settled ? fresh : held;

	return {
		uploadFailuresError: failurePages.isError,
		retryUploadFailures: () => {
			void failurePages.refetch();
		},
		organizationId: organization.activeOrg?.id,
		costMaximum,
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
		endDate: shown.endDate,
		headlineMetrics,
		organizationSessionCount: overviewKpis?.total_sessions ?? rangeSessionCount,
		isSnapshotSessionsError,
		isSnapshotSessionsPending:
			isSnapshotSessionsPending || (!settled && !held.loaded),
		isSummaryError,
		isSummaryPending,
		orderedSessions: shown.orderedSessions,
		snapshotSessionsData,
		startDate: shown.startDate,
		usageShares: shown.usageShares,
		totalSessionCount:
			slicedCount ??
			rangeSessionCount + (failurePages.data?.pages[0]?.totalCount ?? 0),
		useRolling24Hours,
	};
}

export type SessionsPageData = ReturnType<typeof useSessionsPageData>;
