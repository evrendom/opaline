import type { SessionPullRequest } from "@rudel/api-routes";
import {
	IconCircleCheck,
	IconCircleDashed,
	IconCircleX,
	IconRepeat,
	IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CI_STATUS } from "../detail/step/session-reader-step-fields";
import { formatReaderDuration } from "../model/session-reader-model";
import { ciLook } from "../summary/session-reader-summary-github";
import { Glyph } from "../summary/session-reader-summary-sections";
import type { SummaryCiRun } from "../summary/session-summary-model";
import { GitHubLink } from "./session-reader-ci-link";
import { isFailed, runDurationMs } from "./session-reader-ci-model";
import { formatWhen } from "./session-reader-ci-parts";
import {
	type CiRound,
	type CiRoundOutcome,
	pullEndWords,
	pushOutcomeWords,
} from "./session-reader-ci-rounds";
import { ciJobUrl, ciRunUrl } from "./session-reader-run-ci";

const OUTCOME = {
	cancelled: {
		className: "",
		icon: IconCircleDashed,
		label: "Cancelled",
	},
	failed: {
		className: "text-rose-500",
		icon: IconCircleX,
		label: "Failed",
	},
	other: { className: "", icon: IconCircleDashed, label: "Ended" },
	passed: {
		className: "text-emerald-500",
		icon: IconCircleCheck,
		label: "Passed",
	},
	flaky: {
		className: "text-amber-500",
		icon: IconRepeat,
		label: "Flaky",
	},
	running: {
		className: "text-amber-500",
		icon: IconCircleDashed,
		label: "Running",
	},
} satisfies Record<
	CiRoundOutcome,
	{ className: string; icon: typeof IconCircleX; label: string }
>;

const duration = (ms: number) => formatReaderDuration(ms / 1000);

const DOT: Record<CiRoundOutcome, string> = {
	cancelled: "border border-muted-foreground/50",
	failed: "bg-rose-500",
	other: "bg-muted-foreground/40",
	passed: "bg-emerald-500",
	flaky: "bg-amber-500",
	running: "animate-pulse bg-amber-400",
};

export const isRoundPicked = (round: CiRound, pickedRun: string | null) =>
	round.runs.some((run) => run.ciRunId === pickedRun);

function roundWords(round: CiRound, index: number) {
	return [
		`Push ${index + 1}`,
		`${OUTCOME[round.outcome].label}${round.failedJobs.length > 0 ? ` on ${round.failedJobs.join(", ")}` : ""}`,
		round.sha.slice(0, 7),
		formatWhen(round.at),
	].join(" · ");
}

const MARKS_SHOWN = 8;
const COMPACT_MARKS_SHOWN = 16;

export function CiRoundMarks({
	compact = false,
	rounds,
}: {
	compact?: boolean;
	rounds: readonly CiRound[];
}) {
	if (rounds.length === 0) return null;
	const shown = rounds.slice(0, compact ? COMPACT_MARKS_SHOWN : MARKS_SHOWN);
	const rest = rounds.length - shown.length;
	return (
		<span
			role="img"
			aria-label={`CI on ${rounds.length} ${rounds.length === 1 ? "push" : "pushes"}`}
			className={cn(
				"flex shrink-0 items-center",
				compact ? "gap-0.5" : "gap-[3px]",
			)}
		>
			{shown.map((round, index) => (
				<span
					key={round.sha}
					title={roundWords(round, index)}
					className={cn(
						"rounded-full",
						compact ? "size-1" : "size-1.5",
						DOT[round.outcome],
					)}
				/>
			))}
			{rest > 0 ? (
				<span
					className={cn(
						"text-muted-foreground tabular-nums",
						compact ? "text-[9px] leading-none" : "text-[10px]",
					)}
				>
					+{rest}
				</span>
			) : null}
		</span>
	);
}

