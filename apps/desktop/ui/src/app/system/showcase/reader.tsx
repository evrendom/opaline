import type {
	SessionDetailTurnSummary,
	SessionPullRequest,
	SessionSetupFile,
} from "@rudel/api-routes";
import { IconFile, IconFileCode, IconFolder } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import type { NormalizedSessionDetailOverview } from "@/features/sessions/components/session-detail-fast-response";
import { ContextFill } from "@/features/sessions/reader/context/session-reader-context-fill";
import type { ContextMeasure } from "@/features/sessions/reader/context/session-reader-context-measure";
import { ModelChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { FileTag } from "@/features/sessions/reader/files/session-reader-file-tag";
import { ViewToggle } from "@/features/sessions/reader/files/session-reader-files-parts";
import { useFilesRailTags } from "@/features/sessions/reader/rail/session-reader-files-rail";
import {
	createActiveTurnStore,
	TurnRailList,
} from "@/features/sessions/reader/rail/session-reader-turn-rail";
import { railLineKey } from "@/features/sessions/reader/rail/session-reader-turn-rail-row";
import type { SessionReaderTab } from "@/features/sessions/reader/reader-params";
import { SessionReaderSkeleton } from "@/features/sessions/reader/session-reader-light-samples";
import {
	CiColumnsSample,
	SetupColumnsSample,
} from "@/features/sessions/reader/session-reader-samples";
import { SessionReaderTabs } from "@/features/sessions/reader/session-reader-tabs";
import {
	SubagentChip,
	SubagentTag,
} from "@/features/sessions/reader/subagents/session-reader-subagent-chip";
import { SummaryFigures } from "@/features/sessions/reader/summary/session-reader-summary-figures";
import {
	ACCENT,
	sessionFigures,
} from "@/features/sessions/reader/summary/session-reader-summary-figures-model";
import { SummaryPullRequests } from "@/features/sessions/reader/summary/session-reader-summary-github";
import { SummarySection } from "@/features/sessions/reader/summary/session-reader-summary-section";
import { SummaryFiles } from "@/features/sessions/reader/summary/session-reader-summary-sections";
import {
	SummaryMcpAndTools,
	SummarySkillsAndFiles,
} from "@/features/sessions/reader/summary/session-reader-summary-setup";
import { cn } from "@/lib/utils";
import { Group, Specimen, State } from "./kit";
import { seed } from "./providers";

const NOOP = () => {};

// The demo's first session (acme/loomrail-workers, GPT 5.5, six runs), in
// the shapes the session reader receives.
const SESSION = seed.sessions[0];
const STARTED = Date.parse(SESSION?.session_date ?? "2026-08-31T13:08:30Z");
const WINDOW = 258_400;
const RUNS = [
	["1ic31r", 0.15, 0.24, 49],
	["1mmyju", 0.26, 0.31, 302],
	["tn9o5d", 0.32, 0.27, 288],
	["193dqi", 0.35, 0.33, 410],
	["1nqygs", 0.4, 0.29, 351],
	["1dhrpg", 0.4, 0.32, 520],
] as const;

const at = (seconds: number) =>
	new Date(STARTED + seconds * 1000).toISOString();

const TURNS: SessionDetailTurnSummary[] = RUNS.map(
	([id, share, cost, seconds], index) => {
		const start = RUNS.slice(0, index).reduce((sum, run) => sum + run[3], 0);
		const input = Math.round(share * WINDOW);
		return {
			activityResolution: "exact",
			durationSeconds: seconds,
			editedFiles: index === 1 ? ["workers/retry.py"] : [],
			endedAt: at(start + seconds),
			errorCount: index === 2 ? 1 : 0,
			errorEvents: [],
			estimatedCost: cost,
			hasBody: true,
			index,
			inputTokens: input,
			modelSignalCount: 0,
			outputTokens: 1800,
			responsePreview: null,
			signalCount: 0,
			signalOccurrences: [],
			signalOccurrencesOmittedCount: 0,
			signalOccurrencesTruncated: false,
			skillCount: index === 0 ? 1 : 0,
			skillEvents: [],
			skills: index === 0 ? ["testing-conventions"] : [],
			slashCommands: [],
			startedAt: at(start),
			stepKinds: index === 1 ? { shell: 2 } : undefined,
			toolCallCount: 4,
			turnId: `${id}0a-5d2c-4f1e-9b7a-0c3e5f7a9b1d`,
			usageCalls: [
				{
					at: at(start + seconds),
					cacheCreationInputTokens: 0,
					cacheReadInputTokens: 0,
					contextWindow: WINDOW,
					freshInputTokens: input,
					model: "gpt-5.5",
					outputTokens: 1800,
				},
			],
			userPreview: null,
		};
	},
);

const OVERVIEW_SESSION: NormalizedSessionDetailOverview["session"] = {
	durationMinutes: SESSION?.duration_min ?? 32,
	estimatedCost: SESSION?.estimated_cost ?? 1.76,
	gitBranch: SESSION?.git_branch ?? "main",
	gitSha: "80d1035b",
	inputTokens: SESSION?.input_tokens ?? 0,
	lastInteractionDate: at(1920),
	modelUsed: "gpt-5.5",
	outputTokens: SESSION?.output_tokens ?? 0,
	projectPath: SESSION?.project_path ?? "/workspace/loomrail-workers",
	repository: SESSION?.repository ?? "acme/loomrail-workers",
	sessionDate: at(0),
	sessionId: SESSION?.session_id ?? "01a057ef-85d4-767c-bd6c-69a7b216bcb5",
	skills: SESSION?.skills ?? [],
	slashCommands: [],
	source: "codex",
	totalTokens: SESSION?.total_tokens ?? 0,
	userId: SESSION?.user_id ?? "",
};

const setupFile = (
	setup: Omit<SessionSetupFile, "chars" | "firstAt" | "subagents" | "versions">,
): SessionSetupFile => ({
	chars: 1200,
	firstAt: at(0),
	subagents: false,
	versions: 1,
	...setup,
});

const SETUP: SessionSetupFile[] = [
	setupFile({
		kind: "agents_md",
		owner: "acme/loomrail-workers",
		path: "AGENTS.md",
		runs: 6,
		scope: "repository",
		setupFile: "repo:AGENTS.md",
	}),
	setupFile({
		kind: "system_prompt",
		owner: "codex",
		path: "system",
		runs: 6,
		scope: "harness",
		setupFile: "harness:system",
	}),
	setupFile({
		kind: "developer",
		owner: "codex",
		path: "permissions",
		runs: 6,
		scope: "harness",
		setupFile: "harness:permissions",
	}),
];

const SKILLS = [
	{
		name: "testing-conventions",
		subagents: false,
		turns: [TURNS[0]?.turnId ?? ""],
		uses: 1,
	},
	{ name: "interface-craft", subagents: false, turns: [], uses: 0 },
];

const FILES = [
	{
		changedTurns: [TURNS[1]?.turnId ?? ""],
		created: 0,
		edited: 1,
		path: "/workspace/loomrail-workers/workers/retry.py",
		read: 2,
		turns: [TURNS[1]?.turnId ?? "", TURNS[2]?.turnId ?? ""],
	},
	{
		changedTurns: [],
		created: 0,
		edited: 0,
		path: "/workspace/loomrail-workers/.agents/skills/testing-conventions/SKILL.md",
		read: 1,
		turns: [TURNS[0]?.turnId ?? ""],
	},
];

const PULLS: SessionPullRequest[] = [
	{
		authorLogin: "rafa",
		draft: false,
		headRef: "fix/retry-after",
		mergedAt: at(4000),
		number: 451,
		relations: ["pr_named"],
		repository: "acme/loomrail-workers",
		state: "merged",
		title: "Parse Retry-After as seconds or an HTTP date",
	},
];

const NO_EMPTY: ReadonlySet<SessionReaderTab> = new Set();
const CI_EMPTY: ReadonlySet<SessionReaderTab> = new Set(["ci"]);

/** The reader's stage: its rail width and pane offsets, as the reader page
 *  sets them on the screen around these pieces. */
function ReaderStage({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 gap-xxl bg-inset p-xl [--panes-top:0rem] [--stage-top:0rem]",
				className,
			)}
		>
			{children}
		</div>
	);
}

