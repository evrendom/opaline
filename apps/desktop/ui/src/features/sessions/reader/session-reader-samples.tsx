import type {
	SessionFile,
	SessionPullRequest,
	SessionRunStep,
	SessionSetupFile,
	SessionSetupText,
} from "@rudel/api-routes";
import { cn } from "@/lib/utils";
import { getCiPulls } from "./ci/session-reader-ci-model";
import {
	CiPullCard,
	CiPullColumn,
	useCiPullRows,
} from "./ci/session-reader-ci-pulls";
import { FileDetail } from "./files/session-reader-file-detail";
import { CARD } from "./files/session-reader-files-parts";
import { useEditsByCall } from "./files/session-reader-run-trace";
import {
	SessionFiles,
	TouchedFiles,
} from "./files/session-reader-touched-files";
import {
	SetupCard,
	type SetupVersions,
} from "./setup/session-reader-setup-card";
import { SetupColumn } from "./setup/session-reader-setup-column";

type Pick = { agent: string | null; model: string | null; run: string | null };

const NOOP = () => {};
const AT = "2026-10-22T08:48:00.000Z";
const ROOT = "/Users/you/projects/app";

const CODE = [
	'import { useMemo } from "react";',
	'import { formatDuration } from "@/lib/format";',
	'import type { SessionSummary } from "./session-model";',
	"",
	"export function useSessionFigures(session: SessionSummary) {",
	"\treturn useMemo(() => {",
	"\t\tconst started = new Date(session.startedAt).getTime();",
	"\t\tconst ended = new Date(session.endedAt).getTime();",
	"\t\treturn {",
	"\t\t\tcost: session.estimatedCost,",
	"\t\t\tduration: formatDuration(ended - started),",
	"\t\t\tturns: session.turnCount,",
	"\t\t};",
	"\t}, [session]);",
	"}",
	"",
	"export function figureLabel(kind: string) {",
	'\tif (kind === "cost") return "Cost";',
	'\tif (kind === "duration") return "Duration";',
	'\treturn "Turns";',
	"}",
	"",
	"export const FIGURE_ORDER = [",
	'\t"cost",',
	'\t"duration",',
	'\t"turns",',
	"] as const;",
	"",
	"export function sortFigures<T extends { kind: string }>(figures: T[]) {",
	"\treturn [...figures].sort(",
	"\t\t(a, b) =>",
	"\t\t\tFIGURE_ORDER.indexOf(a.kind as never) -",
	"\t\t\tFIGURE_ORDER.indexOf(b.kind as never),",
	"\t);",
	"}",
	"",
	"export function totalCost(figures: { cost: number }[]) {",
	"\treturn figures.reduce((sum, each) => sum + each.cost, 0);",
	"}",
	"",
	"export function averageDuration(durations: number[]) {",
	"\tif (durations.length === 0) return 0;",
	"\treturn durations.reduce((sum, each) => sum + each, 0) / durations.length;",
	"}",
].join("\n");

const PATHS = [
	"src/features/sessions/session-figures.ts",
	"src/features/sessions/session-model.ts",
	"src/features/sessions/session-page.tsx",
	"src/features/sessions/session-row.tsx",
	"src/features/sessions/sessions-table.tsx",
	"src/features/dashboard/dashboard-page.tsx",
	"src/features/dashboard/dashboard-cards.tsx",
	"src/lib/format.ts",
	"src/lib/utils.ts",
	"src/app/routes.tsx",
	"src/app/providers.tsx",
	"docs/performance-notes.md",
	"docs/architecture.md",
	"package.json",
	"README.md",
	"tsconfig.json",
	"vite.config.ts",
	"biome.json",
	"scripts/seed.ts",
	"scripts/check-bundle.mjs",
	"tests/session-figures.test.ts",
	"tests/format.test.ts",
	"tests/setup.ts",
	".github/workflows/ci.yml",
	".env.example",
	"index.html",
	"public/favicon.svg",
	"src/main.tsx",
	"src/index.css",
	"src/app/app-shell.tsx",
];

const SAMPLE_FILES: SessionFile[] = PATHS.map((path, index) => ({
	changes: [],
	content: index === 0 ? CODE : null,
	contentCut: false,
	movedTo: null,
	path: `${ROOT}/${path}`,
	readBy: [],
	readTurns: [],
	reads: index % 3 === 0 ? 0 : 1,
}));

const SAMPLE_STEPS: SessionRunStep[] = SAMPLE_FILES.slice(0, 14).map(
	(file, index) => ({
		agentId: "",
		at: AT,
		check: null,
		eventId: `sample-step-${index}`,
		failed: false,
		kind: index % 4 === 0 ? "edit" : "read",
		label: file.path.split("/").at(-1) ?? null,
		launched: null,
		paths: [file.path],
		verb: index % 4 === 0 ? "Edited" : "Read",
	}),
);

const NO_HIDDEN: ReadonlySet<string> = new Set();
const NO_EXTENTS: ReadonlyMap<string, number> = new Map();

