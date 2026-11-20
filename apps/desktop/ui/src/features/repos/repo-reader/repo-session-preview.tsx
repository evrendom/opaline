import { IconArrowUpRight, IconRefresh } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Reveal } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { sessionDetailInitialQueryOptions } from "@/features/sessions/components/session-detail-fast-query";
import type { NormalizedSessionDetailOverview } from "@/features/sessions/components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "@/features/sessions/components/use-session-detail-overview-pages";
import {
	ContextAreaHeight,
	ContextPreview,
	ContextToggleSlot,
} from "@/features/sessions/reader/context/session-reader-context-head";
import { ContextMapSample } from "@/features/sessions/reader/context/session-reader-context-map-sample";
import { AREA_HEIGHT } from "@/features/sessions/reader/context/session-reader-context-place";
import { SessionContext } from "@/features/sessions/reader/context/session-reader-context-session";
import {
	contextSnapshotOptions,
	StoredSessionContext,
	useStoredContextSnapshot,
} from "@/features/sessions/reader/context/session-reader-context-stored";
import { useSessionSummaryLinks } from "@/features/sessions/use-session-summary-links";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { useRepoData } from "./repo-page-data";

const LEAST_PREVIEW_AREA = 80;

const shortId = (sessionId: string) => sessionId.split("-")[0] ?? sessionId;

export function usePrefetchSessionPreview() {
	const queryClient = useQueryClient();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	return (sessionId: string) => {
		if (!organizationId) return;
		void queryClient.prefetchQuery(
			contextSnapshotOptions(organizationId, sessionId),
		);
	};
}

export function SessionPreview({ sessionId }: { sessionId: string }) {
	const getShellRoutePath = useShellRoutePath();
	const { repoKey } = useRepoData();
	const stored = useStoredContextSnapshot(sessionId);
	const live = stored.isError || (stored.isSuccess && stored.data === null);
	const initial = useQuery({
		...sessionDetailInitialQueryOptions(sessionId),
		enabled: live,
		retry: 1,
	});
	const overview = initial.data?.overview;
	const [toggleSlot, setToggleSlot] = useState<HTMLElement | null>(null);
	const failed = live && initial.isError && !overview;
	const content = stored.data ? (
		<StoredSessionContext sessionId={sessionId} snapshot={stored.data} />
	) : overview ? (
		<LiveSessionContext overview={overview} />
	) : null;
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2">
			<div className="@container/head flex h-7 min-w-0 shrink-0 items-center gap-1.5 px-[3px]">
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium">
					{shortId(sessionId)}
				</span>
				<span ref={setToggleSlot} className="mr-1.5 flex empty:hidden" />
				<Link
					to={getShellRoutePath(appRoutes.repoDetail(repoKey, sessionId))}
					aria-label="Open session"
					className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg bg-card pr-2 pl-2.5 text-xs font-medium text-muted-foreground shadow-(--custom-shadow) transition-colors corner-squircle outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 squircle:rounded-[14px] dark:bg-muted-foreground/10 @max-[30rem]/head:w-7 @max-[30rem]/head:px-0"
				>
					<span className="@max-[30rem]/head:sr-only">Open session</span>
					<IconArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
				</Link>
			</div>
			{failed ? (
				<EmptyState
					icon={IconRefresh}
					title="This session didn't load"
					description="Its detail took too long to come back."
					className="min-h-0 flex-1 rounded-md corner-squircle squircle:rounded-xl"
				>
					<button
						type="button"
						onClick={() => void initial.refetch()}
						className="mx-auto mt-2 inline-flex h-7 items-center rounded-md bg-muted/70 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						Try again
					</button>
				</EmptyState>
			) : (
				<ContextToggleSlot.Provider value={toggleSlot}>
					<FitContext>{content}</FitContext>
				</ContextToggleSlot.Provider>
			)}
		</div>
	);
}

function FitContext({ children }: { children: ReactNode }) {
	const ready = Boolean(children);
	const box = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [areaHeight, setAreaHeight] = useState(AREA_HEIGHT);
	useLayoutEffect(() => {
		const outer = box.current;
		const inner = content.current;
		if (!outer || !inner || !ready) return;
		const refit = () =>
			setAreaHeight((had) =>
				Math.max(
					LEAST_PREVIEW_AREA,
					Math.round(had + outer.clientHeight - inner.offsetHeight),
				),
			);
		refit();
		const observer = new ResizeObserver(refit);
		observer.observe(outer);
		observer.observe(inner);
		return () => observer.disconnect();
	}, [ready]);
	return (
		<div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
			<div className="absolute inset-0">
				<Reveal
					fill
					label="Loading session"
					loading={!children}
					sample={<ContextMapSample fill />}
					sampleId="repo-session-preview"
				>
					{() => (
						<div ref={content}>
							<ContextPreview.Provider value>
								<ContextAreaHeight.Provider value={areaHeight}>
									{children}
								</ContextAreaHeight.Provider>
							</ContextPreview.Provider>
						</div>
					)}
				</Reveal>
			</div>
		</div>
	);
}

function LiveSessionContext({
	overview,
}: {
	overview: NormalizedSessionDetailOverview;
}) {
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const links = useSessionSummaryLinks(overview.session.sessionId);
	return (
		<SessionContext
			measure="context"
			overview={overview}
			setup={links?.setup}
			turns={turns}
		/>
	);
}
