import {
	REPOSITORY_PULL_REQUEST_CI_LIMIT,
	REPOSITORY_PULL_REQUEST_LIMIT,
	type RepositoryPullRequest,
	type RepositoryPullRequests,
	type RunCiRun,
	resolveRepoIdentity,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import { idComponentSql } from "./analysis/sql-l1-views.js";
import { pullRequestNodeId } from "./l1-edges/l1-edge-ids.js";
import {
	L1_EDGES_BY_TARGET_TABLE,
	RUN_INDEX_TABLE,
} from "./l1-edges/l1-edge-tables.js";
import {
	CI_RUN_ID_SQL,
	type CiJobs,
	readCiJobs,
	type SessionRunCiEnv,
	type SessionRunCiScope,
	shapeCiRun,
	visibleRepositoryNames,
} from "./run-ci/session-run-ci.js";

const DISABLED: RepositoryPullRequests = { enabled: false, pullRequests: [] };
const CI_ROWS_PER_PULL = REPOSITORY_PULL_REQUEST_CI_LIMIT * 2;
const CI_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const REMOTE_KEY_PREFIX = "remote:";
const PULL_NODE_SQL = `concat(${idComponentSql("repository_id")}, '/', toString(pr_number))`;

export async function repositoryPullRequests(
	env: Pick<SessionRunCiEnv, "executor" | "enabled" | "repositories">,
	scope: SessionRunCiScope,
	repoKey: string,
): Promise<RepositoryPullRequests> {
	const names = await visibleRepositoryNames(env, scope.workspaceId);
	if (!names) return DISABLED;
	const repositories = await githubRepositoriesOf(
		env.executor,
		scope.workspaceId,
		repoKey,
		names,
	);
	if (repositories.length === 0) return DISABLED;
	const params = { workspaceId: scope.workspaceId, repositories };
	const pulls = await readPulls(env.executor, params);
	if (pulls.length === 0) return { enabled: true, pullRequests: [] };
	const [sessions, ci] = await Promise.all([
		readSessions(env.executor, scope, params, pulls),
		readCi(env.executor, params, pulls, names),
	]);
	return {
		enabled: true,
		pullRequests: pulls.map(
			(pull): RepositoryPullRequest => ({
				repository: names.get(pull.repository_id) ?? "",
				node: pullKey(pull),
				number: pull.number,
				title: pull.title,
				state: pull.state,
				draft: pull.draft,
				createdAt: iso(pull.created_ms),
				mergedAt: iso(pull.merged_ms),
				closedAt: iso(pull.closed_ms),
				headRef: pull.head_ref || null,
				authorLogin: pull.author_login || null,
				sessions: sessions.get(pullKey(pull)) ?? [],
				ci: ci.get(pullKey(pull)) ?? [],
			}),
		),
	};
}

async function githubRepositoriesOf(
	executor: ClickHouseExecutor,
	workspaceId: string,
	repoKey: string,
	names: ReadonlyMap<string, string>,
): Promise<string[]> {
	const remotes = repoKey.startsWith(REMOTE_KEY_PREFIX)
		? [repoKey]
		: repoKey.startsWith("path:")
			? await worktreeRemoteKeys(executor, workspaceId, repoKey)
			: [];
	const wanted = new Set(
		remotes.map((key) => key.slice(REMOTE_KEY_PREFIX.length).toLowerCase()),
	);
	return [...names]
		.filter(([, fullName]) =>
			wanted.has(`github.com/${fullName}`.toLowerCase()),
		)
		.map(([repositoryId]) => repositoryId)
		.sort();
}

async function worktreeRemoteKeys(
	executor: ClickHouseExecutor,
	workspaceId: string,
	repoKey: string,
): Promise<string[]> {
	const rows = await query(executor, RemoteRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT DISTINCT git_remote, package_name, project_path
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
			WHERE organization_id = {workspaceId:String} AND git_remote != ''
			LIMIT 10001`,
		query_params: { workspaceId },
	});
	return [
		...new Set(
			rows
				.filter(
					(row) =>
						resolveRepoIdentity({
							gitRemote: null,
							packageName: row.package_name,
							projectPath: row.project_path,
						}).repoKey === repoKey,
				)
				.map(
					(row) =>
						resolveRepoIdentity({
							gitRemote: row.git_remote,
							packageName: null,
							projectPath: "",
						}).repoKey,
				),
		),
	];
}

function readPulls(
	executor: ClickHouseExecutor,
	params: { workspaceId: string; repositories: string[] },
): Promise<PullRow[]> {
	return query(executor, PullRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT repository_id, number, title, state, draft,
				toUnixTimestamp64Milli(created_at) AS created_ms,
				toUnixTimestamp64Milli(merged_at) AS merged_ms,
				toUnixTimestamp64Milli(closed_at) AS closed_ms,
				head_ref, head_repository_id, author_login
			FROM ${getSafeClickHouseTable("rudel.github_pull_requests")} FINAL
			WHERE workspace_id = {workspaceId:String} AND provider = 'github'
				AND repository_id IN {repositories:Array(String)}
			ORDER BY created_at DESC, repository_id, number DESC
			LIMIT {limit:UInt32}`,
		query_params: { ...params, limit: REPOSITORY_PULL_REQUEST_LIMIT },
	});
}

