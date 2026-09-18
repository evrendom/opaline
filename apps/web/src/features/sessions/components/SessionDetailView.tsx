import type { SessionAnalytics } from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	// biome-ignore lint/style/noRestrictedImports: the tab title must update when async session details reveal the model and when client-side navigation changes the session id.
	useEffect,
	useRef,
	useState,
} from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Button } from "@/app/ui/button";
import { ConversationSkillLinkContext } from "@/components/conversation/conversation-skill-link";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { getSessionUploadFailure } from "@/features/sessions/session-upload-failure";
import { useSessionOpenTracking } from "@/features/sessions/use-session-open-tracking";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { formatUsername } from "@/lib/format";
import { client } from "@/lib/orpc";
import { SessionDetailFastContent } from "./session-detail-fast-content";
import {
	fetchSessionDetailInitial,
	SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
	sessionDetailBodyQueryPrefix,
	sessionDetailInitialQueryKey,
	sessionDetailOverviewPageQueryKey,
	sessionDetailRevisionQueryPrefix,
	sessionDetailWindowQueryPrefix,
	shouldRetrySessionDetailFastQuery,
} from "./session-detail-fast-query";
import { SessionDetailHeader } from "./session-detail-header";
import { SessionDetailContentLoadingView } from "./session-detail-loading";
import { buildSessionDetailOverviewViewModel } from "./session-detail-overview-model";
import { buildSessionDetailViewModel } from "./session-detail-view-model";
import {
	canRetrySessionDetailError,
	getSessionDetailErrorState,
} from "./session-detail-view-utils";
import { SessionUploadFailureDetail } from "./session-upload-failure-detail";
import { useSessionPaneFullscreen } from "./use-session-pane-fullscreen";

type SessionDetailViewProps = {
	showOverviewStrip?: boolean;
	initialSession?: SessionAnalytics;
	navigation: SessionNavigation | undefined;
	onClose: (() => void) | undefined;
	position: number | undefined;
	sessionId: string;
	totalSessions: number;
};

function SessionDetailStateMessage({
	description,
	isRetrying = false,
	onRetry,
	title,
}: {
	description: string | undefined;
	isRetrying?: boolean;
	onRetry?: () => void;
	title: string;
}) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-12">
			<div className="dashboardy-card rounded-[1.5rem] border px-8 py-10 text-center shadow-none">
				<p className="mb-2 text-lg font-semibold text-(--dashboardy-heading)">
					{title}
				</p>
				{description ? (
					<p className="text-sm text-(--dashboardy-muted)">{description}</p>
				) : null}
				{onRetry ? (
					<Button
						className="mt-5"
						disabled={isRetrying}
						onClick={onRetry}
						size="sm"
						type="button"
						variant="outline"
					>
						{isRetrying ? "Trying again…" : "Try again"}
					</Button>
				) : null}
			</div>
		</div>
	);
}

