import { describe, expect, test } from "bun:test";
import { RepositoryPullRequestsSchema } from "@rudel/api-routes";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import { repositoryPullRequests } from "./repository-pull-requests.service.js";
import type { SessionRunCiEnv } from "./run-ci/session-run-ci.js";

type Rows = readonly Record<string, unknown>[];

interface Tables {
	remotes?: Rows;
	pulls?: Rows;
	sessions?: Rows;
	ci?: Rows;
	jobs?: Rows;
}

function executorOf(tables: Tables) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		statements,
		async close() {},
		async execute() {},
		async query<T>(statement: ClickHouseStatement) {
			statements.push(statement);
			const sql = statement.query;
			const rows = sql.includes("rudel.github_ci_jobs")
				? tables.jobs
				: sql.includes("rudel.github_ci_run_pull_requests")
					? tables.ci
					: sql.includes("rudel.l1_edges_by_target")
						? tables.sessions
						: sql.includes("rudel.github_pull_requests")
							? tables.pulls
							: sql.includes("rudel.session_analytics")
								? tables.remotes
								: undefined;
			if (!rows) throw new Error(`unexpected statement: ${sql}`);
			return rows as T[];
		},
		async insert() {},
	};
	return executor satisfies ClickHouseExecutor & {
		statements: ClickHouseStatement[];
	};
}

const ATHENA = { repositoryId: "1345271521", fullName: "opalinehq/athena" };
const CLI = { repositoryId: "1159109991", fullName: "opalinehq/cli" };
const REPO_KEY = "remote:github.com/opalinehq/athena";

function envOf(
	tables: Tables,
	options: {
		enabled?: boolean;
		repositories?: readonly { repositoryId: string; fullName: string }[];
	} = {},
) {
	const executor = executorOf(tables);
	const env: Pick<SessionRunCiEnv, "executor" | "enabled" | "repositories"> = {
		executor,
		enabled: async () => options.enabled ?? true,
		repositories: async () => options.repositories ?? [ATHENA, CLI],
	};
	return { env, executor };
}

const ms = (iso: string) => String(Date.parse(iso));

const pull = (over: Record<string, unknown>) => ({
	repository_id: "1345271521",
	number: 301,
	title: "feat: run questions dashboard",
	state: "closed",
	draft: 0,
	created_ms: ms("2026-10-14T08:50:00.000Z"),
	merged_ms: ms("2026-10-14T12:00:00.000Z"),
	closed_ms: ms("2026-10-14T12:00:00.000Z"),
	head_ref: "feat/run-questions-dashboard",
	head_repository_id: "1345271521",
	author_login: "evrendom",
	...over,
});

const ciRow = (over: Record<string, unknown>) => ({
	ci_run_id: "1345271521/actions_run/38537619754/1",
	repository_id: "1345271521",
	github_run_id: "38537619754",
	attempt: 1,
	workflow_name: "CI",
	event: "pull_request",
	head_branch: "feat/run-questions-dashboard",
	head_sha: "e96c449b62614c106da5d56fbbd905fe5aa3c601",
	conclusion: "success",
	created_ms: ms("2026-10-14T09:00:00.000Z"),
	member_pulls: ["1345271521/301"],
	branch_pulls: [],
	...over,
});

const SCOPE = { workspaceId: "w", member: null };

