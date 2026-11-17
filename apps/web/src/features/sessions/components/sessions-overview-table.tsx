import type {
	SessionAnalytics,
	SessionFilterCatalog,
	SessionListFilters,
} from "@rudel/api-routes";
import {
	type ReactNode,
	type Ref,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { useEffectOnceWhen } from "@/app/hooks/useEffectOnceWhen";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { Reveal } from "@/app/ui/bones";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useLiveClock } from "@/features/sessions/use-live-sessions";
import { useLoadSessionPages } from "@/features/sessions/use-load-session-pages";
import { useSessionRunQuestionTags } from "@/features/sessions/use-run-question-tags";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { formatNumber, formatUsername } from "@/lib/format";
import { cn } from "@/lib/utils";
import { subagentTintAt } from "../reader/subagents/session-reader-subagent-tints";
import { sessionRowKey } from "../session-row-key";
import { buildSessionMemberProfileSummaries } from "./session-member-profile-summary";
import { SessionsOverviewControls } from "./sessions-overview-controls";
import { SessionsOverviewFluidList } from "./sessions-overview-fluid-list";
import { SessionsOverviewHeader } from "./sessions-overview-header";
import {
	DEFAULT_SESSIONS_PER_PAGE,
	SessionsOverviewPager,
} from "./sessions-overview-pager";
import { SessionsOverviewRow } from "./sessions-overview-row";
import { getContainedWheelScroll } from "./sessions-overview-scroll";
import { SessionsOverviewSample } from "./sessions-overview-skeleton";
import {
	SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
} from "./sessions-overview-table-utils";
import { useSessionsOverviewTableState } from "./use-sessions-overview-table-state";

const LIVE_ROW_CLOCK_MS = 5_000;

export type SessionListPagination = {
	hasNextPage: boolean;
	isFetching: boolean;
	isError: boolean;
	loadMore: () => void;
};

