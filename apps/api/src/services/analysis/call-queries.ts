import {
	type AnalysisFindInput,
	CALL_COMMAND_CHARS,
	COMMAND_FROM,
	COMMAND_SIMHASH_NEAR_BITS,
	type RunRef,
} from "@rudel/api-routes";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";
import { commandsTable } from "./call-commands.js";
import { commandColumnsSql } from "./command-identity.js";
import type { CompiledFilters } from "./find-filters.js";
import { runToolErrorSql } from "./run-index-sql.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	pinnedFilter,
	pinnedParams,
	REF_RUNS_SQL,
	records,
	refParams,
} from "./sql.js";
import {
	CALL_COMPLETION_SQL,
	CALL_HAND_OFF_SQL,
	CALL_TASK_END_SQL,
	CALL_TASK_NOTIFICATION_SQL,
} from "./sql-measures.js";

/*
 * `find source=calls`: one row per call that carries a command (a shell
 * command, a Codex code-mode script, a written script file), with its command
 * identity computed from the stored text and whether its result failed.
 */

export type CallGroupBy = Extract<
	AnalysisFindInput["groupBy"],
	"commandFingerprint" | "commandArgv0" | "commandPrefix" | "session"
>;

/** A call's position: newest first, then session, stream, record and block. */
export type CallCursor = readonly [number, string, string, number, number];

export const CallRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	record_idx: z.number(),
	block_idx: z.number(),
	turn_idx: z.number(),
	at_ms: z.coerce.number(),
	tool_name: z.string(),
	file_path: z.string(),
	command_from: z.enum(COMMAND_FROM),
	command: z.string(),
	command_chars: z.number().nullable(),
	command_argv0: z.string().nullable(),
	command_prefix: z.string().nullable(),
	command_fingerprint: z.string().nullable(),
	command_simhash: z.string().nullable(),
	has_result: z.union([z.boolean(), z.number()]).transform(Boolean),
	failed: z.union([z.boolean(), z.number()]).transform(Boolean),
	exit_code: z.number().nullable(),
	call_minutes: z.number().nullable(),
	random_key: z.string(),
	matched_calls: z.coerce.number(),
	matched_minutes: z.number().nullable(),
});
export type CallRow = z.infer<typeof CallRowSchema>;

/** A call that stands for its group, by position. */
const ExampleSchema = z.tuple([
	z.string(),
	z.string(),
	z.number(),
	z.number(),
	z.number(),
]);

export const CallGroupRowSchema = z.object({
	/** Null for the calls the key does not apply to. */
	key: z.string().nullable(),
	calls: z.coerce.number(),
	sessions: z.coerce.number(),
	failed_calls: z.coerce.number(),
	first_ms: z.coerce.number(),
	last_ms: z.coerce.number(),
	call_minutes: z.number(),
	runs: z.array(z.tuple([z.coerce.number(), z.string(), z.coerce.number()])),
	/** [last seen, [session, agent, turn, record, block]] of up to three different texts. */
	examples: z.array(z.tuple([z.coerce.number(), ExampleSchema])),
});
export type CallGroupRow = z.infer<typeof CallGroupRowSchema>;

export const CallExampleRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	record_idx: z.number(),
	block_idx: z.number(),
	command_from: z.enum(COMMAND_FROM),
	command: z.string(),
	normalized: z.string().nullable(),
});
export type CallExampleRow = z.infer<typeof CallExampleRowSchema>;

const GROUP_COLUMNS: Record<CallGroupBy, string> = {
	commandFingerprint: "toString(command_fingerprint)",
	commandArgv0: "command_argv0",
	commandPrefix: "command_prefix",
	session: "session_id",
};

interface CallQuery {
	scope: TranscriptReadScope;
	generations: readonly SessionGeneration[];
	input: AnalysisFindInput;
	/** Only the calls of these runs. */
	refs?: readonly RunRef[];
	filters?: CompiledFilters;
	stored?: boolean;
}

/**
 * Calls of the pinned generations with their command columns, and each call's
 * results reduced to one row. Copies of a record are identical, so filtering
 * before `FINAL` deduplicates exactly; results are reduced by `max`, so they
 * need no `FINAL`.
 */
function commandRecordsSql(stored: boolean | undefined): string {
	return stored
		? `SELECT user_id, source, session_date, session_id, agent_id, record_idx, block_idx, turn_idx, ts,
				toUnixTimestamp64Milli(ts) AS at_ms, tool_name, file_path, call_id, head, command_from, command_text,
				command_argv0, command_prefix, command_normalized, command_fingerprint, command_simhash
			FROM ${commandsTable()} FINAL
			PREWHERE turn_idx >= 1`
		: `SELECT user_id, source, session_date, session_id, agent_id, record_idx, block_idx, turn_idx, ts,
				toUnixTimestamp64Milli(ts) AS at_ms, tool_name, file_path, call_id, head, ${commandColumnsSql()}
			FROM ${records()} FINAL
			PREWHERE turn_idx >= 1 AND (kind = 'tool_call' OR (kind = 'file_change' AND file_op = 'write'))`;
}

