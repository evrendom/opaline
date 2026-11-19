import { TupleParam } from "@clickhouse/client-web";
import {
	getAgentRunDuration,
	REPOSITORY_RUNS_LIMIT,
	type RepositoryRunFigures,
	type RepositoryRuns,
	type RepositoryRunsOf,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import {
	L1_EDGES_BY_TARGET_TABLE,
	RUN_INDEX_TABLE,
} from "./l1-edges/l1-edge-tables.js";
import { type RepoRange, repoScopeOf } from "./repository-setup.service.js";
import type { SessionRunCiScope } from "./run-ci/session-run-ci.js";
import { buildCanonicalPricingModelSql } from "./usage-event-analytics.service.js";

const TOUCHED_OWNER = `organization_id = {workspaceId:String}
	AND (user_id, session_id) IN (SELECT user_id, session_id FROM touched_sessions)`;

export async function repositoryRuns(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string | undefined,
	of: RepositoryRunsOf,
	range?: RepoRange,
): Promise<RepositoryRuns> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { runs: [], truncated: false, figures: null };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const committedRuns = `committed_runs AS (
		SELECT user_id, session_id, revision, parser_version, agent_id,
			start_record, run_id, turn_idx, started_at, prompt_head, cost_usd,
			coalesce(nullIf(${buildCanonicalPricingModelSql("model")}, ''), model, '') AS run_model,
			if(isNotNull(duration_ms), duration_ms / 1000,
				dateDiff('millisecond', started_at, ended_at) / 1000) AS duration_s
		FROM ${runIndex}
		WHERE ${TOUCHED_OWNER} AND row_kind = 'run'
			AND ${committedBuildSql(runIndex, TOUCHED_OWNER, ["user_id", "session_id"])}
	)`;
	const rows = await query(env.executor, RunRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte},
			${hitsSql(of, committedRuns)}
			SELECT h.user_id AS user_id, h.session_id AS session_id,
				h.agent_id AS agent_id, h.start_record AS start_record,
				r.revision AS revision, r.parser_version AS parser_version,
				r.turn_idx AS turn_idx,
				toUnixTimestamp64Milli(r.started_at) AS started_ms,
				r.prompt_head AS prompt, h.changes AS changes, h.reads AS reads,
				h.calls AS calls, h.relations AS relations,
				r.run_id AS run_id, r.cost_usd AS cost_usd,
				r.run_model AS model, r.duration_s AS duration_s
			FROM hits AS h
			INNER JOIN committed_runs AS r
				ON r.user_id = h.user_id AND r.session_id = h.session_id
				AND r.agent_id = h.agent_id AND r.start_record = h.start_record
			ORDER BY started_ms DESC, session_id, agent_id
			LIMIT ${FIGURE_RUNS_LIMIT}`,
		query_params: { ...repo.params, ...paramsOf(of) },
	});
	const listed = rows.slice(0, REPOSITORY_RUNS_LIMIT + 1);
	const [uuids, figures, links] = await Promise.all([
		startUuids(env.executor, repo.params, listed),
		readFigures(env.executor, repo.params, rows),
		readRunLinks(env.executor, repo.params, listed),
	]);
	return {
		runs: listed.slice(0, REPOSITORY_RUNS_LIMIT).map((row) => ({
			sessionId: row.session_id,
			agentId: row.agent_id,
			startRecord: row.start_record,
			turn: row.turn_idx,
			turnId: uuids.get(startKey(row)) ?? null,
			startedAt: new Date(row.started_ms).toISOString(),
			prompt: row.prompt,
			changes: row.changes,
			reads: row.reads,
			calls: row.calls,
			relations: row.relations,
			costUsd: row.cost_usd,
			model: row.model || null,
			mergedPullRequests: links.get(row.run_id)?.merged ?? 0,
			ciRuns: links.get(row.run_id)?.ciRuns ?? 0,
		})),
		truncated: rows.length > REPOSITORY_RUNS_LIMIT,
		figures,
	};
}

const FIGURE_RUNS_LIMIT = 2000;

async function readFigures(
	executor: ClickHouseExecutor,
	params: Record<string, unknown>,
	rows: readonly z.infer<typeof RunRowSchema>[],
): Promise<RepositoryRunFigures | null> {
	if (rows.length === 0) return null;
	const sessions = new Map(
		rows.map((row) => [`${row.user_id} ${row.session_id}`, row]),
	);
	const edges = getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE);
	const [row] = await query(executor, FiguresRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH links AS (
				SELECT DISTINCT to_kind, to_id FROM (
					SELECT to_kind, to_id, from_id, is_active
					FROM ${edges} FINAL
					WHERE organization_id = {workspaceId:String} AND from_kind = 'run'
						AND to_kind IN ('pull_request', 'ci_run')
						AND (user_id, session_id) IN {sessions:Array(Tuple(String, String))}
				)
				WHERE is_active = 1 AND from_id IN {runIds:Array(String)}
			)
			SELECT
				(SELECT tuple(
						sum(arraySum(mapValues(model_apology_counts))),
						sum(arraySum(mapValues(member_negative_counts))))
					FROM ${getSafeClickHouseTable("rudel.session_language_signals")} FINAL
					WHERE organization_id = {workspaceId:String}
						AND (user_id, session_id) IN {sessions:Array(Tuple(String, String))}
				) AS language,
				(SELECT count() FROM ${getSafeClickHouseTable("rudel.github_pull_requests")} FINAL
					WHERE workspace_id = {workspaceId:String} AND provider = 'github'
						AND merged_at IS NOT NULL
						AND concat(repository_id, '/', toString(number))
							IN (SELECT to_id FROM links WHERE to_kind = 'pull_request')
				) AS merged,
				(SELECT count() FROM links WHERE to_kind = 'ci_run') AS ci_runs`,
		query_params: {
			workspaceId: params.workspaceId,
			sessions: [...sessions.values()].map(
				(each) => new TupleParam([each.user_id, each.session_id]),
			),
			runIds: rows.map((each) => each.run_id),
		},
	});
	const [apologies, negative] = row?.language ?? [0, 0];
	return {
		sessions: sessions.size,
		agentRuns: rows.length,
		cost: rows.reduce((sum, each) => sum + (each.cost_usd ?? 0), 0),
		unpricedRuns: rows.filter((each) => each.cost_usd === null).length,
		signals: apologies + negative,
		mergedPullRequests: row?.merged ?? 0,
		ciRuns: row?.ci_runs ?? 0,
		breakdowns: {
			models: tally(rows, (each) =>
				each.cost_usd === null || !each.model
					? null
					: [each.model, each.cost_usd],
			),
			members: tally([...sessions.values()], (each) => [each.user_id, 1]),
			durations: tally(rows, (each) => [
				getAgentRunDuration(each.duration_s ?? undefined),
				1,
			]),
			signalTypes: [
				{ id: "modelApologies", value: apologies },
				{ id: "userNegative", value: negative },
			],
		},
	};
}

