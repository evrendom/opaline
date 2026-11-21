import type {
	RepositoryRun,
	RepositoryRunsOf,
	RepositorySetupFile,
	RepositorySetupSession,
	SessionDetailTurnSummary,
} from "@rudel/api-routes";
import {
	IconArrowUpRight,
	IconPlug,
	IconRoute,
	IconSparkles,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Bone, Bones, Reveal } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { FluidList, useFluidListItem } from "@/components/fluid-list";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import {
	type McpServer,
	mcpServers,
} from "@/features/repos/repo-reader/repo-mcp-servers";
import { keepWhileRangeChanges } from "@/features/repos/repo-reader/repo-page-data";
import {
	eventOf,
	sessionPagePath,
} from "@/features/repos/repo-reader/repo-run-calls";
import {
	runKeyOf,
	usePickedRun,
} from "@/features/repos/repo-reader/repo-runs-column";
import {
	useRepoMcpTools,
	useRepoSetup,
	useRepoSetupSessions,
	useRepoSetupVersions,
} from "@/features/repos/repo-reader/use-repo-setup";
import { sessionDetailInitialQueryOptions } from "@/features/sessions/components/session-detail-fast-query";
import type { NormalizedSessionDetailOverview } from "@/features/sessions/components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "@/features/sessions/components/use-session-detail-overview-pages";
import { MemberBubble } from "@/features/sessions/reader/detail/session-reader-member-bubble";
import { ModelAvatar } from "@/features/sessions/reader/detail/session-reader-model-avatar";
import { McpCall } from "@/features/sessions/reader/detail/step/session-reader-mcp-call";
import { ToolCard } from "@/features/sessions/reader/detail/step/session-reader-tool-card";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import {
	CARD,
	ReaderPane,
	ScrollColumn,
} from "@/features/sessions/reader/files/session-reader-files-parts";
import { mcpResult } from "@/features/sessions/reader/model/session-reader-mcp-tool";
import {
	getReaderMemberText,
	getReaderWaterfall,
	type SessionReaderStep,
} from "@/features/sessions/reader/model/session-reader-model";
import { PickStrip } from "@/features/sessions/reader/rail/session-reader-pick-strip";
import { SetupCard } from "@/features/sessions/reader/setup/session-reader-setup-card";
import {
	type RunSetupUses,
	SetupRunTrace,
	useRunSetupUses,
	useSetupRunStore,
} from "@/features/sessions/reader/setup/session-reader-setup-use";
import { findSkillSetupFile } from "@/features/sessions/reader/setup/session-setup-files";
import {
	subagentBrief,
	subagentIdOf,
} from "@/features/sessions/reader/subagents/session-reader-agent-focus";
import { SubagentChip } from "@/features/sessions/reader/subagents/session-reader-subagent-chip";
import { SubagentTints } from "@/features/sessions/reader/subagents/session-reader-subagent-tints";
import { ReaderSubagentsContext } from "@/features/sessions/reader/subagents/use-reader-subagent-branches";
import { getSubagentLaunches } from "@/features/sessions/reader/summary/session-summary-model";
import { shortRunId, shortSubagentId } from "@/features/sessions/run-id";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

export type UseSection = "skills" | "mcp";

const RUNS_STALE_TIME_MS = 5 * 60_000;
const STALL_MS = 20_000;
const RUNS_MIN_WIDTH = "13rem";
const FILE_CARD_MIN_WIDTH = "22.5rem";
const COLUMN_GAPS = "3rem";
const RUNS_WIDTH = {
	minWidth: RUNS_MIN_WIDTH,
	width: "20rem",
} satisfies CSSProperties;
const MIDDLE_WIDTH = {
	minWidth: `min(26rem, max(0px, 100% - ${RUNS_MIN_WIDTH} - ${FILE_CARD_MIN_WIDTH} - ${COLUMN_GAPS}))`,
} satisfies CSSProperties;
const FILE_CARD_WIDTH = {
	minWidth: FILE_CARD_MIN_WIDTH,
	width: "29.5rem",
} satisfies CSSProperties;

