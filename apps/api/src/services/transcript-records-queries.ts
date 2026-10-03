import {
	FILE_MUTATION_OPERATIONS,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../clickhouse.js";

/**
 * SQL for the transcript record readers. Every statement:
 *
 * - is scoped by `organization_id` and `user_id` from bound parameters,
 * - reads only the generation its caller pinned (see `SessionGeneration`),
 *   resolved once per operation from the session's newest receipt,
 * - binds every caller value as a typed query parameter, and
 * - reads `text` only where a function below says so explicitly. Facts and map
 *   queries never reference it.
 */

/** Names of the subagent launch tools, matched case-insensitively. */
const SUBAGENT_LAUNCH_TOOLS = "('task', 'agent', 'spawn_agent')";
const MUTATION_OPERATIONS = `(${FILE_MUTATION_OPERATIONS.map((operation) => `'${operation}'`).join(", ")})`;

const QUERY_SETTINGS = {
	max_bytes_to_read: String(4 * 1024 * 1024 * 1024),
	max_execution_time: 30,
	max_rows_to_read: "50000000",
	max_result_rows: "100000",
	max_result_bytes: "16777216",
	result_overflow_mode: "throw",
} as const;

export interface TranscriptReadScope {
	readonly organizationId: string;
	readonly userId: string;
}

const table = () => getSafeClickHouseTable("rudel.transcript_records");

/**
 * The committed extraction generation of one session, resolved once per read
 * operation and bound into every later query of it, so one response can never
 * mix rows of two generations.
 */
export interface SessionGeneration {
	readonly parserVersion: number;
	readonly revision: string;
	readonly sessionId: string;
}

function baseParams(scope: TranscriptReadScope) {
	return {
		organizationId: scope.organizationId,
		receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		userId: scope.userId,
	};
}

function generationParams(generations: readonly SessionGeneration[]) {
	return {
		parserVersions: generations.map((generation) => generation.parserVersion),
		revisions: generations.map((generation) => generation.revision),
		sessionIds: generations.map((generation) => generation.sessionId),
	};
}

/** CTE holding the pinned generations as rows of (session, revision, parser). */
function pinnedGenerationsCte(): string {
	return `
		pinned AS (
			SELECT g.1 AS session_id, g.2 AS revision, g.3 AS parser_version
			FROM (
				SELECT arrayJoin(arrayZip(
					{sessionIds:Array(String)},
					arrayMap(value -> toUInt64(value), {revisions:Array(String)}),
					{parserVersions:Array(UInt16)}
				)) AS g
			)
		)`;
}

/** Row filter for records of the pinned generations, excluding receipts. */
function recordsFilter(alias = ""): string {
	const column = (name: string) => (alias ? `${alias}.${name}` : name);
	return `${column("organization_id")} = {organizationId:String}
				AND ${column("user_id")} = {userId:String}
				AND ${column("session_id")} IN {sessionIds:Array(String)}
				AND (${column("session_id")}, ${column("revision")}, ${column("parser_version")}) IN (SELECT session_id, revision, parser_version FROM pinned)
				AND ${column("record_idx")} < {receiptRecordIdx:UInt32}`;
}

/** Mutation rows whose tool call did not fail. */
function unfailedFileChangeFilter(): string {
	return `kind = 'file_change'
				AND file_op IN ${MUTATION_OPERATIONS}
				AND (session_id, agent_id, call_id) NOT IN (
					SELECT session_id, agent_id, call_id
					FROM ${table()} FINAL
					WHERE ${recordsFilter()}
						AND kind = 'tool_result'
						AND (is_error OR (exit_code IS NOT NULL AND exit_code != 0))
						AND call_id != ''
				)`;
}

/** Newest committed generation of each session: its newest receipt. */
export function buildCommittedGenerationsStatement(
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			SELECT
				session_id,
				toString(revision) AS revision_text,
				parser_version,
				source,
				head AS receipt
			FROM ${table()}
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id IN {sessionIds:Array(String)}
				AND agent_id = ''
				AND record_idx = {receiptRecordIdx:UInt32}
				AND block_idx = 0
			ORDER BY session_id, revision DESC, parser_version DESC
			LIMIT 1 BY session_id
		`,
		query_params: { ...baseParams(scope), sessionIds: [...sessionIds] },
	};
}

export function buildSessionTotalsStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				session_id,
				count() AS records,
				uniqExactIf(turn_idx, kind = 'user_prompt' AND agent_id = '') AS turns,
				toUnixTimestamp64Milli(min(ts)) AS started_ms,
				toUnixTimestamp64Milli(max(ts)) AS ended_ms,
				countIf(kind = 'tool_call') AS tool_calls,
				countIf(kind = 'tool_result' AND is_error) AS tool_errors,
				countIf(kind = 'tool_call' AND lower(tool_name) IN ${SUBAGENT_LAUNCH_TOOLS}) AS subagent_spawns,
				groupUniqArrayIf(agent_id, agent_id != '') AS stream_agent_ids,
				groupUniqArrayIf(spawned_agent_id, spawned_agent_id != '') AS spawned_agent_ids
			FROM ${table()} FINAL
			WHERE ${recordsFilter()}
			GROUP BY session_id
		`,
		query_params: { ...baseParams(scope), ...generationParams(generations) },
	};
}

