import type { SessionListInput } from "@rudel/api-routes";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	type ComponentProps,
	type CSSProperties,
	lazy,
	type ReactNode,
	Suspense,
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
} from "@/app/ui/horizontal-resize-handle";
import { clampPaneSize } from "@/app/ui/horizontal-resize-utils";
import { SearchInput } from "@/components/dashboard/data-table";
import { RetryButton } from "@/components/retry-button";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import {
	MINIMUM_SESSION_TRANSCRIPT_PANE_WIDTH_PX,
	MINIMUM_SESSION_TURN_TABLE_PANE_WIDTH_PX,
	SESSION_DETAIL_RESIZE_HANDLE_WIDTH_PX,
} from "@/features/sessions/components/session-detail-pane-sizing";
import { SessionDetailErrorBoundary } from "@/features/sessions/components/session-detail-view-parts";
import { SessionsOverviewTable } from "@/features/sessions/components/sessions-overview-table";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { SessionReaderFallback } from "@/features/sessions/reader/session-reader-light-samples";
import {
	type DayRange,
	SLICE_MAX_DAYS,
	SLICE_ROW_LIMIT,
	sessionsOnUtcDays,
	useSettledFocus,
} from "@/features/sessions/session-day-slice";
import {
	getLoadedSessionReaderView,
	loadSessionReaderView,
} from "@/features/sessions/session-detail-prefetch";
import {
	getSessionNeighbours,
	type SessionNavigation,
} from "@/features/sessions/session-navigation";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import {
	sessionRowKey,
	transcriptSubagentId,
} from "@/features/sessions/session-row-key";
import { useSessionCostMaximum } from "@/features/sessions/use-session-cost-maximum";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useCurrentShellRoute } from "@/features/shell/hooks/useCurrentShellRoute";
import {
	ShellHeaderPortalContext,
	useShellHeaderPortal,
} from "@/features/shell/shell-header-portal";
import { useCanViewSession } from "@/features/workspace/hooks/useCanViewSession";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { getInclusiveDateRangeDays } from "@/lib/analytics-date-range";
import { client, orpc } from "@/lib/orpc";

