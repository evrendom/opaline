import { TupleParam } from "@clickhouse/client-web";
import {
	type ParsedRunId,
	parseRunId,
	REPOSITORY_RUN_CALL_TEXT_LIMIT,
	type ReportCall,
	type ReportRun,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import { RUN_INDEX_TABLE } from "./l1-edges/l1-edge-tables.js";
import { repoScopeOf } from "./repository-setup.service.js";
import type { SessionRunCiScope } from "./run-ci/session-run-ci.js";

const L = REPOSITORY_RUN_CALL_TEXT_LIMIT;

const OWNER = `organization_id = {workspaceId:String}
	AND (user_id, session_id) IN (
		SELECT user_id, session_id FROM repo_sessions
		WHERE (user_id, session_id) IN {sessions:Array(Tuple(String, String))}
	)`;

function parsedRuns(runIds: readonly string[]) {
	return runIds.flatMap((runId) => {
		const parsed = parseRunId(runId);
		return parsed ? [{ runId, ...parsed }] : [];
	});
}

function sessionsOf(runs: readonly ParsedRunId[]) {
	const keys = new Map(
		runs.map((run) => [`${run.userId} ${run.sessionId}`, run]),
	);
	return [...keys.values()].map(
		(run) => new TupleParam([run.userId, run.sessionId]),
	);
}

const runKey = (run: {
	user_id: string;
	session_id: string;
	agent_id: string;
	start_record: number;
}) =>
	[run.user_id, run.session_id, run.agent_id, run.start_record].join("\u0000");

export async function reportRuns(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	input: { repoKey: string; runIds: readonly string[] },
): Promise<{ runs: ReportRun[] }> {
	const wanted = parsedRuns(input.runIds);
	const repo = await repoScopeOf(env.executor, scope, input.repoKey);
	if (!repo || wanted.length === 0) return { runs: [] };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const rows = await query(env.executor, RunRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte},
			committed AS (
				SELECT user_id, session_id, revision, parser_version, agent_id,
					start_record, turn_idx, started_at, prompt_head
				FROM ${runIndex}
				WHERE ${OWNER} AND row_kind = 'run'
					AND ${committedBuildSql(runIndex, OWNER, ["user_id", "session_id"])}
			)
			SELECT r.user_id AS user_id, r.session_id AS session_id,
				r.agent_id AS agent_id, r.start_record AS start_record,
				r.revision AS revision, r.parser_version AS parser_version,
				r.turn_idx AS turn_idx,
				toUnixTimestamp64Milli(r.started_at) AS started_ms,
				r.prompt_head AS prompt, n.prompt_head AS next_prompt
			FROM committed AS r
			LEFT JOIN committed AS n
				ON n.user_id = r.user_id AND n.session_id = r.session_id
				AND n.agent_id = r.agent_id AND n.turn_idx = r.turn_idx + 1
			WHERE (r.user_id, r.session_id, r.agent_id, r.start_record)
				IN {runs:Array(Tuple(String, String, String, UInt32))}`,
		query_params: {
			...repo.params,
			sessions: sessionsOf(wanted),
			runs: wanted.map(
				(run) =>
					new TupleParam([
						run.userId,
						run.sessionId,
						run.agentId,
						run.startRecord,
					]),
			),
		},
	});
	const uuids = await startUuids(env.executor, repo.params, rows);
	const byKey = new Map(rows.map((row) => [runKey(row), row]));
	return {
		runs: wanted.flatMap((run) => {
			const row = byKey.get(
				runKey({
					user_id: run.userId,
					session_id: run.sessionId,
					agent_id: run.agentId,
					start_record: run.startRecord,
				}),
			);
			if (!row) return [];
			return [
				{
					runId: run.runId,
					sessionId: row.session_id,
					agentId: row.agent_id,
					startRecord: row.start_record,
					turn: row.turn_idx,
					turnId: uuids.get(runKey(row)) ?? null,
					startedAt: new Date(row.started_ms).toISOString(),
					prompt: row.prompt,
					nextPrompt: row.next_prompt || null,
				},
			];
		}),
	};
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
			GROUP BY user_id, session_id, agent_id, start_record`,
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
	return new Map(found.map((row) => [runKey(row), row.uuid]));
}

export async function reportCalls(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	input: {
		repoKey: string;
		calls: readonly { runId: string; callId: string }[];
	},
): Promise<{ calls: ReportCall[] }> {
	const wanted = input.calls.flatMap((call) => {
		const parsed = parseRunId(call.runId);
		return parsed ? [{ ...call, ...parsed }] : [];
	});
	const repo = await repoScopeOf(env.executor, scope, input.repoKey);
	if (!repo || wanted.length === 0) return { calls: [] };
	const records = getSafeClickHouseTable("rudel.transcript_records");
	const rows = await query(env.executor, CallRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte},
			picked AS (
				SELECT user_id, session_id, agent_id, call_id, revision, kind,
					record_idx, ts, tool_name, file_op, file_path, source, subtype,
					text, text_chars, head, is_error
				FROM ${records}
				WHERE ${OWNER}
					AND (user_id, session_id, agent_id, call_id)
						IN {calls:Array(Tuple(String, String, String, String))}
			),
			latest AS (
				SELECT user_id, session_id, max(revision) AS revision
				FROM picked GROUP BY user_id, session_id
			)
			SELECT p.session_id AS session_id, p.agent_id AS agent_id,
				p.call_id AS call_id,
				toUnixTimestamp64Milli(minIf(p.ts, p.kind != 'tool_result')) AS at_ms,
				anyIf(p.tool_name, p.tool_name != '') AS tool,
				anyIf(p.file_op, p.file_op != '') AS op,
				anyIf(p.file_path, p.file_path != '') AS path,
				maxIf(p.source = 'codex' AND p.subtype IN ('patch', 'nested') AND p.file_op = 'write', p.kind != 'tool_result') AS codex_add,
				argMaxIf(p.text, p.text_chars, p.kind != 'tool_result') AS input,
				maxIf(p.text_chars, p.kind != 'tool_result') AS input_chars,
				anyIf(p.text, p.kind = 'tool_result') AS result,
				maxIf(p.text_chars, p.kind = 'tool_result') AS result_chars,
				countIf(p.kind = 'tool_result') > 0 AS has_result,
				maxIf(p.is_error, p.kind = 'tool_result') AS failed,
				maxIf(startsWith(p.head, 'File created successfully at:'), p.kind = 'tool_result') AS created
			FROM picked AS p
			INNER JOIN latest AS l
				ON l.user_id = p.user_id AND l.session_id = p.session_id
				AND l.revision = p.revision
			GROUP BY session_id, agent_id, call_id`,
		query_params: {
			...repo.params,
			sessions: sessionsOf(wanted),
			calls: wanted.map(
				(call) =>
					new TupleParam([
						call.userId,
						call.sessionId,
						call.agentId,
						call.callId,
					]),
			),
		},
	});
	const clip = (text: string, chars: number) => ({
		text: text.slice(0, L),
		cut: chars > L || text.length < chars,
	});
	const byKey = new Map(
		rows.map((row) => [
			[row.session_id, row.agent_id, row.call_id].join("\u0000"),
			row,
		]),
	);
	return {
		calls: wanted.flatMap((call) => {
			const row = byKey.get(
				[call.sessionId, call.agentId, call.callId].join("\u0000"),
			);
			if (!row) return [];
			return [
				{
					runId: call.runId,
					callId: row.call_id,
					at: new Date(row.at_ms).toISOString(),
					tool: row.tool,
					op: row.op,
					path: row.path || null,
					created: row.created === 1 || row.codex_add === 1,
					failed: row.failed === 1,
					input: row.input_chars > 0 ? clip(row.input, row.input_chars) : null,
					output: row.has_result ? clip(row.result, row.result_chars) : null,
					loaded: null,
					line: null,
				},
			];
		}),
	};
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
	next_prompt: z.string().nullable(),
});

const StartRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	start_record: z.coerce.number(),
	uuid: z.string(),
});

const CallRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	call_id: z.string(),
	at_ms: z.coerce.number(),
	tool: z.string(),
	op: z.string(),
	path: z.string(),
	codex_add: z.coerce.number(),
	input: z.string(),
	input_chars: z.coerce.number(),
	result: z.string(),
	result_chars: z.coerce.number(),
	has_result: z.coerce.boolean(),
	failed: z.coerce.number(),
	created: z.coerce.number(),
});
