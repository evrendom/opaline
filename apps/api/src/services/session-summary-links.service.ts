import {
	SESSION_SETUP_TEXT_VERSION_LIMIT,
	type SessionPullRequest,
	type SessionSetupFile,
	type SessionSetupRuns,
	type SessionSetupText,
	type SessionSummaryLinks,
} from "@rudel/api-routes";
import {
	RUN_SETUP_TABLE,
	SETUP_TEXTS_TABLE,
} from "@rudel/ch-schema/received-setup";
import { z } from "zod";
import { getSafeClickHouseTable } from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import { idComponentSql } from "./analysis/sql-l1-views.js";
import { L1_EDGES_TABLE, RUN_INDEX_TABLE } from "./l1-edges/l1-edge-tables.js";
import { runCiDemoOf, withDemoPullRequests } from "./run-ci/demo-run-ci.js";
import {
	type SessionRunCiEnv,
	type SessionRunCiScope,
	sessionOwnerParams,
	sessionOwnerSql,
	visibleRepositoryNames,
} from "./run-ci/session-run-ci.js";

export async function sessionSummaryLinks(
	env: SessionRunCiEnv,
	scope: SessionRunCiScope,
	sessionId: string,
): Promise<SessionSummaryLinks> {
	const [setup, pullRequests] = await Promise.all([
		readSetupFiles(env, scope, sessionId),
		readPullRequests(env, scope, sessionId),
	]);
	const demo = runCiDemoOf(env, scope.workspaceId);
	if (!demo) return { setup, pullRequests };
	return {
		setup,
		pullRequests: withDemoPullRequests(
			pullRequests,
			demo.pullRequests(sessionId),
		),
	};
}

export async function sessionSetupText(
	env: Pick<SessionRunCiEnv, "executor">,
	scope: SessionRunCiScope,
	sessionId: string,
	setupFile: string,
): Promise<SessionSetupText> {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = sessionOwnerSql(scope);
	const rows = await query(env.executor, SetupTextRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH received AS (
				SELECT user_id, version,
					argMin(version_name, run_started_at) AS version_name,
					max(chars) AS chars,
					uniqExact((agent_id, run_start_record)) AS runs,
					toUnixTimestamp64Milli(min(run_started_at)) AS first_ms
				FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
				WHERE ${owner} AND setup_file = {setupFile:String}
					AND ${committedBuildSql(runIndex, owner, ["user_id", "session_id"])}
				GROUP BY user_id, version
			)
			SELECT r.version AS version, r.version_name AS version_name,
				r.chars AS chars, r.runs AS runs, r.first_ms AS first_ms,
				t.text AS text, toUInt8(t.text_cut) AS text_cut
			FROM received AS r
			INNER JOIN (
				SELECT user_id, version, text, text_cut
				FROM ${getSafeClickHouseTable(SETUP_TEXTS_TABLE)} FINAL
				WHERE organization_id = {workspaceId:String}
					AND (user_id, version) IN (SELECT user_id, version FROM received)
			) AS t ON t.user_id = r.user_id AND t.version = r.version
			ORDER BY first_ms DESC, version DESC
			LIMIT ${SESSION_SETUP_TEXT_VERSION_LIMIT}`,
		query_params: { ...sessionOwnerParams(scope, sessionId), setupFile },
	});
	return {
		versions: rows.reverse().map((row) => ({
			version: row.version,
			versionName: row.version_name,
			text: row.text,
			textCut: row.text_cut,
			chars: row.chars,
			runs: row.runs,
			firstAt: new Date(row.first_ms).toISOString(),
		})),
	};
}

export async function sessionSetupRuns(
	env: Pick<SessionRunCiEnv, "executor">,
	scope: SessionRunCiScope,
	sessionId: string,
): Promise<SessionSetupRuns> {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = sessionOwnerSql(scope);
	const rows = await query(env.executor, SetupRunRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT agent_id, toUnixTimestamp64Milli(run_started_at) AS started_ms,
				setup_file, version, version_name,
				toUInt8(carried) AS carried, toUInt8(compacted_since) AS compacted
			FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
			WHERE ${owner}
				AND ${committedBuildSql(runIndex, owner, ["user_id", "session_id"])}
			ORDER BY run_started_at, agent_id, run_start_record, received_at,
				setup_file, version`,
		query_params: sessionOwnerParams(scope, sessionId),
	});
	return {
		runs: rows.map((row) => ({
			agentId: row.agent_id,
			startedAt: new Date(row.started_ms).toISOString(),
			setupFile: row.setup_file,
			version: row.version,
			versionName: row.version_name,
			carried: row.carried,
			compacted: row.compacted,
		})),
	};
}

