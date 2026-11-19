import type { SessionAnalytics } from "@rudel/api-routes";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { useAnalyticsTracking } from "@/features/analytics/tracking/useAnalyticsTracking";
import { SessionDetailView } from "@/features/sessions/components/SessionDetailView";
import { SessionDetailErrorBoundary } from "@/features/sessions/components/session-detail-view-parts";
import { sessionPaneMotionStyle } from "@/features/sessions/components/session-pane-motion";
import { SessionTraceDock } from "@/features/sessions/components/session-trace-dock";
import { SessionWorkspaceResizeHandle } from "@/features/sessions/components/session-workspace-resize-handle";
import { SessionsListSurface } from "@/features/sessions/components/sessions-list-surface";
import { getSessionNeighbours } from "@/features/sessions/session-navigation";
import { useSessionsPageData } from "@/features/sessions/use-sessions-page-data";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useShellBottomNavigationPortal } from "@/features/shell/shell-bottom-navigation-portal";
import { useCanViewSession } from "@/features/workspace/hooks/useCanViewSession";
import { markSessionOpen } from "./session-open-timing";
import { transcriptSubagentId } from "./session-row-key";

export function NewSessionPage() {
	const params = useParams<{ sessionId?: string }>();
	const data = useSessionsPageData({
		trackPageView: false,
		paginated: false,
	});
	const canViewSession = useCanViewSession();
	const navigate = useNavigate();
	const getShellRoutePath = useShellRoutePath();
	const shellBottomNavigationPortal = useShellBottomNavigationPortal();
	const { trackDrilldown } = useAnalyticsTracking();
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const viewableSessions = data.orderedSessions.filter(
		(session) =>
			transcriptSubagentId(session) === null && canViewSession(session.user_id),
	);
	const defaultSessionId = viewableSessions[0]?.session_id ?? null;
	const activeSessionId = params.sessionId ?? defaultSessionId;

	useEffect(() => {
		if (params.sessionId || !defaultSessionId) return;

		navigate(getShellRoutePath(appRoutes.newSessionDetail(defaultSessionId)), {
			replace: true,
		});
	}, [defaultSessionId, navigate, params.sessionId, getShellRoutePath]);

	const { nextSession, previousSession } = getSessionNeighbours({
		canViewSession,
		orderedSessions: viewableSessions,
		selectedSessionId: activeSessionId,
	});
	const selectedSessionIndex = viewableSessions.findIndex(
		(session) => session.session_id === activeSessionId,
	);
	const sessionPosition =
		selectedSessionIndex === -1 ? undefined : selectedSessionIndex + 1;

	function getDetailPath(sessionId: string) {
		return getShellRoutePath(appRoutes.newSessionDetail(sessionId));
	}

	function handleSessionClick(session: SessionAnalytics) {
		if (!canViewSession(session.user_id)) return;

		const targetPath = getDetailPath(session.session_id);
		trackDrilldown({
			drilldownMethod: "table_row",
			sourceComponent: "newsesh_sessions_list",
			targetType: "session",
			targetId: session.session_id,
			targetPath,
		});
	}

	function navigateToSession(session: SessionAnalytics | undefined) {
		if (!session) return;
		markSessionOpen(session.session_id);

		navigate(getDetailPath(session.session_id), {
			replace: true,
			viewTransition: true,
		});
	}

	const sessionNavigation = {
		hasNextSession: nextSession !== undefined,
		hasPreviousSession: previousSession !== undefined,
		onNextSession: () => navigateToSession(nextSession),
		onPreviousSession: () => navigateToSession(previousSession),
	};

	return (
		<>
			<main
				className="dashboardy-page flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[color:var(--dashboardy-surface-opaque)]"
				data-slot="session-workspace"
			>
				<section
					aria-label="Sessions overview"
					className="hidden min-h-0 min-w-0 flex-none overflow-hidden lg:flex lg:w-[var(--session-list-pane-width,29.8125rem)]"
					data-slot="sessions-list-pane"
				>
					<SessionsListSurface
						activeSessionId={activeSessionId}
						canOpenSession={(session) => canViewSession(session.user_id)}
						getSessionHref={(session) => getDetailPath(session.session_id)}
						data={data}
						layout="workspace"
						onSessionClick={handleSessionClick}
						scrollContainerRef={scrollContainerRef}
					/>
				</section>
				<div className="hidden lg:contents">
					<SessionWorkspaceResizeHandle storageKey="rudel:newsesh-list-pane-width" />
				</div>
				<section
					aria-label="Selected session detail"
					className="relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[color:var(--dashboardy-surface-opaque)]"
					data-slot="session-detail-pane"
					style={sessionPaneMotionStyle}
				>
					{activeSessionId ? (
						<SessionDetailErrorBoundary
							fallbackHref={getShellRoutePath(appRoutes.newSession())}
							key={activeSessionId}
						>
							<SessionDetailView
								navigation={sessionNavigation}
								position={sessionPosition}
								sessionId={activeSessionId}
								totalSessions={viewableSessions.length}
							/>
						</SessionDetailErrorBoundary>
					) : (
						<div
							aria-busy={data.isSnapshotSessionsPending}
							aria-live="polite"
							className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-base text-[color:var(--dashboardy-muted)] sm:text-sm"
						>
							{data.isSnapshotSessionsPending
								? "Loading session detail…"
								: "No sessions are available in this date range."}
						</div>
					)}
				</section>
			</main>
			{activeSessionId && shellBottomNavigationPortal
				? createPortal(
						<SessionTraceDock
							navigation={sessionNavigation}
							onReturn={() =>
								navigate(getShellRoutePath(appRoutes.newSession()), {
									replace: true,
									viewTransition: true,
								})
							}
							position={sessionPosition}
							totalSessions={viewableSessions.length}
						/>,
						shellBottomNavigationPortal,
					)
				: null}
		</>
	);
}