export function CiRoundDots({
	onPick,
	pickedRun,
	rounds,
}: {
	onPick: (ciRunId: string) => void;
	pickedRun: string | null;
	rounds: readonly CiRound[];
}) {
	return (
		<span className="flex flex-wrap items-center gap-1">
			{rounds.map((round, index) => {
				const picked = isRoundPicked(round, pickedRun);
				return (
					<button
						key={round.sha}
						type="button"
						aria-pressed={picked}
						aria-label={roundWords(round, index)}
						title={roundWords(round, index)}
						onClick={() => onPick(round.run.ciRunId)}
						className="group/dot pointer-events-auto flex size-4 items-center justify-center rounded-full outline-none"
					>
						<span
							className={cn(
								"size-2 rounded-full transition-transform group-hover/dot:scale-125",
								DOT[round.outcome],
								picked &&
									"scale-125 ring-2 ring-foreground/70 ring-offset-1 ring-offset-background",
							)}
						/>
					</button>
				);
			})}
		</span>
	);
}

export function CiPushDetail({
	index,
	repository,
	round,
	total,
}: {
	index: number;
	repository: string;
	round: CiRound<SummaryCiRun>;
	total: number;
}) {
	const look = OUTCOME[round.outcome];
	return (
		<section className="flex flex-col gap-2 rounded-lg bg-muted/40 py-3">
			<div className="flex min-w-0 flex-col gap-1 px-3">
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<Glyph icon={look.icon} className={cn("size-4", look.className)} />
					<span className="font-medium">
						Push {index + 1} of {total}
					</span>
					<span
						className={cn(
							"min-w-0 truncate",
							round.outcome === "failed"
								? "text-rose-600 dark:text-rose-400"
								: "text-muted-foreground",
						)}
					>
						{look.label}
						{round.failedJobs.length > 0
							? ` on ${round.failedJobs.join(", ")}`
							: ""}
					</span>
					{repository ? (
						<GitHubLink
							href={`https://github.com/${repository}/commit/${round.sha}`}
							label="Open the commit on GitHub"
						/>
					) : null}
				</div>
				<p className="text-xs text-muted-foreground tabular-nums">
					{[
						`${round.run.headBranch} @${round.sha.slice(0, 7)}`,
						`pushed ${formatWhen(round.at)}`,
						round.ciMs !== null ? `CI took ${duration(round.ciMs)}` : null,
						round.untilNextMs !== null
							? `next push ${duration(round.untilNextMs)} later`
							: "the last push",
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
			</div>
			<ul className="flex flex-col px-3">
				{round.runs.map((run) => (
					<PushRun key={run.ciRunId} run={run} />
				))}
			</ul>
		</section>
	);
}

function PushRun({ run }: { run: SummaryCiRun }) {
	const look = ciLook(run.conclusion);
	const failed = isFailed(run.conclusion)
		? run.jobs.filter((job) => isFailed(job.conclusion))
		: [];
	const took = runDurationMs(run);
	const github = ciRunUrl(run);
	return (
		<li className="flex min-h-7 min-w-0 items-center gap-2 text-xs">
			<Glyph icon={look.icon} className={cn("size-3.5", look.className)} />
			<span className="shrink-0 font-medium">
				{run.workflowName}
				{run.attempt > 1 ? (
					<span className="font-normal text-muted-foreground">
						{" "}
						· attempt {run.attempt}
					</span>
				) : null}
			</span>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
				{failed.length > 0 ? (
					failed.map((job) => {
						const log = ciJobUrl(run, job);
						return log ? (
							<a
								key={job.jobId}
								href={log}
								target="_blank"
								rel="noreferrer"
								title={`Open ${job.name}'s log on GitHub`}
								className="truncate text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
							>
								{job.name}
							</a>
						) : (
							<span
								key={job.jobId}
								className="truncate text-rose-600 dark:text-rose-400"
							>
								{job.name}
							</span>
						);
					})
				) : (
					<span className="text-muted-foreground">
						{run.conclusion
							? (CI_STATUS[run.conclusion] ?? run.conclusion)
							: "Running"}
					</span>
				)}
			</span>
			{took !== null ? (
				<span className="shrink-0 text-muted-foreground tabular-nums">
					{duration(took)}
				</span>
			) : null}
			{github ? (
				<GitHubLink href={github} label="Open the run on GitHub" />
			) : null}
		</li>
	);
}

const END_DOT = {
	closed: "bg-rose-500",
	merged: "bg-violet-500",
	open: "border border-muted-foreground/50",
};

function LineNode({
	above,
	below,
	className,
	cross = false,
}: {
	above: boolean;
	below: boolean;
	className: string;
	cross?: boolean;
}) {
	return (
		<span className="relative flex justify-center pt-[3px]">
			{above ? (
				<span className="absolute -top-1.5 h-[7px] w-px bg-border" />
			) : null}
			<span
				className={cn(
					"flex size-3 items-center justify-center rounded-full text-muted-foreground",
					className,
				)}
			>
				{cross ? (
					<IconX aria-hidden="true" className="size-2" stroke={3} />
				) : null}
			</span>
			{below ? (
				<span className="absolute top-[17px] -bottom-1.5 w-px bg-border" />
			) : null}
		</span>
	);
}

export function CiRounds({
	onPickRun,
	pickedRun,
	pull,
	rounds,
}: {
	onPickRun: (ciRunId: string) => void;
	pickedRun: string | null;
	pull: SessionPullRequest | null;
	rounds: readonly CiRound<SummaryCiRun>[];
}) {
	if (rounds.length === 0) return null;
	const longest = Math.max(1, ...rounds.map((round) => round.ciMs ?? 0));
	const ending = pullEndWords(rounds, pull);
	return (
		<section className="flex flex-col gap-1">
			<h3 className="px-3 text-xs font-medium text-foreground/80">Pushes</h3>
			<ol className="flex flex-col">
				{rounds.map((round, index) => {
					const picked = isRoundPicked(round, pickedRun);
					const below = index < rounds.length - 1 || ending !== null;
					const failed =
						round.outcome === "failed" || round.outcome === "flaky";
					return (
						<li key={round.sha} className="flex flex-col">
							<button
								type="button"
								aria-pressed={picked}
								aria-label={roundWords(round, index)}
								title={roundWords(round, index)}
								onClick={() => onPickRun(round.run.ciRunId)}
								className={cn(
									"grid w-full grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 rounded-lg px-3 py-1.5 text-left transition-colors",
									picked ? "bg-muted ring-1 ring-border" : "hover:bg-muted/40",
								)}
							>
								<LineNode
									above={index > 0}
									below={below}
									className={DOT[round.outcome]}
									cross={round.outcome === "cancelled"}
								/>
								<span className="flex min-w-0 flex-col gap-1">
									<span className="flex min-w-0 items-baseline gap-2 text-xs">
										<span className="shrink-0 font-medium">
											Push {index + 1}
										</span>
										<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
											{round.sha.slice(0, 7)}
										</span>
										{failed ? (
											<span
												className={cn(
													"min-w-0 truncate",
													round.outcome === "failed"
														? "text-rose-600 dark:text-rose-400"
														: "text-amber-600 dark:text-amber-400",
												)}
											>
												{pushOutcomeWords(round)}
											</span>
										) : null}
										<span className="ml-auto shrink-0 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
											{formatWhen(round.at)}
										</span>
									</span>
									<span className="flex items-center gap-2">
										<span className="h-1.5 min-w-0 flex-1">
											{round.ciMs !== null ? (
												<span
													className="block h-full min-w-[2px] rounded-full bg-muted-foreground/35"
													style={{
														width: `${(round.ciMs / longest) * 100}%`,
													}}
												/>
											) : null}
										</span>
										<span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
											{round.ciMs !== null ? duration(round.ciMs) : "—"}
										</span>
									</span>
								</span>
							</button>
							{round.untilNextMs !== null ? (
								<span className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 px-3">
									<span className="flex justify-center">
										<span className="w-px bg-border" />
									</span>
									<span className="py-0.5 text-[11px] text-muted-foreground tabular-nums">
										{duration(round.untilNextMs)} until the next push
									</span>
								</span>
							) : null}
						</li>
					);
				})}
				{ending && pull ? (
					<li className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 px-3 py-1.5 text-xs text-muted-foreground">
						<LineNode
							above
							below={false}
							className={
								END_DOT[
									pull.mergedAt
										? "merged"
										: pull.state === "closed"
											? "closed"
											: "open"
								]
							}
						/>
						<span>{ending}</span>
					</li>
				) : null}
			</ol>
		</section>
	);
}
