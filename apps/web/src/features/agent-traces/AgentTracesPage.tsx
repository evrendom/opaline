import type { AgentRun, AgentRuns, AgentRunsFilter } from "@rudel/api-routes";
import {
	IconExternalLink,
	IconMessageQuestion,
	IconRoute,
	IconX,
	IconZoomCancel,
} from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Button } from "@/app/ui/button";
import { CONVERSATION_TRACE_TAG_CLASS_NAME } from "@/components/conversation/conversation-trace-tag";
import { SearchInput } from "@/components/dashboard/data-table";
import { Skeleton } from "@/components/dashboard/skeleton";
import { OverviewRangeFiltersMenu } from "@/components/overview-list";
import { UsageStateMessage } from "@/components/usage-collection-view";
import {
	CONFIDENCE_BOUND,
	type ConfidenceFilters,
	toAgentRunsFilters,
} from "@/features/agent-traces/confidence-filters";
import { useAgentTracesAccess } from "@/features/agent-traces/use-agent-traces-access";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { DashboardDateControls } from "@/features/dashboard/components/DashboardDateControls";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { SkillRunWaterfall } from "@/features/repos/repo-skill-run-waterfall";
import { fetchSessionDetailOverview } from "@/features/sessions/components/session-detail-fast-query";
import { SessionMemberProfilePreview } from "@/features/sessions/components/session-member-profile-preview";
import {
	SESSION_OVERVIEW_CELL_CLASS_NAME,
	SESSION_OVERVIEW_METADATA_CLASS_NAME,
	SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
	SESSION_OVERVIEW_ROW_CLASS_NAME,
} from "@/features/sessions/components/session-overview-row-elements";
import {
	formatReaderCost,
	formatReaderDuration,
	getCostQuintiles,
	getCostShade,
} from "@/features/sessions/components/session-reader-model";
import { ModelChip } from "@/features/sessions/components/session-reader-waterfall-chips";
import { SessionsOverviewFluidList } from "@/features/sessions/components/sessions-overview-fluid-list";
import { SESSION_OVERVIEW_SURFACE_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { shortRunId } from "@/features/sessions/run-id";
import {
	isRunQuestionYes,
	runQuestionTagLabel,
} from "@/features/sessions/run-question-tags";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import {
	type UseFluidHoverReturn,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// The run's id, when it started, the run itself with its answers, its
// member, the reader's ledger (duration and cost), and the scrollbar gutter.
const TRACE_GRID_CLASS_NAME =
	"grid-cols-[96px_64px_minmax(0,1fr)_auto_128px_minmax(0,16px)]";
const PAGE_SIZE = 100;
// Turn pages to read per session before giving up on finding a run's turn.
const MAX_TURN_PAGES = 10;
// Answer tags shown in a row; the rest are counted.
const MAX_ROW_TAGS = 3;
type Question = AgentRuns["questions"][number];

function runKey(run: AgentRun): string {
	return `${run.userId}\u0000${run.sessionId}\u0000${run.agentId}\u0000${run.turn}`;
}

/**
 * Agent traces: every agent run in the workspace over the date range, newest
 * first, as the skill page's agent traces list them, each with what the run
 * questions found about it. The filter menu narrows the runs by each
 * question's confidence (the answer's probability of yes), any number of
 * questions at once; a row folds out the run's steps.
 */
export function AgentTracesPage() {
	const demo = useDemoRuntime();
	const { state: organization } = useOrganization();
	const { state: range } = useDateRange();
	const { userMap, avatarMap } = useUserMap();
	const [search, setSearch] = useState("");
	const [confidence, setConfidence] = useState<ConfidenceFilters>({});
	const [expanded, setExpanded] = useState<string | null>(null);
	const filters = useMemo(() => toAgentRunsFilters(confidence), [confidence]);
	const access = useAgentTracesAccess();
	const available = import.meta.env.MODE !== "plugin" && demo === null;

	const options = orpc.analytics.sessions.agentRuns.infiniteOptions({
		input: (cursor: string | undefined) => ({
			startDate: range.startDate,
			endDate: range.endDate,
			filters,
			limit: PAGE_SIZE,
			...(cursor ? { cursor } : {}),
		}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
	const runsQuery = useInfiniteQuery({
		...options,
		queryKey: ["org", organization.activeOrg?.id, ...options.queryKey],
		enabled: access.enabled && !!organization.activeOrg?.id,
		// Keep the list while the range or filters change, never across workspaces.
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[1] === organization.activeOrg?.id
				? previous
				: undefined,
		staleTime: 60_000,
	});
	const firstPage = runsQuery.data?.pages[0];
	const enabled = firstPage?.enabled ?? false;
	const questions = firstPage?.questions ?? [];
	const questionsById = useMemo(
		() => new Map(questions.map((question) => [question.id, question])),
		[questions],
	);
	const runs = useMemo(
		() => runsQuery.data?.pages.flatMap((page) => page.runs) ?? [],
		[runsQuery.data],
	);
	const visibleRuns = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) return runs;
		return runs.filter((run) =>
			[
				run.prompt ?? "",
				run.repository,
				run.model ?? "",
				run.sessionId,
				userMap[run.userId] ?? "",
			].some((text) => text.toLocaleLowerCase().includes(query)),
		);
	}, [runs, search, userMap]);
	const costThresholds = useMemo(
		() => getCostQuintiles(visibleRuns.map((run) => run.costUsd ?? 0)),
		[visibleRuns],
	);
	const filtered = new Set(filters.map((filter) => filter.questionId));
	const hasActiveFilters = filters.length > 0;
	const clearAll = () => {
		setSearch("");
		setConfidence({});
	};

	const filterMenuItems = questions.map((question) => ({
		group: "activity" as const,
		icon: IconMessageQuestion,
		key: question.id,
		label: runQuestionTagLabel(question),
	}));

	return (
		<div
			className={cn(
				"dashboardy-page isolate antialiased",
				SESSION_OVERVIEW_SURFACE_CLASS_NAME,
			)}
		>
			<section
				aria-label="Agent traces"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				<div
					className="flex h-12 shrink-0 items-center gap-2 px-6"
					data-slot="agent-traces-toolbar"
				>
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="Search runs…"
						label="Search runs"
					/>
					<OverviewRangeFiltersMenu
						bounds={Object.fromEntries(
							questions.map((question) => [question.id, CONFIDENCE_BOUND]),
						)}
						disabled={!enabled || questions.length === 0}
						filters={filterMenuItems}
						formatValue={(_key, value) => `${value}%`}
						noun="runs by confidence"
						values={Object.fromEntries(
							questions.map((question) => [
								question.id,
								confidence[question.id] ?? { minimum: null, maximum: null },
							]),
						)}
						onChange={(key, value) => {
							setExpanded(null);
							setConfidence((previous) => ({ ...previous, [key]: value }));
						}}
						onClearAll={() => setConfidence({})}
					/>
					<div className="ml-auto">
						<DashboardDateControls sourceComponent="agent_traces_date_picker" />
					</div>
				</div>
				{hasActiveFilters ? (
					<ActiveConfidenceFilters
						filters={filters}
						questionsById={questionsById}
						onRemove={(questionId) =>
							setConfidence((previous) => {
								const { [questionId]: _removed, ...rest } = previous;
								return rest;
							})
						}
					/>
				) : null}
				{firstPage && !enabled ? (
					<p className="px-6 pb-2 text-xs text-(--session-overview-subtle)">
						Run questions aren’t answered for this workspace yet, so runs are
						listed without confidence scores.
					</p>
				) : null}
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
					{available && !access.pending && !access.enabled ? (
						<UsageStateMessage
							icon={<IconRoute aria-hidden="true" />}
							title="Agent traces aren’t enabled for this workspace"
							description="Agent traces is in early access for a few workspaces."
						/>
					) : !available ? (
						<UsageStateMessage
							icon={<IconRoute aria-hidden="true" />}
							title="Agent traces aren’t available here"
							description="Open Opaline to see every agent run with its run question answers."
						/>
					) : access.pending || runsQuery.isPending ? (
						<div className="flex flex-col gap-2 p-4">
							{[0, 1, 2, 3, 4, 5].map((index) => (
								<Skeleton key={index} className="h-8 w-full rounded-lg" />
							))}
						</div>
					) : runsQuery.isError && runs.length === 0 ? (
						<UsageStateMessage
							icon={<IconRoute aria-hidden="true" />}
							title="Agent traces couldn’t be loaded"
							description="Your sessions are still available. Try loading this view again."
							action={
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => {
										void runsQuery.refetch();
									}}
								>
									Try again
								</Button>
							}
						/>
					) : visibleRuns.length === 0 ? (
						<UsageStateMessage
							icon={
								hasActiveFilters || search ? (
									<IconZoomCancel aria-hidden="true" />
								) : (
									<IconRoute aria-hidden="true" />
								)
							}
							title={
								hasActiveFilters || search
									? "No matching runs"
									: "No agent runs in this range"
							}
							description={
								hasActiveFilters || search
									? "Try other confidence ranges or clear the filters."
									: "Try widening the time range."
							}
							action={
								hasActiveFilters || search ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={clearAll}
									>
										Clear filters
									</Button>
								) : undefined
							}
						/>
					) : (
						<div className="pl-4">
							<SessionsOverviewFluidList
								fillHeight={false}
								highlightClassName="rounded-lg corner-squircle squircle:rounded-2xl"
							>
								{({ registerItem, setActiveIndex }) =>
									visibleRuns.map((run, index) => {
										const key = runKey(run);
										const open = expanded === key;
										const toggle = () => setExpanded(open ? null : key);
										return (
											<AgentRunRow
												key={key}
												index={index}
												registerItem={registerItem}
												setHoverActiveIndex={setActiveIndex}
												run={run}
												questionsById={questionsById}
												filtered={filtered}
												costThresholds={costThresholds}
												open={open}
												onToggle={toggle}
												avatarUrl={avatarMap[run.userId]}
												userLabel={userMap[run.userId] ?? run.userId}
											>
												{open ? (
													// biome-ignore lint/a11y/noStaticElementInteractions: only keeps the list's decorative hover out; the panel's own controls are buttons.
													<div
														className="rounded-b-lg bg-neutral-100 px-4 pb-4 corner-squircle squircle:rounded-b-2xl dark:bg-card"
														onMouseEnter={() => setActiveIndex(null)}
														onMouseMove={(event) => event.stopPropagation()}
													>
														<div className="overflow-clip rounded-b-lg bg-(--dashboard-01-content-background,var(--background)) shadow-(--custom-outline-shadow) [clip-path:inset(0_-8px_-8px_-8px)] corner-squircle squircle:rounded-b-xl">
															<AgentRunPanel
																run={run}
																questionsById={questionsById}
																onClose={toggle}
															/>
														</div>
													</div>
												) : null}
											</AgentRunRow>
										);
									})
								}
							</SessionsOverviewFluidList>
						</div>
					)}
					{runsQuery.hasNextPage && visibleRuns.length > 0 ? (
						<div className="flex justify-center px-6 py-4">
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={runsQuery.isFetchingNextPage}
								onClick={() => {
									void runsQuery.fetchNextPage();
								}}
							>
								{runsQuery.isFetchingNextPage ? "Loading…" : "Load more runs"}
							</Button>
						</div>
					) : null}
				</div>
			</section>
		</div>
	);
}