function tally<T>(
	items: readonly T[],
	pick: (item: T) => readonly [string, number] | null,
) {
	const totals = new Map<string, number>();
	for (const item of items) {
		const picked = pick(item);
		if (picked) totals.set(picked[0], (totals.get(picked[0]) ?? 0) + picked[1]);
	}
	return [...totals]
		.map(([id, value]) => ({ id, value }))
		.sort((a, b) => b.value - a.value);
}

async function readRunLinks(
	executor: ClickHouseExecutor,
	params: Record<string, unknown>,
	rows: readonly z.infer<typeof RunRowSchema>[],
): Promise<Map<string, { ciRuns: number; merged: number }>> {
	if (rows.length === 0) return new Map();
	const sessions = new Map(
		rows.map((row) => [`${row.user_id} ${row.session_id}`, row]),
	);
	const edges = getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE);
	const found = await query(executor, RunLinksRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH links AS (
				SELECT DISTINCT from_id, to_kind, to_id FROM (
					SELECT to_kind, to_id, from_id, is_active
					FROM ${edges} FINAL
					WHERE organization_id = {workspaceId:String} AND from_kind = 'run'
						AND to_kind IN ('pull_request', 'ci_run')
						AND (user_id, session_id) IN {sessions:Array(Tuple(String, String))}
				)
				WHERE is_active = 1 AND from_id IN {runIds:Array(String)}
			),
			merged AS (
				SELECT concat(repository_id, '/', toString(number)) AS id
				FROM ${getSafeClickHouseTable("rudel.github_pull_requests")} FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github'
					AND merged_at IS NOT NULL
					AND concat(repository_id, '/', toString(number))
						IN (SELECT to_id FROM links WHERE to_kind = 'pull_request')
			)
			SELECT from_id AS run_id,
				countIf(to_kind = 'ci_run') AS ci_runs,
				countIf(to_kind = 'pull_request' AND to_id IN (SELECT id FROM merged)) AS merged
			FROM links
			GROUP BY from_id`,
		query_params: {
			workspaceId: params.workspaceId,
			sessions: [...sessions.values()].map(
				(each) => new TupleParam([each.user_id, each.session_id]),
			),
			runIds: rows.map((each) => each.run_id),
		},
	});
	return new Map(
		found.map((each) => [
			each.run_id,
			{ ciRuns: each.ci_runs, merged: each.merged },
		]),
	);
}

const RunLinksRowSchema = z.object({
	run_id: z.string(),
	ci_runs: z.coerce.number(),
	merged: z.coerce.number(),
});

const FiguresRowSchema = z.object({
	language: z
		.tuple([z.coerce.number(), z.coerce.number()])
		.nullable()
		.catch([0, 0]),
	merged: z.coerce.number(),
	ci_runs: z.coerce.number(),
});
function startKey(row: {
	user_id: string;
	session_id: string;
	agent_id: string;
	start_record: number;
}) {
	return [row.user_id, row.session_id, row.agent_id, row.start_record].join(
		"\u0000",
	);
}

async function startUuids(
	executor: ClickHouseExecutor,
	params: Record<string, unknown>,
	rows: readonly z.infer<typeof RunRowSchema>[],
): Promise<Map<string, string>> {
	if (rows.length === 0) return new Map();
	const found = await query(executor, StartRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, session_id, agent_id, record_idx AS start_record,
				any(record_uuid) AS uuid
			FROM ${getSafeClickHouseTable("rudel.transcript_records")}
			WHERE organization_id = {workspaceId:String}
				AND (user_id, session_id, revision, parser_version, agent_id, record_idx)
					IN {starts:Array(Tuple(String, String, UInt64, UInt16, String, UInt32))}
				AND record_uuid != ''
			GROUP BY user_id, session_id, agent_id, start_record
			LIMIT ${REPOSITORY_RUNS_LIMIT + 1}`,
		query_params: {
			workspaceId: params.workspaceId,
			starts: rows.map(
				(row) =>
					new TupleParam([
						row.user_id,
						row.session_id,
						row.revision,
						row.parser_version,
						row.agent_id,
						row.start_record,
					]),
			),
		},
	});
	return new Map(found.map((row) => [startKey(row), row.uuid]));
}