async function readSetupFiles(
	env: SessionRunCiEnv,
	scope: SessionRunCiScope,
	sessionId: string,
): Promise<SessionSetupFile[]> {
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = sessionOwnerSql(scope);
	const rows = await query(env.executor, SetupFileRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT setup_file, any(kind) AS kind, any(scope) AS scope,
				any(owner) AS owner, any(path) AS path,
				uniqExact(version) AS versions,
				uniqExact((agent_id, run_start_record)) AS runs,
				max(agent_id != '') AS subagents, max(chars) AS chars,
				toUnixTimestamp64Milli(min(run_started_at)) AS first_ms
			FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
			WHERE ${owner}
				AND ${committedBuildSql(runIndex, owner, ["user_id", "session_id"])}
			GROUP BY setup_file
			ORDER BY first_ms, setup_file`,
		query_params: sessionOwnerParams(scope, sessionId),
	});
	return rows.map((row) => ({
		setupFile: row.setup_file,
		kind: row.kind,
		scope: row.scope,
		owner: row.owner,
		path: row.path,
		versions: row.versions,
		runs: row.runs,
		subagents: row.subagents,
		chars: row.chars,
		firstAt: new Date(row.first_ms).toISOString(),
	}));
}

async function readPullRequests(
	env: SessionRunCiEnv,
	scope: SessionRunCiScope,
	sessionId: string,
): Promise<SessionPullRequest[]> {
	const names = await visibleRepositoryNames(env, scope.workspaceId);
	if (!names) return [];
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const edges = getSafeClickHouseTable(L1_EDGES_TABLE);
	const pulls = getSafeClickHouseTable("rudel.github_pull_requests");
	const owner = sessionOwnerSql(scope);
	const prNodeId = `concat(${idComponentSql("repository_id")}, '/', toString(number))`;
	const rows = await query(env.executor, PullRequestRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH
			runs AS (
				SELECT run_id FROM ${runIndex} FINAL
				WHERE ${owner} AND row_kind = 'run'
					AND ${committedBuildSql(runIndex, owner, ["user_id", "session_id"])}
			),
			named AS (
				SELECT to_id AS node_id, groupUniqArray(relation) AS relations
				FROM (
					SELECT from_id, relation, to_id, is_active
					FROM ${edges} FINAL
					WHERE organization_id = {workspaceId:String}
						AND repository_id IN {repositories:Array(String)}
						AND from_kind = 'run' AND from_id IN (SELECT run_id FROM runs)
						AND relation IN ('pr_named', 'pr_branch_head')
				)
				WHERE is_active = 1
				GROUP BY node_id
			),
			pulls AS (
				SELECT ${prNodeId} AS node_id, repository_id, number, title, state,
					draft, toUnixTimestamp64Milli(merged_at) AS merged_ms,
					head_ref, author_login
				FROM ${pulls} FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github'
					AND repository_id IN {repositories:Array(String)}
					AND ${prNodeId} IN (SELECT node_id FROM named)
			)
			SELECT n.node_id AS node_id, n.relations AS relations,
				p.repository_id AS repository_id, p.number AS number,
				p.title AS title, p.state AS state, p.draft AS draft,
				p.merged_ms AS merged_ms, p.head_ref AS head_ref,
				p.author_login AS author_login
			FROM named AS n
			LEFT JOIN pulls AS p ON p.node_id = n.node_id`,
		query_params: {
			...sessionOwnerParams(scope, sessionId),
			repositories: [...names.keys()],
		},
	});
	return rows
		.flatMap((row): SessionPullRequest[] => {
			const [repositoryPart, numberPart] = row.node_id.split("/");
			const number = Number(numberPart);
			if (!repositoryPart || !Number.isInteger(number) || number <= 0)
				return [];
			const synced = row.number > 0;
			return [
				{
					repository: names.get(decodeURIComponent(repositoryPart)) ?? "",
					number,
					relations: [...row.relations].sort(),
					title: synced ? row.title : null,
					state: synced ? row.state : null,
					draft: synced ? row.draft : null,
					mergedAt:
						synced && row.merged_ms !== null && row.merged_ms > 0
							? new Date(row.merged_ms).toISOString()
							: null,
					headRef: synced ? row.head_ref : null,
					authorLogin: synced ? row.author_login : null,
				},
			];
		})
		.sort(
			(a, b) => a.repository.localeCompare(b.repository) || a.number - b.number,
		);
}

const SetupFileRowSchema = z.object({
	setup_file: z.string(),
	kind: z.string(),
	scope: z.string(),
	owner: z.string(),
	path: z.string(),
	versions: z.coerce.number(),
	runs: z.coerce.number(),
	subagents: z.coerce.boolean(),
	chars: z.coerce.number(),
	first_ms: z.coerce.number(),
});

const SetupTextRowSchema = z.object({
	version: z.string(),
	version_name: z.string(),
	chars: z.coerce.number(),
	runs: z.coerce.number(),
	first_ms: z.coerce.number(),
	text: z.string(),
	text_cut: z.coerce.number().transform((cut) => cut === 1),
});

const SetupRunRowSchema = z.object({
	agent_id: z.string(),
	started_ms: z.coerce.number(),
	setup_file: z.string(),
	version: z.string(),
	version_name: z.string(),
	carried: z.coerce.number().transform((carried) => carried === 1),
	compacted: z.coerce.number().transform((compacted) => compacted === 1),
});

const PullRequestRowSchema = z.object({
	node_id: z.string(),
	relations: z.array(z.string()),
	repository_id: z.string(),
	number: z.coerce.number(),
	title: z.string(),
	state: z.string(),
	draft: z.coerce.number().transform((draft) => draft === 1),
	merged_ms: z.coerce.number().nullable(),
	head_ref: z.string(),
	author_login: z.string(),
});