/** The active confidence ranges as chips, each removing its own filter. */
function ActiveConfidenceFilters({
	filters,
	questionsById,
	onRemove,
}: {
	filters: readonly AgentRunsFilter[];
	questionsById: ReadonlyMap<string, Question>;
	onRemove: (questionId: string) => void;
}) {
	return (
		<section
			aria-label="Active confidence filters"
			className="flex shrink-0 flex-wrap items-center gap-1.5 px-6 pb-2"
		>
			{filters.map((filter) => {
				const question = questionsById.get(filter.questionId);
				const label = question
					? runQuestionTagLabel(question)
					: filter.questionId;
				return (
					<button
						key={filter.questionId}
						type="button"
						aria-label={`Remove ${label} filter`}
						title={question?.question}
						onClick={() => onRemove(filter.questionId)}
						className={cn(CONVERSATION_TRACE_TAG_CLASS_NAME, "cursor-pointer")}
					>
						<IconMessageQuestion
							aria-hidden="true"
							className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
						/>
						<span className="truncate font-sans">{label}</span>
						<span className="shrink-0 font-normal tabular-nums text-(--session-overview-subtle)">
							{Math.round(filter.min * 100)}–{Math.round(filter.max * 100)}%
						</span>
						<IconX aria-hidden="true" className="size-3 shrink-0" />
					</button>
				);
			})}
		</section>
	);
}