export function matchSql(
	of: Extract<RepositoryRunsOf, { kind: "file" | "mcp" | "setup" }>,
): string {
	if (of.kind === "file")
		return `t.file_op != '' AND t.file_path != ''
					AND if(startsWith(t.file_path, concat(s.project_path, '/')),
						substring(t.file_path, length(s.project_path) + 2),
						t.file_path) IN {paths:Array(String)}`;
	if (of.kind === "mcp")
		return `(t.mcp_server = {server:String}
					OR endsWith(t.mcp_server, concat('_', {server:String})))
				AND t.call_id != ''${
					of.tool
						? `
				AND (t.tool_name = {tool:String}
					OR endsWith(t.tool_name, concat('__', {tool:String})))`
						: ""
				}`;
	return `t.subtype = 'skill_body'
					AND position(t.facts['received_setup'], concat({skillPath:String}, '"')) > 0`;
}

export function skillPathOf(setupFile: string): string {
	return setupFile.slice(setupFile.lastIndexOf(":") + 1).replace(/^~/u, "");
}

export function mcpServerOf(owner: string): string {
	return owner.replace(/[^A-Za-z0-9_-]/gu, "_");
}

export function paramsOf(of: RepositoryRunsOf): Record<string, unknown> {
	if (of.kind === "file") return { paths: of.paths };
	if (of.kind === "setup") return { skillPath: skillPathOf(of.setupFile) };
	if (of.kind === "mcp")
		return {
			server: mcpServerOf(of.server),
			...(of.tool ? { tool: of.tool } : {}),
		};
	return { toKind: of.kind, node: of.node };
}

