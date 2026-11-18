import {
	type RunCiJob,
	type RunCiRun,
	runCiStartedAt,
	type SessionRunCi,
	type SessionRunCiRun,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	chunkByParamBytes,
	query,
} from "../analysis/sql.js";
import { idComponentSql } from "../analysis/sql-l1-views.js";
import { L1_EDGES_TABLE, RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import { type RunCiDemoSource, runCiDemoOf } from "./demo-run-ci.js";

export const RUN_CI_LINK_LIMIT = 200;

export const CI_RUN_ID_SQL = `concat(${idComponentSql("repository_id")}, '/actions_run/', ${idComponentSql("run_id")}, '/', toString(attempt))`;

export interface SessionRunCiEnv {
	readonly executor: ClickHouseExecutor;
	readonly demo?: RunCiDemoSource;
	enabled(workspaceId: string): Promise<boolean>;
	repositories(
		workspaceId: string,
	): Promise<readonly { repositoryId: string; fullName: string }[]>;
}

export interface SessionRunCiScope {
	readonly workspaceId: string;
	readonly member: string | null;
}

export function sessionOwnerSql(scope: SessionRunCiScope): string {
	return `organization_id = {workspaceId:String} AND session_id = {sessionId:String}${
		scope.member === null ? "" : " AND user_id = {member:String}"
	}`;
}

export function sessionOwnerParams(
	scope: SessionRunCiScope,
	sessionId: string,
): { workspaceId: string; sessionId: string; member?: string } {
	return {
		workspaceId: scope.workspaceId,
		sessionId,
		...(scope.member === null ? {} : { member: scope.member }),
	};
}

export async function visibleRepositoryNames(
	env: Pick<SessionRunCiEnv, "enabled" | "repositories">,
	workspaceId: string,
): Promise<ReadonlyMap<string, string> | null> {
	if (!(await env.enabled(workspaceId))) return null;
	const repositories = await env.repositories(workspaceId);
	if (repositories.length === 0) return null;
	return new Map(
		repositories.map((repository) => [
			repository.repositoryId,
			repository.fullName,
		]),
	);
}

export async function sessionRunCi(
	env: SessionRunCiEnv,
	scope: SessionRunCiScope,
	sessionId: string,
): Promise<SessionRunCi> {
	const demo = runCiDemoOf(env, scope.workspaceId);
	const scripted = demo?.runs(sessionId) ?? [];
	if (scripted.length > 0) return { enabled: true, runs: scripted };
	const names = await visibleRepositoryNames(env, scope.workspaceId);
	if (!names) return { enabled: demo !== undefined, runs: [] };
	const params = {
		workspaceId: scope.workspaceId,
		repositories: [...names.keys()],
	};
	const links = await readLinks(env.executor, scope, sessionId, params);
	const jobs = await readCiJobs(
		env.executor,
		params,
		links.map((link) => link.github_run_id),
	);
	return { enabled: true, runs: assemble(links, jobs, names) };
}

function readLinks(
	executor: ClickHouseExecutor,
	scope: SessionRunCiScope,
	sessionId: string,
	params: { workspaceId: string; repositories: string[] },
): Promise<LinkRow[]> {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const edges = getSafeClickHouseTable(L1_EDGES_TABLE);
	const ciRuns = getSafeClickHouseTable("rudel.github_ci_runs");
	const owner = sessionOwnerSql(scope);
	const edgeScope =
		"organization_id = {workspaceId:String} AND repository_id IN {repositories:Array(String)}";
	const github =
		"workspace_id = {workspaceId:String} AND provider = 'github' AND repository_id IN {repositories:Array(String)}";
	const ciRunId = CI_RUN_ID_SQL;
	return query(executor, LinkRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH
			runs AS (
				SELECT run_id, agent_id, turn_idx, started_at, ended_at
				FROM ${runIndex} FINAL
				WHERE ${owner} AND row_kind = 'run'
					AND ${committedBuildSql(runIndex, owner, ["user_id", "session_id"])}
			),
			run_edges AS (
				SELECT DISTINCT from_id AS run_id, relation, to_id AS node_id
				FROM (
					SELECT from_id, relation, to_id, is_active
					FROM ${edges} FINAL
					WHERE ${edgeScope} AND from_kind = 'run'
						AND from_id IN (SELECT run_id FROM runs)
						AND relation IN ('ci_named', 'commit_pushed', 'pr_named', 'pr_branch_head')
				)
				WHERE is_active = 1
			),
			github_edges AS (
				SELECT DISTINCT from_id AS node_id, relation, to_id AS ci_run_id
				FROM (
					SELECT from_id, relation, to_id, is_active
					FROM ${edges} FINAL
					WHERE ${edgeScope} AND user_id = ''
						AND from_kind IN ('commit', 'pull_request')
						AND from_id IN (SELECT node_id FROM run_edges WHERE relation != 'ci_named')
						AND relation IN ('ci_on_sha', 'ci_for_pr') AND to_kind = 'ci_run'
				)
				WHERE is_active = 1
			),
			links AS (
				SELECT run_id, 'exact' AS link, relation, '' AS pr_node, node_id AS ci_run_id
				FROM run_edges
				WHERE relation = 'ci_named'
				UNION ALL
				SELECT r.run_id AS run_id,
					if(r.relation = 'commit_pushed', 'exact', 'pr_window') AS link,
					r.relation AS relation,
					if(r.relation = 'commit_pushed', '', r.node_id) AS pr_node,
					g.ci_run_id AS ci_run_id
				FROM run_edges AS r
				INNER JOIN github_edges AS g ON g.node_id = r.node_id
				WHERE (r.relation = 'commit_pushed' AND g.relation = 'ci_on_sha')
					OR (r.relation IN ('pr_named', 'pr_branch_head') AND g.relation = 'ci_for_pr')
			),
			grouped AS (
				SELECT run_id, ci_run_id,
					groupUniqArrayIf(relation, link = 'exact') AS exact_relations,
					groupUniqArrayIf(relation, link = 'pr_window') AS window_relations,
					groupUniqArrayIf(pr_node, pr_node != '') AS pr_nodes
				FROM links
				GROUP BY run_id, ci_run_id
			),
			ci AS (
				SELECT ${ciRunId} AS ci_run_id, repository_id, run_id, attempt,
					workflow_name, event, head_branch, head_sha, conclusion, created_at
				FROM ${ciRuns} FINAL
				WHERE ${github} AND kind = 'actions_run'
					AND ${ciRunId} IN (SELECT ci_run_id FROM grouped)
			)
			SELECT r.agent_id AS agent_id, r.turn_idx AS turn_idx,
				toUnixTimestamp64Milli(r.started_at) AS started_ms,
				toUnixTimestamp64Milli(r.ended_at) AS ended_ms,
				l.ci_run_id AS ci_run_id, c.repository_id AS repository_id,
				c.run_id AS github_run_id, c.attempt AS attempt,
				c.workflow_name AS workflow_name, c.event AS event,
				c.head_branch AS head_branch, c.head_sha AS head_sha,
				c.conclusion AS conclusion,
				toUnixTimestamp64Milli(c.created_at) AS created_ms,
				l.exact_relations AS exact_relations,
				l.window_relations AS window_relations, l.pr_nodes AS pr_nodes
			FROM grouped AS l
			INNER JOIN runs AS r ON r.run_id = l.run_id
			INNER JOIN ci AS c ON c.ci_run_id = l.ci_run_id
			WHERE notEmpty(l.exact_relations)
				OR (c.created_at >= r.started_at AND c.created_at <= r.ended_at)
			ORDER BY notEmpty(l.exact_relations) DESC, c.created_at, l.ci_run_id, r.agent_id, r.turn_idx
			LIMIT {limit:UInt32}`,
		query_params: {
			...params,
			...sessionOwnerParams(scope, sessionId),
			limit: RUN_CI_LINK_LIMIT,
		},
	});
}

export type CiJobs = ReadonlyMap<string, readonly RunCiJob[]>;

export async function readCiJobs(
	executor: ClickHouseExecutor,
	params: { workspaceId: string; repositories: string[] },
	githubRunIds: readonly string[],
): Promise<CiJobs> {
	const jobs = new Map<string, RunCiJob[]>();
	const table = getSafeClickHouseTable("rudel.github_ci_jobs");
	for (const chunk of chunkByParamBytes([...new Set(githubRunIds)], (id) => [
		id,
	]))
		for (const row of await query(executor, JobRowSchema, {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			query: `SELECT repository_id, run_id, attempt, job_id, name, status, conclusion,
				toUnixTimestamp64Milli(created_at) AS created_ms,
				toUnixTimestamp64Milli(started_at) AS started_ms,
				toUnixTimestamp64Milli(completed_at) AS completed_ms,
				runner_name
			FROM ${table} FINAL
			WHERE workspace_id = {workspaceId:String} AND provider = 'github'
				AND repository_id IN {repositories:Array(String)}
				AND run_id IN {githubRunIds:Array(String)}`,
			query_params: { ...params, githubRunIds: chunk },
		})) {
			const key = jobKey(row.repository_id, row.run_id, row.attempt);
			const list = jobs.get(key) ?? [];
			jobs.set(key, list);
			list.push({
				jobId: row.job_id,
				name: row.name,
				status: row.status,
				conclusion: row.conclusion,
				createdAt: iso(row.created_ms),
				startedAt: iso(row.started_ms),
				completedAt: iso(row.completed_ms),
				runnerName: row.runner_name,
			});
		}
	for (const list of jobs.values()) list.sort(byCreatedThenName);
	return jobs;
}

export interface CiRunFacts {
	readonly ci_run_id: string;
	readonly repository_id: string;
	readonly github_run_id: string;
	readonly attempt: number;
	readonly workflow_name: string;
	readonly event: string;
	readonly head_branch: string;
	readonly head_sha: string;
	readonly conclusion: string | null;
	readonly created_ms: number;
}

export function shapeCiRun(
	row: CiRunFacts,
	names: ReadonlyMap<string, string>,
	jobs: CiJobs,
	linked: Pick<RunCiRun, "link" | "relations" | "pullRequests">,
): RunCiRun {
	return {
		ciRunId: row.ci_run_id,
		githubRunId: row.github_run_id,
		attempt: row.attempt,
		repository: names.get(row.repository_id) ?? "",
		workflowName: row.workflow_name,
		event: row.event,
		headBranch: row.head_branch,
		headSha: row.head_sha,
		conclusion: row.conclusion,
		createdAt: new Date(row.created_ms).toISOString(),
		...linked,
		jobs: [
			...(jobs.get(jobKey(row.repository_id, row.github_run_id, row.attempt)) ??
				[]),
		],
	};
}

function assemble(
	links: readonly LinkRow[],
	jobs: CiJobs,
	names: ReadonlyMap<string, string>,
): SessionRunCiRun[] {
	const runs = new Map<string, SessionRunCiRun & { ci: RunCiRun[] }>();
	for (const link of links) {
		const exact = link.exact_relations.length > 0;
		if (
			!exact &&
			(link.created_ms < link.started_ms || link.created_ms > link.ended_ms)
		)
			continue;
		const key = `${link.agent_id}\u0000${link.turn_idx}`;
		const run = runs.get(key) ?? {
			agentId: link.agent_id,
			turn: link.turn_idx,
			startedAt: runCiStartedAt(link.started_ms),
			ci: [],
		};
		runs.set(key, run);
		run.ci.push(
			shapeCiRun(link, names, jobs, {
				link: exact ? "exact" : "pr_window",
				relations: [
					...(exact ? link.exact_relations : link.window_relations),
				].sort(),
				pullRequests: pullRequestNumbers(link.pr_nodes),
			}),
		);
	}
	return [...runs.values()]
		.map((run) => ({
			...run,
			ci: run.ci.sort(
				(a, b) =>
					Number(b.link === "exact") - Number(a.link === "exact") ||
					a.createdAt.localeCompare(b.createdAt) ||
					a.ciRunId.localeCompare(b.ciRunId),
			),
		}))
		.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.turn - b.turn);
}

function jobKey(repositoryId: string, runId: string, attempt: number): string {
	return `${repositoryId}\u0000${runId}\u0000${attempt}`;
}

function byCreatedThenName(a: RunCiJob, b: RunCiJob): number {
	if (a.createdAt !== b.createdAt) {
		if (a.createdAt === null) return 1;
		if (b.createdAt === null) return -1;
		return a.createdAt.localeCompare(b.createdAt);
	}
	return a.name.localeCompare(b.name);
}

function iso(ms: number | null): string | null {
	return ms === null ? null : new Date(ms).toISOString();
}

function pullRequestNumbers(nodes: readonly string[]): number[] {
	const numbers = new Set<number>();
	for (const node of nodes) {
		const number = Number(decodeURIComponent(node.split("/").at(-1) ?? ""));
		if (Number.isInteger(number) && number > 0) numbers.add(number);
	}
	return [...numbers].sort((a, b) => a - b);
}

const LinkRowSchema = z.object({
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	started_ms: z.coerce.number(),
	ended_ms: z.coerce.number(),
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
	exact_relations: z.array(z.string()),
	window_relations: z.array(z.string()),
	pr_nodes: z.array(z.string()),
});
type LinkRow = z.infer<typeof LinkRowSchema>;

const JobRowSchema = z.object({
	repository_id: z.string(),
	run_id: z.string(),
	attempt: z.coerce.number(),
	job_id: z.string(),
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	created_ms: z.coerce.number().nullable(),
	started_ms: z.coerce.number().nullable(),
	completed_ms: z.coerce.number().nullable(),
	runner_name: z.string(),
});
