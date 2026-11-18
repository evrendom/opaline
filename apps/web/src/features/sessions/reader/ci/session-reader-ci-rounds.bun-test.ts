import { expect, test } from "bun:test";
import type { RunCiRun } from "@rudel/api-routes";
import { runDurationMs } from "./session-reader-ci-model";
import {
	ciLine,
	getCiRounds,
	jobBaseName,
	pullEndWords,
	pushOutcomeWords,
	summarizeCiRounds,
} from "./session-reader-ci-rounds";

const run = (
	ciRunId: string,
	headSha: string,
	createdAt: string,
	conclusion: string | null,
	failedJob?: string,
	workflowName = "CI",
): RunCiRun => ({
	attempt: 1,
	ciRunId,
	conclusion,
	createdAt,
	event: "pull_request",
	githubRunId: ciRunId,
	headBranch: "branch",
	headSha,
	jobs: [
		{
			completedAt: new Date(Date.parse(createdAt) + 600_000).toISOString(),
			conclusion: failedJob ? "failure" : conclusion,
			createdAt,
			jobId: `${ciRunId}-job`,
			name: failedJob ?? "verify",
			runnerName: "",
			startedAt: createdAt,
			status: "completed",
		},
	],
	link: "exact",
	pullRequests: [1],
	relations: [],
	repository: "owner/repo",
	workflowName,
});

test("rounds follow the pushes, red then green", () => {
	const rounds = getCiRounds([
		run("b", "sha2", "2026-10-16T10:21:00.000Z", "success"),
		run("a", "sha1", "2026-10-16T10:08:00.000Z", "failure", "integration"),
	]);
	expect(rounds.map((round) => [round.sha, round.outcome])).toEqual([
		["sha1", "failed"],
		["sha2", "passed"],
	]);
	expect(rounds[0]?.failedJobs).toEqual(["integration"]);
	expect(rounds[0]?.untilNextMs).toBe(13 * 60_000);
	expect(rounds[1]?.untilNextMs).toBeNull();
	expect(summarizeCiRounds(rounds)).toEqual({
		ended: "passed",
		flaky: 0,
		flakyJobs: [],
		green: true,
		lastRed: false,
		greenAfterMs: 23 * 60_000,
		pushes: 2,
		red: 1,
		redJobs: ["integration"],
	});
});

test("a workflow that failed then passed on the same commit is flaky", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T21:13:00.000Z", "failure", "integration"),
		run("b", "sha1", "2026-10-16T21:30:00.000Z", "success"),
	]);
	expect(rounds).toHaveLength(1);
	expect(rounds[0]?.outcome).toBe("flaky");
	expect(rounds[0]?.run.ciRunId).toBe("a");
	expect(summarizeCiRounds(rounds).flaky).toBe(1);
	expect(summarizeCiRounds(rounds).red).toBe(0);
	expect(summarizeCiRounds(rounds).flakyJobs).toEqual(["integration"]);
});

test("passed first, then failed on a second run of the commit: flaky too", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T20:05:10.000Z", "success"),
		run("b", "sha1", "2026-10-16T20:23:29.000Z", "failure", "integration"),
	]);
	expect(rounds[0]?.outcome).toBe("flaky");
	expect(rounds[0]?.failedJobs).toEqual(["integration"]);
});

test("a failure in another workflow is not undone by a pass", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T21:13:00.000Z", "failure", "e2e", "E2E"),
		run("b", "sha1", "2026-10-16T21:30:00.000Z", "success"),
	]);
	expect(rounds[0]?.outcome).toBe("failed");
});

test("superseded pushes read as cancelled, and a pass among cancels as passed", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T10:07:00.000Z", "cancelled"),
		run("b", "sha2", "2026-10-16T10:17:00.000Z", "cancelled"),
		run("c", "sha2", "2026-10-16T10:18:00.000Z", "success"),
	]);
	expect(rounds.map((round) => round.outcome)).toEqual(["cancelled", "passed"]);
	expect(summarizeCiRounds(rounds).red).toBe(0);
});