export function buildSessionCommandsStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				session_id,
				command_class,
				countIf(kind = 'tool_call') AS calls,
				countIf(kind = 'tool_result' AND is_error) AS failed
			FROM ${table()} FINAL
			WHERE ${recordsFilter()}
				AND command_class != ''
				AND kind IN ('tool_call', 'tool_result')
			GROUP BY session_id, command_class
		`,
		query_params: { ...baseParams(scope), ...generationParams(generations) },
	};
}

export function buildSessionFilesStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	maxFiles: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				session_id,
				uniqExact(file_path) AS file_count,
				arraySlice(arraySort(groupUniqArray(file_path)), 1, {maxFiles:UInt32}) AS files
			FROM ${table()} FINAL
			WHERE ${recordsFilter()}
				AND ${unfailedFileChangeFilter()}
			GROUP BY session_id
		`,
		query_params: {
			...baseParams(scope),
			...generationParams(generations),
			maxFiles,
		},
	};
}

/** Filters shared by the per-session, per-agent map and turn statements. */
function streamFilter(alias = ""): string {
	return `${recordsFilter(alias)}
				AND ${alias ? `${alias}.` : ""}agent_id = {agentId:String}`;
}

function streamParams(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
) {
	return { ...baseParams(scope), ...generationParams([generation]), agentId };
}

export function buildMapTurnsStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				records.turn_idx,
				toUnixTimestamp64Milli(min(records.ts)) AS started_ms,
				toUnixTimestamp64Milli(max(records.ts)) AS ended_ms,
				min(records.record_idx) AS first_record_idx,
				max(records.record_idx) AS last_record_idx,
				min(records.byte_start) AS first_byte_start,
				max(records.byte_start + records.byte_len) AS byte_end,
				countIf(records.kind = 'tool_call') AS tool_calls,
				countIf(records.kind = 'tool_result' AND records.is_error) AS tool_errors,
				countIf(records.kind = 'tool_call' AND lower(records.tool_name) IN ${SUBAGENT_LAUNCH_TOOLS}) AS subagent_spawns,
				sumIf(records.text_chars, records.kind = 'user_prompt') AS prompt_chars
			FROM ${table()} AS records FINAL
			WHERE ${streamFilter("records")}
				AND records.kind != 'meta'
			GROUP BY records.turn_idx
			ORDER BY records.turn_idx
		`,
		query_params: streamParams(scope, generation, agentId),
	};
}

/** Reads only the `head` of each turn's first prompt record. */
export function buildMapPromptsStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT turn_idx, argMin(head, record_idx) AS prompt_head
			FROM ${table()} FINAL
			WHERE ${streamFilter()}
				AND kind = 'user_prompt'
			GROUP BY turn_idx
		`,
		query_params: streamParams(scope, generation, agentId),
	};
}

