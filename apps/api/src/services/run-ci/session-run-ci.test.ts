import { describe, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	RUN_CI_LINK_LIMIT,
	type SessionRunCiEnv,
	sessionRunCi,
} from "./session-run-ci.js";

function executorOf(
	links: readonly Record<string, unknown>[],
	jobs: readonly Record<string, unknown>[],
) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		statements,
		async close() {},
		async execute() {},
		async query<T>(statement: ClickHouseStatement) {
			statements.push(statement);
			return (
				statement.query.includes("rudel.github_ci_jobs") ? jobs : links
			) as T[];
		},
		async insert() {},
	};
	return executor satisfies ClickHouseExecutor & {
		statements: ClickHouseStatement[];
	};
}

const REPOSITORY = { repositoryId: "1345271521", fullName: "opalinehq/athena" };

function envOf(
	links: readonly Record<string, unknown>[],
	jobs: readonly Record<string, unknown>[] = [],
	options: {
		enabled?: boolean;
		repositories?: readonly { repositoryId: string; fullName: string }[];
	} = {},
) {
	const executor = executorOf(links, jobs);
	const asked: string[] = [];
	const env: SessionRunCiEnv = {
		executor,
		enabled: async () => options.enabled ?? true,
		repositories: async (workspaceId) => {
			asked.push(workspaceId);
			return options.repositories ?? [REPOSITORY];
		},
	};
	return { env, executor, asked };
}

const ms = (iso: string) => Date.parse(iso);

const RUN_4 = {
	agent_id: "",
	turn_idx: 4,
	started_ms: String(ms("2026-10-14T08:46:10.340Z")),
	ended_ms: String(ms("2026-10-14T09:04:21.423Z")),
};
const ciRun = (over: Record<string, unknown>) => ({
	...RUN_4,
	ci_run_id: "1345271521/actions_run/38537619754/1",
	repository_id: "1345271521",
	github_run_id: "38537619754",
	attempt: 1,
	workflow_name: "CI",
	event: "pull_request",
	head_branch: "feat/run-questions-dashboard",
	head_sha: "e96c449b62614c106da5d56fbbd905fe5aa3c601",
	conclusion: "cancelled",
	created_ms: String(ms("2026-10-14T08:47:24.000Z")),
	exact_relations: [],
	window_relations: ["pr_named"],
	pr_nodes: ["1345271521/301"],
	...over,
});
const PROD_LINKS = [
	ciRun({}),
	ciRun({
		ci_run_id: "1345271521/actions_run/38537619292/1",
		github_run_id: "38537619292",
		workflow_name: "PR Title",
		event: "pull_request_target",
		conclusion: "success",
	}),
	ciRun({
		ci_run_id: "1345271521/actions_run/38537622748/1",
		github_run_id: "38537622748",
		head_branch: "feat/run-question-tags-rollout",
		head_sha: "01219a602bad878591f382664029f99f210513c7",
		created_ms: String(ms("2026-10-14T08:47:25.000Z")),
		pr_nodes: ["1345271521/303"],
	}),
];
const job = (over: Record<string, unknown>) => ({
	repository_id: "1345271521",
	run_id: "38537619754",
	attempt: 1,
	job_id: "115764252835",
	name: "verify",
	status: "completed",
	conclusion: "failure",
	created_ms: ms("2026-10-14T08:47:25.000Z"),
	started_ms: ms("2026-10-14T08:47:33.000Z"),
	completed_ms: ms("2026-10-14T08:48:30.000Z"),
	runner_name: "blacksmith-8vcpu-ubuntu-2404-znlb6ppslqt4wtii",
	...over,
});
const PROD_JOBS = [
	job({}),
	job({
		job_id: "115764366945",
		name: "integration",
		conclusion: "cancelled",
		created_ms: ms("2026-10-14T08:47:42.000Z"),
		started_ms: ms("2026-10-14T08:47:50.000Z"),
		completed_ms: ms("2026-10-14T08:51:09.000Z"),
		runner_name: "blacksmith-4vcpu-ubuntu-2404-4o5vofdsdleo57kc",
	}),
	job({
		job_id: "115764366697",
		name: "cli-smoke (blacksmith-6vcpu-macos-15, 20)",
		conclusion: "success",
		created_ms: ms("2026-10-14T08:47:42.000Z"),
		started_ms: ms("2026-10-14T08:48:02.000Z"),
		completed_ms: ms("2026-10-14T08:48:43.000Z"),
		runner_name: "blacksmith-6vcpu-macos-15-wfxx5dbcxz436tqu",
	}),
	job({
		job_id: "115764253153",
		name: "changes",
		conclusion: "success",
		started_ms: ms("2026-10-14T08:47:33.000Z"),
		completed_ms: ms("2026-10-14T08:47:42.000Z"),
		runner_name: "blacksmith-4vcpu-ubuntu-2404-y2cecrnli63ar64z",
	}),
	job({
		job_id: "115765751748",
		name: "deploy",
		conclusion: "cancelled",
		created_ms: ms("2026-10-14T08:51:10.000Z"),
		started_ms: ms("2026-10-14T08:51:10.000Z"),
		completed_ms: ms("2026-10-14T08:51:10.000Z"),
		runner_name: "",
	}),
	job({ job_id: "999", name: "verify", attempt: 2 }),
];

