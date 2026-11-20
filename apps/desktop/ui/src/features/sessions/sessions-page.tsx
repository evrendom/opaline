import type { SessionAnalytics } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import {
	type ComponentProps,
	lazy,
	Suspense,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { DateRangeOverride } from "@/features/analytics/date-range/DateRangeProvider";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import {
	DotPickContext,
	DotPreviewContext,
} from "@/features/costs/cost-hover-date";
import { useDotFilter } from "@/features/costs/use-dot-filter";
import { SessionDetailErrorBoundary } from "@/features/sessions/components/session-detail-view-parts";
import { SessionTraceDock } from "@/features/sessions/components/session-trace-dock";
import { SessionsListSurface } from "@/features/sessions/components/sessions-list-surface";
import { getSessionNeighbours } from "@/features/sessions/session-navigation";
import { useLoadSessionPages } from "@/features/sessions/use-load-session-pages";
import { useSessionsPageData } from "@/features/sessions/use-sessions-page-data";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useShellBottomNavigationPortal } from "@/features/shell/shell-bottom-navigation-portal";
import { useCanViewSession } from "@/features/workspace/hooks/useCanViewSession";
import { sessionDetailInitialQueryOptions } from "./components/session-detail-fast-query";
import { SessionReaderFallback } from "./reader/session-reader-light-samples";
import {
	getLoadedSessionReaderView,
	loadSessionReaderView,
} from "./session-detail-prefetch";
import { transcriptSubagentId } from "./session-row-key";
import { SessionsRail } from "./sessions-rail";

const LazySessionReaderView = lazy(() =>
	loadSessionReaderView().then((module) => ({
		default: module.SessionReaderView,
	})),
);
type ReaderProps = ComponentProps<typeof LazySessionReaderView>;

/** The reader: rendered at once when its code is in (preloaded as the list
 * is hovered, or as the app boots on a session's address), so opening a
 * session never suspends to a placeholder and waits out React's reveal
 * throttle before the reader mounts. Chosen once per session opened: a
 * switch while mounted would remount it. */
function SessionReader(props: ReaderProps) {
	const [Reader] = useState(
		() => getLoadedSessionReaderView() ?? LazySessionReaderView,
	);
	return <Reader {...props} />;
}

function preloadSessionDetail() {
	// A failed speculative download must not prevent a normal click from retrying.
	void loadSessionReaderView().catch(() => undefined);
}

const SESSION_LIST_SCROLL_POSITION_LIMIT = 20;
const sessionListScrollPositions = new Map<string, number>();

