import type { RunCiRun, SessionPullRequest } from "@rudel/api-routes";
import { formatReaderDuration } from "../model/session-reader-model";
import { isFailed, runDurationMs } from "./session-reader-ci-model";

export type CiRoundOutcome =
	| "cancelled"
	| "failed"
	| "other"
	| "passed"
	| "flaky"
	| "running";

export type CiRound<Run extends RunCiRun = RunCiRun> = {
	at: string;
	ciMs: number | null;
	failedJobs: string[];
	outcome: CiRoundOutcome;
	run: Run;
	runs: Run[];
	sha: string;
	untilNextMs: number | null;
};

const ms = (iso: string) => Date.parse(iso);

function outcomeOf(runs: readonly RunCiRun[]): CiRoundOutcome {
	const failed = runs.filter((run) => isFailed(run.conclusion));
	if (failed.length > 0) {
		const passedToo = failed.every((bad) =>
			runs.some(
				(good) =>
					good.conclusion === "success" &&
					good.workflowName === bad.workflowName,
			),
		);
		return passedToo ? "flaky" : "failed";
	}
	if (runs.some((run) => run.conclusion === null)) return "running";
	if (runs.some((run) => run.conclusion === "success")) return "passed";
	const ran = runs.filter((run) => run.conclusion !== "skipped");
	if (ran.length > 0 && ran.every((run) => run.conclusion === "cancelled"))
		return "cancelled";
	return "other";
}

export function getCiRounds<Run extends RunCiRun>(
	runs: readonly Run[],
): CiRound<Run>[] {
	const bySha = new Map<string, Run[]>();
	for (const run of [...runs].sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	)) {
		if (!run.headSha) continue;
		bySha.set(run.headSha, [...(bySha.get(run.headSha) ?? []), run]);
	}
	const rounds = [...bySha].map(([sha, group]): CiRound<Run> => {
		const durations = group
			.map(runDurationMs)
			.filter((each): each is number => each !== null);
		return {
			at: group[0]?.createdAt ?? "",
			ciMs: durations.length > 0 ? Math.max(...durations) : null,
			failedJobs: [
				...new Set(
					group.flatMap((run) =>
						(isFailed(run.conclusion) ? run.jobs : [])
							.filter((job) => isFailed(job.conclusion))
							.map((job) => job.name),
					),
				),
			],
			outcome: outcomeOf(group),
			run: group.find((run) => isFailed(run.conclusion)) ?? (group[0] as Run),
			runs: group,
			sha,
			untilNextMs: null,
		};
	});
	rounds.forEach((round, index) => {
		const next = rounds[index + 1];
		if (next) round.untilNextMs = Math.max(0, ms(next.at) - ms(round.at));
	});
	return rounds;
}

export type CiRoundsSummary = {
	ended: CiRoundOutcome | null;
	flaky: number;
	flakyJobs: string[];
	greenAfterMs: number | null;
	green: boolean;
	lastRed: boolean;
	pushes: number;
	red: number;
	redJobs: string[];
};

function byCount(names: readonly string[]): string[] {
	const counts = new Map<string, number>();
	for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

export function summarizeCiRounds(rounds: readonly CiRound[]): CiRoundsSummary {
	const first = rounds[0];
	const greenIndex = rounds.findIndex(
		(round) => round.outcome === "passed" || round.outcome === "flaky",
	);
	const green = rounds[greenIndex];
	const failed = rounds.filter((round) => round.outcome === "failed");
	const flaky = rounds.filter((round) => round.outcome === "flaky");
	return {
		ended: rounds.at(-1)?.outcome ?? null,
		flaky: flaky.length,
		flakyJobs: byCount(flaky.flatMap((round) => round.failedJobs)),
		green: green !== undefined,
		greenAfterMs:
			first && green && greenIndex > 0
				? ms(green.at) - ms(first.at) + (green.ciMs ?? 0)
				: null,
		lastRed: green !== undefined && rounds.at(-1)?.outcome === "failed",
		pushes: rounds.length,
		red: failed.length,
		redJobs: byCount(failed.flatMap((round) => round.failedJobs)),
	};
}

export type CiLinePart = {
	text: string;
	tone: "failed" | "flaky" | "muted" | "passed" | "running";
};

const times = (count: number) =>
	count === 1 ? "once" : count === 2 ? "twice" : `${count}×`;

export function ciLine(summary: CiRoundsSummary): CiLinePart[] {
	if (summary.pushes === 0) return [{ text: "No CI", tone: "muted" }];
	const jobs = (names: readonly string[]) =>
		names.length > 0
			? ` on ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`
			: "";
	const parts: CiLinePart[] = [];
	if (summary.ended === "running")
		parts.push({ text: "CI running", tone: "running" });
	else if (summary.ended === "failed")
		parts.push({
			text: `Ends red${jobs(summary.redJobs)}`,
			tone: "failed",
		});
	else if (!summary.green) parts.push({ text: "Never green", tone: "failed" });
	else parts.push({ text: "Green", tone: "passed" });
	const red = summary.red;
	if (red > 0 && !(summary.ended === "failed" && red === 1))
		parts.push({
			text: `red ${times(red)}${summary.ended === "failed" ? "" : jobs(summary.redJobs)}`,
			tone: "failed",
		});
	if (summary.flaky > 0)
		parts.push({
			text: `flaky${jobs(summary.flakyJobs)}`,
			tone: "flaky",
		});
	if (summary.pushes > 1)
		parts.push({
			text: `${summary.pushes} pushes`,
			tone: "muted",
		});
	return parts;
}

const duration = (value: number) => formatReaderDuration(value / 1000);

export const jobBaseName = (name: string) =>
	name.replace(/\s*\(.*\)\s*$/, "") || name;

export function jobWords(names: readonly string[]): string {
	const base = [...new Set(names.map(jobBaseName))];
	return `${base.slice(0, 2).join(", ")}${base.length > 2 ? ` +${base.length - 2}` : ""}`;
}

export const failedRunsMs = (round: CiRound) =>
	round.runs
		.filter((run) => isFailed(run.conclusion))
		.reduce((sum, run) => sum + (runDurationMs(run) ?? 0), 0);

export function pushOutcomeWords(round: CiRound): string {
	switch (round.outcome) {
		case "passed":
			return "Passed";
		case "failed":
			return `Failed on ${jobWords(round.failedJobs)}`;
		case "flaky":
			return `Flaky on ${jobWords(round.failedJobs)}, ${duration(failedRunsMs(round))} lost`;
		case "cancelled":
			return "Cancelled";
		case "running":
			return "Running";
		default:
			return "Ended";
	}
}

export function pullEndWords(
	rounds: readonly CiRound[],
	pull: SessionPullRequest | null,
): string | null {
	const first = rounds[0];
	if (!pull || !first) return null;
	if (pull.mergedAt)
		return `Merged ${duration(Math.max(0, ms(pull.mergedAt) - ms(first.at)))} after the first push`;
	return pull.state === "closed" ? "Closed without merging" : "Still open";
}