const COPY = {
	mcp: {
		icon: IconPlug,
		missing: (name: string) => `No run called ${name} yet`,
		pick: "Pick a run",
		pickHint: "Pick a run on the left to see what it sent and got back.",
	},
	skills: {
		icon: IconSparkles,
		missing: (name: string) => `No run loaded ${name} yet`,
		pick: "Pick a run",
		pickHint: "Pick a run on the left to see where it loaded the skill.",
	},
} as const;

export function WorkspaceUseView({
	name,
	section,
}: {
	name: string;
	section: UseSection;
}) {
	const setup = useRepoSetup(undefined, { allTime: true });
	const tools = useRepoMcpTools(undefined, section === "mcp", {
		allTime: true,
	});
	const server = useMemo(
		() =>
			section === "mcp" && setup.data && tools.data
				? (mcpServers(setup.data.files, tools.data.tools).find(
						(each) => each.name === name || each.file.owner === name,
					) ?? null)
				: null,
		[name, section, setup.data, tools.data],
	);
	const file = useMemo(
		() =>
			section === "mcp"
				? (server?.file ?? null)
				: setup.data
					? ((findSkillSetupFile(
							setup.data.files.filter((each) => each.kind === "skill_body"),
							name,
						) as RepositorySetupFile | null) ?? null)
					: null,
		[name, section, server, setup.data],
	);
	const of: RepositoryRunsOf | null = file
		? section === "mcp"
			? { kind: "mcp", server: file.owner }
			: { kind: "setup", setupFile: file.setupFile }
		: null;
	const runsQuery = useAnalyticsQuery({
		...orpc.analytics.repositories.runs.queryOptions({
			input: { of: of ?? { kind: "mcp", server: "" } },
		}),
		enabled: of !== null,
		staleTime: RUNS_STALE_TIME_MS,
		placeholderData: keepWhileRangeChanges({ of }),
	});
	const runs = runsQuery.data?.runs;
	const [pickedKey, pickRun] = usePickedRun();
	const picked =
		runs?.find((run) => runKeyOf(run) === pickedKey) ?? runs?.[0] ?? null;
	const versioned =
		file && !file.setupFile.startsWith("called:") ? file.setupFile : "";
	const versions = useRepoSetupVersions(undefined, versioned, {
		allTime: true,
	});
	const received = useRepoSetupSessions(undefined, versioned, {
		allTime: true,
	});
	const versionOf = useMemo(
		() =>
			versions.versions.length > 1
				? runVersions(received.data?.sessions ?? [], versions.numbers)
				: NO_VERSION,
		[received.data, versions.numbers, versions.versions.length],
	);
	const pickedVersion = picked ? versionOf(picked) : null;
	const copy = COPY[section];
	const settled = !setup.isPending && (section !== "mcp" || !tools.isPending);
	const loading = !settled || (of !== null && runsQuery.isPending);
	const missing =
		settled && (!file || (runs !== undefined && runs.length === 0));
	const shownFile = file && !file.setupFile.startsWith("called:") ? file : null;

	return (
		<div className="h-full overflow-hidden pt-m pr-[calc(var(--space-xxl)*4/3)] pb-m pl-xxl">
			<div className="flex h-full min-h-0 gap-xxl">
				<div className="-mb-m flex min-h-0 shrink flex-col" style={RUNS_WIDTH}>
					<ScrollColumn className="-mx-xs px-xs pb-[calc(var(--space-xxl)*4/3)]">
						{loading || (runs && runs.length > 0) ? (
							<Reveal
								label="Reading the runs"
								loading={loading}
								sample={<RunListSample />}
								sampleId="use-runs"
							>
								{() =>
									runs ? (
										<RunList
											onPick={(run) => pickRun(runKeyOf(run))}
											picked={picked}
											prefetch={section === "skills"}
											runs={runs}
											versionOf={versionOf}
										/>
									) : null
								}
							</Reveal>
						) : null}
					</ScrollColumn>
				</div>
				<div
					className={cn(
						"relative z-10 flex min-h-0 flex-1 overflow-hidden",
						CARD,
					)}
					style={MIDDLE_WIDTH}
				>
					{missing ? (
						<CenteredState
							icon={copy.icon}
							title={
								server && server.calls === 0
									? `${server.name} was never called`
									: copy.missing(name)
							}
							description={
								server && server.calls === 0
									? `It was connected in ${server.sessions.toLocaleString()} ${server.sessions === 1 ? "session" : "sessions"}, but no run called its tools.`
									: "Opaline has no indexed run that used it yet."
							}
						/>
					) : picked && file && section === "mcp" ? (
						<McpRunCalls
							key={runKeyOf(picked)}
							name={name}
							of={of ?? { kind: "mcp", server: file.owner }}
							run={picked}
							version={pickedVersion?.number ?? null}
						/>
					) : picked && file ? (
						<RunUse
							key={runKeyOf(picked)}
							file={file}
							name={name}
							next={
								runs
									? runs.slice(
											runs.indexOf(picked) + 1,
											runs.indexOf(picked) + 3,
										)
									: []
							}
							run={picked}
							section={section}
							version={pickedVersion?.number ?? null}
						/>
					) : loading ? (
						<MiddleSample section={section} />
					) : (
						<CenteredState
							icon={copy.icon}
							title={copy.pick}
							description={copy.pickHint}
						/>
					)}
				</div>
				<div
					className={cn("flex min-h-0 shrink overflow-hidden", CARD)}
					style={FILE_CARD_WIDTH}
				>
					{shownFile || (!server && loading) ? (
						<Reveal
							fill
							className="min-w-0 flex-1"
							label="Reading the file"
							loading={!shownFile}
							sample={<FileCardSample />}
							sampleId="use-file"
						>
							{() =>
								shownFile ? (
									<SetupCard
										details={false}
										diffs
										file={shownFile}
										versionPicker={false}
										versions={{
											...versions,
											shown:
												versions.versions.find(
													(each) => each.version === pickedVersion?.version,
												) ?? versions.shown,
										}}
									/>
								) : null
							}
						</Reveal>
					) : server ? (
						<CalledOnly server={server} />
					) : null}
				</div>
			</div>
		</div>
	);
}