/** The answers a row shows: yes answers and every filtered question's, most likely first. */
function rowAnswers(run: AgentRun, filtered: ReadonlySet<string>) {
	return run.answers.filter(
		(answer) => isRunQuestionYes(answer.probability) || filtered.has(answer.id),
	);
}

function answerLabel(
	id: string,
	questionsById: ReadonlyMap<string, Question>,
): { label: string; question: string } {
	const question = questionsById.get(id);
	return question
		? { label: runQuestionTagLabel(question), question: question.question }
		: { label: id, question: id };
}

/** One answer as a tag: the question's short name and its confidence. */
function AnswerTag({
	id,
	probability,
	questionsById,
}: {
	id: string;
	probability: number;
	questionsById: ReadonlyMap<string, Question>;
}) {
	const { label, question } = answerLabel(id, questionsById);
	const yes = isRunQuestionYes(probability);
	return (
		<span
			className={cn(
				CONVERSATION_TRACE_TAG_CLASS_NAME,
				"min-w-0 max-w-52 shrink",
			)}
			data-agent-run-answer
			title={`${question} · ${Math.round(probability * 100)}% yes`}
		>
			<IconMessageQuestion
				aria-hidden="true"
				className={cn(
					"size-3.5 shrink-0",
					yes
						? "text-amber-600 dark:text-amber-400"
						: "text-(--session-overview-subtle)",
				)}
			/>
			<span className="truncate font-sans">{label}</span>
			<span className="shrink-0 font-normal tabular-nums text-[#8d8d8d] dark:text-[#8c8c8c]">
				{Math.round(probability * 100)}%
			</span>
		</span>
	);
}