const SCOPE = { workspaceId: "w", member: "sELOs7w9GGmFsw73PlyMbAjdWUQuTS5T" };

describe("sessionRunCi", () => {
	test("reads nothing where the run_ci feature is off", async () => {
		const { env, executor, asked } = envOf(PROD_LINKS, PROD_JOBS, {
			enabled: false,
		});
		expect(await sessionRunCi(env, SCOPE, "s1")).toEqual({
			enabled: false,
			runs: [],
		});
		expect(executor.statements).toHaveLength(0);
		expect(asked).toHaveLength(0);
	});

	test("reads nothing where no GitHub repository is visible", async () => {
		const { env, executor } = envOf(PROD_LINKS, PROD_JOBS, {
			repositories: [],
		});
		expect(await sessionRunCi(env, SCOPE, "s1")).toEqual({
			enabled: false,
			runs: [],
		});
		expect(executor.statements).toHaveLength(0);
	});

	test("shows the PR's CI that started while a run that only named the PR went on as pr_window, with its jobs oldest first", async () => {
		const { env, executor } = envOf(PROD_LINKS, PROD_JOBS);
		const result = await sessionRunCi(
			env,
			SCOPE,
			"f40f503d-b38e-419a-b768-064fd03ee0e4",
		);
		expect(result.enabled).toBe(true);
		expect(result.runs).toHaveLength(1);
		const [run] = result.runs;
		expect(run?.agentId).toBe("");
		expect(run?.turn).toBe(4);
		expect(run?.startedAt).toBe("2026-10-14T08:46:10.340Z");
		expect(run?.ci.map((ci) => [ci.githubRunId, ci.link])).toEqual([
			["38537619292", "pr_window"],
			["38537619754", "pr_window"],
			["38537622748", "pr_window"],
		]);
		expect(run?.ci[1]).toEqual({
			ciRunId: "1345271521/actions_run/38537619754/1",
			githubRunId: "38537619754",
			attempt: 1,
			repository: "opalinehq/athena",
			workflowName: "CI",
			event: "pull_request",
			headBranch: "feat/run-questions-dashboard",
			headSha: "e96c449b62614c106da5d56fbbd905fe5aa3c601",
			conclusion: "cancelled",
			createdAt: "2026-10-14T08:47:24.000Z",
			link: "pr_window",
			relations: ["pr_named"],
			pullRequests: [301],
			jobs: [
				{
					jobId: "115764253153",
					name: "changes",
					status: "completed",
					conclusion: "success",
					createdAt: "2026-10-14T08:47:25.000Z",
					startedAt: "2026-10-14T08:47:33.000Z",
					completedAt: "2026-10-14T08:47:42.000Z",
					runnerName: "blacksmith-4vcpu-ubuntu-2404-y2cecrnli63ar64z",
				},
				{
					jobId: "115764252835",
					name: "verify",
					status: "completed",
					conclusion: "failure",
					createdAt: "2026-10-14T08:47:25.000Z",
					startedAt: "2026-10-14T08:47:33.000Z",
					completedAt: "2026-10-14T08:48:30.000Z",
					runnerName: "blacksmith-8vcpu-ubuntu-2404-znlb6ppslqt4wtii",
				},
				expect.objectContaining({
					name: "cli-smoke (blacksmith-6vcpu-macos-15, 20)",
				}),
				expect.objectContaining({
					name: "integration",
					conclusion: "cancelled",
				}),
				expect.objectContaining({
					name: "deploy",
					createdAt: "2026-10-14T08:51:10.000Z",
				}),
			],
		});
		expect(run?.ci[2]?.pullRequests).toEqual([303]);
		expect(run?.ci[0]?.jobs).toEqual([]);

		const [links, jobs] = executor.statements;
		expect(executor.statements).toHaveLength(2);
		expect(links?.query_params).toEqual({
			workspaceId: "w",
			repositories: ["1345271521"],
			sessionId: "f40f503d-b38e-419a-b768-064fd03ee0e4",
			limit: RUN_CI_LINK_LIMIT,
			member: "sELOs7w9GGmFsw73PlyMbAjdWUQuTS5T",
		});
		expect(links?.query).toContain("user_id = {member:String}");
		expect(links?.query).toContain("row_kind = 'receipt'");
		expect(links?.query).toContain("WHERE is_active = 1");
		expect(links?.query).toContain(
			"repository_id IN {repositories:Array(String)}",
		);
		expect(links?.query).toContain("kind = 'actions_run'");
		expect(links?.query).not.toContain("f40f503d");
		expect(jobs?.query_params).toEqual({
			workspaceId: "w",
			repositories: ["1345271521"],
			githubRunIds: ["38537619754", "38537619292", "38537622748"],
		});
		expect(jobs?.query).toContain("provider = 'github'");
		expect(jobs?.query).not.toContain("38537619754");
	});

	test("a CI run both proven and on the PR is exact only, with the exact relations", async () => {
		const { env } = envOf([
			ciRun({
				exact_relations: ["ci_named"],
				window_relations: ["pr_named"],
				created_ms: String(ms("2026-10-14T10:00:00.000Z")),
			}),
		]);
		const [run] = (await sessionRunCi(env, SCOPE, "s1")).runs;
		expect(run?.ci).toHaveLength(1);
		expect(run?.ci[0]).toMatchObject({
			link: "exact",
			relations: ["ci_named"],
			pullRequests: [301],
		});
	});

	test("drops PR CI GitHub created outside the run, and a run left without CI", async () => {
		const { env } = envOf([
			ciRun({ created_ms: String(ms("2026-10-14T08:46:10.339Z")) }),
			ciRun({
				ci_run_id: "1345271521/actions_run/2/1",
				github_run_id: "2",
				created_ms: String(ms("2026-10-14T09:04:21.424Z")),
			}),
		]);
		expect(await sessionRunCi(env, SCOPE, "s1")).toEqual({
			enabled: true,
			runs: [],
		});
	});

	test("orders runs by stream and run, exact CI first, each oldest first, and jobs without a time last", async () => {
		const { env } = envOf(
			[
				ciRun({
					ci_run_id: "1345271521/actions_run/10/1",
					github_run_id: "10",
					created_ms: String(ms("2026-10-14T08:47:00.000Z")),
				}),
				ciRun({
					ci_run_id: "1345271521/actions_run/11/1",
					github_run_id: "11",
					exact_relations: ["commit_pushed"],
					window_relations: [],
					pr_nodes: [],
					created_ms: String(ms("2026-10-14T08:59:00.000Z")),
				}),
				ciRun({
					ci_run_id: "1345271521/actions_run/12/1",
					github_run_id: "12",
					exact_relations: ["ci_named", "commit_pushed"],
					window_relations: [],
					pr_nodes: [],
					created_ms: String(ms("2026-10-14T08:50:00.000Z")),
				}),
				ciRun({
					ci_run_id: "1345271521/actions_run/13/1",
					github_run_id: "13",
					window_relations: ["pr_named", "pr_branch_head"],
					pr_nodes: ["1345271521/303", "1345271521/301"],
					created_ms: String(ms("2026-10-14T08:46:30.000Z")),
				}),
				ciRun({
					agent_id: "sub",
					turn_idx: 1,
					ci_run_id: "1345271521/actions_run/14/1",
					github_run_id: "14",
				}),
				ciRun({
					turn_idx: 2,
					started_ms: String(ms("2026-10-14T08:00:00.000Z")),
					ended_ms: String(ms("2026-10-14T08:50:00.000Z")),
					ci_run_id: "1345271521/actions_run/15/1",
					github_run_id: "15",
					repository_id: "unbound",
				}),
			],
			[
				job({ run_id: "10", job_id: "b", name: "b", created_ms: null }),
				job({ run_id: "10", job_id: "a", name: "a", created_ms: null }),
				job({ run_id: "10", job_id: "c", name: "c" }),
			],
		);
		const { runs } = await sessionRunCi(env, SCOPE, "s1");
		expect(
			runs.map((run) => [
				run.agentId,
				run.turn,
				run.ci.map((ci) => [ci.githubRunId, ci.link, ci.relations]),
			]),
		).toEqual([
			["", 2, [["15", "pr_window", ["pr_named"]]]],
			[
				"",
				4,
				[
					["12", "exact", ["ci_named", "commit_pushed"]],
					["11", "exact", ["commit_pushed"]],
					["13", "pr_window", ["pr_branch_head", "pr_named"]],
					["10", "pr_window", ["pr_named"]],
				],
			],
			["sub", 1, [["14", "pr_window", ["pr_named"]]]],
		]);
		expect(runs[1]?.ci[2]?.pullRequests).toEqual([301, 303]);
		expect(
			runs[1]?.ci[3]?.jobs.map((ran) => [ran.name, ran.createdAt]),
		).toEqual([
			["c", "2026-10-14T08:47:25.000Z"],
			["a", null],
			["b", null],
		]);
		expect(runs[0]?.ci[0]?.repository).toBe("");
	});

	test("asks for no jobs when no run reached CI, and binds no member where the reader reads every session", async () => {
		const { env, executor } = envOf([]);
		expect(
			await sessionRunCi(env, { workspaceId: "w", member: null }, "s1"),
		).toEqual({ enabled: true, runs: [] });
		expect(executor.statements).toHaveLength(1);
		expect(executor.statements[0]?.query).not.toContain("{member:String}");
		expect(executor.statements[0]?.query_params).not.toHaveProperty("member");
	});
});
