import {
	isLiveSessionDetailRevision,
	liveSessionDetailRevision,
} from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	memo,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { appRoutes } from "@/app/routes";
import { Reveal } from "@/app/ui/bones";
import { ConversationSkillLinkContext } from "@/components/conversation/conversation-skill-link";
import { RetryButton } from "@/components/retry-button";
import type { SessionNavigation } from "@/features/sessions/session-navigation";
import { useSessionSummaryLinks } from "@/features/sessions/use-session-summary-links";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useShellHeaderPortal } from "@/features/shell/shell-header-portal";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { cn } from "@/lib/utils";
import { SessionWhere } from "../components/session-context-chips";
import {
	sessionDetailBodyQueryPrefix,
	sessionDetailInitialQueryOptions,
	sessionDetailRevisionQueryPrefix,
	sessionDetailWindowQueryPrefix,
} from "../components/session-detail-fast-query";
import { SessionDetailHeader } from "../components/session-detail-header";
import { buildSessionDetailOverviewViewModel } from "../components/session-detail-overview-model";
import { hasSessionDetailErrorCode } from "../components/session-detail-response";
import {
	canRetrySessionDetailError,
	getSessionDetailErrorState,
} from "../components/session-detail-view-utils";
import {
	useLiveSession,
	useLiveSessionPolling,
	useLiveSessionState,
} from "../use-live-sessions";
import { usePrefetchFileChanges } from "../use-prefetch-file-changes";
import { useCiAccess } from "../use-session-run-ci";
import { SessionReaderCiView } from "./ci/session-reader-ci-view";
import { useStoredContextSnapshot } from "./context/session-reader-context-stored";
import { SessionReaderContent } from "./detail/session-reader-content";
import { SessionReaderFilesView } from "./files/session-reader-files-view";
import { createActiveTurnStore } from "./rail/session-reader-turn-rail";
import type { SessionReaderTab } from "./reader-params";
import {
	findMcpSetupFile,
	pullRequestKey,
	type SessionPlaces,
	SessionPlacesContext,
} from "./session-places";
import { SessionInRepo } from "./session-reader-in-repo";
import { ReaderSample } from "./session-reader-skeleton";
import { SessionReaderTabRow } from "./session-reader-tab-row";
import { useReaderPick, useSessionReaderTab } from "./session-reader-tabs";
import { SessionReaderSetupView } from "./setup/session-reader-setup-view";
import { findSkillSetupFile } from "./setup/session-setup-files";
import { SubagentsCountedProvider } from "./subagents/session-reader-subagents-counted";
import { SessionReaderSummary } from "./summary/session-reader-summary";

const TAB_BAND_LEFT: Record<SessionReaderTab, string> = {
	ci: "left-(--reader-main-left)",
	detail: "left-(--reader-main-left)",
	files: "left-(--reader-main-left)",
	setup: "left-(--reader-main-left)",
	summary: "left-(--reader-main-left)",
};

const TAB_BAND_FROM: Record<SessionReaderTab, string> = {
	ci: "left-[calc(2rem+var(--reader-rail)+0.5rem)] pl-xl",
	detail: "left-[calc(2rem+var(--reader-rail)+0.5rem)] pl-xl",
	files: "left-[calc(2rem+var(--reader-rail)+0.5rem)] pl-xl",
	setup: "left-[calc(2rem+var(--reader-rail)+0.5rem)] pl-xl",
	summary: "left-[calc(2rem+var(--reader-rail)+0.5rem)] pl-xl",
};

const LIVE_REREAD_DELAY_MS = 1_000;

