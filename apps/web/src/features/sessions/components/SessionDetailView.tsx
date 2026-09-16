import type { SessionAnalytics } from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	// biome-ignore lint/style/noRestrictedImports: the tab title must update when async session details reveal the model and when client-side navigation changes the session id.
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/app/ui/button";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { useSessionOpenTracking } from "@/features/sessions/use-session-open-tracking";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
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
import { useSessionPaneFullscreen } from "./use-session-pane-fullscreen";

type SessionDetailViewProps = {
	initialSession?: SessionAnalytics;
	navigation: SessionNavigation;
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
	const overviewQuery = useQuery({
		enabled: sessionId.length > 0,
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
	const viewModel = overview
		? buildSessionDetailOverviewViewModel(overview, userMap)
		: initialSession
			? buildSessionDetailViewModel(initialSession, userMap)
			: undefined;
	const sessionTabTitle = `${
		viewModel?.displayModel
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
		isLoading: overviewQuery.isLoading,
		error: overviewQuery.error,
		hasData: Boolean(overview),
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
				isLoading={overviewQuery.isLoading}
				navigation={navigation}
				portalHost={shellHeaderPortal}
				position={position}
				sessionId={sessionId}
				totalSessions={totalSessions}
				viewModel={viewModel}
			/>

			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				{overviewQuery.isLoading ? <SessionDetailContentLoadingView /> : null}
				{!overviewQuery.isLoading && errorState ? (
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
				{!overviewQuery.isLoading && !errorState && overview && viewModel ? (
					<div className="flex h-full min-h-0 flex-col">
						{hasShapeWarning ? (
							<output className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-(--dashboardy-heading)">
								Some session fields were unavailable. Safe overview values are
								shown.
							</output>
						) : null}
						<div className="min-h-0 flex-1">
							<SessionDetailFastContent
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
				{!overviewQuery.isLoading && !errorState && !overview ? (
					<SessionDetailStateMessage
						description={undefined}
						title="Session Not Found"
					/>
				) : null}
			</div>
		</div>
	);
}