/** One run as a session overview row: its session and run number, its date,
 * the model's chip (the disclosure) with its prompt and answers, its member,
 * and the reader's ledger — its duration, and its cost in the ledger's heat. */
function AgentRunRow({
	index,
	registerItem,
	setHoverActiveIndex,
	run,
	questionsById,
	filtered,
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
	run: AgentRun;
	questionsById: ReadonlyMap<string, Question>;
	filtered: ReadonlySet<string>;
	costThresholds: readonly number[];
	open: boolean;
	onToggle: () => void;
	avatarUrl: string | undefined;
	userLabel: string;
	children?: ReactNode;
}) {
	const itemRef = useRef<HTMLButtonElement>(null);
	useRegisterFluidHoverItem(registerItem, index, itemRef);
	const startedAt = new Date(run.startedAt);
	const answers = rowAnswers(run, filtered);
	const shown = answers.slice(0, MAX_ROW_TAGS);
	const hidden = answers.slice(MAX_ROW_TAGS);
	return (
		<li
			className="relative z-10 [--frozen-offset:4rem]"
			onFocus={() => setHoverActiveIndex(index)}
		>
			<div
				className={cn(
					open && "sticky top-0 z-40 bg-(--session-overview-surface)",
				)}
			>
				<button
					ref={itemRef}
					type="button"
					aria-expanded={open}
					onClick={onToggle}
					className={cn(
						SESSION_OVERVIEW_ROW_CLASS_NAME,
						TRACE_GRID_CLASS_NAME,
						"group/toggle cursor-pointer",
						open &&
							"rounded-t-lg bg-neutral-100 corner-squircle squircle:rounded-t-2xl dark:bg-card",
					)}
				>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "gap-1")}>
						<span
							className="truncate font-mono text-[11px] text-(--session-overview-subtle)"
							title={`Session ${run.sessionId}${run.agentId ? ` · subagent ${run.agentId}` : ""} · run ${run.turn}`}
						>
							{shortRunId(run.sessionId)}#{run.turn}
						</span>
						{run.agentId ? (
							<span className="shrink-0 rounded-sm bg-violet-500/10 px-1 text-[10px] text-violet-600 dark:text-violet-400">
								sub
							</span>
						) : null}
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "px-2")}>
						<time
							dateTime={run.startedAt}
							className={SESSION_OVERVIEW_METADATA_CLASS_NAME}
							title={startedAt.toLocaleString()}
						>
							{startedAt.toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
							})}
						</time>
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "gap-2 px-2")}>
						<ModelChip model={run.model ?? ""} glyph="size-3" open={open} />
						<p
							className={cn(
								"min-w-0 truncate",
								SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME,
							)}
							title={run.prompt ?? undefined}
						>
							{run.prompt ?? "No prompt"}
						</p>
						{shown.length > 0 ? (
							<div className="flex min-w-0 max-w-[60%] shrink-0 items-center gap-1">
								{shown.map((answer) => (
									<AnswerTag
										key={answer.id}
										id={answer.id}
										probability={answer.probability}
										questionsById={questionsById}
									/>
								))}
								{hidden.length > 0 ? (
									<span
										className="shrink-0 whitespace-nowrap text-[0.625rem] font-normal text-(--session-overview-subtle)"
										title={hidden
											.map(
												(answer) =>
													`${answerLabel(answer.id, questionsById).label} ${Math.round(answer.probability * 100)}%`,
											)
											.join(", ")}
									>
										+{hidden.length}
									</span>
								) : null}
							</div>
						) : null}
					</div>
					<div className={cn(SESSION_OVERVIEW_CELL_CLASS_NAME, "justify-end")}>
						<SessionMemberProfilePreview
							avatarUrl={avatarUrl}
							profile={{ activity: [1], favoriteModel: run.model ?? "" }}
							userLabel={userLabel}
						/>
					</div>
					<div
						className={cn(
							SESSION_OVERVIEW_CELL_CLASS_NAME,
							"justify-end gap-2",
						)}
						title={`This run’s cost · ${run.toolCalls} tool calls${run.failedCalls ? `, ${run.failedCalls} failed` : ""}`}
					>
						<span className={SESSION_OVERVIEW_METADATA_CLASS_NAME}>
							{formatReaderDuration(run.minutes * 60)}
						</span>
						<span
							className={cn(
								SESSION_OVERVIEW_METADATA_CLASS_NAME,
								getCostShade(run.costUsd, costThresholds),
							)}
						>
							{formatReaderCost(run.costUsd)}
						</span>
					</div>
				</button>
				{open ? (
					<div className="h-4 bg-neutral-100 px-4 pt-1 dark:bg-card">
						<div className="h-5 rounded-t-lg bg-(--dashboard-01-content-background,var(--background)) shadow-(--custom-outline-shadow) [clip-path:inset(-8px_-8px_7px_-8px)] corner-squircle squircle:rounded-t-xl" />
					</div>
				) : null}
			</div>
			{children}
		</li>
	);
}