export const SessionReaderView = memo(function SessionReaderView({
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
	const {
		ciPicks,
		hrefs,
		openCi,
		openFiles,
		openSetup,
		openSubagent,
		openTurn,
		selectTab,
		setupFile,
		tab: requestedTab,
	} = useSessionReaderTab();
	const ciAccess = useCiAccess(sessionId);
	const tab =
		requestedTab === "ci" && ciAccess === "off" ? "summary" : requestedTab;
	const links = useSessionSummaryLinks(sessionId);
	useStoredContextSnapshot(sessionId);
	useLiveSessionPolling(sessionId);
	const liveState = useLiveSessionState(sessionId);
	const live = useLiveSession(sessionId);
	const liveSession = live?.session ?? undefined;
	const liveRevision = liveSession
		? liveSessionDetailRevision(liveSession)
		: undefined;
	const liveUploaded = live?.uploaded === true;
	const initialQuery = useQuery({
		...sessionDetailInitialQueryOptions(sessionId),
		enabled: sessionId.length > 0,
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
	});
	const overview = initialQuery.data?.overview;
	const viewModel = useMemo(
		() =>
			overview
				? buildSessionDetailOverviewViewModel(overview, userMap)
				: undefined,
		[overview, userMap],
	);
	const errorState = getSessionDetailErrorState(initialQuery.error);
	const revision = overview?.revision;
	usePrefetchFileChanges(sessionId, revision ?? "");
	const readsLiveLines =
		revision !== undefined && isLiveSessionDetailRevision(revision);
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

	const getShellRoutePath = useShellRoutePath();
	const setup = links?.setup;
	const pullRequests = links?.pullRequests;
	const getSkillHref = useCallback(
		(name: string, turnId?: string) => {
			const body = setup ? findSkillSetupFile(setup, name) : null;
			return body
				? hrefs.setup(body.setupFile)
				: getShellRoutePath(appRoutes.skillDetail(name, sessionId, turnId));
		},
		[getShellRoutePath, hrefs, sessionId, setup],
	);
	const openers = useRef({ openCi, openFiles, openSetup, openSubagent });
	openers.current = { openCi, openFiles, openSetup, openSubagent };
	const places = useMemo<SessionPlaces>(
		() => ({
			hrefs,
			openCi: (picks) => openers.current.openCi(picks),
			openFile: (picks) => openers.current.openFiles(picks),
			openSetup: (setupFile) => openers.current.openSetup(setupFile),
			openSubagent: (subagentId) => openers.current.openSubagent(subagentId),
			mcpSetupFile: (server) =>
				setup ? findMcpSetupFile(setup, server) : null,
			revision: revision ?? "",
			sessionId,
			pullRequestOf: (number) => {
				const matching = (pullRequests ?? []).filter(
					(pull) => pull.number === number,
				);
				const only = matching.length === 1 ? matching[0] : undefined;
				return only ? pullRequestKey(only.repository, only.number) : null;
			},
			skillSetupFile: (name) =>
				(setup ? findSkillSetupFile(setup, name) : null)?.setupFile ?? null,
		}),
		[hrefs, pullRequests, revision, sessionId, setup],
	);
	const [reading] = useState(createActiveTurnStore);
	const { agent: readAgent } = useReaderPick();
	const [summaryOpened, setSummaryOpened] = useState(tab === "summary");
	if (tab === "summary" && !summaryOpened) setSummaryOpened(true);
	const changeTab = (next: SessionReaderTab) =>
		selectTab(next, tab === "detail" && !readAgent ? reading.get() : null);
	const inRepo = useContext(SessionInRepo);
	const contextFields =
		viewModel && !inRepo ? (
			<span className="flex items-center gap-s text-body-xl">
				<SessionWhere viewModel={viewModel} />
			</span>
		) : null;

	return (
		<SessionPlacesContext.Provider value={places}>
			<SubagentsCountedProvider>
				<ConversationSkillLinkContext.Provider value={getSkillHref}>
					<div className="dashboardy-page flex h-full min-h-0 min-w-0 flex-1 flex-col bg-canvas text-ink [--reader-page:var(--canvas)]">
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
							where={contextFields}
						/>
						<div className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden [--dashboard-01-content-background:var(--dashboard-01-stage-background)] [--panes-top:calc(var(--stage-top)-0.125rem)] [--stage-top:--spacing(13)] [--tabs-band:--spacing(19)]">
							<div
								aria-hidden="true"
								className={cn(
									"absolute top-(--stage-top) right-0 bottom-0 -z-10",
									"-ml-xxl corner-tl-m corner-squircle",
									"pointer-events-none bg-(--dashboard-01-stage-background)",
									"squircle:corner-tl-xl",
									TAB_BAND_LEFT[tab],
								)}
							/>
							<div
								className={cn(
									"absolute top-0 right-0 z-50 flex h-(--stage-top) justify-start",
									"pt-xl pr-[calc(var(--space-xxl)*4/3)]",
									"bg-(--reader-page)",
									TAB_BAND_FROM[tab],
								)}
							>
								<div className="flex h-7 items-center">
									<SessionReaderTabRow
										ci={ciAccess === "on"}
										model={viewModel?.displayModel ?? null}
										onChange={changeTab}
										overview={overview}
										reading={reading}
										value={tab}
									/>
								</div>
							</div>
							{!initialQuery.isLoading && errorState && !waitingForLiveLines ? (
								<div
									className={cn(
										"flex h-full flex-col items-center justify-center gap-m",
										"px-xxl",
										"text-center",
									)}
								>
									<p className="text-body-xxl font-heavy">{errorState.title}</p>
									{errorState.description ? (
										<p className="text-body-xl text-ink-3">
											{errorState.description}
										</p>
									) : null}
									{canRetrySessionDetailError(initialQuery.error) ? (
										<RetryButton
											onRetry={() => void refetch()}
											retrying={initialQuery.isFetching}
											className="mt-l"
										/>
									) : null}
								</div>
							) : null}
							{errorState &&
							!initialQuery.isLoading &&
							!waitingForLiveLines ? null : (
								<Reveal
									fill
									label="Loading session"
									loading={initialQuery.isLoading || waitingForLiveLines}
									sample={<ReaderSample tab={tab} />}
									sampleId={`session-reader-${tab}`}
								>
									{() => (
										<>
											{overview && viewModel && !errorState && summaryOpened ? (
												<Activity
													mode={tab === "summary" ? "visible" : "hidden"}
												>
													<SessionReaderSummary
														model={viewModel.displayModel ?? null}
														onOpenFiles={openFiles}
														onOpenSetup={openSetup}
														onOpenTurn={openTurn}
														overview={overview}
													/>
												</Activity>
											) : null}
											{overview && viewModel && !errorState ? (
												tab === "summary" ? null : tab === "ci" ? (
													<SessionReaderCiView
														model={viewModel.displayModel ?? null}
														onOpenTurn={openTurn}
														overview={overview}
														picked={ciPicks}
													/>
												) : tab === "setup" ? (
													<SessionReaderSetupView
														model={viewModel.displayModel ?? null}
														onOpenTurn={openTurn}
														onPick={openSetup}
														overview={overview}
														picked={setupFile}
														sessionId={sessionId}
														setup={links?.setup}
													/>
												) : tab === "files" ? (
													<SessionReaderFilesView
														model={viewModel.displayModel ?? null}
														onOpenTurn={openTurn}
														overview={overview}
													/>
												) : (
													<SessionReaderContent
														key={
															readsLiveLines
																? sessionId
																: `${sessionId}:${overview.revision}`
														}
														emptyMessage={
															readsLiveLines
																? "Waiting for the first turn of this session."
																: undefined
														}
														followNewest={
															readsLiveLines && liveState === "running"
														}
														initialWindow={
															initialQuery.data?.initialDetail.window
														}
														model={viewModel.displayModel ?? null}
														onStaleRevision={handleStaleRevision}
														reading={reading}
														overview={overview}
														userImageUrl={avatarMap[viewModel.safeUserId]}
														userLabel={viewModel.safeUserDisplayName}
													/>
												)
											) : null}
										</>
									)}
								</Reveal>
							)}
						</div>
					</div>
				</ConversationSkillLinkContext.Provider>
			</SubagentsCountedProvider>
		</SessionPlacesContext.Provider>
	);
});