function Tabs({
	empty,
	initial,
}: {
	empty: ReadonlySet<SessionReaderTab>;
	initial: SessionReaderTab;
}) {
	const [tab, setTab] = useState(initial);
	return <SessionReaderTabs ci empty={empty} onChange={setTab} value={tab} />;
}

function Rail({
	idle,
	run,
}: {
	idle?: ReadonlySet<string>;
	run: string | null;
}) {
	const [activeTurn] = useState(createActiveTurnStore);
	const tags = useFilesRailTags();
	const [picked, setPicked] = useState(run);
	return (
		<div className="flex h-[22rem] w-(--reader-rail) min-h-0 shrink-0 flex-col">
			<TurnRailList
				activeTurn={activeTurn}
				costThresholds={[0.25, 0.28, 0.3, 0.32]}
				currentTurnId={picked}
				idle={idle}
				model="gpt-5.5"
				onSelect={(turnId) => setPicked(turnId === picked ? null : turnId)}
				tags={tags}
				turns={TURNS}
				whole={{
					onPick: () => setPicked(null),
					picked: picked === null,
					total: TURNS.length,
				}}
			/>
		</div>
	);
}

function Figures() {
	const [measure, setMeasure] = useState<ContextMeasure>("context");
	return (
		<SummaryFigures
			accent={ACCENT}
			figures={sessionFigures(OVERVIEW_SESSION, TURNS, TURNS.length, 0)}
			measure={measure}
			onMeasure={setMeasure}
		/>
	);
}