type RunVersion = { number: number; version: string };

const NO_VERSION = (): RunVersion | null => null;

function runVersions(
	sessions: readonly RepositorySetupSession[],
	numbers: ReadonlyMap<string, number>,
): (run: RepositoryRun) => RunVersion | null {
	const bySession = new Map<string, RepositorySetupSession[]>();
	for (const session of sessions)
		bySession.set(session.sessionId, [
			...(bySession.get(session.sessionId) ?? []),
			session,
		]);
	return (run) => {
		const received = bySession.get(run.sessionId);
		if (!received) return null;
		const at = Date.parse(run.startedAt);
		const during = received.find(
			(each) =>
				Date.parse(each.firstAt) - 1_000 <= at &&
				at <= Date.parse(each.lastAt) + 1_000,
		);
		const before = received
			.filter((each) => Date.parse(each.firstAt) <= at)
			.sort((a, b) => Date.parse(b.firstAt) - Date.parse(a.firstAt))[0];
		const match = during ?? before ?? received[0];
		const number = match ? numbers.get(match.version) : undefined;
		return match && number ? { number, version: match.version } : null;
	};
}

function CalledOnly({ server }: { server: McpServer }) {
	return (
		<CenteredState
			icon={IconPlug}
			title={`${server.name} sent no instructions`}
			description={`Called ${server.calls.toLocaleString()} ${server.calls === 1 ? "time" : "times"} through ${server.tools.length} ${server.tools.length === 1 ? "tool" : "tools"}, with no instructions Opaline kept.`}
		/>
	);
}