export function SessionsPage() {
	const params = useParams<{ sessionId?: string }>();
	const activeSessionId = params.sessionId ?? null;
	const detailReady =
		useQuery({
			...sessionDetailInitialQueryOptions(activeSessionId ?? ""),
			enabled: false,
			select: () => true,
		}).data === true;
	const { dotPick, preview, shownRange } = useDotFilter(useDateRange().state);
	const data = useSessionsPageData({
		detail: activeSessionId !== null,
		detailReady,
		focus: activeSessionId === null ? shownRange : null,
	});
	const canViewSession = useCanViewSession();
	const location = useLocation();
	const navigate = useNavigate();
	const getShellRoutePath = useShellRoutePath();
	const shellBottomNavigationPortal = useShellBottomNavigationPortal();
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const scrollContainer = scrollContainerRef.current;
		if (!scrollContainer) {
			return;
		}

		const locationKey = location.key;
		const savedScrollPosition = sessionListScrollPositions.get(locationKey);
		const animationFrame =
			savedScrollPosition === undefined
				? undefined
				: window.requestAnimationFrame(() => {
						scrollContainer.scrollTop = savedScrollPosition;
					});
		// Saved as it scrolls: opening a session unmounts the list, and by the
		// time this effect cleans up the container is detached and reads 0.
		const saveScrollPosition = () => {
			sessionListScrollPositions.set(locationKey, scrollContainer.scrollTop);
			if (
				sessionListScrollPositions.size > SESSION_LIST_SCROLL_POSITION_LIMIT
			) {
				const oldestLocationKey = sessionListScrollPositions
					.keys()
					.next().value;
				if (oldestLocationKey !== undefined) {
					sessionListScrollPositions.delete(oldestLocationKey);
				}
			}
		};
		scrollContainer.addEventListener("scroll", saveScrollPosition, {
			passive: true,
		});

		return () => {
			if (animationFrame !== undefined) {
				window.cancelAnimationFrame(animationFrame);
			}
			scrollContainer.removeEventListener("scroll", saveScrollPosition);
		};
	}, [location.key]);
	const viewableSessions = data.orderedSessions.filter(
		(session) =>
			transcriptSubagentId(session) === null && canViewSession(session.user_id),
	);
	const { nextSession, previousSession } = getSessionNeighbours({
		canViewSession,
		orderedSessions: viewableSessions,
		selectedSessionId: activeSessionId,
	});
	const selectedSessionIndex = viewableSessions.findIndex(
		(session) => session.session_id === activeSessionId,
	);
	useLoadSessionPages(
		selectedSessionIndex >= 0 &&
			selectedSessionIndex >= viewableSessions.length - 5,
		data.pagination,
	);
	const sessionPosition =
		selectedSessionIndex === -1 ? undefined : selectedSessionIndex + 1;

	function closeSession() {
		navigate(getShellRoutePath(appRoutes.session()));
	}

	const sessionNavigation = useMemo(() => {
		function navigateToSession(targetSession: SessionAnalytics | undefined) {
			if (!targetSession) {
				return;
			}

			const targetPath = getShellRoutePath(
				appRoutes.sessionDetail(targetSession.session_id),
			);
			navigate(targetPath, {
				replace: true,
				viewTransition: true,
			});
		}
		return {
			hasNextSession: nextSession !== undefined,
			hasPreviousSession: previousSession !== undefined,
			onNextSession: () => navigateToSession(nextSession),
			onPreviousSession: () => navigateToSession(previousSession),
		};
	}, [getShellRoutePath, navigate, nextSession, previousSession]);
	const activeSessionDetail = activeSessionId ? (
		<SessionDetailErrorBoundary
			fallbackHref={getShellRoutePath(appRoutes.session())}
			key={activeSessionId}
		>
			<Suspense fallback={<SessionReaderFallback />}>
				<SessionReader
					navigation={sessionNavigation}
					position={sessionPosition}
					sessionId={activeSessionId}
					totalSessions={viewableSessions.length}
				/>
			</Suspense>
		</SessionDetailErrorBoundary>
	) : undefined;

	return (
		<>
			{/* An open session takes the whole page; its breadcrumb
			    in the shell header leads back to the list. */}
			<div
				className="dashboardy-page @container/session-workspace flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[color:var(--dashboardy-surface-opaque)]"
				data-slot="session-workspace"
			>
				{activeSessionDetail ? (
					<section
						aria-label="Session detail"
						className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
						data-slot="session-detail-page"
					>
						{activeSessionDetail}
					</section>
				) : (
					<section
						aria-label="Sessions"
						onPointerEnter={preloadSessionDetail}
						onFocusCapture={preloadSessionDetail}
						className="flex min-h-0 min-w-0 flex-1"
						data-rail-beside
						data-slot="sessions-list-pane"
					>
						<DotPickContext.Provider value={dotPick}>
							<DotPreviewContext.Provider value={preview}>
								<SessionsRail />
							</DotPreviewContext.Provider>
							<DateRangeOverride range={shownRange}>
								<SessionsListSurface
									activeSessionId={activeSessionId}
									canOpenSession={(session) => canViewSession(session.user_id)}
									data={data}
									getSessionHref={(session) =>
										getShellRoutePath(
											appRoutes.sessionDetail(session.session_id),
										)
									}
									layout="workspace"
									showPlace
									showSkillsColumn={false}
									scrollContainerRef={scrollContainerRef}
								/>
							</DateRangeOverride>
						</DotPickContext.Provider>
					</section>
				)}
			</div>
			{activeSessionId && shellBottomNavigationPortal
				? createPortal(
						<SessionTraceDock
							navigation={sessionNavigation}
							onReturn={closeSession}
							position={sessionPosition}
							totalSessions={viewableSessions.length}
						/>,
						shellBottomNavigationPortal,
					)
				: null}
		</>
	);
}