async function readSessions(
	executor: ClickHouseExecutor,
	scope: SessionRunCiScope,
	params: { workspaceId: string; repositories: string[] },
	pulls: readonly PullRow[],
): Promise<Map<string, string[]>> {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const member = scope.member === null ? "" : " AND user_id = {member:String}";
	const owner = `organization_id = {workspaceId:String}${member}
		AND (user_id, session_id) IN (SELECT user_id, session_id FROM edges)`;
	const rows = await query(executor, SessionRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH
			edges AS (
				SELECT DISTINCT to_id AS pr_node, from_id AS run_id, user_id, session_id
				FROM (
					SELECT to_id, from_id, user_id, session_id, is_active
					FROM ${getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE)} FINAL
					WHERE organization_id = {workspaceId:String} AND to_kind = 'pull_request'
						AND to_id IN {pullNodes:Array(String)}
						AND relation IN ('pr_named', 'pr_branch_head') AND from_kind = 'run'
						AND repository_id IN {repositories:Array(String)}${member}
				)
				WHERE is_active = 1
			),
			runs AS (
				SELECT run_id, started_at FROM ${runIndex} FINAL
				WHERE ${owner} AND row_kind = 'run'
					AND run_id IN (SELECT run_id FROM edges)
					AND ${committedBuildSql(runIndex, owner, ["user_id", "session_id"])}
			)
			SELECT e.pr_node AS pr_node, e.session_id AS session_id,
				toUnixTimestamp64Milli(min(r.started_at)) AS first_ms
			FROM edges AS e
			INNER JOIN runs AS r ON r.run_id = e.run_id
			GROUP BY pr_node, session_id
			ORDER BY pr_node, first_ms, session_id
			LIMIT 10000`,
		query_params: {
			...params,
			...(scope.member === null ? {} : { member: scope.member }),
			pullNodes: pulls.map(pullKey),
		},
	});
	const sessions = new Map<string, string[]>();
	for (const row of rows) {
		const list = sessions.get(row.pr_node) ?? [];
		sessions.set(row.pr_node, list);
		if (!list.includes(row.session_id)) list.push(row.session_id);
	}
	return sessions;
}

async function readCi(
	executor: ClickHouseExecutor,
	params: { workspaceId: string; repositories: string[] },
	pulls: readonly PullRow[],
	names: ReadonlyMap<string, string>,
): Promise<Map<string, RunCiRun[]>> {
	const branched = pulls.filter(
		(pull) =>
			pull.head_ref !== "" && pull.head_repository_id === pull.repository_id,
	);
	const github =
		"workspace_id = {workspaceId:String} AND provider = 'github' AND repository_id IN {repositories:Array(String)}";
	const rows = await query(executor, CiRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH
			members AS (
				SELECT DISTINCT ${PULL_NODE_SQL} AS pr_node,
					repository_id, run_id, attempt
				FROM ${getSafeClickHouseTable("rudel.github_ci_run_pull_requests")} FINAL
				WHERE ${github} AND pr_number IN {numbers:Array(UInt32)}
					AND kind = 'actions_run'
					AND ${PULL_NODE_SQL} IN {pullNodes:Array(String)}
			),
			ci AS (
				SELECT ${CI_RUN_ID_SQL} AS ci_run_id, repository_id, run_id, attempt,
					workflow_name, event, head_branch, head_sha, conclusion, created_at
				FROM ${getSafeClickHouseTable("rudel.github_ci_runs")} FINAL
				WHERE ${github} AND kind = 'actions_run'
					AND created_at >= fromUnixTimestamp64Milli({sinceMs:Int64})
					AND ((repository_id, run_id, attempt) IN (SELECT repository_id, run_id, attempt FROM members)
						OR concat(repository_id, '/', head_branch) IN {branchKeys:Array(String)})
			),
			matched AS (
				SELECT m.pr_node AS pr_node, 'member' AS via,
					c.ci_run_id AS ci_run_id, c.repository_id AS repository_id, c.run_id AS run_id,
					c.attempt AS attempt, c.workflow_name AS workflow_name, c.event AS event,
					c.head_branch AS head_branch, c.head_sha AS head_sha,
					c.conclusion AS conclusion, c.created_at AS created_at
				FROM ci AS c
				INNER JOIN members AS m ON m.repository_id = c.repository_id
					AND m.run_id = c.run_id AND m.attempt = c.attempt
				UNION ALL
				SELECT b.pr_node AS pr_node, 'branch' AS via,
					c.ci_run_id AS ci_run_id, c.repository_id AS repository_id, c.run_id AS run_id,
					c.attempt AS attempt, c.workflow_name AS workflow_name, c.event AS event,
					c.head_branch AS head_branch, c.head_sha AS head_sha,
					c.conclusion AS conclusion, c.created_at AS created_at
				FROM ci AS c
				INNER JOIN (
					SELECT pair.1 AS branch_key, pair.2 AS pr_node FROM (
						SELECT arrayJoin(arrayZip({branchKeys:Array(String)}, {branchPulls:Array(String)})) AS pair
					)
				) AS b ON b.branch_key = concat(c.repository_id, '/', c.head_branch)
			),
			kept AS (
				SELECT * FROM matched
				ORDER BY created_at DESC, ci_run_id DESC
				LIMIT {perPull:UInt32} BY pr_node
			)
			SELECT ci_run_id, repository_id, run_id AS github_run_id, attempt,
				workflow_name, event, head_branch, head_sha, conclusion,
				toUnixTimestamp64Milli(created_at) AS created_ms,
				groupUniqArrayIf(pr_node, via = 'member') AS member_pulls,
				groupUniqArrayIf(pr_node, via = 'branch') AS branch_pulls
			FROM kept
			GROUP BY ci_run_id, repository_id, run_id, attempt, workflow_name,
				event, head_branch, head_sha, conclusion, created_at
			ORDER BY created_at DESC, ci_run_id DESC
			LIMIT {limit:UInt32}`,
		query_params: {
			...params,
			numbers: [...new Set(pulls.map((pull) => pull.number))],
			pullNodes: pulls.map(pullKey),
			branchKeys: branched.map(branchKey),
			branchPulls: branched.map(pullKey),
			sinceMs:
				Math.min(...pulls.map((pull) => pull.created_ms)) - CI_LOOKBACK_MS,
			perPull: CI_ROWS_PER_PULL,
			limit: CI_ROWS_PER_PULL * REPOSITORY_PULL_REQUEST_LIMIT,
		},
	});
	const jobs = await readCiJobs(
		executor,
		params,
		rows.map((row) => row.github_run_id),
	);
	return attachCi(rows, pulls, names, jobs);
}

