import type { SessionAnalytics } from "@rudel/api-routes";
import { type Ref, useCallback, useMemo, useRef } from "react";
import { useLoadMoreIntersectionObserver } from "@/app/hooks/useLoadMoreIntersectionObserver";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { formatNumber, formatUsername } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildSessionMemberProfileSummaries } from "./session-member-profile-summary";
import { SessionsOverviewControls } from "./sessions-overview-controls";
import { SessionsOverviewFluidList } from "./sessions-overview-fluid-list";
import { SessionsOverviewHeader } from "./sessions-overview-header";
import { SessionsOverviewRow } from "./sessions-overview-row";
import { getContainedWheelScroll } from "./sessions-overview-scroll";
import { SessionsOverviewSkeleton } from "./sessions-overview-skeleton";
import {
	SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
	SESSION_OVERVIEW_SURFACE_CLASS_NAME,
} from "./sessions-overview-table-utils";
import { useSessionsOverviewTableState } from "./use-sessions-overview-table-state";

type SessionsOverviewTableProps = {
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
}: SessionsOverviewTableProps) {
	const tableScrollElementRef = useRef<HTMLDivElement | null>(null);
	const { avatarMap, userMap } = useUserMap();
	const tableState = useSessionsOverviewTableState({
		sessionCountLabel,
		sessions,
		totalSessionCount,
		userMap,
	});
	const memberProfileSummaries = useMemo(
		() => buildSessionMemberProfileSummaries(tableState.recentSessions),
		[tableState.recentSessions],
	);
	const setLoadMoreElement = useLoadMoreIntersectionObserver({
		enabled: tableState.remainingLoadedSessionCount > 0,
		onIntersect: tableState.loadNextSessionBatch,
	});
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
				>
					<div
						className={cn(
							"@container/sessions-overview flex min-h-full flex-col",
							SESSION_OVERVIEW_MIN_WIDTH_CLASS_NAME,
						)}
						data-slot="sessions-overview-canvas"
					>
						<SessionsOverviewHeader
							controls={<SessionsOverviewControls tableState={tableState} />}
							onSort={tableState.handleSort}
							sort={tableState.sort}
						/>
						{isLoading ? (
							<SessionsOverviewSkeleton />
						) : tableState.recentSessions.length === 0 ? (
							<div className="flex min-h-64 flex-1 items-center justify-center border-b border-(--session-overview-border) px-6 text-center text-base text-(--session-overview-muted) sm:text-sm">
								No recent sessions in the selected range.
							</div>
						) : tableState.filteredSessions.length === 0 ? (
							<div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-2 border-b border-(--session-overview-border) px-6 text-center text-base text-(--session-overview-muted) sm:text-sm">
								<p>No sessions match the selected filters.</p>
								<button
									type="button"
									className="rounded-md px-2 py-1 font-medium text-(--session-overview-accent) outline-none hover:bg-(--session-overview-hover) focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-(--session-overview-accent)"
									onClick={tableState.clearAllFilters}
								>
									Clear filters
								</button>
							</div>
						) : (
							<>
								<SessionsOverviewFluidList>
									{({ registerItem, setActiveIndex }) =>
										tableState.visibleSessions.map((session, index) => (
											<SessionsOverviewRow
												key={session.session_id}
												index={index}
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
										))
									}
								</SessionsOverviewFluidList>
								{tableState.remainingLoadedSessionCount > 0 ? (
									<div
										ref={setLoadMoreElement}
										aria-hidden="true"
										className="h-px w-full"
									/>
								) : null}
								{tableState.remainingLoadedSessionCount === 0 &&
								tableState.unloadedSessionCount > 0 ? (
									<p className="border-b border-(--session-overview-border) px-3 py-2 text-right text-base font-medium tabular-nums text-(--session-overview-muted) sm:text-sm">
										{formatNumber(tableState.unloadedSessionCount)} more not
										shown
										{tableState.hasActiveFilters
											? "; filters apply to loaded sessions"
											: null}
									</p>
								) : null}
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