type SessionsOverviewTableProps = {
	showPlace?: boolean;
	highlightClassName?: string;
	onVisibleSessions?: (sessions: readonly { session_date: string }[]) => void;
	showSkillsColumn?: boolean;
	/** Leads the header's toolbar, before sorting, such as a search field. */
	toolbarStart?: ReactNode;
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
	showPlace = false,
	highlightClassName,
	onVisibleSessions,
	showSkillsColumn = true,
	showDateControl = true,
	toolbarStart,
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
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState<number>(DEFAULT_SESSIONS_PER_PAGE);
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
			setPage(0);
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
	// What run questions found in the listed sessions, where the workspace's
	// runs are answered; the tags share the skills column, so none without it.
	// A live row has no run index yet, and a failed upload no runs at all.
	const taggedSessionIds = useMemo(
		() =>
			showSkillsColumn
				? (sessions ?? [])
						.filter(
							(session) => !session.upload_failure && !session.live_session,
						)
						.map((session) => session.session_id)
				: [],
		[sessions, showSkillsColumn],
	);
	const questionTags = useSessionRunQuestionTags(taggedSessionIds);
	// Live rows read "12s ago"; only they follow the clock.
	const hasLiveRows = tableState.sortedSessions.some(
		(session) => session.live_session !== undefined,
	);
	const nowMs = useLiveClock(hasLiveRows ? LIVE_ROW_CLOCK_MS : false);
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const loaded = tableState.sortedSessions.length;
	const lastLoadedPage = Math.max(Math.ceil(loaded / pageSize) - 1, 0);
	const shownPage = pagination?.hasNextPage
		? page
		: Math.min(page, lastLoadedPage);
	const pageSessions = useMemo(
		() =>
			tableState.sortedSessions.slice(
				shownPage * pageSize,
				(shownPage + 1) * pageSize,
			),
		[tableState.sortedSessions, shownPage, pageSize],
	);
	const focusedIndex = pageSessions.findIndex(
		(session) => sessionRowKey(session) === focusedKey,
	);
	const reportVisible = useLatestValueRef(() =>
		onVisibleSessions?.(pageSessions),
	);
	useEffectOnceWhen({
		effect: () => reportVisible.current(),
		isReady: onVisibleSessions !== undefined,
		key: `${shownPage}:${pageSessions.length}:${loaded}`,
	});
	const subagentTints = useMemo(() => {
		const byParent = new Map<string, SessionAnalytics[]>();
		for (const session of tableState.sortedSessions) {
			if (session.subagent_of?.kind !== "agent") continue;
			const key = `${session.subagent_of.source}:${session.subagent_of.session_id}`;
			byParent.set(key, [...(byParent.get(key) ?? []), session]);
		}
		const tints = new Map<string, string>();
		for (const rows of byParent.values()) {
			const launched = [...rows].sort((left, right) =>
				left.session_date.localeCompare(right.session_date),
			);
			launched.forEach((session, index) => {
				tints.set(
					sessionRowKey(session),
					subagentTintAt(session.subagent_of?.order ?? index),
				);
			});
		}
		return tints;
	}, [tableState.sortedSessions]);
	const renderedRows = pageSessions.map((session, index) => ({
		session,
		position: shownPage * pageSize + index,
		start: undefined,
	}));
	useLoadSessionPages((shownPage + 2) * pageSize > loaded, pagination);
	const knownTotal =
		pagination?.hasNextPage && !tableState.hasActiveFilters
			? Math.max(loaded, totalSessionCount ?? 0)
			: loaded;
	const showPage = useCallback((next: number) => {
		setPage(next);
		if (tableScrollElementRef.current)
			tableScrollElementRef.current.scrollTop = 0;
	}, []);
	const changePageSize = useCallback(
		(next: number) => {
			setPageSize(next);
			showPage(Math.floor((shownPage * pageSize) / next));
		},
		[pageSize, shownPage, showPage],
	);
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
	const { fade, ref: fadeRef } = useScrollFade<HTMLDivElement>();
	const setTableScrollContainer = useCallback(
		(element: HTMLDivElement | null) => {
			fadeRef(element);
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
		[fadeRef, handleContainedWheel, scrollContainerRef],
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
					{...fade}
					// Focusable only for the demo, which focuses it on entry so the
					// keyboard scrolls it; in the app a click must not focus it.
					tabIndex={demo ? -1 : undefined}
					className="scroll-fade @container isolate h-full min-h-0 min-w-0 touch-pan-x touch-pan-y overflow-auto overscroll-none [--scroll-fade-top-offset:--spacing(12)] in-data-rail-beside:[--scroll-fade-top-offset:--spacing(15)] [overflow-anchor:none] [scrollbar-gutter:stable]"
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
							event.key !== "Tab" ||
							event.ctrlKey ||
							event.metaKey ||
							event.altKey ||
							focusedIndex < 0
						)
							return;
						const nextIndex = focusedIndex + (event.shiftKey ? -1 : 1);
						const next = pageSessions[nextIndex];
						if (!next) return;
						event.preventDefault();
						const key = sessionRowKey(next);
						setFocusedKey(key);
						requestAnimationFrame(() => {
							const row = Array.from(
								tableScrollElementRef.current?.querySelectorAll<HTMLElement>(
									"[data-session-key]",
								) ?? [],
							).find((row) => row.dataset.sessionKey === key);
							row?.querySelector<HTMLElement>("a, button")?.focus();
						});
					}}
				>
					<SessionsOverviewHeader
						showSkillsColumn={showSkillsColumn}
						controls={
							<SessionsOverviewControls
								tableState={tableState}
								showDateControl={showDateControl}
								toolbarStart={toolbarStart}
							/>
						}
						onSort={tableState.handleSort}
						sort={tableState.sort}
					/>
					<div
						className={cn(
							"@container/sessions-overview flex min-h-[calc(100%-3rem)] flex-col",
							showSkillsColumn && SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
						)}
						data-slot="sessions-overview-canvas"
					>
						{!isLoading && tableState.recentSessions.length === 0 ? (
							<div className="flex min-h-64 flex-1 items-center justify-center border-b border-(--session-overview-border) px-6 text-center text-base text-(--session-overview-muted) sm:text-sm">
								No recent sessions in the selected range.
							</div>
						) : !isLoading && tableState.filteredSessions.length === 0 ? (
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
							<Reveal
								fill
								className="flex-1"
								label="Loading sessions"
								loading={isLoading}
								sample={
									<SessionsOverviewSample showSkillsColumn={showSkillsColumn} />
								}
								sampleId="sessions"
							>
								{() => (
									<SessionsOverviewFluidList
										fillHeight={!pagination?.hasNextPage}
										highlightClassName={cn(
											"in-data-rail-beside:rounded-lg in-data-rail-beside:corner-squircle in-data-rail-beside:squircle:rounded-2xl",
											highlightClassName,
										)}
									>
										{({ registerItem, setActiveIndex }) => (
											<>
												{renderedRows.map(
													({ session, position, start }, index) => (
														<SessionsOverviewRow
															subagentTint={subagentTints.get(
																sessionRowKey(session),
															)}
															showPlace={showPlace}
															showSkillsColumn={showSkillsColumn}
															key={sessionRowKey(session)}
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
															liveNowMs={
																session.live_session ? nowMs : undefined
															}
															maximumSessionCost={tableState.maximumSessionCost}
															memberProfile={memberProfileSummaries.get(
																session.user_id,
															)}
															onSessionClick={onSessionClick}
															questionTags={questionTags.get(
																session.session_id,
															)}
															session={session}
															userLabel={formatUsername(
																session.user_id,
																userMap,
															)}
														/>
													),
												)}
											</>
										)}
									</SessionsOverviewFluidList>
								)}
							</Reveal>
						)}
						{pageSessions.length > 0 ? (
							<SessionsOverviewPager
								isFetching={pagination?.isFetching ?? false}
								known={knownTotal}
								more={
									(pagination?.hasNextPage ?? false) && knownTotal === loaded
								}
								onPage={showPage}
								onPageSize={changePageSize}
								page={shownPage}
								pageSize={pageSize}
								shown={pageSessions.length}
							/>
						) : null}
						{!pagination && tableState.unloadedSessionCount > 0 ? (
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