describe("repositoryPullRequests", () => {
	test("is disabled with no GitHub connection, asking ClickHouse nothing", async () => {
		const { env, executor } = envOf({}, { enabled: false });
		expect(await repositoryPullRequests(env, SCOPE, REPO_KEY)).toEqual({
			enabled: false,
			pullRequests: [],
		});
		expect(executor.statements).toHaveLength(0);
	});

	test("is disabled for a repo that is no visible GitHub repository", async () => {
		const { env, executor } = envOf({});
		for (const repoKey of [
			"remote:github.com/someone/else",
			"remote:gitlab.com/opalinehq/athena",
			"pkg:athena",
			"path-raw:/tmp/x",
		])
			expect(await repositoryPullRequests(env, SCOPE, repoKey)).toEqual({
				enabled: false,
				pullRequests: [],
			});
		expect(executor.statements).toHaveLength(0);
	});

	test("maps a worktree repo to the GitHub repository its sessions push to", async () => {
		const { env, executor } = envOf({
			remotes: [
				{
					git_remote: "git@github.com:OpalineHQ/athena.git",
					package_name: "",
					project_path: "/Users/e/conductor/workspaces/athena/luanda",
				},
				{
					git_remote: "git@github.com:opalinehq/cli.git",
					package_name: "",
					project_path: "/Users/e/conductor/workspaces/cli/lima",
				},
			],
			pulls: [],
		});
		expect(await repositoryPullRequests(env, SCOPE, "path:athena")).toEqual({
			enabled: true,
			pullRequests: [],
		});
		expect(executor.statements.at(-1)?.query_params?.repositories).toEqual([
			"1345271521",
		]);
	});

	test("shapes pull requests in the order ClickHouse returns them, newest first", async () => {
		const { env, executor } = envOf({
			pulls: [
				pull({
					number: 338,
					title: "fix: pause autorun",
					state: "open",
					draft: 1,
					created_ms: ms("2026-11-02T16:02:36.000Z"),
					merged_ms: null,
					closed_ms: null,
					head_ref: "",
					author_login: "",
				}),
				pull({}),
			],
			sessions: [],
			ci: [],
			jobs: [],
		});
		const result = await repositoryPullRequests(env, SCOPE, REPO_KEY);
		expect(RepositoryPullRequestsSchema.parse(result)).toEqual(result);
		expect(result).toEqual({
			enabled: true,
			pullRequests: [
				{
					repository: "opalinehq/athena",
					node: "1345271521/338",
					number: 338,
					title: "fix: pause autorun",
					state: "open",
					draft: true,
					createdAt: "2026-11-02T16:02:36.000Z",
					mergedAt: null,
					closedAt: null,
					headRef: null,
					authorLogin: null,
					sessions: [],
					ci: [],
				},
				{
					repository: "opalinehq/athena",
					node: "1345271521/301",
					number: 301,
					title: "feat: run questions dashboard",
					state: "closed",
					draft: false,
					createdAt: "2026-10-14T08:50:00.000Z",
					mergedAt: "2026-10-14T12:00:00.000Z",
					closedAt: "2026-10-14T12:00:00.000Z",
					headRef: "feat/run-questions-dashboard",
					authorLogin: "evrendom",
					sessions: [],
					ci: [],
				},
			],
		});
		const pulls = executor.statements.find((statement) =>
			statement.query.includes("rudel.github_pull_requests"),
		);
		expect(pulls?.query).toContain("ORDER BY created_at DESC");
		expect(pulls?.query_params).toMatchObject({
			workspaceId: "w",
			repositories: ["1345271521"],
			limit: 200,
		});
	});

	test("attaches CI by pull request membership and by head branch", async () => {
		const { env, executor } = envOf({
			pulls: [
				pull({
					number: 306,
					head_ref: "claude/bold-tesla",
					created_ms: ms("2026-10-15T16:00:00.000Z"),
				}),
				pull({
					number: 305,
					head_ref: "claude/bold-tesla",
					created_ms: ms("2026-10-15T07:00:00.000Z"),
				}),
				pull({ number: 301 }),
				pull({
					number: 290,
					head_ref: "main",
					head_repository_id: "999",
				}),
			],
			sessions: [],
			ci: [
				ciRow({
					ci_run_id: "1345271521/actions_run/3/1",
					github_run_id: "3",
					head_branch: "claude/bold-tesla",
					event: "push",
					created_ms: ms("2026-10-15T17:00:00.000Z"),
					member_pulls: [],
					branch_pulls: ["1345271521/305", "1345271521/306"],
				}),
				ciRow({
					ci_run_id: "1345271521/actions_run/2/1",
					github_run_id: "2",
					created_ms: ms("2026-10-14T10:00:00.000Z"),
					member_pulls: ["1345271521/301"],
					branch_pulls: ["1345271521/301"],
				}),
				ciRow({
					created_ms: ms("2026-10-14T09:00:00.000Z"),
					member_pulls: ["1345271521/301", "1345271521/290"],
				}),
			],
			jobs: [
				{
					repository_id: "1345271521",
					run_id: "38537619754",
					attempt: 1,
					job_id: "9",
					name: "verify",
					status: "completed",
					conclusion: "success",
					created_ms: ms("2026-10-14T09:00:01.000Z"),
					started_ms: ms("2026-10-14T09:00:05.000Z"),
					completed_ms: ms("2026-10-14T09:04:00.000Z"),
					runner_name: "ubuntu",
				},
			],
		});
		const result = await repositoryPullRequests(env, SCOPE, REPO_KEY);
		expect(RepositoryPullRequestsSchema.parse(result)).toEqual(result);
		const ci = new Map(
			result.pullRequests.map((pull) => [
				pull.number,
				pull.ci.map((run) => ({
					ciRunId: run.ciRunId,
					link: run.link,
					relations: run.relations,
					pullRequests: run.pullRequests,
					jobs: run.jobs.map((job) => job.name),
				})),
			]),
		);
		expect(ci.get(306)).toEqual([
			{
				ciRunId: "1345271521/actions_run/3/1",
				link: "pr_window",
				relations: ["head_branch"],
				pullRequests: [306],
				jobs: [],
			},
		]);
		expect(ci.get(305)).toEqual([]);
		expect(ci.get(301)).toEqual([
			{
				ciRunId: "1345271521/actions_run/2/1",
				link: "exact",
				relations: ["ci_for_pr", "head_branch"],
				pullRequests: [301],
				jobs: [],
			},
			{
				ciRunId: "1345271521/actions_run/38537619754/1",
				link: "exact",
				relations: ["ci_for_pr"],
				pullRequests: [290, 301],
				jobs: ["verify"],
			},
		]);
		expect(ci.get(290)?.map((run) => run.ciRunId)).toEqual([
			"1345271521/actions_run/38537619754/1",
		]);
		const query = executor.statements.find((statement) =>
			statement.query.includes("rudel.github_ci_run_pull_requests"),
		);
		expect(query?.query_params).toMatchObject({
			numbers: [306, 305, 301, 290],
			pullNodes: [
				"1345271521/306",
				"1345271521/305",
				"1345271521/301",
				"1345271521/290",
			],
			branchKeys: [
				"1345271521/claude/bold-tesla",
				"1345271521/claude/bold-tesla",
				"1345271521/feat/run-questions-dashboard",
			],
			branchPulls: ["1345271521/306", "1345271521/305", "1345271521/301"],
			sinceMs: Date.parse("2026-10-14T08:50:00.000Z") - 30 * 86_400_000,
			perPull: 40,
		});
	});

	test("keeps the newest twenty CI runs of a pull request", async () => {
		const { env } = envOf({
			pulls: [pull({})],
			sessions: [],
			ci: Array.from({ length: 25 }, (_, index) =>
				ciRow({
					ci_run_id: `1345271521/actions_run/${100 + index}/1`,
					github_run_id: String(100 + index),
					created_ms: String(Date.parse("2026-10-14T09:00:00.000Z") + index),
				}),
			),
			jobs: [],
		});
		const [only] = (await repositoryPullRequests(env, SCOPE, REPO_KEY))
			.pullRequests;
		expect(only?.ci).toHaveLength(20);
		expect(only?.ci[0]?.githubRunId).toBe("124");
		expect(only?.ci.at(-1)?.githubRunId).toBe("105");
	});

	test("lists each session once per pull request, as the run edges order them", async () => {
		const { env, executor } = envOf({
			pulls: [pull({ number: 302 }), pull({})],
			sessions: [
				{ pr_node: "1345271521/301", session_id: "b", first_ms: "1" },
				{ pr_node: "1345271521/301", session_id: "a", first_ms: "2" },
				{ pr_node: "1345271521/301", session_id: "b", first_ms: "3" },
				{ pr_node: "1345271521/302", session_id: "a", first_ms: "4" },
			],
			ci: [],
			jobs: [],
		});
		const result = await repositoryPullRequests(
			env,
			{ workspaceId: "w", member: "u1" },
			REPO_KEY,
		);
		expect(
			result.pullRequests.map((pull) => [pull.number, pull.sessions]),
		).toEqual([
			[302, ["a"]],
			[301, ["b", "a"]],
		]);
		const sessions = executor.statements.find((statement) =>
			statement.query.includes("rudel.l1_edges_by_target"),
		);
		expect(sessions?.query).toContain("user_id = {member:String}");
		expect(sessions?.query_params).toMatchObject({
			member: "u1",
			pullNodes: ["1345271521/302", "1345271521/301"],
		});
	});
});