function recordHitsSql(match: string, committedRuns: string): string {
	const records = getSafeClickHouseTable("rudel.transcript_records");
	return `touches AS (
			SELECT t.user_id AS user_id, t.session_id AS session_id,
				t.revision AS revision, t.parser_version AS parser_version,
				t.agent_id AS agent_id, t.record_idx AS record_idx,
				t.call_id AS call_id, t.file_op AS file_op, t.mcp_server AS mcp_server,
				t.subtype AS subtype
			FROM ${records} AS t
			INNER JOIN repo_sessions AS s
				ON s.user_id = t.user_id AND s.session_id = t.session_id
			WHERE t.organization_id = {workspaceId:String}
				AND (t.user_id, t.session_id) IN (SELECT user_id, session_id FROM repo_sessions)
				AND ${match}
		),
		touched_sessions AS (SELECT DISTINCT user_id, session_id FROM touches),
		${committedRuns},
		hits AS (
			SELECT x.user_id AS user_id, x.session_id AS session_id,
				x.agent_id AS agent_id, r.start_record AS start_record,
				uniqExactIf(x.call_id, x.file_op != '' AND x.file_op != 'read') AS changes,
				uniqExactIf(x.call_id, x.file_op = 'read') AS reads,
				uniqExactIf(x.call_id, x.mcp_server != '')
					+ countIf(x.subtype = 'skill_body') AS calls,
				CAST([], 'Array(String)') AS relations
			FROM touches AS x
			ASOF INNER JOIN committed_runs AS r
				ON x.user_id = r.user_id AND x.session_id = r.session_id
				AND x.revision = r.revision AND x.parser_version = r.parser_version
				AND x.agent_id = r.agent_id AND x.record_idx >= r.start_record
			GROUP BY user_id, session_id, agent_id, start_record
		)`;
}

function hitsSql(of: RepositoryRunsOf, committedRuns: string): string {
	if (of.kind === "file" || of.kind === "mcp" || of.kind === "setup")
		return recordHitsSql(matchSql(of), committedRuns);
	const edges = getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE);
	return `edges AS (
			SELECT DISTINCT from_id AS run_id, user_id, session_id, relation
			FROM (
				SELECT from_id, user_id, session_id, relation, is_active
				FROM ${edges} FINAL
				WHERE organization_id = {workspaceId:String}
					AND to_kind = {toKind:String} AND to_id = {node:String}
					AND from_kind = 'run'
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM repo_sessions)
			)
			WHERE is_active = 1
		),
		touched_sessions AS (SELECT DISTINCT user_id, session_id FROM edges),
		${committedRuns},
		hits AS (
			SELECT r.user_id AS user_id, r.session_id AS session_id,
				r.agent_id AS agent_id, r.start_record AS start_record,
				toUInt64(0) AS changes, toUInt64(0) AS reads, toUInt64(0) AS calls,
				arraySort(groupUniqArray(e.relation)) AS relations
			FROM edges AS e
			INNER JOIN committed_runs AS r ON r.run_id = e.run_id
			GROUP BY user_id, session_id, agent_id, start_record
		)`;
}

const RunRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	start_record: z.coerce.number(),
	revision: z
		.union([z.string(), z.number()])
		.transform((value) => BigInt(value)),
	parser_version: z.coerce.number(),
	turn_idx: z.coerce.number(),
	started_ms: z.coerce.number(),
	prompt: z.string().nullable(),
	changes: z.coerce.number(),
	reads: z.coerce.number(),
	calls: z.coerce.number(),
	relations: z.array(z.string()),
	run_id: z.string(),
	cost_usd: z.coerce.number().nullable(),
	model: z.string(),
	duration_s: z.coerce.number().nullable(),
});

const StartRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	start_record: z.coerce.number(),
	uuid: z.string(),
});