function FilesToggle() {
	const [view, setView] = useState<"changed" | "read" | "all">("all");
	return (
		<ViewToggle
			label="Files to show"
			onPick={setView}
			options={[
				{ icon: IconFileCode, id: "changed", label: "Changed" },
				{ icon: IconFile, id: "read", label: "Read" },
				{ icon: IconFolder, id: "all", label: "All" },
			]}
			value={view}
		/>
	);
}

const IDLE = new Set(
	TURNS.filter((_, index) => index !== 2 && index !== 3).map((turn) =>
		railLineKey(turn.turnId, null),
	),
);

export function ReaderGroup() {
	return (
		<Group title="Session reader">
			<Specimen
				name="SessionReaderTabs (PillTabs, tab-pill)"
				source="features/sessions/reader/session-reader-tabs.tsx"
				where="The reader's tab row under the session header; a tab with nothing in it is dimmed."
			>
				<State label="Summary open, CI & PRs empty">
					<Tabs empty={CI_EMPTY} initial="summary" />
				</State>
				<State label="Detail open">
					<Tabs empty={NO_EMPTY} initial="detail" />
				</State>
			</Specimen>

			<Specimen
				name="TurnRailList (RailRow, ContextFill, RailTagsPicker)"
				source="features/sessions/reader/rail/session-reader-turn-rail.tsx"
				where="The Agent runs rail on every reader tab: the whole session or one run picked; runs without the open file dimmed on Files and Setup."
			>
				<State label="Entire session picked (Summary)">
					<ReaderStage>
						<Rail run={null} />
					</ReaderStage>
				</State>
				<State label="A run picked (Detail)">
					<ReaderStage>
						<Rail run={TURNS[0]?.turnId ?? null} />
					</ReaderStage>
				</State>
				<State label="Runs dimmed (Files, Setup)">
					<ReaderStage>
						<Rail idle={IDLE} run={null} />
					</ReaderStage>
				</State>
			</Specimen>

			<Specimen
				name="SummaryFigures (StatCard)"
				source="features/sessions/reader/summary/session-reader-summary-figures.tsx"
				where="Summary tab, above the context map: context, cost, duration and turns; the picked measure is ringed in its accent."
			>
				<div className="w-full max-w-[56rem]">
					<Figures />
				</div>
			</Specimen>

			<Specimen
				name="SummarySection with SummarySkillsAndFiles, SummaryMcpAndTools"
				source="features/sessions/reader/summary/session-reader-summary-setup.tsx"
				where="Summary tab: Skills & Context files and MCP & Tools cards."
				className="grid w-full max-w-[56rem] grid-cols-2"
			>
				<SummarySection title="Skills & Context files" count={3}>
					<SummarySkillsAndFiles
						onOpen={NOOP}
						onOpenSetup={NOOP}
						setup={SETUP}
						skills={SKILLS}
					/>
				</SummarySection>
				<SummarySection title="MCP & Tools" count={2}>
					<SummaryMcpAndTools onOpen={NOOP} setup={SETUP} />
				</SummarySection>
			</Specimen>

			<Specimen
				name="SummarySection with SummaryFiles, SummaryPullRequests"
				source="features/sessions/reader/summary/session-reader-summary-sections.tsx"
				where="Summary tab: the Files tree and the Pull requests card, linked or empty."
				className="grid w-full max-w-[56rem] grid-cols-2"
			>
				<SummarySection title="Files" count={FILES.length}>
					<SummaryFiles files={FILES} onOpenFiles={NOOP} />
				</SummarySection>
				<div className="grid min-w-0 gap-xl">
					<SummarySection title="Pull requests" count={PULLS.length}>
						<SummaryPullRequests pullRequests={PULLS} />
					</SummarySection>
					<SummarySection title="Pull requests" count={0}>
						<SummaryPullRequests pullRequests={[]} />
					</SummarySection>
				</div>
			</Specimen>

			<Specimen
				name="ModelChip, SubagentChip, SubagentTag, FileTag, ContextFill"
				source="features/sessions/reader/detail/waterfall/session-reader-waterfall-chips.tsx"
				where="Across the reader: the model in the header and rail, subagent marks, file tags in steps, the context ring in rail rows."
				className="items-center"
			>
				<State label="ModelChip gpt-5.5">
					<ModelChip model="gpt-5.5" />
				</State>
				<State label="ModelChip claude-fable-5">
					<ModelChip model="claude-fable-5" />
				</State>
				<State label="SubagentChip">
					<SubagentChip selected={false} subagentId="7f3a9c" />
				</State>
				<State label="SubagentChip selected">
					<SubagentChip selected subagentId="7f3a9c" />
				</State>
				<State label="SubagentTag">
					<SubagentTag subagentId="7f3a9c" />
				</State>
				<State label="FileTag">
					<FileTag path="/workspace/loomrail-workers/workers/retry.py" />
				</State>
				<State label="ContextFill compact">
					<span className="text-body-m tabular-nums">
						<ContextFill
							compact
							use={{ model: "gpt-5.5", tokens: 103_400, window: WINDOW }}
						/>
					</span>
				</State>
				<State label="ContextFill over 80%">
					<span className="text-body-m tabular-nums">
						<ContextFill
							compact
							use={{ model: "gpt-5.5", tokens: 220_000, window: WINDOW }}
						/>
					</span>
				</State>
			</Specimen>

			<Specimen
				name="ViewToggle (tab-pill)"
				source="features/sessions/reader/files/session-reader-files-parts.tsx"
				where="Files and Setup column headers: Changed, Read, All."
			>
				<FilesToggle />
			</Specimen>

			<Specimen
				name="SetupColumn, SetupCard"
				source="features/sessions/reader/setup/session-reader-setup-card.tsx"
				where="Setup tab: the session's setup files, the picked one read beside them (shown with the tab's own sample data)."
			>
				<ReaderStage className="h-[30rem] w-full">
					<SetupColumnsSample agent={null} model="gpt-5.5" run={null} />
				</ReaderStage>
			</Specimen>

			<Specimen
				name="CiPullColumn, CiPullCard"
				source="features/sessions/reader/ci/session-reader-ci-pulls.tsx"
				where="CI & PRs tab: the pull requests, the picked one's CI beside them (shown with the tab's own sample data)."
			>
				<ReaderStage className="h-[30rem] w-full">
					<CiColumnsSample agent={null} model="gpt-5.5" run={null} />
				</ReaderStage>
			</Specimen>

			<Specimen
				name="SessionReaderSkeleton (Bones)"
				source="features/sessions/reader/session-reader-light-samples.tsx"
				where="While a session loads: the Summary tab's shape in bones."
			>
				<div className="h-[36rem] w-full overflow-hidden bg-inset [--panes-top:0rem] [--stage-top:0rem]">
					<SessionReaderSkeleton tab="summary" />
				</div>
			</Specimen>
		</Group>
	);
}