/** The reader's turn that is this run of the main transcript, found by its prompt's time. */
async function findRunTurn(run: AgentRun, signal: AbortSignal) {
	const startedAt = Date.parse(run.startedAt);
	let revision = "";
	let turnCursor: string | undefined;
	for (let page = 0; page < MAX_TURN_PAGES; page++) {
		const { overview } = await fetchSessionDetailOverview(
			{
				sessionId: run.sessionId,
				turnCursor,
				...(revision ? { expectedRevision: revision } : {}),
			},
			signal,
		);
		revision = overview.revision;
		const turn = overview.turnPage.items.find(
			(item) =>
				item.startedAt !== null && Date.parse(item.startedAt) === startedAt,
		);
		if (turn) return { revision, turn };
		turnCursor = overview.turnPage.nextCursor ?? undefined;
		if (!turnCursor) break;
	}
	return null;
}

/** An open run: every answer about it with its confidence, a link into the
 * session, and its steps as the session reader's waterfall. */
function AgentRunPanel({
	run,
	questionsById,
	onClose,
}: {
	run: AgentRun;
	questionsById: ReadonlyMap<string, Question>;
	onClose: () => void;
}) {
	const getShellRoutePath = useShellRoutePath();
	const main = run.agentId === "";
	const turn = useAnalyticsQuery({
		queryKey: ["agent-run-turn", run.userId, run.sessionId, run.startedAt],
		queryFn: ({ signal }) => findRunTurn(run, signal),
		enabled: main,
		retry: 1,
		staleTime: 5 * 60_000,
	});
	const turnId = turn.data?.turn.turnId;
	const sessionPath = getShellRoutePath(
		`${appRoutes.sessionDetail(run.sessionId)}${turnId ? `?${new URLSearchParams({ turn: turnId })}` : ""}`,
	);
	return (
		<div className="flex flex-col">
			<div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-2">
				{run.answers.length > 0 ? (
					run.answers.map((answer) => (
						<AnswerTag
							key={answer.id}
							id={answer.id}
							probability={answer.probability}
							questionsById={questionsById}
						/>
					))
				) : (
					<span className="text-xs text-(--session-overview-subtle)">
						No run question answers yet.
					</span>
				)}
				<Link
					to={sessionPath}
					className="ml-auto inline-flex items-center gap-1 text-xs text-(--session-overview-muted) hover:text-foreground"
				>
					Open in session
					<IconExternalLink aria-hidden="true" className="size-3.5" />
				</Link>
			</div>
			{!main ? (
				<p className="px-4 pb-3 text-xs text-muted-foreground">
					This run is a subagent’s; open the session to read its steps.
				</p>
			) : turn.isPending ? (
				<div className="flex flex-col gap-2 p-3">
					<Skeleton className="h-5 w-full" />
					<Skeleton className="h-5 w-5/6" />
				</div>
			) : turn.data ? (
				<SkillRunWaterfall
					sessionId={run.sessionId}
					revision={turn.data.revision}
					run={turn.data.turn}
					model={run.model}
					onClose={onClose}
				/>
			) : (
				<p className="px-4 pb-3 text-xs text-muted-foreground">
					This run’s steps couldn’t load here; open the session to read it.
				</p>
			)}
		</div>
	);
}