const PAGE_SIZE = 50;
// A session ID search reads up to this many sessions, in big pages.
const MAX_SEARCHED_SESSIONS = 2_000;
const SEARCH_PAGE_SIZE = 1_000;
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
}: UsageSessionsPaneProps & {
	name: string;
	onBack: () => void;
	children: ReactNode;
}) {
	const headerPortal = useShellHeaderPortal();
	const shellRoute = useCurrentShellRoute();
	const [searchParams] = useSearchParams();
	const selectedSessionId = searchParams.get("session");
	const layoutRef = useRef<HTMLDivElement>(null);
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
	return (
		<>
			{headerPortal
				? createPortal(
						// Detail breadcrumb, as on the session page: the section's
						// chip and muted name lead back to the list (lifting only their text
						// on hover, outside the header's fluid fill); the name is the title.
						<nav
							aria-label={`${kind} breadcrumb`}
							className="flex min-w-0 flex-1 items-center gap-s text-body-xxl font-medium"
						>
							<button
								type="button"
								onClick={onBack}
								data-fluid-menu-root=""
								className="flex shrink-0 items-center gap-m text-ink-3 transition-colors focus-outline hover:text-ink"
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
								// design-escape-ok(opacity): no role renders this; text-ink-3/50
								className="size-4 shrink-0 text-ink-3/50"
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
						<UsageSessionsPane
							kind={kind}
							sessionFilter={sessionFilter}
							sessionCount={sessionCount}
							detailHref={detailHref}
						/>
					</section>
					<HorizontalResizeHandle
						ariaLabel={`Resize ${kind.toLowerCase()} usage panel`}
						direction={1}
						className="hidden edge-l-m border-line-strong md:block"
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
						className="flex min-h-0 min-w-0 flex-col overflow-hidden edge-t-m border-line-strong md:edge-t-none"
					>
						<h1 className="sr-only">{name}</h1>
						{children}
					</section>
				</div>
			</div>
		</>
	);
}

interface UsageSessionsPaneProps {
	kind: "Skill" | "Repo";
	sessionFilter: Pick<SessionListInput, "skillName" | "repoKey">;
	sessionCount: number | undefined;
	detailHref: (sessionId?: string) => string;
	/** Inclusive date range; all time when omitted. */
	range?: { startDate: string; endDate: string };
	/** Where an open session's previous/next control goes, such as the
	 * page's tab row; beside the back button when omitted. */
	navigationHost?: HTMLElement | null;
	/** Show the back-button bar above an open session; off when the page's
	 * breadcrumb already leads back to the list. */
	backBar?: boolean;
	rowHighlightClassName?: string;
	onVisibleSessions?: (sessions: readonly { session_date: string }[]) => void;
	/** Days of the range to list, such as a hovered or picked day on the
	 * rail: the desktop app slices them from the range it holds whole. */
	focus?: DayRange | null;
}

/**
 * The sessions that used a skill or ran in a repo: the sessions table,
 * swapped in place for a picked session (`?session=`) with a back button
 * above it.
 */
export function UsageSessionsPane({
	kind,
	sessionFilter,
	sessionCount,
	detailHref,
	range = { startDate: "1970-01-01", endDate: "2100-01-01" },
	navigationHost,
	backBar = true,
	rowHighlightClassName,
	onVisibleSessions,
	focus = null,
}: UsageSessionsPaneProps) {
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
	const scrollRef = useRef<HTMLDivElement>(null);
	const desktop = useLocalDesktopApp();
	const wholeRange = JSON.stringify([
		state.activeOrg?.id,
		sessionFilter,
		range.startDate,
		range.endDate,
	]);
	const [overflowRange, setOverflowRange] = useState<string | null>(null);
	const slicing =
		desktop &&
		getInclusiveDateRangeDays(range.startDate, range.endDate) <=
			SLICE_MAX_DAYS &&
		overflowRange !== wholeRange;
	const asked = useSettledFocus(slicing ? null : focus, !slicing);
	const queried = asked
		? { startDate: asked.start, endDate: asked.end }
		: range;
	const options = orpc.analytics.sessions.list.infiniteOptions({
		input: (offset: number) => ({
			...sessionFilter,
			startDate: queried.startDate,
			endDate: queried.endDate,
			limit: slicing ? SLICE_ROW_LIMIT : PAGE_SIZE,
			offset,
		}),
		initialPageParam: 0,
		getNextPageParam: (lastPage, _pages, offset) =>
			!slicing && lastPage.length === PAGE_SIZE
				? offset + lastPage.length
				: undefined,
	});
	const costMaximum = useSessionCostMaximum();
	const sessionsQuery = useInfiniteQuery({
		...options,
		queryKey: ["org", state.activeOrg?.id, ...options.queryKey],
		enabled: !!state.activeOrg?.id && demo?.live !== false,
		placeholderData: (previous, previousQuery) =>
			state.activeOrg?.id && previousQuery?.queryKey[1] === state.activeOrg.id
				? previous
				: undefined,
	});
	const placeholder = sessionsQuery.isPlaceholderData;
	const wholeRangeRows = slicing
		? sessionsQuery.data?.pages[0]?.length
		: undefined;
	if (
		wholeRangeRows !== undefined &&
		wholeRangeRows >= SLICE_ROW_LIMIT &&
		overflowRange !== wholeRange
	)
		setOverflowRange(wholeRange);
	const focusStart = focus?.start;
	const focusEnd = focus?.end;
	const sessions = useMemo(() => {
		const loaded =
			sessionsQuery.data?.pages.flatMap(parseSessionOverviewRows) ?? [];
		const shown =
			focusStart && focusEnd
				? { start: focusStart, end: focusEnd }
				: { start: queried.startDate, end: queried.endDate };
		const rows =
			placeholder || focusStart ? sessionsOnUtcDays(loaded, shown) : loaded;
		return [
			...new Map(
				rows.map((row) => [`${row.user_id}:${sessionRowKey(row)}`, row]),
			).values(),
		];
	}, [
		sessionsQuery.data,
		placeholder,
		queried.startDate,
		queried.endDate,
		focusStart,
		focusEnd,
	]);
	// Session ID search: the API has no ID filter, so while a search is on,
	// read every page once and match IDs here (the loaded rows stand in
	// until that lands).
	const [idSearch, setIdSearch] = useState("");
	const idQuery = idSearch.trim().toLowerCase();
	const searchQuery = useQuery({
		queryKey: [
			"org",
			state.activeOrg?.id,
			"usage-session-id-search",
			sessionFilter,
			range,
		],
		queryFn: async ({ signal }) => {
			const rows = [];
			for (
				let offset = 0;
				offset < MAX_SEARCHED_SESSIONS;
				offset += SEARCH_PAGE_SIZE
			) {
				const page = parseSessionOverviewRows(
					await client.analytics.sessions.list(
						{
							...sessionFilter,
							startDate: range.startDate,
							endDate: range.endDate,
							limit: SEARCH_PAGE_SIZE,
							offset,
						},
						{ signal },
					),
				);
				rows.push(...page);
				if (page.length < SEARCH_PAGE_SIZE) break;
			}
			return rows;
		},
		enabled: !!idQuery && !!state.activeOrg?.id && demo?.live !== false,
		staleTime: 60_000,
	});
	const searched =
		searchQuery.data && focus
			? sessionsOnUtcDays(searchQuery.data, focus)
			: searchQuery.data;
	const matchingSessions = idQuery
		? (searched ?? sessions).filter((session) =>
				session.session_id.toLowerCase().includes(idQuery),
			)
		: sessions;
	// Steps through the loaded rows, in the table's order.
	const navigableSessions = sessions.filter(
		(session) => transcriptSubagentId(session) === null,
	);
	const { previousSession, nextSession } = getSessionNeighbours({
		canViewSession,
		orderedSessions: navigableSessions,
		selectedSessionId,
	});
	const selectedIndex = navigableSessions.findIndex(
		(session) => session.session_id === selectedSessionId,
	);

	return (
		<>
			{selectedSessionId ? (
				<UsageSessionDetail
					backLabel={`Back to ${kind.toLowerCase()} sessions`}
					sessionId={selectedSessionId}
					fallbackHref={getShellRoutePath(detailHref())}
					onBack={() => selectSession(null)}
					navigation={{
						hasPreviousSession: previousSession !== undefined,
						hasNextSession: nextSession !== undefined,
						onPreviousSession: () => {
							if (previousSession) selectSession(previousSession.session_id);
						},
						onNextSession: () => {
							if (nextSession) selectSession(nextSession.session_id);
						},
						scopeLabel: `this ${kind.toLowerCase()}`,
					}}
					navigationHost={navigationHost}
					backBar={backBar}
					position={selectedIndex < 0 ? undefined : selectedIndex + 1}
					totalSessions={sessionCount ?? sessions.length}
				/>
			) : null}
			<div
				className={
					selectedSessionId ? "hidden" : "flex min-h-0 flex-1 flex-col"
				}
			>
				<SessionsOverviewTable
					costMaximum={costMaximum}
					showPlace={kind === "Repo"}
					highlightClassName={rowHighlightClassName}
					onVisibleSessions={onVisibleSessions}
					activeSessionId={null}
					canOpenSession={(session) => canViewSession(session.user_id)}
					getSessionHref={(session) =>
						getShellRoutePath(detailHref(session.session_id))
					}
					getSessionLinkState={undefined}
					isLoading={sessionsQuery.isPending}
					onSessionClick={undefined}
					scrollContainerRef={scrollRef}
					sessionCountLabel={
						idQuery
							? matchingSessions.length
							: (sessionCount ?? sessions.length)
					}
					sessions={matchingSessions}
					toolbarStart={
						<SearchInput
							value={idSearch}
							onChange={setIdSearch}
							placeholder="Search by session ID…"
							label="Search sessions by ID"
						/>
					}
					sessionDetailDisabledNote={
						sessionsQuery.isError && !sessionsQuery.data
							? "Sessions couldn’t load."
							: undefined
					}
					totalSessionCount={sessionCount ?? sessions.length}
					showDateControl={false}
					showSkillsColumn={false}
					pagination={{
						// A search reads every page itself.
						hasNextPage: !idQuery && sessionsQuery.hasNextPage,
						isFetching: sessionsQuery.isFetching,
						isError: sessionsQuery.isFetchNextPageError,
						loadMore: () => {
							void sessionsQuery.fetchNextPage({ cancelRefetch: false });
						},
					}}
				/>
				{sessionsQuery.isError && !sessionsQuery.data ? (
					<RetryButton
						onRetry={() => {
							void sessionsQuery.refetch();
						}}
					/>
				) : null}
			</div>
		</>
	);
}

const LazySessionReaderView = lazy(() =>
	loadSessionReaderView().then((module) => ({
		default: module.SessionReaderView,
	})),
);

function SessionReader(props: ComponentProps<typeof LazySessionReaderView>) {
	const [Reader] = useState(
		() => getLoadedSessionReaderView() ?? LazySessionReaderView,
	);
	return (
		<Suspense fallback={<SessionReaderFallback />}>
			<Reader {...props} />
		</Suspense>
	);
}

/**
 * One session opened in place of a sessions list: a back button with the
 * session's own header controls beside it, then the session.
 */
export function UsageSessionDetail({
	backLabel,
	sessionId,
	fallbackHref,
	onBack,
	navigation,
	navigationHost,
	backBar = true,
	position,
	totalSessions = 0,
}: {
	backLabel: string;
	sessionId: string;
	fallbackHref: string;
	onBack: () => void;
	navigation?: SessionNavigation;
	/** Where `navigation` goes; beside the back button when omitted. */
	navigationHost?: HTMLElement | null;
	/** The back-button bar; leave it out when a breadcrumb leads back. */
	backBar?: boolean;
	position?: number;
	totalSessions?: number;
}) {
	const [sessionHeaderPortal, setSessionHeaderPortal] =
		useState<HTMLDivElement | null>(null);
	return (
		<ShellHeaderPortalContext.Provider
			value={navigationHost ?? sessionHeaderPortal}
		>
			{backBar ? (
				<div className="flex h-12 shrink-0 items-center gap-m edge-b-m border-line-strong px-l">
					<Button
						aria-label={backLabel}
						title={backLabel}
						variant="ghost"
						size="icon-sm"
						onClick={onBack}
					>
						<IconChevronLeft size={16} />
					</Button>
					<div ref={setSessionHeaderPortal} className="flex min-w-0 flex-1" />
				</div>
			) : null}
			<SessionDetailErrorBoundary key={sessionId} fallbackHref={fallbackHref}>
				<SessionReader
					navigation={navigation}
					position={position}
					sessionId={sessionId}
					totalSessions={totalSessions}
				/>
			</SessionDetailErrorBoundary>
		</ShellHeaderPortalContext.Provider>
	);
}