function RunList({
	onPick,
	picked,
	prefetch,
	runs,
	versionOf,
}: {
	onPick: (run: RepositoryRun) => void;
	picked: RepositoryRun | null;
	prefetch: boolean;
	runs: readonly RepositoryRun[];
	versionOf: (run: RepositoryRun) => RunVersion | null;
}) {
	const queryClient = useQueryClient();
	const warm = (run: RepositoryRun) => {
		if (prefetch)
			void queryClient.prefetchQuery(
				sessionDetailInitialQueryOptions(run.sessionId),
			);
	};
	const days = useMemo(() => {
		const groups: { label: string; runs: RepositoryRun[] }[] = [];
		for (const run of runs) {
			const label = dayLabel(run.startedAt);
			const last = groups.at(-1);
			if (last?.label === label) last.runs.push(run);
			else groups.push({ label, runs: [run] });
		}
		return groups;
	}, [runs]);
	const parentModels = useMemo(
		() =>
			new Map(
				runs
					.filter((run) => !run.agentId && run.turnId)
					.map((run) => [`${run.sessionId}:${run.turnId}`, run.model ?? null]),
			),
		[runs],
	);
	let index = 0;
	return (
		<FluidList>
			{days.map((day) => (
				<section key={day.label} className="flex flex-col gap-xxs">
					<h3 className="px-l pt-l pb-xs text-body-s font-medium text-ink-3 first:pt-xs">
						{day.label}
					</h3>
					{day.runs.map((run) => (
						<RunRow
							key={runKeyOf(run)}
							index={index++}
							isPicked={run === picked}
							onPick={onPick}
							onWarm={warm}
							parentModel={
								parentModels.get(`${run.sessionId}:${run.turnId}`) ??
								run.model ??
								null
							}
							run={run}
							version={versionOf(run)?.number ?? null}
						/>
					))}
				</section>
			))}
		</FluidList>
	);
}

function RunRow({
	index,
	isPicked,
	onPick,
	onWarm,
	parentModel,
	run,
	version,
}: {
	index: number;
	isPicked: boolean;
	onPick: (run: RepositoryRun) => void;
	onWarm: (run: RepositoryRun) => void;
	parentModel: string | null;
	run: RepositoryRun;
	version: number | null;
}) {
	const item = useFluidListItem<HTMLButtonElement>(index);
	const prompt = run.prompt?.replace(/\s+/gu, " ").trim();
	return (
		<button
			type="button"
			ref={item.ref}
			aria-current={isPicked || undefined}
			onClick={() => onPick(run)}
			onFocus={() => {
				item.onFocus();
				onWarm(run);
			}}
			onPointerEnter={() => onWarm(run)}
			title={prompt || undefined}
			className={cn(
				"relative flex w-full items-center gap-l",
				"corner-s px-l py-s corner-squircle",
				"text-left",
				"focus-outline transition-colors",
				"squircle:corner-l",
				isPicked && "bg-field",
			)}
		>
			{run.agentId ? (
				<SubagentTints ids={[run.agentId]}>
					<SubagentChip selected={isPicked} subagentId={run.agentId} />
				</SubagentTints>
			) : (
				<ModelChip model={run.model ?? null} />
			)}
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-body-m tabular-nums",
					isPicked ? "text-ink" : "text-ink-90",
				)}
			>
				{run.agentId
					? shortSubagentId(run.agentId)
					: run.turnId
						? shortRunId(run.turnId)
						: "—"}
				{run.agentId && run.turnId ? (
					<span className="inline-flex items-center gap-xs pl-xs align-middle text-ink-3">
						in
						<ModelChip chip="size-3.5" glyph="size-2" model={parentModel} />
						{shortRunId(run.turnId)}
					</span>
				) : null}
			</span>
			{version ? (
				<span
					title={`Loaded version ${version}`}
					className={cn(
						"shrink-0",
						"corner-xs px-xs",
						"text-body-xs font-medium tabular-nums",
						"bg-field text-ink-3",
					)}
				>
					v{version}
				</span>
			) : null}
			<span className="shrink-0 text-body-s text-ink-3 tabular-nums">
				{timeOfDay(run.startedAt)}
			</span>
		</button>
	);
}