function callsSql({ input, refs, filters, stored }: CallQuery): string {
	const conditions = [
		input.commandFrom ? "command_from = {commandFrom:String}" : "",
		input.commandArgv0 ? "command_argv0 = {commandArgv0:String}" : "",
		input.commandPrefix ? "command_prefix = {commandPrefix:String}" : "",
		input.commandFingerprint
			? "command_fingerprint = {commandFingerprint:UInt64}"
			: "",
		input.commandSimhash
			? `bitCount(bitXor(command_simhash, {commandSimhash:UInt64})) <= ${COMMAND_SIMHASH_NEAR_BITS}`
			: "",
	].filter(Boolean);
	const result = "kind = 'tool_result'";
	const ended = CALL_TASK_END_SQL;
	return `calls AS (
			${commandRecordsSql(stored)}
			WHERE ${pinnedFilter()} AND command_from != ''
				${refs ? `AND (session_id, agent_id, turn_idx) IN (SELECT r.1, r.2, r.3 FROM (${REF_RUNS_SQL}))` : ""}
				${conditions.map((condition) => `AND ${condition}`).join(" ")}
		), results AS (
			SELECT session_id, agent_id, call_id,
				countIf(${result}) AS results,
				maxIf(ts, ${result} OR ${ended}) AS result_at,
				max(${runToolErrorSql()} OR (${ended} AND (is_error OR ifNull(exit_code, 0) != 0))) AS result_failed,
				anyIf(exit_code, (${result} OR ${ended} OR (${CALL_COMPLETION_SQL})) AND exit_code IS NOT NULL) AS result_exit_code,
				anyIf(denial_kind, ${result} AND denial_kind != '') AS result_denial_kind,
				anyIf(file_path, (${CALL_HAND_OFF_SQL} OR ${CALL_TASK_NOTIFICATION_SQL}) AND file_path != '') AS task_file,
				countIf(${ended}) > 0 AS task_ended
			FROM ${records()}
			WHERE ${pinnedFilter()} AND call_id != ''
				AND (${result} OR (${CALL_TASK_NOTIFICATION_SQL} AND subtype = 'task_notification') OR (${CALL_COMPLETION_SQL}))
			GROUP BY session_id, agent_id, call_id
		), matched AS (
			SELECT c.user_id AS user_id, c.source AS source, c.session_date AS session_date,
				c.session_id AS session_id, c.agent_id AS agent_id, c.record_idx AS record_idx, c.block_idx AS block_idx,
				c.turn_idx AS turn_idx, c.at_ms AS at_ms, c.ts AS started_at, c.call_id AS call_id,
				c.tool_name AS tool_name, c.file_path AS file_path, c.command_from AS command_from,
				ifNull(c.command_text, c.head) AS command, c.command_text AS command_text,
				lengthUTF8(c.command_text) AS command_chars, c.command_argv0 AS command_argv0,
				c.command_prefix AS command_prefix, c.command_fingerprint AS command_fingerprint,
				c.command_simhash AS command_simhash,
				toUInt8(r.results > 0) AS has_result, toUInt8(ifNull(r.result_failed, 0)) AS failed,
				r.result_exit_code AS exit_code, r.result_denial_kind AS denial_kind,
				toUInt8(r.task_file != '') AS backgrounded,
				if(r.results = 0 OR (r.task_file != '' AND NOT r.task_ended), NULL, r.result_at) AS finished_at,
				if(finished_at IS NULL, NULL, greatest(0, dateDiff('millisecond', c.ts, finished_at)) / 60000) AS call_minutes
			FROM calls c LEFT ANY JOIN results r ON c.session_id = r.session_id AND c.agent_id = r.agent_id AND c.call_id = r.call_id
			${filters ? `WHERE ${filters.sql}` : ""}
		)`;
}

function params(query: CallQuery) {
	const { input } = query;
	return {
		...pinnedParams(query.scope, query.generations),
		...refParams(query.refs),
		...query.filters?.params,
		commandFrom: input.commandFrom ?? "",
		commandArgv0: input.commandArgv0 ?? "",
		commandPrefix: input.commandPrefix ?? "",
		commandFingerprint: input.commandFingerprint ?? "0",
		commandSimhash: input.commandSimhash ?? "0",
		commandChars: CALL_COMMAND_CHARS,
	};
}

export type CallPosition =
	| { order: "time"; after?: CallCursor }
	| { order: "random"; seed: string; after?: RandomCallCursor };

export type RandomCallCursor = readonly [
	string,
	string,
	string,
	number,
	number,
];