function attachCi(
	rows: readonly CiRow[],
	pulls: readonly PullRow[],
	names: ReadonlyMap<string, string>,
	jobs: CiJobs,
): Map<string, RunCiRun[]> {
	const created = new Map(
		pulls.map((pull) => [pullKey(pull), pull.created_ms]),
	);
	const ci = new Map<string, RunCiRun[]>();
	for (const row of rows) {
		const member = row.member_pulls.length > 0;
		const targets = member
			? row.member_pulls
			: branchOwner(row.branch_pulls, row.created_ms, created);
		const numbers = targets
			.map((node) => Number(node.split("/").at(-1)))
			.sort((a, b) => a - b);
		for (const node of targets) {
			const list = ci.get(node) ?? [];
			ci.set(node, list);
			list.push(
				shapeCiRun(row, names, jobs, {
					link: member ? "exact" : "pr_window",
					relations: member
						? row.branch_pulls.includes(node)
							? ["ci_for_pr", "head_branch"]
							: ["ci_for_pr"]
						: ["head_branch"],
					pullRequests: numbers,
				}),
			);
		}
	}
	for (const [node, list] of ci)
		ci.set(
			node,
			list
				.sort(
					(a, b) =>
						b.createdAt.localeCompare(a.createdAt) ||
						b.ciRunId.localeCompare(a.ciRunId),
				)
				.slice(0, REPOSITORY_PULL_REQUEST_CI_LIMIT),
		);
	return ci;
}

