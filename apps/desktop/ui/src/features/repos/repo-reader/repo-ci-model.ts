import type { RepositoryPullRequest } from "@rudel/api-routes";
import { isTitleCheck } from "@/features/sessions/reader/ci/session-reader-ci-model";
import {
	type CiRound,
	type CiRoundsSummary,
	getCiRounds,
	jobBaseName,
	summarizeCiRounds,
} from "@/features/sessions/reader/ci/session-reader-ci-rounds";

export type FirstTry = "green" | "fixed" | "red" | "flaky" | "none";

export type RepoPull = {
	key: string;
	pull: RepositoryPullRequest;
	rounds: CiRound[];
	summary: CiRoundsSummary;
	firstTry: FirstTry;
	openedAt: number;
	endedAt: number | null;
	greenAt: number | null;
	redWaitMs: number;
	ciMs: number;
};

export type JobStat = {
	job: string;
	firstPushFails: number;
	laterFails: number;
	flaky: number;
	pulls: RepoPull[];
	lostMs: number;
	byWeek: number[];
};

const at = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
const isGreen = (round: CiRound) =>
	round.outcome === "passed" || round.outcome === "flaky";

function firstTryOf(
	rounds: readonly CiRound[],
	summary: CiRoundsSummary,
): FirstTry {
	const first = rounds[0];
	if (!first) return "none";
	if (first.outcome === "passed") return "green";
	if (first.outcome === "flaky") return "flaky";
	return summary.green ? "fixed" : "red";
}

export function getRepoPulls(
	pullRequests: readonly RepositoryPullRequest[],
): RepoPull[] {
	return pullRequests.map((pull) => {
		const rounds = getCiRounds(pull.ci.filter((run) => !isTitleCheck(run)));
		const summary = summarizeCiRounds(rounds);
		const green = rounds.find(isGreen);
		const greenAt = green ? at(green.at) + (green.ciMs ?? 0) : null;
		const opened = at(pull.createdAt);
		const firstPush = at(rounds[0]?.at ?? null);
		const ended = at(pull.mergedAt ?? pull.closedAt);
		return {
			key: `${pull.repository}#${pull.number}`,
			pull,
			rounds,
			summary,
			firstTry: firstTryOf(rounds, summary),
			openedAt: Number.isNaN(opened) ? firstPush : opened,
			endedAt: Number.isNaN(ended) ? null : ended,
			greenAt,
			redWaitMs: rounds
				.filter((round) => !isGreen(round) && round.outcome !== "running")
				.reduce((sum, round) => sum + (round.untilNextMs ?? 0), 0),
			ciMs: rounds.reduce((sum, round) => sum + (round.ciMs ?? 0), 0),
		};
	});
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

export function getJobStats(pulls: readonly RepoPull[], weeks = 8): JobStat[] {
	const now = Math.max(
		...pulls.map((each) => each.openedAt).filter(Number.isFinite),
		0,
	);
	const stats = new Map<string, JobStat>();
	const statOf = (job: string) => {
		const found = stats.get(job);
		if (found) return found;
		const made: JobStat = {
			job,
			firstPushFails: 0,
			laterFails: 0,
			flaky: 0,
			pulls: [],
			lostMs: 0,
			byWeek: Array.from({ length: weeks }, () => 0),
		};
		stats.set(job, made);
		return made;
	};
	for (const pull of pulls)
		pull.rounds.forEach((round, index) => {
			if (round.outcome !== "failed" && round.outcome !== "flaky") return;
			for (const job of new Set(round.failedJobs.map(jobBaseName))) {
				const stat = statOf(job);
				if (round.outcome === "flaky") stat.flaky += 1;
				else if (index === 0) stat.firstPushFails += 1;
				else stat.laterFails += 1;
				if (!stat.pulls.includes(pull)) stat.pulls.push(pull);
				stat.lostMs += round.untilNextMs ?? 0;
				const week = Math.floor((now - at(round.at)) / WEEK_MS);
				if (week >= 0 && week < weeks) stat.byWeek[weeks - 1 - week] += 1;
			}
		});
	return [...stats.values()].sort(
		(a, b) =>
			b.firstPushFails +
			b.laterFails +
			b.flaky -
			(a.firstPushFails + a.laterFails + a.flaky),
	);
}

export function firstTryCounts(pulls: readonly RepoPull[]) {
	const counts: Record<FirstTry, number> = {
		green: 0,
		fixed: 0,
		red: 0,
		flaky: 0,
		none: 0,
	};
	for (const pull of pulls) counts[pull.firstTry] += 1;
	const withCi = pulls.length - counts.none;
	return {
		counts,
		withCi,
		firstTryRate: withCi > 0 ? (counts.green + counts.flaky) / withCi : 0,
	};
}

export const OUTCOME_TONE: Record<CiRound["outcome"], string> = {
	passed: "bg-success",
	failed: "bg-error",
	flaky: "bg-warning-translucent",
	running: "bg-accent-line",
	cancelled: "bg-ink-disabled",
	// design-escape-ok(opacity): no role renders this; ink-3/30
	other: "bg-ink-3/30",
};

export const FIRST_TRY_WORDS: Record<FirstTry, string> = {
	green: "Green on the first push",
	flaky: "Green on the first push, after a flaky rerun",
	fixed: "Red first, fixed by a later push",
	red: "Never went green",
	none: "No CI",
};

export function formatSpan(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0m";
	const minutes = Math.round(ms / 60000);
	if (minutes < 60) return `${minutes}m`;
	const hours = minutes / 60;
	if (hours < 48)
		return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
	return `${Math.round(hours / 24)}d`;
}
