import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Button } from "@/app/ui/button";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import {
	useLiveSessionState,
	useLiveSessionTailPolling,
} from "../use-live-sessions";
import { LiveSessionErrorBoundary } from "./live-session-error-boundary";
import { LiveSessionSlot } from "./live-session-panel";
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

/**
 * The reader layout of a session: a calm, chat-style transcript with a sticky
 * rail of session facts and per-turn status.
 * It reads the session-detail queries the repo and skill pages' embedded
 * session view reads, so the two share one cache.
 * A session that is still running shows its live lines: in place of the
 * reader until the session is uploaded, and above it while an uploaded
 * session runs again.
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
	// Live lines are extra: without them, or when they fail, the page is as
	// before. The reader re-renders only when the live state changes; the
	// live slots follow the lines themselves.
	useLiveSessionTailPolling(sessionId);
	const liveState = useLiveSessionState(sessionId);
	const initialQuery = useQuery({
		enabled: sessionId.length > 0,
		queryFn: ({ signal }) => fetchSessionDetailInitial(sessionId, signal),
		queryKey: sessionDetailInitialQueryKey(sessionId),
		retry: shouldRetrySessionDetailFastQuery,
		staleTime: SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
	});
	const overview = initialQuery.data?.overview;
	const viewModel = overview
		? buildSessionDetailOverviewViewModel(overview, userMap)
		: undefined;
	const errorState = getSessionDetailErrorState(initialQuery.error);
	const liveInsteadOfMissing =
		liveState !== "none" &&
		hasSessionDetailErrorCode(initialQuery.error, "NOT_FOUND");
	const revision = overview?.revision;
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
				navigation={liveInsteadOfMissing ? undefined : navigation}
				portalHost={shellHeaderPortal}
				position={position}
				sessionId={sessionId}
				showIdentity={false}
				totalSessions={totalSessions}
				viewModel={viewModel}
			/>
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{liveState !== "none" &&
				liveState !== "ended" &&
				overview &&
				!errorState ? (
					<LiveSessionErrorBoundary>
						<LiveSessionSlot
							avatarMap={avatarMap}
							layout="inline"
							sessionId={sessionId}
							userMap={userMap}
						/>
					</LiveSessionErrorBoundary>
				) : null}
				<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
					{initialQuery.isLoading ? <SessionReaderSkeleton /> : null}
					{!initialQuery.isLoading && liveInsteadOfMissing ? (
						<LiveSessionErrorBoundary
							fallback={<SessionReaderMessage title="Session Not Found" />}
						>
							<LiveSessionSlot
								avatarMap={avatarMap}
								layout="page"
								sessionId={sessionId}
								userMap={userMap}
							/>
						</LiveSessionErrorBoundary>
					) : null}
					{!initialQuery.isLoading && errorState && !liveInsteadOfMissing ? (
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
							key={`${sessionId}:${overview.revision}`}
							contextChips={<SessionContextFields viewModel={viewModel} />}
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
		</div>
	);
}

function SessionReaderMessage({ title }: { title: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
			<p className="text-lg font-semibold">{title}</p>
		</div>
	);
}
