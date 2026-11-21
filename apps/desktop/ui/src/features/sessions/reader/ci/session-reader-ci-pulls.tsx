import { IconBrandGithub } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { FluidList, useFluidListItem } from "@/components/fluid-list";
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
	failed: "text-rose-ink",
	flaky: "text-amber-ink",
	muted: "text-ink-3",
	passed: "text-emerald-ink",
	running: "text-amber-ink",
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
		<div className="-mb-m flex min-h-0 w-[380px] shrink-0 flex-col gap-s pt-(--panes-top)">
			<PickStrip
				agent={agent}
				model={model}
				run={run}
				summary={`${prs} ${prs === 1 ? "PR" : "PRs"}`}
			/>
			<ScrollColumn className="-mx-xs px-xs pb-[calc(var(--space-xxl)*4/3)]">
				{rows.length === 0 ? (
					<p className="py-xs pl-m text-body-s text-ink-3">
						{agent
							? "This subagent reached no CI."
							: "No CI reached in this run."}
					</p>
				) : (
					<FluidList>
						<ul className="flex flex-col gap-xxs">
							{rows.map((row, index) => (
								<li key={row.entry.key}>
									<PullLine
										index={index}
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
					</FluidList>
				)}
				{!run && unplaced > 0 ? (
					<p className="px-l py-m text-body-s text-ink-3">
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
				"flex min-w-0 flex-wrap items-baseline gap-x-s tabular-nums",
				className,
			)}
		>
			{parts.map((part, index) => (
				<span key={part.text} className="inline-flex items-baseline gap-s">
					{index > 0 ? (
						// design-escape-ok(opacity): no role renders this; text-ink-3/50
						<span aria-hidden="true" className="text-ink-3/50">
							·
						</span>
					) : null}
					<span className={TONE[part.tone]}>{part.text}</span>
				</span>
			))}
		</span>
	);
}

export function PullLine({
	index,
	isPicked,
	meta,
	onPick,
	onPickRun,
	pickedRun,
	row,
}: {
	index?: number;
	isPicked: boolean;
	meta?: ReactNode;
	onPick: () => void;
	onPickRun: (ciRunId: string) => void;
	pickedRun: string | null;
	row: CiPullRow;
}) {
	const { pull } = row.entry;
	const look = pullLook(row.entry);
	const PullGlyph = look.icon;
	const item = useFluidListItem<HTMLDivElement>(index);
	return (
		<div
			ref={item.ref}
			className={cn(
				"relative flex flex-col gap-xs",
				"corner-s px-l py-s corner-squircle",
				"transition-colors",
				"squircle:corner-l",
				isPicked && "bg-field",
			)}
		>
			<button
				type="button"
				aria-current={isPicked || undefined}
				onClick={onPick}
				onFocus={item.onFocus}
				className={cn(
					"flex w-full items-start gap-l",
					"text-left",
					"focus-outline",
					"after:absolute after:inset-0 after:corner-s",
				)}
			>
				<PullGlyph
					aria-hidden="true"
					className={cn(
						"mt-xxs size-4 shrink-0",
						look.className || "text-ink-disabled",
					)}
				/>
				<span
					title={pull?.title ?? undefined}
					className={cn(
						"min-w-0 flex-1 truncate text-body-m",
						// design-escape-ok(opacity): no role renders this; text-ink/90
						isPicked ? "text-ink" : "text-ink/90",
					)}
				>
					{pullTitle(row.entry)}
				</span>
				{pull ? (
					<span className="shrink-0 text-body-s text-ink-3 tabular-nums">
						#{pull.number}
					</span>
				) : null}
			</button>
			{row.rounds.length > 0 || meta ? (
				<div className="pointer-events-none relative flex min-w-0 items-center gap-m pl-xxl">
					{row.rounds.length > 0 ? (
						<CiRoundDots
							onPick={onPickRun}
							pickedRun={pickedRun}
							rounds={row.rounds}
						/>
					) : null}
					{meta ? (
						<span className="ml-auto flex shrink-0 items-center line-solid [&>*]:line-solid">
							{meta}
						</span>
					) : null}
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
			<header className="flex flex-col gap-s edge-b-m border-line-soft px-xxl py-xl">
				<div className="flex min-w-0 items-center gap-m">
					<PullGlyph
						aria-hidden="true"
						className={cn("size-4 shrink-0", look.className || "text-ink-3")}
					/>
					<h2
						title={pull?.title ?? undefined}
						className="min-w-0 truncate text-body-xl font-medium"
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
				<p
					className={cn(
						"flex min-w-0 flex-wrap items-baseline gap-x-m",
						"text-body-m tabular-nums",
						"text-ink-3",
					)}
				>
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
						<span className="truncate font-mono text-body-s">
							{pull.headRef}
						</span>
					) : null}
				</p>
				<CiLine className="text-body-m" summary={row.summary} />
			</header>
			<ScrollColumn className="flex flex-col gap-xxl px-l py-xl *:shrink-0">
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
				{reachedBy ? <div className="px-l">{reachedBy}</div> : null}
				{row.runs.length === 0 ? (
					<p className="px-l text-body-m text-ink-3">
						{row.titleChecks > 0
							? `Only the PR Title check ran for it, ${row.titleChecks} times.`
							: "No CI linked to it."}
					</p>
				) : null}
			</ScrollColumn>
		</div>
	);
}
