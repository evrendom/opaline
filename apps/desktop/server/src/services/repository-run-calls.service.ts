import {
	REPOSITORY_RUN_CALL_TEXT_LIMIT,
	REPOSITORY_RUN_CALLS_LIMIT,
	type RepositoryRunCalls,
	type RepositoryRunsOf,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import { RUN_INDEX_TABLE } from "./l1-edges/l1-edge-tables.js";
import { matchSql, paramsOf } from "./repository-runs.service.js";
import { type RepoRange, repoScopeOf } from "./repository-setup.service.js";
import type { SessionRunCiScope } from "./run-ci/session-run-ci.js";

const IN_RUN = `t.organization_id = {workspaceId:String}
	AND (t.user_id, t.session_id, t.revision, t.parser_version, t.agent_id)
		IN (SELECT user_id, session_id, revision, parser_version, agent_id FROM run)
	AND t.record_idx >= (SELECT any(start_record) FROM run)
	AND t.record_idx < (SELECT any(end_record) FROM run)`;

const RUN_OWNER = `organization_id = {workspaceId:String}
	AND (user_id, session_id) IN (
		SELECT user_id, session_id FROM repo_sessions WHERE session_id = {sessionId:String}
	)`;

const L = REPOSITORY_RUN_CALL_TEXT_LIMIT;

const clipped = (column: string, chars: string, name: string) =>
	`substring(${column}, 1, ${L}) AS ${name}_text,
				toUInt8(${chars} > ${L} OR char_length(${column}) < ${chars}) AS ${name}_cut`;

export async function repositoryRunCalls(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	input: {
		repoKey?: string;
		of: RepositoryRunsOf;
		sessionId: string;
		agentId: string;
		startRecord: number;
		range?: RepoRange;
	},
): Promise<RepositoryRunCalls> {
	const of = input.of;
	const repo = await repoScopeOf(
		env.executor,
		scope,
		input.repoKey,
		input.range,
	);
	if (!repo) return { calls: [], truncated: false };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const records = getSafeClickHouseTable("rudel.transcript_records");
	const run = `run AS (
			SELECT user_id, session_id, revision, parser_version, agent_id,
				start_record, end_record
			FROM ${runIndex}
			WHERE ${RUN_OWNER} AND row_kind = 'run'
				AND agent_id = {agentId:String} AND start_record = {startRecord:UInt32}
				AND ${committedBuildSql(runIndex, RUN_OWNER, ["user_id", "session_id"])}
			LIMIT 1
		)`;
	const rows = await query(env.executor, CallRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte}, ${run},
			${
				of.kind === "setup"
					? skillCallsSql(records, of)
					: of.kind === "file" || of.kind === "mcp"
						? recordCallsSql(records, of)
						: allCallsSql(records)
			},
			results AS (
				SELECT call_id, any(text) AS result, any(text_chars) AS result_chars,
					max(is_error) AS failed, max(t.ts) AS ended,
					max(startsWith(head, 'File created successfully at:')) AS created
				FROM ${records} AS t
				WHERE ${IN_RUN} AND t.kind = 'tool_result' AND t.call_id != ''
					AND t.call_id IN (SELECT call_id FROM calls WHERE call_id != '')
				GROUP BY call_id
			)
			SELECT c.call_id AS call_id, toUnixTimestamp64Milli(c.ts) AS at_ms,
				c.tool AS tool, c.op AS op, c.path AS path, c.codex_add AS codex_add,
				${clipped("c.input", "c.input_chars", "input")},
				${clipped("r.result", "r.result_chars", "result")},
				${clipped("c.loaded", "c.loaded_chars", "loaded")},
				r.failed AS failed, r.created AS created, r.call_id != '' AS has_result,
				if(r.call_id != '', toUnixTimestamp64Milli(r.ended), 0) AS end_ms,
				c.loaded_chars AS loaded_chars, c.input_chars AS input_chars
			FROM calls AS c
			LEFT JOIN results AS r ON r.call_id = c.call_id
			ORDER BY c.rec
			LIMIT ${REPOSITORY_RUN_CALLS_LIMIT + 1}`,
		query_params: {
			...repo.params,
			...paramsOf(of),
			sessionId: input.sessionId,
			agentId: input.agentId,
			startRecord: input.startRecord,
		},
	});
	return {
		calls: rows.slice(0, REPOSITORY_RUN_CALLS_LIMIT).map((row) => ({
			callId: row.call_id,
			at: new Date(row.at_ms).toISOString(),
			tool: row.tool,
			op: row.op,
			path: row.path || null,
			created: row.created === 1 || row.codex_add === 1,
			failed: row.failed === 1,
			input:
				row.input_chars > 0
					? { text: row.input_text, cut: row.input_cut === 1 }
					: null,
			output: row.has_result
				? { text: row.result_text, cut: row.result_cut === 1 }
				: null,
			loaded:
				row.loaded_chars > 0
					? { text: row.loaded_text, cut: row.loaded_cut === 1 }
					: null,
			line: null,
			endAt: row.end_ms > 0 ? new Date(row.end_ms).toISOString() : null,
		})),
		truncated: rows.length > REPOSITORY_RUN_CALLS_LIMIT,
	};
}

function allCallsSql(records: string): string {
	return `calls AS (
			SELECT t.call_id AS call_id, min(t.record_idx) AS rec, min(t.ts) AS ts,
				anyIf(t.tool_name, t.tool_name != '') AS tool,
				anyIf(t.file_op, t.file_op != '') AS op,
				anyIf(t.file_path, t.file_path != '') AS path,
				toUInt8(0) AS codex_add,
				argMax(t.text, t.text_chars) AS input, max(t.text_chars) AS input_chars,
				'' AS loaded, toUInt32(0) AS loaded_chars
			FROM ${records} AS t
			WHERE ${IN_RUN} AND t.kind = 'tool_call' AND t.call_id != ''
			GROUP BY call_id
		)`;
}

function recordCallsSql(
	records: string,
	of: Extract<RepositoryRunsOf, { kind: "file" | "mcp" }>,
): string {
	return `matched AS (
			SELECT t.call_id AS call_id, min(t.record_idx) AS rec,
				anyIf(t.file_op, t.file_op != '') AS op,
				anyIf(t.file_path, t.file_path != '') AS path,
				max(t.source = 'codex' AND t.subtype IN ('patch', 'nested') AND t.file_op = 'write') AS codex_add
			FROM ${records} AS t
			INNER JOIN repo_sessions AS s
				ON s.user_id = t.user_id AND s.session_id = t.session_id
			WHERE ${IN_RUN} AND t.kind != 'tool_result' AND t.call_id != ''
				AND ${of.kind === "mcp" ? "t.kind = 'tool_call' AND " : ""}${matchSql(of)}
			GROUP BY call_id
		),
		calls AS (
			SELECT m.call_id AS call_id, any(m.rec) AS rec, min(t.ts) AS ts,
				anyIf(t.tool_name, t.tool_name != '') AS tool,
				any(m.op) AS op, any(m.path) AS path, any(m.codex_add) AS codex_add,
				argMax(t.text, t.text_chars) AS input, max(t.text_chars) AS input_chars,
				'' AS loaded, toUInt32(0) AS loaded_chars
			FROM ${records} AS t
			INNER JOIN matched AS m ON m.call_id = t.call_id
			WHERE ${IN_RUN} AND t.kind != 'tool_result'
				AND t.call_id IN (SELECT call_id FROM matched)
			GROUP BY call_id
		)`;
}

function skillCallsSql(
	records: string,
	of: Extract<RepositoryRunsOf, { kind: "setup" }>,
): string {
	return `bodies AS (
			SELECT toUInt8(1) AS one, t.record_idx AS rec, t.ts AS ts,
				t.text AS loaded, t.text_chars AS loaded_chars
			FROM ${records} AS t
			WHERE ${IN_RUN} AND t.subtype = 'skill_body'
				AND ${matchSql(of)}
		),
		skill_calls AS (
			SELECT toUInt8(1) AS one, t.record_idx AS rec, t.call_id AS call_id,
				t.text AS input, t.text_chars AS input_chars
			FROM ${records} AS t
			WHERE ${IN_RUN} AND t.kind = 'tool_call' AND t.tool_name = 'Skill'
		),
		calls AS (
			SELECT b.rec AS rec, b.ts AS ts, k.call_id AS call_id,
				'Skill' AS tool, 'skill' AS op, '' AS path, toUInt8(0) AS codex_add,
				k.input AS input, k.input_chars AS input_chars,
				b.loaded AS loaded, b.loaded_chars AS loaded_chars
			FROM bodies AS b
			ASOF LEFT JOIN skill_calls AS k ON b.one = k.one AND b.rec > k.rec
		)`;
}

const CallRowSchema = z.object({
	call_id: z.string(),
	at_ms: z.coerce.number(),
	tool: z.string(),
	op: z.string(),
	path: z.string(),
	codex_add: z.coerce.number(),
	input_text: z.string(),
	input_cut: z.coerce.number(),
	input_chars: z.coerce.number(),
	result_text: z.string(),
	result_cut: z.coerce.number(),
	loaded_text: z.string(),
	loaded_cut: z.coerce.number(),
	loaded_chars: z.coerce.number(),
	failed: z.coerce.number(),
	created: z.coerce.number(),
	end_ms: z.coerce.number(),
	has_result: z.coerce.boolean(),
});