function McpRunCalls({
	name,
	of,
	run,
	version,
}: {
	name: string;
	of: RepositoryRunsOf;
	run: RepositoryRun;
	version: number | null;
}) {
	const query = useAnalyticsQuery({
		...orpc.analytics.repositories.runCalls.queryOptions({
			input: {
				agentId: run.agentId,
				of,
				sessionId: run.sessionId,
				startRecord: run.startRecord,
			},
		}),
		staleTime: RUNS_STALE_TIME_MS,
	});
	const calls = query.data?.calls;
	const tag = version ? ` · v${version}` : "";
	return (
		<ReaderPane>
			<PickStrip
				agent={run.agentId || null}
				model={run.model ?? null}
				run={run.turnId}
				summary={
					calls
						? `${calls.length}${query.data?.truncated ? "+" : ""} ${calls.length === 1 ? "call" : "calls"} to ${name}${tag}`
						: undefined
				}
			>
				<OpenRunLink run={run} compact />
			</PickStrip>
			{query.isError ? (
				<CenteredState
					icon={IconRoute}
					title="This run's calls could not be read"
					description="Open it in its session instead."
				>
					<OpenRunLink run={run} />
				</CenteredState>
			) : (
				<Reveal
					fill
					className="min-h-0 min-w-0 flex-1"
					label="Reading the calls"
					loading={!calls}
					sample={<McpCallsSample />}
					sampleId="use-calls"
				>
					{() => (
						<ScrollColumn className="-mx-xs min-h-0 flex-1 px-xs pb-[calc(var(--space-xxl)*4/3)]">
							<ol className="flex flex-col gap-xl pt-m">
								{(calls ?? []).map((call) => (
									<li key={call.callId}>
										<ToolCard
											call={<McpCall event={eventOf(call)} />}
											collapsible
											fit
											model={run.model ?? null}
											output={mcpResult(call.output?.text ?? null)}
											scrolls={false}
											wrapLines
										/>
									</li>
								))}
							</ol>
						</ScrollColumn>
					)}
				</Reveal>
			)}
		</ReaderPane>
	);
}

function RunUse({
	file,
	name,
	next,
	run,
	section,
	version,
}: {
	file: RepositorySetupFile;
	name: string;
	next: readonly RepositoryRun[];
	run: RepositoryRun;
	section: UseSection;
	version: number | null;
}) {
	const initial = useQuery({
		...sessionDetailInitialQueryOptions(run.sessionId),
		retry: 1,
	});
	const queryClient = useQueryClient();
	const [stalled, setStalled] = useState(false);
	useMountEffect(() => {
		for (const each of next)
			void queryClient.prefetchQuery(
				sessionDetailInitialQueryOptions(each.sessionId),
			);
		const timer = setTimeout(() => setStalled(true), STALL_MS);
		return () => clearTimeout(timer);
	});
	const overview = initial.data?.overview;
	if (initial.isError || (stalled && !overview))
		return (
			<CenteredState
				icon={IconRoute}
				title={
					initial.isError
						? "This run could not be read"
						: "This run is taking too long to load"
				}
				description={
					initial.isError
						? "Opaline couldn’t read its session. It may still open in the session itself."
						: "Its session is large or Opaline is slow to answer. Open it in the session instead."
				}
			>
				<OpenRunLink run={run} />
			</CenteredState>
		);
	if (!overview) return <MiddleSample section={section} />;
	return (
		<RunInSession
			file={file}
			name={name}
			overview={overview}
			run={run}
			section={section}
			version={version}
		/>
	);
}

function RunInSession({
	file,
	name,
	overview,
	run,
	section,
	version,
}: {
	file: RepositorySetupFile;
	name: string;
	overview: NormalizedSessionDetailOverview;
	run: RepositoryRun;
	section: UseSection;
	version: number | null;
}) {
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const agent = run.agentId || null;
	const turnId = agent ? getSubagentLaunches(turns).get(agent) : run.turnId;
	const turn = turns.find((each) => each.turnId === turnId);
	const subagents = useMemo(
		() => ({
			onStaleRevision: () => {},
			revision: overview.revision,
			sessionId: run.sessionId,
			subagents: overview.subagents,
		}),
		[overview.revision, overview.subagents, run.sessionId],
	);
	if (!turn)
		return pages.isFetchingNextPage || pages.hasNextPage ? (
			<MiddleSample section={section} />
		) : (
			<CenteredState
				icon={IconRoute}
				title="This run could not be found"
				description="Open it in its session instead."
			/>
		);
	return (
		<ReaderSubagentsContext.Provider value={subagents}>
			<RunTrace
				agent={agent}
				file={file}
				model={overview.session.modelUsed}
				name={name}
				revision={overview.revision}
				run={run}
				section={section}
				turn={turn}
				userId={overview.session.userId}
				version={version}
			/>
		</ReaderSubagentsContext.Provider>
	);
}