export function buildMapFilesStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	maxFilesPerTurn: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				turn_idx,
				uniqExact(file_path) AS file_count,
				arraySlice(arraySort(groupUniqArray(file_path)), 1, {maxFiles:UInt32}) AS files
			FROM ${table()} FINAL
			WHERE ${streamFilter()}
				AND ${unfailedFileChangeFilter()}
			GROUP BY turn_idx
		`,
		query_params: {
			...streamParams(scope, generation, agentId),
			maxFiles: maxFilesPerTurn,
		},
	};
}

export function buildMapCommandsStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				turn_idx,
				command_class,
				countIf(kind = 'tool_call') AS calls,
				countIf(kind = 'tool_result' AND is_error) AS failed
			FROM ${table()} FINAL
			WHERE ${streamFilter()}
				AND command_class != ''
				AND kind IN ('tool_call', 'tool_result')
			GROUP BY turn_idx, command_class
		`,
		query_params: streamParams(scope, generation, agentId),
	};
}

function turnFilter(): string {
	return `${streamFilter()}
				AND turn_idx = {turnIdx:UInt32}`;
}

function turnParams(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
) {
	return { ...streamParams(scope, generation, agentId), turnIdx };
}

/** Prompt text for one turn, capped in SQL so a huge prompt is never shipped. */
export function buildTurnPromptStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	promptChars: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				record_idx,
				text_chars,
				substringUTF8(if(empty(text), concat(head, '\\n', tail), text), 1, {promptChars:UInt32}) AS text_slice
			FROM ${table()} FINAL
			WHERE ${turnFilter()}
				AND kind = 'user_prompt'
			ORDER BY record_idx
			LIMIT 5
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			promptChars,
		},
	};
}

export function buildTurnActionsStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	limit: number,
	targetChars: number,
	checksAfter: number | undefined = undefined,
): ClickHouseStatement {
	return {
		clickhouse_settings: { ...QUERY_SETTINGS, join_use_nulls: 1 },
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				c.record_idx,
				c.block_idx,
				c.tool_name,
				c.command_class,
				c.file_path,
				c.file_op,
				c.call_id,
				toUnixTimestamp64Milli(c.ts) AS ts_ms,
				substringUTF8(c.head, 1, {targetChars:UInt32}) AS target,
				r.any_result_is_error AS result_is_error,
				r.last_result_exit_code AS result_exit_code,
				r.call_id IS NOT NULL AS has_result
			FROM (
				SELECT record_idx, block_idx, ts, tool_name, command_class, file_path, file_op, call_id, head
				FROM ${table()} FINAL
				WHERE ${turnFilter()}
					AND kind = 'tool_call'
					${checksAfter === undefined ? "" : "AND record_idx > {checksAfter:UInt32} AND (command_class IN ('test','build','typecheck','lint') OR match(lower(tool_name), 'playwright|chrome|browser'))"}
			) AS c
			LEFT JOIN (
				SELECT
					results.call_id,
					max(toUInt8(results.is_error OR (results.exit_code IS NOT NULL AND results.exit_code != 0))) AS any_result_is_error,
					argMax(results.exit_code, results.record_idx) AS last_result_exit_code
				FROM ${table()} AS results FINAL
				WHERE ${streamFilter("results")}
					AND results.kind = 'tool_result'
					AND results.call_id != ''
					AND results.call_id IN (
						SELECT call_id
						FROM ${table()} FINAL
						WHERE ${turnFilter()}
							AND kind = 'tool_call'
					)
				GROUP BY results.call_id
			) AS r ON c.call_id = r.call_id
			ORDER BY c.record_idx, c.block_idx
			LIMIT {limit:UInt32}
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			limit,
			targetChars,
			checksAfter: checksAfter ?? 0,
		},
	};
}

export function buildTurnFileChangesStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	limit: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT record_idx, block_idx, file_op, file_path, subtype, call_id, tool_name
			FROM ${table()} FINAL
			WHERE ${turnFilter()}
				AND ${unfailedFileChangeFilter()}
			ORDER BY record_idx, block_idx
			LIMIT {limit:UInt32}
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			limit,
		},
	};
}

