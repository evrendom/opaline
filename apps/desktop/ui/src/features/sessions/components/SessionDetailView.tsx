import type { SessionAnalytics } from "@rudel/api-routes";
import {
	type Icon,
	IconAlertTriangle,
	IconMessageOff,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	// biome-ignore lint/style/noRestrictedImports: the tab title must update when async session details reveal the model and when client-side navigation changes the session id.
	useEffect,
	useRef,
} from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { ConversationSkillLinkContext } from "@/components/conversation/conversation-skill-link";
import { EmptyState } from "@/components/dashboard/page-parts";
import { RetryButton } from "@/components/retry-button";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { getSessionUploadFailure } from "@/features/sessions/session-upload-failure";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { formatUsername } from "@/lib/format";
import { client } from "@/lib/orpc";
import { SessionContextChips } from "./session-context-chips";
import { SessionDetailFastContent } from "./session-detail-fast-content";
import {
	fetchSessionDetailInitial,
	sessionDetailBodyQueryPrefix,
	sessionDetailInitialQueryOptions,
	sessionDetailOverviewPageQueryKey,
	sessionDetailRevisionQueryPrefix,
	sessionDetailWindowQueryPrefix,
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

type SessionDetailViewProps = {
	/** Session page: the shell header carries the breadcrumb and the
	 *  session's identity sits in context chips above the detail. */
	fullPage?: boolean;
	showOverviewStrip?: boolean;
	initialSession?: SessionAnalytics;
	navigation: SessionNavigation | undefined;
	position: number | undefined;
	sessionId: string;
	totalSessions: number;
};

function SessionDetailStateMessage({
	description,
	icon,
	isRetrying = false,
	onRetry,
	title,
}: {
	description: string | undefined;
	icon: Icon;
	isRetrying?: boolean;
	onRetry?: () => void;
	title: string;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col p-[calc(var(--space-xxl)*4/3)]">
			<EmptyState description={description} icon={icon} title={title}>
				{onRetry ? (
					<RetryButton
						onRetry={onRetry}
						retrying={isRetrying}
						className="mx-auto mt-m"
					/>
				) : null}
			</EmptyState>
		</div>
	);
}

export function SessionDetailView({
	fullPage = false,
	showOverviewStrip = true,
	initialSession,
	navigation,
	position,
	sessionId,
	totalSessions,
}: SessionDetailViewProps) {
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
		...sessionDetailInitialQueryOptions(sessionId),
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
			<div className="dashboardy-page flex h-full min-h-0 min-w-0 flex-1 flex-col bg-canvas text-ink">
				<SessionDetailHeader
					avatarMap={avatarMap}
					headerRef={setHeaderElement}
					hideMetrics
					isLoading={isDetailLoading}
					navigation={navigation}
					portalHost={shellHeaderPortal}
					position={position}
					sessionId={sessionId}
					showIdentity={!fullPage}
					totalSessions={totalSessions}
					viewModel={viewModel}
				/>
				{fullPage ? (
					<SessionContextChips
						avatarUrl={viewModel ? avatarMap[viewModel.safeUserId] : undefined}
						isLoading={isDetailLoading}
						viewModel={viewModel}
					/>
				) : null}
				{relationshipsQuery.data?.parent ||
				relationshipsQuery.data?.children.length ? (
					<nav
						aria-label="Native subagent sessions"
						className="flex min-h-9 shrink-0 items-center gap-m overflow-x-auto whitespace-nowrap edge-b-m border-line px-xl text-body-m text-ink-3"
					>
						{relationshipsQuery.data.parent ? (
							<Link
								className="font-medium text-ink hover:underline"
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
								className="font-medium text-ink hover:underline"
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
							icon={IconAlertTriangle}
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
								<output className="edge-b-m border-warning-line bg-warning-tint px-xl py-m text-body-xl text-ink">
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
							description="It may have been deleted, or it never finished uploading."
							icon={IconMessageOff}
							title="Session not found"
						/>
					) : null}
				</div>
			</div>
		</ConversationSkillLinkContext.Provider>
	);
}
