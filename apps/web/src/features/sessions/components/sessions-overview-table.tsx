import type {
	SessionAnalytics,
	SessionFilterCatalog,
	SessionListFilters,
} from "@rudel/api-routes";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type Ref, useCallback, useMemo, useRef, useState } from "react";
import { useLoadMoreIntersectionObserver } from "@/app/hooks/useLoadMoreIntersectionObserver";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { getSessionRenderIndexes } from "@/features/sessions/session-list-virtualization";
import { useLoadSessionPages } from "@/features/sessions/use-load-session-pages";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { formatNumber, formatUsername } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildSessionMemberProfileSummaries } from "./session-member-profile-summary";
import { SessionsOverviewControls } from "./sessions-overview-controls";
import { SessionsOverviewFluidList } from "./sessions-overview-fluid-list";
import { SessionsOverviewHeader } from "./sessions-overview-header";
import { SessionsOverviewLoadMoreRow } from "./sessions-overview-load-more-row";
import { SessionsOverviewRow } from "./sessions-overview-row";
import { getContainedWheelScroll } from "./sessions-overview-scroll";
import { SessionsOverviewSkeleton } from "./sessions-overview-skeleton";
import {
	SESSION_OVERVIEW_HEADER_HEIGHT,
	SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
	SESSION_OVERVIEW_ROW_HEIGHT,
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
} from "./sessions-overview-table-utils";
import { useSessionsOverviewTableState } from "./use-sessions-overview-table-state";

export type SessionListPagination = {
	hasNextPage: boolean;
	isFetching: boolean;
	isError: boolean;
	loadMore: () => void;
};

type SessionsOverviewTableProps = {
	showSkillsColumn?: boolean;
	showDateControl?: boolean;
	filterCatalog?: SessionFilterCatalog;
	filterCatalogPending?: boolean;
	filterCatalogError?: boolean;
	onRetryFilterCatalog?: () => void;
	onFiltersChange?: (filters: SessionListFilters) => void;
	pagination?: SessionListPagination;
	activeSessionId: string | null | undefined;
	canOpenSession: ((session: SessionAnalytics) => boolean) | undefined;
	getSessionHref: ((session: SessionAnalytics) => string) | undefined;
	getSessionLinkState: ((session: SessionAnalytics) => unknown) | undefined;
	isLoading: boolean;
	onSessionClick: ((session: SessionAnalytics) => void) | undefined;
	scrollContainerRef: Ref<HTMLDivElement> | undefined;
	sessionCountLabel: number;
	sessions: readonly SessionAnalytics[] | undefined;
	sessionDetailDisabledNote: string | undefined;
	totalSessionCount: number;
};

