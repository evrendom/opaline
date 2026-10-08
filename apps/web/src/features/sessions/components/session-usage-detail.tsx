import type { SessionListInput } from "@rudel/api-routes";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
	type CSSProperties,
	type ReactNode,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/app/ui/button";
import {
	HorizontalResizeHandle,
	useElementWidth,
	useStoredPaneSize,
} from "@/components/ui/horizontal-resize-handle";
import { clampPaneSize } from "@/components/ui/horizontal-resize-utils";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { SessionDetailView } from "@/features/sessions/components/SessionDetailView";
import {
	MINIMUM_SESSION_TRANSCRIPT_PANE_WIDTH_PX,
	MINIMUM_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	SESSION_DETAIL_RESIZE_HANDLE_WIDTH_PX,
} from "@/features/sessions/components/session-detail-pane-sizing";
import { SessionDetailErrorBoundary } from "@/features/sessions/components/session-detail-view-parts";
import { SessionsOverviewTable } from "@/features/sessions/components/sessions-overview-table";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import {
	ShellHeaderPortalContext,
	useShellHeaderPortal,
} from "@/features/shell/shell-header-portal";
import { useCanViewSession } from "@/features/workspace/hooks/useCanViewSession";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

const PAGE_SIZE = 50;
const DEFAULT_USAGE_WIDTH = 880;
const MINIMUM_USAGE_WIDTH = 320;
interface UsagePaneStyle extends CSSProperties {
	"--usage-pane-width": string;
}

