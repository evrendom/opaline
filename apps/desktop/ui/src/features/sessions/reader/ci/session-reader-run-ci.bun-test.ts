import { expect, test } from "bun:test";
import type { RunCiJob, RunCiRun } from "@rudel/api-routes";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../model/session-reader-run-steps";
import { CI_WINDOW_GROUP_ID, ciUrl, withRunCi } from "./session-reader-run-ci";

const T0 = Date.parse("2026-10-14T08:46:10.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1_000).toISOString();

const step = (id: string, from: number, to: number): SessionReaderStep => ({
	children: [],
	detail: null,
	endMs: T0 + to * 1_000,
	icon: null,
	id,
	isError: false,
	kind: "tool",
	name: "Bash",
	nativeId: null,
	result: null,
	startMs: T0 + from * 1_000,
	text: null,
	toolEvent: null,
});

const job = (
	jobId: string,
	created: number,
	started: number | null,
	completed: number | null,
	conclusion: string | null,
): RunCiJob => ({
	completedAt: completed === null ? null : at(completed),
	conclusion,
	createdAt: at(created),
	jobId,
	name: jobId,
	runnerName: "blacksmith-4vcpu",
	startedAt: started === null ? null : at(started),
	status: conclusion === null ? "in_progress" : "completed",
});

const ciRun = (
	githubRunId: string,
	link: RunCiRun["link"],
	created: number,
	jobs: RunCiJob[],
	conclusion: string | null = "failure",
): RunCiRun => ({
	attempt: 1,
	ciRunId: `1345271521/actions_run/${githubRunId}/1`,
	conclusion,
	createdAt: at(created),
	event: "pull_request",
	githubRunId,
	headBranch: "feat/run-questions-dashboard",
	headSha: "e96c449b0000000000000000000000000000000",
	jobs,
	link,
	pullRequests: link === "pr_window" ? [301] : [],
	relations: link === "pr_window" ? ["pr_named"] : ["ci_named"],
	repository: "opalinehq/athena",
	workflowName: "CI",
});

const waterfall: SessionReaderWaterfall = (() => {
	const steps = [
		step("merge", 0, 23),
		step("push", 75, 80),
		step("watch", 600, 1_090),
	];
	return {
		allSteps: steps,
		endMs: T0 + 1_091 * 1_000,
		model: null,
		startMs: T0,
		steps,
	};
})();

test("without CI the waterfall is the same object", () => {
	expect(withRunCi(waterfall, [], T0)).toBe(waterfall);
});

test("an exact CI run sits among the run's steps by when it started, its jobs beneath", () => {
	const ci = ciRun("38537619754", "exact", 75, [
		job("verify", 75, 83, 140, "failure"),
		job("changes", 75, 83, 92, "success"),
	]);
	const result = withRunCi(waterfall, [ci], T0 + 2_000_000);
	expect(result.steps.map((each) => each.id)).toEqual([
		"merge",
		"push",
		"ci:1345271521/actions_run/38537619754/1",
		"watch",
	]);
	const row = result.steps[2] as SessionReaderStep;
	expect(row.kind).toBe("ci");
	expect(row.name).toBe("CI · feat/run-questions-dashboard");
	expect(row.isError).toBe(true);
	expect(row.children.map((each) => each.name)).toEqual(["verify", "changes"]);
	expect(row.endMs).toBe(T0 + 140_000);
	expect(result.allSteps).toHaveLength(6);
	expect(result.endMs).toBe(waterfall.endMs);
});

test("a job's queued time ends when it started", () => {
	const ci = ciRun("1", "exact", 75, [job("verify", 75, 83, 140, "failure")]);
	const [jobRow] = (
		withRunCi(waterfall, [ci], T0).steps[2] as SessionReaderStep
	).children;
	expect(jobRow?.startMs).toBe(T0 + 75_000);
	expect(jobRow?.ci).toMatchObject({ kind: "job", startedMs: T0 + 83_000 });
	expect(jobRow?.isError).toBe(true);
});

test("CI that runs on past the run keeps its end, off the run's axis", () => {
	const ci = ciRun(
		"2",
		"exact",
		1_000,
		[job("integration", 1_000, 1_010, 1_800, "success")],
		"success",
	);
	const result = withRunCi(waterfall, [ci], T0);
	expect(result.endMs).toBe(waterfall.endMs);
	expect(
		result.allSteps.find((step) => step.name === "integration")?.endMs,
	).toBe(T0 + 1_800_000);
});

test("CI the run named from before it began keeps its start, off the run's axis", () => {
	const ci = ciRun("3", "exact", -900, [
		job("check", -900, -896, -560, "failure"),
	]);
	const result = withRunCi(waterfall, [ci], T0);
	expect(result.startMs).toBe(waterfall.startMs);
	expect(result.steps[0]?.id).toBe("ci:1345271521/actions_run/3/1");
	expect(result.allSteps.find((step) => step.name === "check")?.startMs).toBe(
		T0 - 900_000,
	);
});

test("a job still running ends now; a skipped one never ends before it starts", () => {
	const now = T0 + 1_500_000;
	const ci = ciRun(
		"3",
		"exact",
		75,
		[
			job("integration", 75, 90, null, null),
			{ ...job("deploy", 300, 300, 299, "skipped") },
		],
		null,
	);
	const [running, skipped] = (
		withRunCi(waterfall, [ci], now).steps[2] as SessionReaderStep
	).children;
	expect(running?.endMs).toBe(now);
	expect(skipped?.endMs).toBe(skipped?.startMs);
});

test("the PR's CI during the run goes under one dimmed group, apart from exact links", () => {
	const exact = ciRun("4", "exact", 75, [
		job("verify", 75, 83, 140, "failure"),
	]);
	const window = ciRun("5", "pr_window", 76, [
		job("verify", 76, 85, 104, "failure"),
	]);
	const result = withRunCi(waterfall, [window, exact], T0);
	const group = result.steps.find((each) => each.id === CI_WINDOW_GROUP_ID);
	expect(group?.ci).toEqual({ dimmed: true, kind: "group" });
	expect(group?.children.map((each) => each.id)).toEqual([
		"ci:1345271521/actions_run/5/1",
	]);
	expect(group?.children[0]?.ci).toMatchObject({ dimmed: true, kind: "run" });
	expect(group?.children[0]?.name).toBe("CI · #301");
	const own = result.steps.find(
		(each) => each.id === "ci:1345271521/actions_run/4/1",
	);
	expect(own?.ci).toMatchObject({ dimmed: false, kind: "run" });
});

test("links point at the job, or at the run's attempt", () => {
	const ci = ciRun("38537619754", "exact", 75, [
		job("115764252835", 75, 83, 140, "failure"),
	]);
	const row = withRunCi(waterfall, [ci], T0).steps[2] as SessionReaderStep;
	expect(ciUrl(row)).toBe(
		"https://github.com/opalinehq/athena/actions/runs/38537619754/attempts/1",
	);
	expect(ciUrl(row.children[0] as SessionReaderStep)).toBe(
		"https://github.com/opalinehq/athena/actions/runs/38537619754/job/115764252835",
	);
});
