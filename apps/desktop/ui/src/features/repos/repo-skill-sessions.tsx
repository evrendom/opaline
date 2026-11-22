import type {
	SessionAnalytics,
	SessionDetailTurnSummary,
} from "@rudel/api-routes";
import { IconRoute } from "@tabler/icons-react";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/app/ui/skeleton";
import { EmptyState } from "@/components/dashboard/page-parts";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { fetchSessionDetailOverview } from "@/features/sessions/components/session-detail-fast-query";
import { SessionMemberProfilePreview } from "@/features/sessions/components/session-member-profile-preview";
import { getSessionModelDisplayValue } from "@/features/sessions/components/session-model-identity";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_METADATA_CLASS_NAME,
	SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
} from "@/features/sessions/components/session-overview-row-elements";
import { SessionsOverviewFluidList } from "@/features/sessions/components/sessions-overview-fluid-list";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import {
	formatReaderCost,
	formatReaderDuration,
	getCostQuintiles,
	getCostShade,
	getReaderTurnSignals,
} from "@/features/sessions/reader/model/session-reader-model";
import { TurnRailMarks } from "@/features/sessions/reader/rail/session-reader-turn-marks";
import { shortRunId } from "@/features/sessions/run-id";
import { useCanViewSession } from "@/features/workspace/hooks/useCanViewSession";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import {
	type UseFluidHoverReturn,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { formatCompactWholeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	SkillRunWaterfall,
	type SkillTracePick,
} from "./repo-skill-run-waterfall";
import { fetchSessionRows, sessionRowsKey } from "./use-sessions-overview";

// The run's id, when it started, the run itself, its member, the reader's
// ledger (duration and cost), and the scrollbar gutter.
const TRACE_GRID_CLASS_NAME =
	"grid-cols-[80px_64px_minmax(0,1fr)_auto_128px_minmax(0,16px)]";
// The list shows the newest runs only, no further loading.
const TRACE_LIMIT = 25;
// Sessions whose runs are read at once while collecting them.
const SESSION_BATCH = 8;
// Turn pages to read per session before giving up on finding more runs.
const MAX_TURN_PAGES = 10;

/** Whether a run invoked the skill (plugin skills carry a `plugin:` prefix). */
export function runUsesSkill(
	run: Pick<SessionDetailTurnSummary, "skills" | "skillEvents">,
	skillName: string,
) {
	const matches = (name: string) =>
		name === skillName || name.endsWith(`:${skillName}`);
	return (
		run.skills.some(matches) ||
		run.skillEvents.some((event) => matches(event.skill))
	);
}

type AgentTrace = {
	revision: string;
	run: SessionDetailTurnSummary;
	session: SessionAnalytics;
};

/** A session's runs that invoked the skill, with the revision they read at. */
async function fetchSkillRuns(
	session: SessionAnalytics,
	skillName: string,
	signal: AbortSignal,
): Promise<AgentTrace[]> {
	const found: AgentTrace[] = [];
	let revision = "";
	let turnCursor: string | undefined;
	for (let page = 0; page < MAX_TURN_PAGES; page++) {
		const { overview } = await fetchSessionDetailOverview(
			{
				sessionId: session.session_id,
				turnCursor,
				...(revision ? { expectedRevision: revision } : {}),
			},
			signal,
		);
		revision = overview.revision;
		for (const run of overview.turnPage.items) {
			if (runUsesSkill(run, skillName)) found.push({ revision, run, session });
		}
		turnCursor = overview.turnPage.nextCursor ?? undefined;
		if (!turnCursor) break;
	}
	return found;
}

/**
 * The agent runs that invoked one skill over a date range, in one repo or
 * across the workspace: the newest 25, as the session overview's rows. A row folds out the run's steps
 * as the session reader's waterfall (its model mark is the disclosure).
 */
export function RepoSkillSessions({
	repoKey,
	skillName,
	range,
	onStepSelect,
}: {
	/** Omitted for the skill's runs in every repo. */
	repoKey?: string;
	skillName: string;
	range: { startDate: string; endDate: string };
	/** A step picked in an open run, apart from the skill's: see
	 * SkillRunWaterfall. Null once the pick returns to the skill or the run
	 * folds away. */
	onStepSelect?: (pick: SkillTracePick | null) => void;
}) {
	const canViewSession = useCanViewSession();
	const { userMap, avatarMap } = useUserMap();
	const { state } = useOrganization();
	const demo = useDemoRuntime();
	const [expanded, setExpanded] = useState<string | null>(null);
	const filter = repoKey ? { repoKey, skillName } : { skillName };
	// The rows the skill's Data tab reads, so the two share one fetch.
	const sessions = useAnalyticsQuery({
		queryKey: [...sessionRowsKey(filter), range.startDate, range.endDate],
		queryFn: ({ signal }) => fetchSessionRows(filter, range, signal),
		placeholderData: keepPreviousData,
		staleTime: 60_000,
	});
	const readable = useMemo(
		() =>
			(sessions.data ?? [])
				.filter((session) => canViewSession(session.user_id))
				.sort((a, b) => b.session_date.localeCompare(a.session_date)),
		[sessions.data, canViewSession],
	);
	// Sessions read so far, newest first, a batch at a time: the next batch
	// starts once this one has answered and the list is still short. Starts
	// over when the skill or range changes.
	const scanKey = `${repoKey ?? ""}\n${skillName}\n${range.startDate}\n${range.endDate}`;
	const [scan, setScan] = useState({ key: scanKey, count: SESSION_BATCH });
	const scanned = scan.key === scanKey ? scan.count : SESSION_BATCH;
	// One query per session, each cached on its own and shown as it lands.
	const runQueries = useQueries({
		queries: readable.slice(0, scanned).map((session) => ({
			queryKey: [
				"org",
				state.activeOrg?.id,
				"skill-runs",
				session.session_id,
				skillName,
			],
			queryFn: ({ signal }: { signal: AbortSignal }) =>
				fetchSkillRuns(session, skillName, signal),
			enabled: !!state.activeOrg?.id && demo?.live !== false,
			retry: 1,
			staleTime: 5 * 60_000,
		})),
	});
	const found = runQueries.flatMap((query) => query.data ?? []);
	const batchDone = runQueries.every((query) => !query.isPending);
	const moreToRead = found.length < TRACE_LIMIT && scanned < readable.length;
	if (batchDone && moreToRead)
		setScan({ key: scanKey, count: scanned + SESSION_BATCH });
	const rows = found
		.sort((a, b) =>
			(b.run.startedAt ?? "").localeCompare(a.run.startedAt ?? ""),
		)
		.slice(0, TRACE_LIMIT);
	const searching = sessions.isPending || !batchDone || moreToRead;
	// The ledger's cost heat, over the runs listed.
	const costThresholds = getCostQuintiles(
		rows.map((trace) => trace.run.estimatedCost ?? 0),
	);
	const failed =
		sessions.isError ||
		(runQueries.length > 0 && runQueries.every((query) => query.isError));
	return (
		<div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
			{rows.length === 0 && searching ? (
				<div className="flex flex-col gap-m p-xl">
					{[0, 1, 2, 3].map((index) => (
						<Skeleton key={index} className="h-8 w-full corner-m" />
					))}
				</div>
			) : rows.length === 0 ? (
				<div className="px-[calc(var(--space-xxl)*4/3)] pt-xxl">
					<EmptyState
						icon={IconRoute}
						title={
							failed
								? "Agent traces couldn’t load"
								: "No agent runs used this skill in this range"
						}
						description={failed ? undefined : "Try widening the time range."}
					/>
				</div>
			) : (
				// Inset 16px on the left, as the skill file card is from this
				// pane, so the rounded highlight and open block clear the edge.
				<div className="pl-xl">
					<SessionsOverviewFluidList
						fillHeight={false}
						highlightClassName="corner-m corner-squircle squircle:corner-xl-inner"
					>
						{({ registerItem, setActiveIndex }) =>
							rows.map((trace, index) => {
								const open = expanded === trace.run.turnId;
								const toggle = () => {
									setExpanded(open ? null : trace.run.turnId);
									onStepSelect?.(null);
								};
								return (
									<AgentTraceRow
										key={trace.run.turnId}
										index={index}
										registerItem={registerItem}
										setHoverActiveIndex={setActiveIndex}
										trace={trace}
										costThresholds={costThresholds}
										open={open}
										onToggle={toggle}
										avatarUrl={avatarMap[trace.session.user_id]}
										userLabel={
											userMap[trace.session.user_id] ?? trace.session.user_id
										}
									>
										{open ? (
											// The panel, in the open row's tint as on the skills list.
											// Overflow is clipped, not hidden, so the card isn't a
											// scroll box of its own and the waterfall's header can
											// freeze to the list.
											// The list's hover never reaches into it: over the panel it
											// would light the row whose centre is nearest, often the next
											// one, though the pointer is on neither.
											// biome-ignore lint/a11y/noStaticElementInteractions: only keeps the list's decorative hover out; the panel's own controls are buttons.
											<div
												className="corner-b-m bg-field px-xl pb-xl corner-squircle squircle:corner-b-xl"
												onMouseEnter={() => setActiveIndex(null)}
												onMouseMove={(event) => event.stopPropagation()}
											>
												{/* The card's body, under the cap the row freezes with:
												    its sides and bottom (the clip drops the shadow's top
												    edge, where the cap meets it). */}
												<div className="overflow-clip corner-b-m bg-(--dashboard-01-content-background,var(--canvas)) shadow-card [clip-path:inset(0_-8px_-8px_-8px)] corner-squircle squircle:corner-b-l">
													<SkillRunWaterfall
														sessionId={trace.session.session_id}
														revision={trace.revision}
														run={trace.run}
														model={trace.session.model_used || null}
														skillName={skillName}
														onStepSelect={onStepSelect}
														onClose={toggle}
													/>
												</div>
											</div>
										) : null}
									</AgentTraceRow>
								);
							})
						}
					</SessionsOverviewFluidList>
				</div>
			)}
			{rows.length > 0 && searching ? (
				<p className="px-xxl py-l text-body-m text-ink-3">
					Finding more runs…
				</p>
			) : null}
		</div>
	);
}

/** One run as a session overview row: its id and date, the model's chip (the
 * disclosure) with the prompt that started it and its marks, its member, and
 * the reader's ledger — its duration, and its cost in the ledger's heat. */
function AgentTraceRow({
	index,
	registerItem,
	setHoverActiveIndex,
	trace,
	costThresholds,
	open,
	onToggle,
	avatarUrl,
	userLabel,
	children,
}: {
	index: number;
	registerItem: UseFluidHoverReturn["registerItem"];
	setHoverActiveIndex: UseFluidHoverReturn["setActiveIndex"];
	trace: AgentTrace;
	costThresholds: readonly number[];
	open: boolean;
	onToggle: () => void;
	avatarUrl: string | undefined;
	userLabel: string;
	/** The open run's panel, under the row in the same item. */
	children?: ReactNode;
}) {
	// The row is the hover item, not the whole item: the panel under it isn't.
	const itemRef = useRef<HTMLButtonElement>(null);
	useRegisterFluidHoverItem(registerItem, index, itemRef);
	const { run, session } = trace;
	const model =
		getSessionModelDisplayValue({
			model: session.model_used,
			source: session.source,
			totalTokens: session.total_tokens,
			errorCount: session.error_count ?? 0,
		}) ?? "";
	const startedAt = run.startedAt ? new Date(run.startedAt) : null;
	const tokens =
		run.inputTokens === null && run.outputTokens === null
			? null
			: (run.inputTokens ?? 0) + (run.outputTokens ?? 0);
	return (
		// The row and its panel share the item, so an open row freezes at the
		// top of the list only while its panel scrolls by, with the panel's
		// header frozen under it (`--frozen-offset`: the row's 3rem and the
		// card cap's 1rem).
		<li
			className="relative z-10 [--frozen-offset:4rem]"
			onFocus={() => setHoverActiveIndex(index)}
		>
			{/* Frozen, it sits on the list's own ground, so the rows scrolling
			    behind it don't show through its rounded top corners. */}
			<div className={cn(open && "sticky top-0 z-40 bg-canvas")}>
				<button
					ref={itemRef}
					type="button"
					aria-expanded={open}
					onClick={onToggle}
					className={cn(
						SESSION_OVERVIEW_ROW_CLASS_NAME,
						TRACE_GRID_CLASS_NAME,
						// group/toggle drives the model chip's disclosure.
						"group/toggle",
						// An open row shares the tint of the panel folded out beneath it,
						// rounding the top of the block the panel rounds at the bottom.
						open && "corner-t-m bg-field corner-squircle squircle:corner-t-xl",
					)}
				>
					<div className={SESSION_OVERVIEW_CELL_CLASS_NAME}>
						<span
							className="truncate font-data text-body-s text-ink-3"
							title={run.turnId}
						>
							{shortRunId(run.turnId)}
						</span>
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "px-m")}>
						<time
							dateTime={run.startedAt ?? undefined}
							className={SESSION_OVERVIEW_METADATA_CLASS_NAME}
							title={startedAt?.toLocaleString()}
						>
							{startedAt
								? startedAt.toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									})
								: "—"}
						</time>
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "gap-m px-m")}>
						<ModelChip model={model} glyph="size-3" open={open} />
						<p
							className={cn(
								"min-w-0 truncate",
								SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
							)}
							title={run.userPreview ?? undefined}
						>
							{run.userPreview ?? "No prompt preview"}
						</p>
						<TurnRailMarks
							bodyState={{ status: "loading" }}
							signals={getReaderTurnSignals(run)}
							turn={run}
						/>
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "justify-end")}>
						<SessionMemberProfilePreview
							avatarUrl={avatarUrl}
							profile={{ activity: [1], favoriteModel: session.model_used }}
							userLabel={userLabel}
						/>
					</div>
					<div
						className={cn(
							SESSION_OVERVIEW_CELL_CLASS_NAME,
							"justify-end gap-m",
						)}
						title={
							tokens === null
								? "This run’s cost"
								: `This run’s cost · ${formatCompactWholeNumber(tokens)} tokens`
						}
					>
						{/* The reader's ledger: how long the run took, then what it
					    cost, tinted by where it falls among these runs. */}
						<span className={SESSION_OVERVIEW_METADATA_CLASS_NAME}>
							{formatReaderDuration(run.durationSeconds)}
						</span>
						<span
							className={cn(
								SESSION_OVERVIEW_METADATA_CLASS_NAME,
								getCostShade(run.estimatedCost, costThresholds),
							)}
						>
							{formatReaderCost(run.estimatedCost)}
						</span>
					</div>
				</button>
				{open ? (
					// The panel card's top edge (corners, stroke, shadow) freezes with
					// the row, so the card keeps its top while the rest of it scrolls
					// under the frozen header; only its top and sides show, meeting
					// the card's body (which shows the rest) seamlessly.
					<div className="h-4 bg-field px-xl pt-xs">
						<div className="h-5 corner-t-m bg-(--dashboard-01-content-background,var(--canvas)) shadow-card [clip-path:inset(-8px_-8px_7px_-8px)] corner-squircle squircle:corner-t-l" />
					</div>
				) : null}
			</div>
			{children}
		</li>
	);
}