export function buildCallRowsStatement(
	query: CallQuery,
	position: CallPosition,
	limit: number,
): ClickHouseStatement {
	const random = position.order === "random";
	const after = position.after;
	const keyset = random
		? `(random_hash, session_id, agent_id, record_idx, block_idx) > ({afterRandom:UInt64}, {afterSession:String}, {afterAgent:String}, {afterRecord:UInt32}, {afterBlock:UInt16})`
		: `at_ms < {afterAt:Int64} OR (at_ms = {afterAt:Int64}
				AND (session_id, agent_id, record_idx, block_idx) > ({afterSession:String}, {afterAgent:String}, {afterRecord:UInt32}, {afterBlock:UInt16}))`;
	const cursor = after?.slice(1) ?? [];
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${callsSql(query)}
			SELECT *, toString(random_hash) AS random_key FROM (
				SELECT session_id, agent_id, record_idx, block_idx, turn_idx, at_ms, tool_name, file_path, command_from,
					substringUTF8(command, 1, {commandChars:UInt32}) AS command, command_chars, command_argv0, command_prefix,
					toString(command_fingerprint) AS command_fingerprint, toString(command_simhash) AS command_simhash,
					has_result, failed, exit_code, call_minutes,
					cityHash64({randomSeed:String}, session_id, agent_id, record_idx, block_idx) AS random_hash,
					count() OVER () AS matched_calls, sum(call_minutes) OVER () AS matched_minutes
				FROM matched
			)
			${after ? `WHERE ${keyset}` : ""}
			ORDER BY ${random ? "random_hash" : "at_ms DESC"}, session_id, agent_id, record_idx, block_idx
			LIMIT {limit:UInt32}`,
		query_params: {
			...params(query),
			limit,
			randomSeed: random ? position.seed : "",
			afterRandom: random && after ? after[0] : "0",
			afterAt: !random && after ? after[0] : 0,
			afterSession: cursor[0] ?? "",
			afterAgent: cursor[1] ?? "",
			afterRecord: cursor[2] ?? 0,
			afterBlock: cursor[3] ?? 0,
		},
	};
}

/**
 * The calls of one batch grouped by `groupBy`, with the calls the key does
 * not apply to under a null key. Each group keeps the newest call of each of
 * its three most recent command texts as examples. Batches hold disjoint
 * sessions, so their counts add up.
 */
export function buildCallGroupsStatement(
	query: CallQuery,
	groupBy: CallGroupBy,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${callsSql(query)}
			SELECT key, sum(n) AS calls, uniqExactMerge(s) AS sessions, sum(f) AS failed_calls,
				min(text_first_ms) AS first_ms, max(text_last_ms) AS last_ms, sum(t) AS call_minutes,
				arrayDistinct(arrayFlatten(groupArray(text_runs))) AS runs,
				arraySlice(arrayReverseSort(e -> e, groupArray((text_last_ms, example))), 1, 3) AS examples
			FROM (
				SELECT ${GROUP_COLUMNS[groupBy]} AS key, cityHash64(command_text) AS text_hash, count() AS n,
					uniqExactState(session_id) AS s, countIf(failed = 1) AS f, min(at_ms) AS text_first_ms, max(at_ms) AS text_last_ms,
					ifNull(sum(call_minutes), 0) AS t,
					groupUniqArray((toUInt32(indexOf({sessionIds:Array(String)}, session_id)), agent_id, turn_idx)) AS text_runs,
					argMax((session_id, agent_id, turn_idx, record_idx, block_idx), (at_ms, session_id, agent_id, record_idx, block_idx)) AS example
				FROM matched
				GROUP BY key, text_hash
			)
			GROUP BY key`,
		query_params: params(query),
	};
}

/** The command text (and normalized text) of the given calls of one batch. */
export function buildCallExamplesStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	calls: readonly (readonly [string, string, number, number])[],
	stored = false,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, agent_id, record_idx, block_idx, command_from,
				substringUTF8(ifNull(command_text, head), 1, {commandChars:UInt32}) AS command,
				substringUTF8(command_normalized, 1, {commandChars:UInt32}) AS normalized
			FROM (
				SELECT session_id, agent_id, record_idx, block_idx, head, ${stored ? "command_from, command_text, command_normalized" : commandColumnsSql()}
				FROM ${stored ? commandsTable() : records()}
				WHERE ${pinnedFilter()}
					AND (session_id, agent_id, record_idx, block_idx) IN (
						SELECT e.1, e.2, e.3, e.4 FROM (SELECT arrayJoin(arrayZip({exampleSessions:Array(String)}, {exampleAgents:Array(String)}, {exampleRecords:Array(UInt32)}, {exampleBlocks:Array(UInt16)})) AS e)
					)
				LIMIT 1 BY session_id, agent_id, record_idx, block_idx
			)`,
		query_params: {
			...pinnedParams(scope, generations),
			commandChars: CALL_COMMAND_CHARS,
			exampleSessions: calls.map((call) => call[0]),
			exampleAgents: calls.map((call) => call[1]),
			exampleRecords: calls.map((call) => call[2]),
			exampleBlocks: calls.map((call) => call[3]),
		},
	};
}
