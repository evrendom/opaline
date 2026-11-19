import { expect, test } from "bun:test";
import type {
	RunCiRun,
	SessionDetailTurnSummary,
	SessionRunCiRun,
} from "@rudel/api-routes";
import { getSummaryCi } from "../summary/session-summary-model";
import {
	ciOfPick,
	ciOwners,
	getCiReach,
	pullTouchers,
	reachWords,
	withReachedPulls,
} from "./session-reader-ci-reach";

const turn = (turnId: string, startedAt: string) =>
	({
		startedAt,
		turnId,
		userPreview: `prompt ${turnId}`,
	}) as never as SessionDetailTurnSummary;

const ci = (
	ciRunId: string,
	link: RunCiRun["link"],
	relations: string[],
	pullRequests: number[],
): RunCiRun => ({
	attempt: 1,
	ciRunId,
	conclusion: "success",
	createdAt: "2026-10-16T10:00:00.000Z",
	event: "pull_request",
	githubRunId: ciRunId,
	headBranch: "b",
	headSha: "abc",
	jobs: [],
	link,
	pullRequests,
	relations,
	repository: "o/r",
	workflowName: "CI",
});

const T1 = "2026-10-16T09:00:00.000Z";
const T2 = "2026-10-16T11:00:00.000Z";
const turns = [turn("t1", T1), turn("t2", T2)];
const launches = new Map([["sub1", "t1"]]);
const tasks = new Map([["sub1", "Fix the parser"]]);
const runs: SessionRunCiRun[] = [
	{
		agentId: "",
		ci: [ci("c1", "exact", ["ci_named"], [])],
		startedAt: T1,
		turn: 1,
	},
	{
		agentId: "sub1",
		ci: [
			ci("c1", "pr_window", ["pr_named"], [7]),
			ci("c2", "pr_window", ["pr_branch_head", "pr_named"], [7]),
		],
		startedAt: "2026-10-16T09:05:00.000Z",
		turn: 1,
	},
	{
		agentId: "",
		ci: [ci("c3", "exact", ["ci_named"], [])],
		startedAt: "2026-10-16T12:00:00.000Z",
		turn: 9,
	},
];

test("each CI run keeps who reached it and how", () => {
	const reach = getCiReach(runs, turns, launches, tasks);
	expect(reach.turns.map((each) => each.turnId)).toEqual(["t1"]);
	expect(reach.unplaced).toBe(1);
	const c1 = reach.byCi.get("c1") ?? [];
	expect(c1.map((each) => [each.reacher.agent, each.link.link])).toEqual([
		[null, "exact"],
		["sub1", "pr_window"],
	]);
	expect(c1[1]?.reacher.task).toBe("Fix the parser");
	const [main, sub] = c1;
	if (!main || !sub) throw new Error("c1 has two reachers");
	expect(reachWords(main.link).short).toBe("named this CI run");
	expect(reachWords(sub.link).full).toContain("Inferred");
});

test("a turn's pick takes its subagents' CI, exact where any is", () => {
	const reach = getCiReach(runs, turns, launches, tasks);
	const t1 = reach.turns[0];
	if (!t1) throw new Error("t1 reached CI");
	expect([...ciOfPick(t1, null)].map(([id, link]) => [id, link.link])).toEqual([
		["c1", "exact"],
		["c2", "pr_window"],
	]);
	expect([...ciOfPick(t1, "sub1").keys()]).toEqual(["c1", "c2"]);
});

test("a CI run takes every pull request its runs named, and says how each touched it", () => {
	const reach = getCiReach(runs, turns, launches, tasks);
	const ciRuns = withReachedPulls(getSummaryCi(runs, turns, launches), reach);
	expect(ciRuns.find((run) => run.ciRunId === "c1")?.pullRequests).toEqual([7]);
	const touchers = pullTouchers("o/r#7", ciRuns.slice(0, 2), reach);
	expect(touchers.map((each) => [each.reacher.key, each.ways])).toEqual([
		["t1", ["named one of its CI runs"]],
		["t1/sub1", ["named it", "pushed its branch"]],
	]);
});

test("each CI run is on the one run that set it off", () => {
	const late = "2026-10-16T11:05:00.000Z";
	const reach = getCiReach(
		[
			...runs,
			{
				agentId: "",
				ci: [
					ci("c2", "pr_window", ["pr_named"], [7]),
					ci("c4", "pr_window", ["pr_named"], [7]),
				],
				startedAt: T2,
				turn: 2,
			},
			{
				agentId: "sub1",
				ci: [ci("c4", "pr_window", ["pr_named"], [7])],
				startedAt: late,
				turn: 1,
			},
		],
		turns,
		launches,
		tasks,
	);
	expect(Object.fromEntries(ciOwners(reach))).toEqual({
		t1: ["c1"],
		"t1/sub1": ["c2"],
		t2: ["c4"],
	});
});