/** Failed tool results and error events, read through their excerpts only. */
export function buildTurnFailuresStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	limit: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				record_idx,
				block_idx,
				kind,
				tool_name,
				command_class,
				exit_code,
				call_id,
				text_chars,
				if(tail != '', tail, head) AS excerpt
			FROM ${table()} FINAL
			WHERE ${turnFilter()}
				AND (is_error OR (exit_code IS NOT NULL AND exit_code != 0))
				AND kind IN ('tool_result', 'meta')
			ORDER BY record_idx, block_idx
			LIMIT {limit:UInt32}
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			limit,
		},
	};
}

/** File-mutation inputs. Reads `text`, capped per row in SQL. */
export function buildTurnDiffStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	limit: number,
	itemChars: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				record_idx,
				block_idx,
				file_op,
				file_path,
				subtype,
				call_id,
				tool_name,
				text_chars,
				substringUTF8(text, 1, {itemChars:UInt32}) AS input
			FROM ${table()} FINAL
			WHERE ${turnFilter()}
				AND ${unfailedFileChangeFilter()}
			ORDER BY record_idx, block_idx
			LIMIT {limit:UInt32}
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			itemChars,
			limit,
		},
	};
}

/** Commands behind file changes that carry no input of their own (shell edits). */
export function buildTurnParentCommandsStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	callIds: readonly string[],
	itemChars: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT call_id, text_chars, substringUTF8(text, 1, {itemChars:UInt32}) AS input
			FROM ${table()} FINAL
			WHERE ${turnFilter()}
				AND kind = 'tool_call'
				AND call_id IN {callIds:Array(String)}
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			callIds: [...callIds],
			itemChars,
		},
	};
}

/** Every substantive record of a turn, text capped per record in SQL. */
export function buildTurnRawStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	turnIdx: number,
	limit: number,
	recordChars: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				record_idx,
				block_idx,
				kind,
				subtype,
				tool_name,
				command_class,
				is_error,
				exit_code,
				file_path,
				call_id,
				byte_start,
				byte_len,
				text_chars,
				substringUTF8(if(empty(text), head, text), 1, {recordChars:UInt32}) AS text_slice
			FROM ${table()} FINAL
			WHERE ${turnFilter()}
				AND kind NOT IN ('meta')
			ORDER BY record_idx, block_idx
			LIMIT {limit:UInt32}
		`,
		query_params: {
			...turnParams(scope, generation, agentId, turnIdx),
			limit,
			recordChars,
		},
	};
}

/** Light description of every block of one line, without text. */
export function buildRecordBlocksStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	recordIdx: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				block_idx,
				kind,
				subtype,
				tool_name,
				turn_idx,
				is_error,
				exit_code,
				file_path,
				byte_start,
				byte_len,
				text_chars
			FROM ${table()} FINAL
			WHERE ${streamFilter()}
				AND record_idx = {recordIdx:UInt32}
			ORDER BY block_idx
		`,
		query_params: {
			...streamParams(scope, generation, agentId),
			recordIdx,
		},
	};
}

/** One block's text slice, in Unicode characters. */
export function buildRecordSliceStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	agentId: string,
	recordIdx: number,
	blockIdx: number,
	fromChar: number,
	charCount: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: QUERY_SETTINGS,
		query: `
			WITH ${pinnedGenerationsCte()}
			SELECT
				lengthUTF8(text) AS stored_chars,
				substringUTF8(text, {fromChar:UInt32} + 1, {charCount:UInt32}) AS slice
			FROM ${table()} FINAL
			WHERE ${streamFilter()}
				AND record_idx = {recordIdx:UInt32}
				AND block_idx = {blockIdx:UInt16}
			LIMIT 1
		`,
		query_params: {
			...streamParams(scope, generation, agentId),
			blockIdx,
			charCount,
			fromChar,
			recordIdx,
		},
	};
}