test("a workflow that skipped beside a cancelled one leaves the push cancelled", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T10:07:00.000Z", "cancelled"),
		run(
			"b",
			"sha1",
			"2026-10-16T10:07:00.000Z",
			"skipped",
			undefined,
			"Deploy preview",
		),
		run("c", "sha2", "2026-10-16T10:09:00.000Z", "skipped"),
	]);
	expect(rounds.map((round) => round.outcome)).toEqual(["cancelled", "other"]);
});

test("a cancelled run's failed job isn't the round's", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T10:07:00.000Z", "cancelled", "cli-smoke"),
		run("b", "sha1", "2026-10-16T10:08:00.000Z", "success"),
	]);
	expect(rounds[0]?.outcome).toBe("passed");
	expect(rounds[0]?.failedJobs).toEqual([]);
});

test("the last push red after a green one", () => {
	const summary = summarizeCiRounds(
		getCiRounds([
			run("a", "sha1", "2026-10-16T10:07:00.000Z", "success"),
			run("b", "sha2", "2026-10-16T10:30:00.000Z", "failure", "verify"),
		]),
	);
	expect(summary.lastRed).toBe(true);
});

test("never green", () => {
	const summary = summarizeCiRounds(
		getCiRounds([
			run("a", "sha1", "2026-10-16T10:07:00.000Z", "failure", "verify"),
		]),
	);
	expect(summary.green).toBe(false);
	expect(summary.greenAfterMs).toBeNull();
});

const line = (runs: RunCiRun[]) =>
	ciLine(summarizeCiRounds(getCiRounds(runs)))
		.map((part) => part.text)
		.join(" · ");

test("a line: green after red, with what the red cost", () => {
	expect(
		line([
			run("a", "sha1", "2026-10-16T10:00:00.000Z", "success"),
			run("b", "sha2", "2026-10-16T10:10:00.000Z", "failure", "integration"),
			run("c", "sha3", "2026-10-16T10:30:00.000Z", "failure", "integration"),
			run("d", "sha4", "2026-10-16T10:41:00.000Z", "success"),
		]),
	).toBe("Green · red twice on integration · 4 pushes");
});

test("a line: green first time", () => {
	expect(line([run("a", "sha1", "2026-10-16T10:00:00.000Z", "success")])).toBe(
		"Green",
	);
});

test("a line: flaky, and ending red", () => {
	expect(
		line([
			run("a", "sha1", "2026-10-16T21:13:00.000Z", "failure", "integration"),
			run("b", "sha1", "2026-10-16T21:30:00.000Z", "success"),
			run("c", "sha2", "2026-10-16T22:00:00.000Z", "failure", "verify"),
		]),
	).toBe("Ends red on verify · flaky on integration · 2 pushes");
});

test("a matrix job reads as one job", () => {
	expect(jobBaseName("cli-smoke (blacksmith-4vcpu-ubuntu-2404, 20)")).toBe(
		"cli-smoke",
	);
	expect(jobBaseName("integration")).toBe("integration");
});

test("a rerun's time starts at its own jobs, not the run's creation", () => {
	const rerun = run("r", "sha1", "2026-10-16T10:20:00.000Z", "success");
	expect(
		runDurationMs({
			...rerun,
			attempt: 2,
			createdAt: "2026-10-16T10:00:00.000Z",
		}),
	).toBe(10 * 60_000);
});

test("each push in words, and how the pull request ended", () => {
	const rounds = getCiRounds([
		run("a", "sha1", "2026-10-16T10:00:00.000Z", "failure", "integration"),
		run(
			"b",
			"sha2",
			"2026-10-16T10:20:00.000Z",
			"failure",
			"integration (ubuntu, 20)",
		),
		run("c", "sha2", "2026-10-16T10:40:00.000Z", "success"),
	]);
	expect(rounds.map(pushOutcomeWords)).toEqual([
		"Failed on integration",
		"Flaky on integration, 10m lost",
	]);
	const pull = {
		authorLogin: null,
		draft: false,
		headRef: null,
		mergedAt: "2026-10-16T11:30:00.000Z",
		number: 1,
		relations: [],
		repository: "owner/repo",
		state: "closed",
		title: null,
	};
	expect(pullEndWords(rounds, pull)).toBe("Merged 1.5h after the first push");
	expect(pullEndWords(rounds, { ...pull, mergedAt: null })).toBe(
		"Closed without merging",
	);
});