function RunTrace({
	agent,
	file,
	model,
	name,
	revision,
	run,
	section,
	turn,
	userId,
	version,
}: {
	agent: string | null;
	file: RepositorySetupFile;
	model: string | null;
	name: string;
	revision: string;
	run: RepositoryRun;
	section: UseSection;
	turn: SessionDetailTurnSummary;
	userId: string;
	version: number | null;
}) {
	const uses = useRunSetupUses({
		agent,
		model,
		revision,
		sessionId: run.sessionId,
		setup: [],
		turn,
	});
	const steps = useMemo(
		() =>
			(uses.waterfall?.allSteps ?? []).filter((step) =>
				section === "mcp"
					? callsServer(step, file.owner)
					: loadsSkill(step, name),
			),
		[file.owner, name, section, uses.waterfall],
	);
	const getShellRoutePath = useShellRoutePath();
	const params = new URLSearchParams(
		section === "skills"
			? { sessionTab: "setup", setup: file.setupFile }
			: { sessionTab: "detail" },
	);
	if (agent) {
		params.set("subagent", agent);
		params.set("agent", agent);
	} else {
		params.set("run", turn.turnId);
		params.set("turn", turn.turnId);
	}
	const tag = version ? ` · v${version}` : "";
	const summary =
		uses.status === "ready"
			? section === "mcp"
				? `${steps.length} ${steps.length === 1 ? "call" : "calls"} to ${name}${tag}`
				: `Loaded ${name}${tag}${steps.length > 1 ? `, ${steps.length} times` : ""}`
			: undefined;
	return (
		<ReaderPane>
			<PickStrip
				agent={agent}
				model={model}
				run={turn.turnId}
				summary={summary}
			>
				<Link
					to={sessionPagePath(
						getShellRoutePath,
						undefined,
						run.sessionId,
						params,
					)}
					className={cn(
						"flex h-6 items-center gap-xs",
						"corner-xs px-s",
						"text-body-s",
						"text-ink-3 transition-colors",
						"hover:text-ink",
					)}
				>
					Open in session
					<IconArrowUpRight aria-hidden="true" className="size-3" />
				</Link>
			</PickStrip>
			<SkillTrace
				agent={agent}
				model={model}
				run={run}
				steps={steps}
				turn={turn}
				userId={userId}
				uses={uses}
			/>
		</ReaderPane>
	);
}

function SkillTrace({
	agent,
	model,
	run,
	steps,
	turn,
	userId,
	uses,
}: {
	agent: string | null;
	model: string | null;
	run: RepositoryRun;
	steps: readonly SessionReaderStep[];
	turn: SessionDetailTurnSummary;
	userId: string;
	uses: RunSetupUses;
}) {
	const store = useSetupRunStore(turn.turnId);
	const first = steps[0]?.id ?? null;
	const prompt = useMemo(() => {
		if (!uses.body) return null;
		if (!agent) return getReaderMemberText(uses.body) || run.prompt;
		const launch = getReaderWaterfall(uses.body, turn, model)?.allSteps.find(
			(step) => subagentIdOf(step) === agent,
		);
		return launch ? subagentBrief(launch).prompt : null;
	}, [agent, model, run.prompt, turn, uses.body]);
	return (
		<Reveal
			fill
			className="min-h-0 min-w-0 flex-1"
			label="Reading this run"
			loading={uses.status === "loading"}
			sample={<SkillTraceBody />}
			sampleId="use-trace"
		>
			{() => (
				<div className="flex min-h-0 flex-1 flex-col">
					<ScrollColumn className="-mx-xs min-h-0 flex-1 px-xs">
						{prompt ? (
							<RunPrompt
								agent={agent}
								model={model}
								startedAt={run.startedAt}
								text={prompt}
								userId={userId}
							/>
						) : null}
						<SetupRunTrace
							run={{
								...uses,
								uses: steps.map((step) => ({ file: NO_FILE, step })),
							}}
							stepId={first}
							store={store}
							turn={turn}
						/>
					</ScrollColumn>
				</div>
			)}
		</Reveal>
	);
}

const NO_FILE = {
	chars: 0,
	firstAt: "",
	kind: "skill_body",
	lastAt: "",
	owner: "",
	path: "",
	runs: 0,
	scope: "member",
	sessions: 0,
	setupFile: "",
	subagents: false,
	versions: 1,
} satisfies RepositorySetupFile;

function loadsSkill(step: SessionReaderStep, name: string): boolean {
	if (!step.skill) return false;
	return step.skill === name || step.skill.split(":").at(-1) === name;
}