export function SessionDetailView({
	showOverviewStrip = true,
	initialSession,
	navigation,
	onClose,
	position,
	sessionId,
	totalSessions,
}: SessionDetailViewProps) {
	const { contentRef, isFullscreen, toggleFullscreen } =
		useSessionPaneFullscreen();
	const headerRef = useRef<HTMLElement>(null);
	const responseScrollRef = useRef<HTMLDivElement>(null);
	const preservedTurnIdRef = useRef<string | undefined>(undefined);
	const shellHeaderPortal = useShellHeaderPortal();
	const getShellRoutePath = useShellRoutePath();
	const getSkillHref = useCallback(
		(name: string, turnId?: string) =>
			getShellRoutePath(appRoutes.skillDetail(name, sessionId, turnId)),
		[getShellRoutePath, sessionId],
	);
	const queryClient = useQueryClient();
	const [cacheHit] = useState(
		() =>
			queryClient.getQueryData(sessionDetailInitialQueryKey(sessionId)) !==
			undefined,
	);
	const handleHeaderWheel = useCallback((event: WheelEvent) => {
		if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (responseScrollRef.current) {
			responseScrollRef.current.scrollTop += event.deltaY;
		}
	}, []);
	const setHeaderElement = useCallback(
		(element: HTMLElement | null) => {
			headerRef.current?.removeEventListener("wheel", handleHeaderWheel);
			headerRef.current = element;
			element?.addEventListener("wheel", handleHeaderWheel, { passive: false });
		},
		[handleHeaderWheel],
	);
	const { userMap, avatarMap } = useUserMap();
	const { state: organization } = useOrganization();
	const relationshipsQuery = useQuery({
		enabled: Boolean(organization.activeOrg?.id && sessionId),
		queryFn: () => client.analytics.sessions.detailRelationships({ sessionId }),
		queryKey: [
			"org",
			organization.activeOrg?.id,
			"session-native-relationships",
			sessionId,
		],
	});
	const knownFailure = initialSession?.upload_failure;
	const failureQuery = useQuery({
		queryKey: ["session-upload-failure", organization.activeOrg?.id, sessionId],
		enabled:
			!!organization.activeOrg?.id &&
			(Boolean(knownFailure) || !initialSession),
		queryFn: () =>
			client.analytics.sessions.uploadFailures({
				sessionId,
				offset: 0,
				limit: 1,
			}),
		initialData: knownFailure
			? { failures: [knownFailure], hasMore: false }
			: undefined,
		refetchInterval: (query) =>
			query.state.data?.failures.length ? 10_000 : false,
	});
	const failure = getSessionUploadFailure(
		sessionId,
		initialSession,
		failureQuery.data?.failures,
	);
	const overviewQuery = useQuery({
		enabled:
			sessionId.length > 0 &&
			!failure &&
			(!knownFailure || failureQuery.isSuccess),
		queryFn: async ({ signal }) => {
			const parsed = await fetchSessionDetailInitial(sessionId, signal);
			queryClient.setQueryData(
				sessionDetailOverviewPageQueryKey({
					revision: parsed.overview.revision,
					sessionId,
					turnCursor: "first",
				}),
				parsed,
			);
			return parsed;
		},
		queryKey: sessionDetailInitialQueryKey(sessionId),
		retry: shouldRetrySessionDetailFastQuery,
		staleTime: SESSION_DETAIL_OVERVIEW_STALE_TIME_MS,
	});
	const overview = overviewQuery.data?.overview;
	const isDetailLoading =
		!failure &&
		(overviewQuery.isLoading || (!overview && failureQuery.isFetching));
	const viewModel = failure
		? buildSessionDetailViewModel(
				{
					session_id: failure.sessionId,
					user_id: failure.userId,
					source: failure.source,
					repository: failure.repository,
					project_path: failure.projectPath,
					git_branch: failure.gitBranch,
					git_sha: failure.gitSha,
					session_date: failure.sessionDate,
				},
				userMap,
			)
		: overview
			? buildSessionDetailOverviewViewModel(overview, userMap)
			: initialSession
				? buildSessionDetailViewModel(initialSession, userMap)
				: undefined;
	const sessionTabTitle = `${
		failure
			? "Upload failed"
			: viewModel?.displayModel
				? formatModelDisplayLabel(viewModel.displayModel)
				: "Session"
	} · ${sessionId}`;

	useEffect(() => {
		const previousTitle = document.title;
		document.title = sessionTabTitle;
		return () => {
			document.title = previousTitle;
		};
	}, [sessionTabTitle]);

	useSessionOpenTracking({
		sessionId,
		isLoading: isDetailLoading,
		error: failure ? null : overviewQuery.error,
		hasData: Boolean(failure || overview),
		cacheHit,
		requestTiming: overviewQuery.data?.loadingTiming,
		turnCount: overview?.turnPage.total,
	});

	function handleStaleRevision(error: unknown, selectedTurnId?: string) {
		preservedTurnIdRef.current = selectedTurnId;
		if (overview) {
			void queryClient.cancelQueries({
				queryKey: sessionDetailRevisionQueryPrefix(
					sessionId,
					overview.revision,
				),
			});
			queryClient.removeQueries({
				queryKey: sessionDetailRevisionQueryPrefix(
					sessionId,
					overview.revision,
				),
			});
		}
		void queryClient.cancelQueries({
			queryKey: sessionDetailBodyQueryPrefix(sessionId),
		});
		queryClient.removeQueries({
			queryKey: sessionDetailBodyQueryPrefix(sessionId),
		});
		void queryClient.cancelQueries({
			queryKey: sessionDetailWindowQueryPrefix(sessionId),
		});
		queryClient.removeQueries({
			queryKey: sessionDetailWindowQueryPrefix(sessionId),
		});
		console.info("[SessionDetailView] Refreshing a stale session revision", {
			code:
				typeof error === "object" && error !== null && "code" in error
					? error.code
					: "STALE_REVISION",
			sessionId,
		});
		void overviewQuery.refetch();
	}

	const errorState = getSessionDetailErrorState(overviewQuery.error);
	const hasShapeWarning =
		(overviewQuery.data?.shapeIssueFields.length ?? 0) > 0;

	return (
		<ConversationSkillLinkContext.Provider value={getSkillHref}>
			<div
				className="dashboardy-page flex h-full min-h-0 min-w-0 flex-1 flex-col bg-(--dashboardy-surface) text-(--dashboardy-heading)"
				ref={contentRef}
				data-session-detail-fullscreen={isFullscreen ? "" : undefined}
			>
				<SessionDetailHeader
					avatarMap={avatarMap}
					displayControls={
						onClose
							? {
									isFullscreen,
									onClose,
									onToggleFullscreen: toggleFullscreen,
								}
							: undefined
					}
					headerRef={setHeaderElement}
					hideMetrics
					isLoading={isDetailLoading}
					navigation={navigation}
					portalHost={shellHeaderPortal}
					position={position}
					sessionId={sessionId}
					totalSessions={totalSessions}
					viewModel={viewModel}
				/>
				{relationshipsQuery.data?.parent ||
				relationshipsQuery.data?.children.length ? (
					<nav
						aria-label="Native subagent sessions"
						className="flex min-h-9 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-(--dashboardy-border) px-4 text-xs text-(--dashboardy-muted)"
					>
						{relationshipsQuery.data.parent ? (
							<Link
								className="font-medium text-(--dashboardy-heading) hover:underline"
								to={getShellRoutePath(
									appRoutes.sessionDetail(
										relationshipsQuery.data.parent.sessionId,
									),
								)}
							>
								Parent session
							</Link>
						) : null}
						{relationshipsQuery.data.children.map((child, index) => (
							<Link
								key={child.sessionId}
								className="font-medium text-(--dashboardy-heading) hover:underline"
								to={getShellRoutePath(appRoutes.sessionDetail(child.sessionId))}
							>
								{child.agentPath?.split("/").at(-1) || `Subagent ${index + 1}`}
							</Link>
						))}
					</nav>
				) : null}

				<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
					{failure ? (
						<SessionUploadFailureDetail
							failure={failure}
							userLabel={formatUsername(failure.userId, userMap)}
						/>
					) : null}
					{isDetailLoading ? (
						<SessionDetailContentLoadingView
							showOverviewStrip={showOverviewStrip}
						/>
					) : null}
					{!failure &&
					!overviewQuery.isLoading &&
					!failureQuery.isFetching &&
					errorState ? (
						<SessionDetailStateMessage
							description={errorState.description}
							isRetrying={overviewQuery.isFetching}
							onRetry={
								canRetrySessionDetailError(overviewQuery.error)
									? () => {
											void overviewQuery.refetch();
										}
									: undefined
							}
							title={errorState.title}
						/>
					) : null}
					{!failure &&
					!overviewQuery.isLoading &&
					!errorState &&
					overview &&
					viewModel ? (
						<div className="flex h-full min-h-0 flex-col">
							{hasShapeWarning ? (
								<output className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-(--dashboardy-heading)">
									Some session fields were unavailable. Safe overview values are
									shown.
								</output>
							) : null}
							<div className="min-h-0 flex-1">
								<SessionDetailFastContent
									showOverviewStrip={showOverviewStrip}
									key={`${sessionId}:${overview.revision}`}
									firstOverview={overview}
									initialDetail={overviewQuery.data?.initialDetail}
									initialSelectedTurnId={preservedTurnIdRef.current}
									onStaleRevision={handleStaleRevision}
									responseScrollRef={responseScrollRef}
									userImageUrl={avatarMap[viewModel.safeUserId]}
									userMap={userMap}
								/>
							</div>
						</div>
					) : null}
					{!failure &&
					!overviewQuery.isLoading &&
					!failureQuery.isFetching &&
					!errorState &&
					!overview ? (
						<SessionDetailStateMessage
							description={undefined}
							title="Session Not Found"
						/>
					) : null}
				</div>
			</div>
		</ConversationSkillLinkContext.Provider>
	);
}