function branchOwner(
	candidates: readonly string[],
	createdMs: number,
	created: ReadonlyMap<string, number>,
): string[] {
	const ordered = candidates
		.map((node) => ({ node, at: created.get(node) ?? 0 }))
		.sort((a, b) => a.at - b.at || a.node.localeCompare(b.node));
	const owner = ordered.filter((pull) => pull.at <= createdMs).at(-1);
	const first = owner ?? ordered[0];
	return first ? [first.node] : [];
}

function pullKey(pull: Pick<PullRow, "repository_id" | "number">): string {
	return pullRequestNodeId(pull.repository_id, pull.number);
}

function branchKey(pull: Pick<PullRow, "repository_id" | "head_ref">): string {
	return `${pull.repository_id}/${pull.head_ref}`;
}

function iso(ms: number | null): string | null {
	return ms === null || ms <= 0 ? null : new Date(ms).toISOString();
}

const RemoteRowSchema = z.object({
	git_remote: z.string(),
	package_name: z.string(),
	project_path: z.string(),
});

const PullRowSchema = z.object({
	repository_id: z.string(),
	number: z.coerce.number(),
	title: z.string(),
	state: z.string(),
	draft: z.coerce.number().transform((draft) => draft === 1),
	created_ms: z.coerce.number(),
	merged_ms: z.coerce.number().nullable(),
	closed_ms: z.coerce.number().nullable(),
	head_ref: z.string(),
	head_repository_id: z.string(),
	author_login: z.string(),
});
type PullRow = z.infer<typeof PullRowSchema>;

const SessionRowSchema = z.object({
	pr_node: z.string(),
	session_id: z.string(),
	first_ms: z.coerce.number(),
});

const CiRowSchema = z.object({
	ci_run_id: z.string(),
	repository_id: z.string(),
	github_run_id: z.string(),
	attempt: z.coerce.number(),
	workflow_name: z.string(),
	event: z.string(),
	head_branch: z.string(),
	head_sha: z.string(),
	conclusion: z.string().nullable(),
	created_ms: z.coerce.number(),
	member_pulls: z.array(z.string()),
	branch_pulls: z.array(z.string()),
});
type CiRow = z.infer<typeof CiRowSchema>;