function callsServer(step: SessionReaderStep, owner: string): boolean {
	const server = /^mcp__(.+?)__/u.exec(step.toolEvent?.toolName ?? "")?.[1];
	if (!server) return false;
	const key = owner.replace(/[^A-Za-z0-9_-]/gu, "_");
	return server === key || server.endsWith(`_${key}`);
}

function dayLabel(iso: string): string {
	const date = new Date(iso);
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (date.toDateString() === today.toDateString()) return "Today";
	if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
	return date.toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		weekday: "short",
	});
}

function timeOfDay(iso: string): string {
	return new Date(iso).toLocaleTimeString("en-US", {
		hour: "2-digit",
		hour12: false,
		minute: "2-digit",
	});
}

function CenteredState({
	children,
	description,
	icon,
	title,
}: {
	children?: ReactNode;
	description: string;
	icon: typeof IconRoute;
	title: string;
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-col p-xl">
			<EmptyState icon={icon} title={title} description={description}>
				{children}
			</EmptyState>
		</div>
	);
}

function OpenRunLink({
	compact = false,
	run,
}: {
	compact?: boolean;
	run: RepositoryRun;
}) {
	const getShellRoutePath = useShellRoutePath();
	const params = new URLSearchParams();
	if (run.agentId) {
		params.set("subagent", run.agentId);
		params.set("agent", run.agentId);
	} else if (run.turnId) {
		params.set("run", run.turnId);
		params.set("turn", run.turnId);
	}
	return (
		<Link
			to={sessionPagePath(getShellRoutePath, undefined, run.sessionId, params)}
			className={
				compact
					? "flex h-6 items-center gap-xs corner-xs px-s text-body-s text-ink-3 transition-colors hover:text-ink"
					: "inline-flex h-8 items-center gap-xs corner-s edge-m border-line-soft px-l text-body-m font-medium transition-colors hover:bg-hover"
			}
		>
			Open in session
			<IconArrowUpRight
				aria-hidden="true"
				className={compact ? "size-3" : "size-3.5"}
			/>
		</Link>
	);
}

function RunListSample() {
	return (
		<div className="flex flex-col gap-xxs pt-xs">
			{[72, 56, 80, 64, 50, 76, 60, 68, 54, 74].map((width) => (
				<div key={width} className="flex h-7 items-center gap-l px-l">
					<Bone className="size-4 shrink-0 corner-full" />
					<Bone className="h-2.5 corner-full" style={{ width: `${width}%` }} />
				</div>
			))}
		</div>
	);
}

function RunPrompt({
	agent,
	model,
	startedAt,
	text,
	userId,
}: {
	agent: string | null;
	model: string | null;
	startedAt: string;
	text: string;
	userId: string;
}) {
	const { avatarMap, userMap } = useUserMap();
	const label = agent ? "Main agent" : (userMap[userId] ?? "Member");
	return (
		<div className="flex flex-col gap-m pt-l pb-xl">
			<p className="flex items-center gap-m pl-[calc(var(--space-xxl)*1.5)] text-body-m text-ink-3">
				<span className="font-medium text-ink">{label}</span>
				<span className="tabular-nums">{dateTime(startedAt)}</span>
			</p>
			<MemberBubble
				avatar={
					agent ? <ModelAvatar loading={false} model={model} /> : undefined
				}
				imageUrl={agent ? undefined : avatarMap[userId]}
				label={label}
				preview={false}
				text={text}
			/>
		</div>
	);
}

function dateTime(iso: string): string {
	return new Date(iso).toLocaleString("en-US", {
		day: "numeric",
		hour: "2-digit",
		hour12: false,
		minute: "2-digit",
		month: "short",
	});
}

function MiddleSample({ section }: { section: UseSection }) {
	return (
		<Bones
			label={section === "mcp" ? "Reading the calls" : "Reading this run"}
			className="min-w-0 flex-1"
		>
			<div className="flex h-full min-h-0 min-w-0 flex-col gap-s pt-xl pr-xl pl-xxl">
				<div
					className={cn(
						"flex h-8 shrink-0 items-center gap-s",
						"corner-s px-m",
						// design-escape-ok(opacity): no role renders this; field/50
						"bg-field/50",
					)}
				>
					<Bone className="size-4 shrink-0 corner-full" />
					<Bone className="h-3 w-16 corner-xs" />
					<Bone className="h-2.5 w-24 corner-xs" />
					<span className="flex-1" />
					<Bone className="h-2.5 w-20 corner-xs" />
				</div>
				{section === "mcp" ? <McpCallsSample /> : <SkillTraceBody />}
			</div>
		</Bones>
	);
}

