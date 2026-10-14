import {
	isLiveSessionDetailRevision,
	liveSessionDetailRevision,
} from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Button } from "@/app/ui/button";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import {
	useLiveSession,
	useLiveSessionPolling,
	useLiveSessionState,
} from "../use-live-sessions";
import { LiveSessionStatus } from "./live-session-status";
import { SessionContextFields } from "./session-context-chips";
import {
	fetchSessionDetailInitial,
	SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
	sessionDetailBodyQueryPrefix,
	sessionDetailInitialQueryKey,
	sessionDetailRevisionQueryPrefix,
	sessionDetailWindowQueryPrefix,
	shouldRetrySessionDetailFastQuery,
} from "./session-detail-fast-query";
import { SessionDetailHeader } from "./session-detail-header";
import { buildSessionDetailOverviewViewModel } from "./session-detail-overview-model";
import { hasSessionDetailErrorCode } from "./session-detail-response";
import {
	canRetrySessionDetailError,
	getSessionDetailErrorState,
} from "./session-detail-view-utils";
import { SessionReaderContent } from "./session-reader-content";
import { SessionReaderSkeleton } from "./session-reader-skeleton";

// A session that moved on is read again this soon after: appends land every
// couple of seconds, and each read derives the whole session on the server.
const LIVE_REREAD_DELAY_MS = 1_000;

/**
 * The reader layout of a session: a calm, chat-style transcript with a sticky
 * rail of session facts and per-turn status.
 * It reads the session-detail queries the repo and skill pages' embedded
 * session view reads, so the two share one cache.
 * A session that is still running reads the same way, from its live lines:
 * the reader follows them as they land, and its upload takes over once the
 * session has stopped.
 */
export function SessionReaderView({
	navigation,
	position,
	sessionId,
	totalSessions,
}: {
	navigation: SessionNavigation | undefined;
	position: number | undefined;
	sessionId: string;
	totalSessions: number;
}) {
	const queryClient = useQueryClient();
	const shellHeaderPortal = useShellHeaderPortal();
	const { userMap, avatarMap } = useUserMap();
	// Live state is extra: without it, or when it fails, the page is as
	// before. The reader re-renders only when the live session changes.
	useLiveSessionPolling(sessionId);
	const liveState = useLiveSessionState(sessionId);
	const live = useLiveSession(sessionId);
	const liveSession = live?.session ?? undefined;
	const liveRevision = liveSession
		? liveSessionDetailRevision(liveSession)
		: undefined;
	const liveUploaded = live?.uploaded === true;
	const initialQuery = useQuery({
		enabled: sessionId.length > 0,
		queryFn: ({ signal }) => fetchSessionDetailInitial(sessionId, signal),
		queryKey: sessionDetailInitialQueryKey(sessionId),
		// The reader follows a running session: when it moved on since the
		// revision shown, or stopped running with an upload stored (which
		// takes over), the detail is read again.
		refetchInterval: (query) => {
			if (liveRevision === undefined) return false;
			const revision = query.state.data?.overview.revision;
			const readsLiveLines =
				revision !== undefined && isLiveSessionDetailRevision(revision);
			const movedOn =
				liveRevision !== revision &&
				(readsLiveLines || liveState === "running" || revision === undefined);
			const uploadTakesOver =
				readsLiveLines && liveState !== "running" && liveUploaded;
			return movedOn || uploadTakesOver ? LIVE_REREAD_DELAY_MS : false;
		},
		retry: shouldRetrySessionDetailFastQuery,
		staleTime: SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
	});
	const overview = initialQuery.data?.overview;
	const viewModel = overview
		? buildSessionDetailOverviewViewModel(overview, userMap)
		: undefined;
	const errorState = getSessionDetailErrorState(initialQuery.error);
	const revision = overview?.revision;
	const readsLiveLines =
		revision !== undefined && isLiveSessionDetailRevision(revision);
	// The first lines of a session that just started may not have landed
	// when the detail was first asked for: the reader waits for them.
	const waitingForLiveLines =
		liveSession !== undefined &&
		hasSessionDetailErrorCode(initialQuery.error, "NOT_FOUND");
	const { refetch } = initialQuery;

	const handleStaleRevision = useCallback(() => {
		for (const queryKey of [
			...(revision
				? [sessionDetailRevisionQueryPrefix(sessionId, revision)]
				: []),
			sessionDetailBodyQueryPrefix(sessionId),
			sessionDetailWindowQueryPrefix(sessionId),
		]) {
			void queryClient.cancelQueries({ queryKey });
			queryClient.removeQueries({ queryKey });
		}
		void refetch();
	}, [queryClient, refetch, revision, sessionId]);

	return (
		// The app's content background (#fcfcfc), not the dashboard's 92% white
		// surface, so the page reads as one plane with the shell header above it.
		<div className="dashboardy-page flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--dashboard-01-content-background,#fcfcfc)] text-(--dashboardy-heading)">
			<SessionDetailHeader
				avatarMap={avatarMap}
				headerRef={() => undefined}
				hideMetrics
				isLoading={initialQuery.isLoading}
				navigation={navigation}
				portalHost={shellHeaderPortal}
				position={position}
				sessionId={sessionId}
				showIdentity={false}
				totalSessions={totalSessions}
				viewModel={viewModel}
			/>
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				{initialQuery.isLoading || waitingForLiveLines ? (
					<SessionReaderSkeleton />
				) : null}
				{!initialQuery.isLoading && errorState && !waitingForLiveLines ? (
					<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
						<p className="text-lg font-semibold">{errorState.title}</p>
						{errorState.description ? (
							<p className="text-sm text-muted-foreground">
								{errorState.description}
							</p>
						) : null}
						{canRetrySessionDetailError(initialQuery.error) ? (
							<Button
								className="mt-3"
								disabled={initialQuery.isFetching}
								onClick={() => void refetch()}
								size="sm"
								variant="outline"
							>
								{initialQuery.isFetching ? "Trying again…" : "Try again"}
							</Button>
						) : null}
					</div>
				) : null}
				{overview && viewModel && !errorState ? (
					<SessionReaderContent
						// A session read live keeps its reader across revisions, so
						// the page does not jump as lines land.
						key={
							readsLiveLines ? sessionId : `${sessionId}:${overview.revision}`
						}
						contextChips={
							<>
								{liveSession ? (
									<LiveSessionStatus session={liveSession} />
								) : null}
								<SessionContextFields viewModel={viewModel} />
							</>
						}
						emptyMessage={
							readsLiveLines
								? "Waiting for the first turn of this session."
								: undefined
						}
						followNewest={readsLiveLines && liveState === "running"}
						initialWindow={initialQuery.data?.initialDetail.window}
						model={viewModel.displayModel ?? null}
						onStaleRevision={handleStaleRevision}
						overview={overview}
						userImageUrl={avatarMap[viewModel.safeUserId]}
						userLabel={viewModel.safeUserDisplayName}
					/>
				) : null}
			</div>
		</div>
	);
}