export function SessionUsageDetail({
	name,
	kind,
	sessionFilter,
	sessionCount,
	detailHref,
	onBack,
	children,
}: {
	name: string;
	kind: "Skill" | "Repo";
	sessionFilter: Pick<SessionListInput, "skillName" | "repoKey">;
	sessionCount: number | undefined;
	detailHref: (sessionId?: string) => string;
	onBack: () => void;
	children: ReactNode;
}) {
	const headerPortal = useShellHeaderPortal();
	const shellRoute = useCurrentShellRoute();
	const [sessionHeaderPortal, setSessionHeaderPortal] =
		useState<HTMLDivElement | null>(null);
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedSessionId = searchParams.get("session");
	function selectSession(sessionId: string | null) {
		setSearchParams((current) => {
			const next = new URLSearchParams(current);
			if (sessionId) next.set("session", sessionId);
			else next.delete("session");
			next.delete("turn");
			return next;
		});
	}
	const getShellRoutePath = useShellRoutePath();
	const canViewSession = useCanViewSession();
	const { state } = useOrganization();
	const demo = useDemoRuntime();
	const layoutRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const layoutWidth = useElementWidth(layoutRef);
	const [storedWidth, setStoredWidth] = useStoredPaneSize(
		`opaline:${kind.toLowerCase()}-usage-width`,
		DEFAULT_USAGE_WIDTH,
	);
	const maximum = Math.max(MINIMUM_USAGE_WIDTH, layoutWidth - 422);
	const minimum = selectedSessionId
		? Math.min(
				maximum,
				MINIMUM_SESSION_TURN_TABLE_PANE_WIDTH_PX +
					SESSION_DETAIL_RESIZE_HANDLE_WIDTH_PX +
					MINIMUM_SESSION_TRANSCRIPT_PANE_WIDTH_PX,
			)
		: MINIMUM_USAGE_WIDTH;
	const usageWidth = clampPaneSize(storedWidth, minimum, maximum);
	const paneStyle: UsagePaneStyle = {
		"--usage-pane-width": `${usageWidth}px`,
	};
	const options = orpc.analytics.sessions.list.infiniteOptions({
		input: (offset: number) => ({
			...sessionFilter,
			startDate: "1970-01-01",
			endDate: "2100-01-01",
			limit: PAGE_SIZE,
			offset,
		}),
		initialPageParam: 0,
		getNextPageParam: (lastPage, _pages, offset) =>
			lastPage.length === PAGE_SIZE ? offset + lastPage.length : undefined,
	});
	const sessionsQuery = useInfiniteQuery({
		...options,
		queryKey: ["org", state.activeOrg?.id, ...options.queryKey],
		enabled: !!state.activeOrg?.id && demo?.live !== false,
	});
	const sessions = useMemo(() => {
		const rows =
			sessionsQuery.data?.pages.flatMap(parseSessionOverviewRows) ?? [];
		return [
			...new Map(
				rows.map((row) => [
					`${row.user_id}:${row.source}:${row.session_id}`,
					row,
				]),
			).values(),
		];
	}, [sessionsQuery.data]);

	return (
		<>
			{headerPortal
				? createPortal(
						// Detail breadcrumb, as on the session page: the section's
						// chip and muted name lead back to the list (lifting only their text
						// on hover, outside the header's fluid fill); the name is the title.
						<nav
							aria-label={`${kind} breadcrumb`}
							className="flex min-w-0 flex-1 items-center gap-1.5 text-base font-medium tracking-tight"
						>
							<button
								type="button"
								onClick={onBack}
								data-fluid-menu-root=""
								className="flex shrink-0 cursor-pointer items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
							>
								<ShellNavIcon
									icon={shellRoute.icon}
									activeIcon={shellRoute.activeIcon}
									active={false}
									tone={shellRoute.tone}
								/>
								{shellRoute.title}
							</button>
							<IconChevronRight
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground/50"
								stroke={1.5}
							/>
							<span aria-current="page" className="truncate">
								{name}
							</span>
						</nav>,
						headerPortal,
					)
				: null}
			<div
				ref={layoutRef}
				style={paneStyle}
				className={`dashboardy-page ${SESSION_OVERVIEW_SURFACE_CLASS_NAME}`}
			>
				<div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(200px,40%)_minmax(0,1fr)] md:grid-cols-[var(--usage-pane-width)_2px_minmax(0,1fr)] md:grid-rows-1">
					<section
						aria-label={
							selectedSessionId ? `${kind} session` : `${kind} usage instances`
						}
						className="flex min-h-0 min-w-0 flex-col overflow-hidden [&_[data-conversation-trace-scroll-container]]:overscroll-none"
					>
						{selectedSessionId ? (
							<ShellHeaderPortalContext.Provider value={sessionHeaderPortal}>
								<div className="flex h-12 shrink-0 items-center gap-2 border-b border-(--session-overview-border) px-3">
									<Button
										aria-label={`Back to ${kind.toLowerCase()} sessions`}
										title={`Back to ${kind.toLowerCase()} sessions`}
										variant="ghost"
										size="icon-sm"
										onClick={() => selectSession(null)}
									>
										<IconChevronLeft size={16} />
									</Button>
									<div
										ref={setSessionHeaderPortal}
										className="flex min-w-0 flex-1"
									/>
								</div>
								<SessionDetailErrorBoundary
									key={selectedSessionId}
									fallbackHref={getShellRoutePath(detailHref())}
								>
									<SessionDetailView
										initialSession={sessions.find(
											(session) => session.session_id === selectedSessionId,
										)}
										navigation={undefined}
										position={undefined}
										sessionId={selectedSessionId}
										showOverviewStrip={false}
										totalSessions={0}
									/>
								</SessionDetailErrorBoundary>
							</ShellHeaderPortalContext.Provider>
						) : null}
						<div
							className={
								selectedSessionId ? "hidden" : "flex min-h-0 flex-1 flex-col"
							}
						>
							<SessionsOverviewTable
								activeSessionId={null}
								canOpenSession={(session) => canViewSession(session.user_id)}
								getSessionHref={(session) =>
									getShellRoutePath(detailHref(session.session_id))
								}
								getSessionLinkState={undefined}
								isLoading={sessionsQuery.isPending}
								onSessionClick={undefined}
								scrollContainerRef={scrollRef}
								sessionCountLabel={sessionCount ?? sessions.length}
								sessions={sessions}
								sessionDetailDisabledNote={
									sessionsQuery.isError && !sessionsQuery.data
										? "Sessions couldn’t load."
										: undefined
								}
								totalSessionCount={sessionCount ?? sessions.length}
								showDateControl={false}
								showSkillsColumn={false}
								pagination={{
									hasNextPage: sessionsQuery.hasNextPage,
									isFetching: sessionsQuery.isFetching,
									isError: sessionsQuery.isFetchNextPageError,
									loadMore: () => {
										void sessionsQuery.fetchNextPage({ cancelRefetch: false });
									},
								}}
							/>
							{sessionsQuery.isError && !sessionsQuery.data ? (
								<Button
									variant="ghost"
									onClick={() => {
										void sessionsQuery.refetch();
									}}
								>
									Try again
								</Button>
							) : null}
						</div>
					</section>
					<HorizontalResizeHandle
						ariaLabel={`Resize ${kind.toLowerCase()} usage panel`}
						direction={1}
						className="hidden border-l border-(--session-overview-border) md:block"
						defaultValue={DEFAULT_USAGE_WIDTH}
						maximum={maximum}
						minimum={minimum}
						value={usageWidth}
						onValueChange={setStoredWidth}
						onValuePreview={(width) =>
							layoutRef.current?.style.setProperty(
								"--usage-pane-width",
								`${width}px`,
							)
						}
					/>
					<section
						aria-label={`${kind} content`}
						className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-(--session-overview-border) md:border-t-0"
					>
						<h1 className="sr-only">{name}</h1>
						{children}
					</section>
				</div>
			</div>
		</>
	);
}