const TRACE_ROWS = [
	{ id: "a", label: 56, left: 0, width: 22 },
	{ id: "b", label: 40, left: 23, width: 4 },
	{ id: "c", label: 64, left: 28, width: 3 },
	{ id: "d", label: 56, left: 32, width: 18 },
	{ id: "e", label: 48, left: 51, width: 2 },
	{ id: "f", label: 56, left: 54, width: 26 },
	{ id: "g", label: 44, left: 81, width: 3 },
];

function SkillTraceBody() {
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<div className="flex flex-col gap-m pt-l pb-xxl">
				<div className="flex items-center gap-m pl-[calc(var(--space-xxl)*1.5)]">
					<Bone className="h-3 w-14 corner-xs" />
					<Bone className="h-3 w-20 corner-xs" />
				</div>
				<div className="flex gap-l">
					<Bone className="mt-s size-6 shrink-0 corner-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-m corner-m bg-card px-l py-l shadow-card corner-squircle squircle:corner-xl">
						<Bone className="h-3 w-full corner-xs" />
						<Bone className="h-3 w-10/12 corner-xs" />
						<Bone className="h-3 w-1/2 corner-xs" />
					</div>
				</div>
			</div>
			<div
				// design-escape-ok(space): skeleton rows indent past the trace's 36px glyph column and its 9px rule
				className="flex flex-col gap-xl pl-[calc(2.25rem+9px)]"
			>
				{TRACE_ROWS.map((row) => (
					<div key={row.id} className="flex h-6 items-center gap-m">
						<Bone className="size-5 shrink-0 corner-s" />
						<Bone
							className="h-3 shrink-0 corner-xs"
							style={{ width: row.label }}
						/>
						<div className="relative h-3 min-w-0 flex-1">
							<Bone
								className="absolute inset-y-0 corner-xs"
								style={{ left: `${row.left}%`, width: `${row.width}%` }}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

const OUTPUT_LINES = [92, 78, 86, 64, 90, 72, 58, 84, 70, 46];

function McpCallsSample() {
	return (
		<div className="flex flex-col gap-xl pt-m">
			<div
				className={cn(
					"flex flex-col",
					"divide-y corner-m edge-m px-l",
					"divide-line-soft border-line-soft bg-canvas",
				)}
			>
				<div className="flex items-center gap-s py-l">
					<Bone className="h-4 w-14 corner-xs" />
					<Bone className="h-3 w-24 corner-xs" />
				</div>
				{["command", "context"].map((key) => (
					<div key={key} className="flex flex-col gap-s py-l">
						<Bone className="h-2.5 w-16 corner-xs" />
						<Bone className="h-3 w-3/4 corner-xs" />
					</div>
				))}
			</div>
			<div className="flex flex-col gap-m px-xs">
				{OUTPUT_LINES.map((width) => (
					<Bone
						key={width}
						className="h-3 corner-xs"
						style={{ width: `${width}%` }}
					/>
				))}
			</div>
		</div>
	);
}

const FILE_LINES = [94, 88, 96, 70, 0, 90, 84, 92, 60, 0, 86, 94, 78].map(
	(width, line) => ({ line, width }),
);

function FileCardSample() {
	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-m edge-b-m border-line-soft px-xxl py-xl">
				<Bone className="size-4 shrink-0 corner-full" />
				<Bone className="h-3.5 w-28 corner-xs" />
			</div>
			<div className="flex flex-col gap-l px-xxl py-xxl">
				<Bone className="mb-xs h-4 w-1/3 corner-xs" />
				{FILE_LINES.map(({ line, width }) =>
					width ? (
						<Bone
							key={line}
							className="h-3 corner-xs"
							style={{ width: `${width}%` }}
						/>
					) : (
						<span key={line} className="h-2" />
					),
				)}
			</div>
		</div>
	);
}