export function SessionsOverviewTable({
	showSkillsColumn = true,
	showDateControl = true,
	activeSessionId,
	canOpenSession,
	getSessionHref,
	getSessionLinkState,
	isLoading,
	onSessionClick,
	scrollContainerRef,
	sessionCountLabel,
	sessions,
	sessionDetailDisabledNote,
	totalSessionCount,
	pagination,
	filterCatalog,
	filterCatalogPending,
	filterCatalogError,
	onRetryFilterCatalog,
	onFiltersChange,
}: SessionsOverviewTableProps) {
	const tableScrollElementRef = useRef<HTMLDivElement | null>(null);
	const { avatarMap, userMap } = useUserMap();
	const tableState = useSessionsOverviewTableState({
		sessionCountLabel,
		sessions,
		totalSessionCount,
		userMap,
		filterCatalog,
		filterCatalogPending,
		filterCatalogError,
		onRetryFilterCatalog,
		onFiltersChange,
		onQueryChange: () => {
			if (tableScrollElementRef.current)
				tableScrollElementRef.current.scrollTop = 0;
		},
	});
	const memberProfileSummaries = useMemo(
		() =>
			buildSessionMemberProfileSummaries(
				tableState.recentSessions.filter((session) => !session.upload_failure),
			),
		[tableState.recentSessions],
	);
	const demo = useDemoRuntime();
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const focusedIndex = tableState.sortedSessions.findIndex(
		(session) => `${session.source}:${session.session_id}` === focusedKey,
	);
	const rangeExtractor = useCallback(
		(range: Parameters<typeof getSessionRenderIndexes>[0]) =>
			getSessionRenderIndexes(range, focusedIndex),
		[focusedIndex],
	);
	const virtualizer = useVirtualizer({
		count: tableState.sortedSessions.length,
		rangeExtractor,
		getScrollElement: () => tableScrollElementRef.current,
		estimateSize: () => SESSION_OVERVIEW_ROW_HEIGHT,
		getItemKey: (index) => {
			const session = tableState.sortedSessions[index];
			return session ? `${session.source}:${session.session_id}` : index;
		},
		scrollMargin: SESSION_OVERVIEW_HEADER_HEIGHT,
		overscan: 8,
		enabled: !demo && !isLoading,
	});
	const virtualRows = virtualizer.getVirtualItems();
	const renderedRows =
		virtualRows.length > 0
			? virtualRows.flatMap((row) => {
					const session = tableState.sortedSessions[row.index];
					return session
						? [
								{
									session,
									position: row.index,
									start: row.start - SESSION_OVERVIEW_HEADER_HEIGHT,
								},
							]
						: [];
				})
			: tableState.visibleSessions.map((session, position) => ({
					session,
					position,
					start: undefined,
				}));
	const loadMore = useCallback(() => {
		if (pagination?.hasNextPage && !pagination.isFetching)
			pagination.loadMore();
		else tableState.loadNextSessionBatch();
	}, [pagination, tableState.loadNextSessionBatch]);
	const setLoadMoreElement = useLoadMoreIntersectionObserver({
		enabled:
			!pagination?.isFetching &&
			!pagination?.isError &&
			(pagination?.hasNextPage === true ||
				(virtualRows.length === 0 &&
					tableState.remainingLoadedSessionCount > 0)),
		onIntersect: loadMore,
	});
	// Filtering and sorting must keep searching older pages. Never claim the
	// loaded subset is the full result while those pages are still outstanding.
	useLoadSessionPages(
		(tableState.hasActiveFilters && !onFiltersChange) ||
			tableState.sort.key !== "time" ||
			tableState.sort.direction !== "desc",
		pagination,
	);

	const handleContainedWheel = useCallback((event: WheelEvent) => {
		if (event.ctrlKey) return;
		const scrollElement = tableScrollElementRef.current;
		if (!scrollElement) return;
		const nextScroll = getContainedWheelScroll({
			clientHeight: scrollElement.clientHeight,
			clientWidth: scrollElement.clientWidth,
			deltaMode: event.deltaMode,
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			scrollHeight: scrollElement.scrollHeight,
			scrollLeft: scrollElement.scrollLeft,
			scrollTop: scrollElement.scrollTop,
			scrollWidth: scrollElement.scrollWidth,
		});
		if (!nextScroll.shouldContain) return;
		event.preventDefault();
		scrollElement.scrollLeft = nextScroll.left;
		scrollElement.scrollTop = nextScroll.top;
	}, []);
	const setTableScrollContainer = useCallback(
		(element: HTMLDivElement | null) => {
			tableScrollElementRef.current?.removeEventListener(
				"wheel",
				handleContainedWheel,
			);
			tableScrollElementRef.current = element;
			if (typeof scrollContainerRef === "function") {
				scrollContainerRef(element);
			} else if (scrollContainerRef) {
				scrollContainerRef.current = element;
			}
			element?.addEventListener("wheel", handleContainedWheel, {
				passive: false,
			});
		},
		[handleContainedWheel, scrollContainerRef],
	);
	return (
		<div className={SESSION_OVERVIEW_SURFACE_CLASS_NAME}>
			{sessionDetailDisabledNote ? (
				<p className="border-t border-(--session-overview-border) px-3 py-2 text-base font-medium text-(--session-overview-muted) sm:text-sm">
					{sessionDetailDisabledNote}
				</p>
			) : null}

			<div className="relative min-h-0 min-w-0 flex-1">
				<div
					ref={setTableScrollContainer}
					tabIndex={-1}
					className="isolate h-full min-h-0 min-w-0 touch-pan-x touch-pan-y overflow-auto overscroll-none [overflow-anchor:none] [scrollbar-gutter:stable]"
					data-slot="sessions-overview-scroll-container"
					onFocusCapture={(event) => {
						setFocusedKey(
							event.target.closest<HTMLElement>("[data-session-key]")?.dataset
								.sessionKey ?? null,
						);
					}}
					onBlurCapture={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget))
							setFocusedKey(null);
					}}
					onKeyDownCapture={(event) => {
						if (
							virtualRows.length === 0 ||
							event.key !== "Tab" ||
							event.ctrlKey ||
							event.metaKey ||
							event.altKey ||
							focusedIndex < 0
						)
							return;
						const nextIndex = focusedIndex + (event.shiftKey ? -1 : 1);
						const next = tableState.sortedSessions[nextIndex];
						if (!next) return;
						event.preventDefault();
						const key = `${next.source}:${next.session_id}`;
						setFocusedKey(key);
						virtualizer.scrollToIndex(nextIndex, { align: "auto" });
						requestAnimationFrame(() => {
							const row = Array.from(
								tableScrollElementRef.current?.querySelectorAll<HTMLElement>(
									"[data-session-key]",
								) ?? [],
							).find((row) => row.dataset.sessionKey === key);
							row
								?.querySelector<HTMLElement>("a, button")
								?.focus({ preventScroll: true });
						});
					}}
				>
					<SessionsOverviewHeader
						showSkillsColumn={showSkillsColumn}
						controls={
							<SessionsOverviewControls
								tableState={tableState}
								showDateControl={showDateControl}
							/>
						}
						onSort={tableState.handleSort}
						sort={tableState.sort}
					/>
					<div
						className={cn(
							"@container/sessions-overview flex min-h-[calc(100%-3rem)] flex-col",
							showSkillsColumn
								? SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME
								: "min-w-[812px]",
						)}
						data-slot="sessions-overview-canvas"
					>
						{isLoading ? (
							<SessionsOverviewSkeleton showSkillsColumn={showSkillsColumn} />
						) : tableState.recentSessions.length === 0 ? (
							<div className="flex min-h-64 flex-1 items-center justify-center border-b border-(--session-overview-border) px-6 text-center text-base text-(--session-overview-muted) sm:text-sm">
								No recent sessions in the selected range.
							</div>
						) : tableState.filteredSessions.length === 0 ? (
							<div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-2 border-b border-(--session-overview-border) px-6 text-center text-base text-(--session-overview-muted) sm:text-sm">
								<p>
									{pagination?.hasNextPage
										? "Looking for matching sessions…"
										: "No sessions match the selected filters."}
								</p>
								<button
									type="button"
									className="rounded-md px-2 py-1 font-medium text-(--session-overview-accent) outline-none hover:bg-(--session-overview-hover) focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-(--session-overview-accent)"
									onClick={tableState.clearAllFilters}
								>
									Clear filters
								</button>
							</div>
						) : (
							<SessionsOverviewFluidList
								fillHeight={!pagination?.hasNextPage}
								height={
									virtualRows.length ? virtualizer.getTotalSize() : undefined
								}
							>
								{({ registerItem, setActiveIndex }) => (
									<>
										{renderedRows.map(({ session, position, start }, index) => (
											<SessionsOverviewRow
												showSkillsColumn={showSkillsColumn}
												key={`${session.source}:${session.session_id}`}
												virtualTop={start}
												index={index}
												position={position}
												setSize={
													pagination?.hasNextPage
														? -1
														: tableState.sortedSessions.length
												}
												registerItem={registerItem}
												setHoverActiveIndex={setActiveIndex}
												activeSessionId={activeSessionId}
												avatarUrl={avatarMap?.[session.user_id]}
												canOpenSession={canOpenSession}
												getSessionHref={getSessionHref}
												getSessionLinkState={getSessionLinkState}
												maximumSessionCost={tableState.maximumSessionCost}
												memberProfile={memberProfileSummaries.get(
													session.user_id,
												)}
												onSessionClick={onSessionClick}
												session={session}
												userLabel={formatUsername(session.user_id, userMap)}
											/>
										))}
									</>
								)}
							</SessionsOverviewFluidList>
						)}
						{pagination?.hasNextPage ? (
							<SessionsOverviewLoadMoreRow
								showSkillsColumn={showSkillsColumn}
								rowRef={setLoadMoreElement}
								isFetching={pagination.isFetching}
								isError={pagination.isError}
								loadMore={loadMore}
							/>
						) : !pagination && tableState.remainingLoadedSessionCount > 0 ? (
							<div
								ref={setLoadMoreElement}
								aria-hidden="true"
								className="h-px w-full"
							/>
						) : !pagination && tableState.unloadedSessionCount > 0 ? (
							<p className="px-3 py-2 text-right text-sm text-(--session-overview-muted)">
								{formatNumber(tableState.unloadedSessionCount)} more not shown
								{tableState.hasActiveFilters
									? "; filters apply to loaded sessions"
									: null}
							</p>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
