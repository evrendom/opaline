import { IconBrandGithub } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ScrollColumn } from "../files/session-reader-files-parts";
import { PickStrip } from "../rail/session-reader-pick-strip";
import { pullRequestLook } from "../summary/session-reader-summary-github";
import type { SummaryCiRun } from "../summary/session-summary-model";
import { GitHubLink } from "./session-reader-ci-link";
import { type CiPull, isTitleCheck } from "./session-reader-ci-model";
import {
	type CiLinePart,
	type CiRound,
	type CiRoundsSummary,
	ciLine,
	getCiRounds,
	summarizeCiRounds,
} from "./session-reader-ci-rounds";
import {
	CiPushDetail,
	CiRoundDots,
	CiRounds,
	isRoundPicked,
} from "./session-reader-ci-rounds-view";
import { pullRequestUrl } from "./session-reader-run-ci";

const TONE: Record<CiLinePart["tone"], string> = {
	failed: "text-rose-600 dark:text-rose-400",
	flaky: "text-amber-600 dark:text-amber-400",
	muted: "text-muted-foreground",
	passed: "text-emerald-600 dark:text-emerald-400",
	running: "text-amber-600 dark:text-amber-400",
};

export type CiPullRow = {
	entry: CiPull;
	rounds: CiRound<SummaryCiRun>[];
	runs: SummaryCiRun[];
	summary: CiRoundsSummary;
	titleChecks: number;
};

export function useCiPullRows(pulls: readonly CiPull[]): CiPullRow[] {
	return useMemo(
		() =>
			pulls.map((entry) => {
				const runs = entry.runs.filter((run) => !isTitleCheck(run));
				const rounds = getCiRounds(runs);
				return {
					entry,
					rounds,
					runs,
					summary: summarizeCiRounds(rounds),
					titleChecks: entry.runs.length - runs.length,
				};
			}),
		[pulls],
	);
}

export function defaultPullRow(rows: readonly CiPullRow[]) {
	return (
		rows.find((row) => row.summary.red > 0) ??
		rows.find((row) => row.summary.flaky > 0) ??
		rows[0]
	);
}

export function CiPullColumn({
	agent,
	model,
	onPick,
	onPickRun,
	picked,
	pickedRun,
	rows,
	run,
	unplaced,
}: {
	agent: string | null;
	model: string | null;
	onPick: (key: string) => void;
	onPickRun: (ciRunId: string | null, pullKey: string) => void;
	picked: string | null;
	pickedRun: string | null;
	rows: readonly CiPullRow[];
	run: string | null;
	unplaced: number;
}) {
	const prs = rows.filter((row) => row.entry.pull).length;
	return (
		<div className="-mb-2 flex min-h-0 w-[380px] shrink-0 flex-col gap-1.5 pt-(--panes-top)">
			<PickStrip
				agent={agent}
				model={model}
				run={run}
				summary={`${prs} ${prs === 1 ? "PR" : "PRs"}`}
			/>
			<ScrollColumn className="-mx-1 px-1 pb-8">
				{rows.length === 0 ? (
					<p className="py-1 pl-2 text-[11px] text-muted-foreground">
						{agent
							? "This subagent reached no CI."
							: "No CI reached in this run."}
					</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{rows.map((row) => (
							<li key={row.entry.key}>
								<PullLine
									isPicked={row.entry.key === picked}
									onPick={() => onPick(row.entry.key)}
									onPickRun={(ciRunId) =>
										onPickRun(
											ciRunId === pickedRun ? null : ciRunId,
											row.entry.key,
										)
									}
									pickedRun={pickedRun}
									row={row}
								/>
							</li>
						))}
					</ul>
				)}
				{!run && unplaced > 0 ? (
					<p className="px-2.5 py-2 text-[11px] text-muted-foreground">
						{unplaced} more {unplaced === 1 ? "run" : "runs"} reached CI with no
						line in the rail to match; their CI shows here.
					</p>
				) : null}
			</ScrollColumn>
		</div>
	);
}

function pullTitle(entry: CiPull) {
	return entry.pull
		? (entry.pull.title ?? `Pull request #${entry.pull.number}`)
		: "CI tied to no pull request";
}

function pullLook(entry: CiPull) {
	return entry.pull
		? pullRequestLook(entry.pull)
		: { className: "", icon: IconBrandGithub, label: "" };
}