export function FilesColumnsSample({ agent, model, run }: Pick) {
	const edits = useEditsByCall(SAMPLE_FILES);
	const shown = SAMPLE_FILES[0];
	return (
		<>
			{run ? (
				<TouchedFiles
					agent={agent}
					edits={edits}
					extents={NO_EXTENTS}
					file={shown.path}
					files={SAMPLE_FILES}
					hidden={NO_HIDDEN}
					model={model}
					onPickFile={NOOP}
					onPickStep={NOOP}
					read={null}
					roots={[]}
					run={run}
					steps={SAMPLE_STEPS}
				/>
			) : (
				<SessionFiles
					edits={edits}
					extents={NO_EXTENTS}
					file={shown.path}
					files={SAMPLE_FILES}
					hidden={NO_HIDDEN}
					model={model}
					onPickFile={NOOP}
					onPickStep={NOOP}
					read={null}
					roots={[]}
					steps={SAMPLE_STEPS}
				/>
			)}
			<div
				className={cn(
					"mt-(--panes-top) flex min-h-0 min-w-0 flex-1 overflow-hidden",
					CARD,
				)}
			>
				<FileDetail
					agent={agent}
					file={shown}
					onClearAgent={NOOP}
					onClearFile={NOOP}
					onClearRun={NOOP}
					onOpenTurn={NOOP}
					run={run}
				/>
			</div>
		</>
	);
}

const setupFile = (
	kind: string,
	scope: string,
	owner: string,
	path: string,
): SessionSetupFile => ({
	chars: 2400,
	firstAt: AT,
	kind,
	owner,
	path,
	runs: 12,
	scope,
	setupFile: `${scope}:${owner}:${kind}:${path}`,
	subagents: false,
	versions: 1,
});

const SAMPLE_SETUP: SessionSetupFile[] = [
	setupFile("instructions", "member", "you", "~/.claude/CLAUDE.md"),
	setupFile("nested_memory", "member", "you", "~/.claude/projects/app/memory"),
	setupFile("agents_md", "repository", "you/app", "AGENTS.md"),
	setupFile("system_prompt", "harness", "Claude Code", ""),
	setupFile("developer", "harness", "Claude Code", ""),
	setupFile("mcp_instructions", "mcp", "docs", ""),
	setupFile("mcp_instructions", "mcp", "analytics", ""),
	setupFile("mcp_instructions", "mcp", "tracker", ""),
];

const SETUP_TEXT = [
	"- Keep changes small and reviewable; one concern per pull request.",
	"- Run the type checker and the tests before saying a change is done.",
	"- Never suppress a warning to make it go away: find what causes it and fix that.",
	"- Prefer the project's own helpers over new dependencies.",
	"- Ask before anything that is hard to undo.",
].join("\n");

const SAMPLE_VERSION: SessionSetupText["versions"][number] = {
	chars: SETUP_TEXT.length,
	firstAt: AT,
	runs: 12,
	text: SETUP_TEXT,
	textCut: false,
	version: "sample",
	versionName: "sample",
};

const SAMPLE_VERSIONS = {
	numbers: new Map([[SAMPLE_VERSION.version, 1]]),
	pick: NOOP,
	query: { isError: false, isLoading: false },
	shown: SAMPLE_VERSION,
	versions: [SAMPLE_VERSION],
} as unknown as SetupVersions;

export function SetupColumnsSample({ agent, model, run }: Pick) {
	const shown = SAMPLE_SETUP[0];
	return (
		<>
			<SetupColumn
				agent={agent}
				model={model}
				onPick={NOOP}
				run={run}
				setup={SAMPLE_SETUP}
				shown={shown}
			/>
			<div
				className={cn(
					"mt-(--panes-top) flex min-h-0 w-[29.5rem] min-w-[22.5rem] shrink overflow-hidden",
					CARD,
				)}
			>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<div className="flex min-h-0 flex-1 flex-col">
						<SetupCard file={shown} versions={SAMPLE_VERSIONS} />
					</div>
				</div>
			</div>
		</>
	);
}

const pullRequest = (number: number, title: string): SessionPullRequest => ({
	authorLogin: "you",
	draft: false,
	headRef: "feature/session-figures",
	mergedAt: AT,
	number,
	relations: ["pr_named"],
	repository: "you/app",
	state: "merged",
	title,
});

const SAMPLE_PULLS = getCiPulls(
	[
		pullRequest(330, "perf: price only the sessions a dashboard reports on"),
		pullRequest(331, "fix: re-apply the retirement when its views revert"),
		pullRequest(332, "feat(web): show sessions' scores in the list"),
		pullRequest(333, "feat: the session reader opens on its summary"),
		pullRequest(334, "fix: keep the rail's range when switching tabs"),
		pullRequest(335, "chore(deps): bump the setup-node action"),
		pullRequest(336, "feat: answers carry the runs they were read from"),
		pullRequest(337, "fix: stop the history cron re-reading candidates"),
		pullRequest(338, "perf: let Postgres sleep while nobody uses the app"),
		pullRequest(339, "feat(api): repo files read from GitHub on demand"),
		pullRequest(340, "fix: batch session deletes and reconcile timeouts"),
		pullRequest(341, "feat: the skill page shows the whole folder"),
		pullRequest(342, "fix(ci): run the skill's SQL examples"),
		pullRequest(343, "perf: share identical dashboard queries"),
	],
	[],
);

export function CiColumnsSample({ agent, model, run }: Pick) {
	const rows = useCiPullRows(SAMPLE_PULLS);
	const shown = rows[0];
	return (
		<>
			<CiPullColumn
				agent={agent}
				model={model}
				onPick={NOOP}
				onPickRun={NOOP}
				picked={shown?.entry.key ?? null}
				pickedRun={null}
				rows={rows}
				run={run}
				unplaced={0}
			/>
			<div
				className={cn(
					"mt-(--panes-top) flex min-h-0 min-w-0 flex-1 overflow-hidden",
					CARD,
				)}
			>
				{shown ? (
					<CiPullCard
						onPickRun={NOOP}
						pickedRun={null}
						reachedBy={null}
						row={shown}
					/>
				) : null}
			</div>
		</>
	);
}