function CiLine({
	className,
	summary,
}: {
	className?: string;
	summary: CiRoundsSummary;
}) {
	const parts = ciLine(summary);
	return (
		<span
			className={cn(
				"flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums",
				className,
			)}
		>
			{parts.map((part, index) => (
				<span key={part.text} className="inline-flex items-baseline gap-1.5">
					{index > 0 ? (
						<span aria-hidden="true" className="text-muted-foreground/50">
							·
						</span>
					) : null}
					<span className={TONE[part.tone]}>{part.text}</span>
				</span>
			))}
		</span>
	);
}

function PullLine({
	isPicked,
	onPick,
	onPickRun,
	pickedRun,
	row,
}: {
	isPicked: boolean;
	onPick: () => void;
	onPickRun: (ciRunId: string) => void;
	pickedRun: string | null;
	row: CiPullRow;
}) {
	const { pull } = row.entry;
	const look = pullLook(row.entry);
	const PullGlyph = look.icon;
	return (
		<div
			className={cn(
				"relative flex flex-col gap-1 rounded-md px-2.5 py-1.5 transition-colors",
				isPicked ? "bg-muted" : "hover:bg-muted/50",
			)}
		>
			<button
				type="button"
				aria-current={isPicked || undefined}
				onClick={onPick}
				className="flex w-full cursor-pointer items-start gap-2.5 text-left outline-none after:absolute after:inset-0 after:rounded-md"
			>
				<PullGlyph
					aria-hidden="true"
					className={cn(
						"mt-px size-4 shrink-0",
						look.className || "text-muted-foreground/70",
					)}
				/>
				<span
					title={pull?.title ?? undefined}
					className={cn(
						"min-w-0 flex-1 truncate text-xs",
						isPicked ? "text-foreground" : "text-foreground/90",
					)}
				>
					{pullTitle(row.entry)}
				</span>
				{pull ? (
					<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
						#{pull.number}
					</span>
				) : null}
			</button>
			{row.rounds.length > 0 ? (
				<div className="pointer-events-none relative flex min-w-0 items-center pl-6.5">
					<CiRoundDots
						onPick={onPickRun}
						pickedRun={pickedRun}
						rounds={row.rounds}
					/>
				</div>
			) : null}
		</div>
	);
}

export function CiPullCard({
	onPickRun,
	pickedRun,
	reachedBy,
	row,
}: {
	onPickRun: (ciRunId: string | null) => void;
	pickedRun: string | null;
	reachedBy: ReactNode;
	row: CiPullRow;
}) {
	const { pull } = row.entry;
	const look = pullLook(row.entry);
	const PullGlyph = look.icon;
	const pick = (ciRunId: string) =>
		onPickRun(ciRunId === pickedRun ? null : ciRunId);
	const pushIndex = row.rounds.findIndex((round) =>
		isRoundPicked(round, pickedRun),
	);
	const push = row.rounds[pushIndex];
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<header className="flex flex-col gap-1.5 border-b border-border/50 px-5 py-4">
				<div className="flex min-w-0 items-center gap-2">
					<PullGlyph
						aria-hidden="true"
						className={cn(
							"size-4 shrink-0",
							look.className || "text-muted-foreground",
						)}
					/>
					<h2
						title={pull?.title ?? undefined}
						className="min-w-0 truncate text-sm font-medium"
					>
						{pullTitle(row.entry)}
					</h2>
					{pull?.repository ? (
						<GitHubLink
							href={pullRequestUrl(pull.repository, pull.number)}
							label={`Open #${pull.number} on GitHub`}
						/>
					) : null}
				</div>
				<p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground tabular-nums">
					{pull ? (
						<span>
							{pull.repository ? `${pull.repository}#` : "#"}
							{pull.number} · {look.label}
						</span>
					) : (
						<span>
							Runs GitHub started for a push, or for a pull request it didn't
							name.
						</span>
					)}
					{pull?.headRef ? (
						<span className="truncate font-mono text-[11px]">
							{pull.headRef}
						</span>
					) : null}
				</p>
				<CiLine className="text-xs" summary={row.summary} />
			</header>
			<ScrollColumn className="flex flex-col gap-5 px-3 py-4 *:shrink-0">
				{push ? (
					<CiPushDetail
						index={pushIndex}
						repository={push.run.repository}
						round={push}
						total={row.rounds.length}
					/>
				) : null}
				<CiRounds
					onPickRun={pick}
					pickedRun={pickedRun}
					pull={pull}
					rounds={row.rounds}
				/>
				{reachedBy ? <div className="px-3">{reachedBy}</div> : null}
				{row.runs.length === 0 ? (
					<p className="px-3 text-xs text-muted-foreground">
						{row.titleChecks > 0
							? `Only the PR Title check ran for it, ${row.titleChecks} times.`
							: "No CI linked to it."}
					</p>
				) : null}
			</ScrollColumn>
		</div>
	);
}
