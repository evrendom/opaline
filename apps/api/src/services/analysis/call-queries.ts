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
import { commandColumnsSql } from "./command-identity.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	pinnedFilter,
	pinnedParams,
	REF_RUNS_SQL,
	records,
	refParams,
} from "./sql.js";

/*
 * `find source=calls`: one row per call that carries a command (a shell
 * command, a Codex code-mode script, a written script file), with its command
 * identity computed from the stored text and whether its result failed.
 */

export type CallGroupBy = Extract<
	AnalysisFindInput["groupBy"],
	"commandFingerprint" | "commandArgv0" | "commandPrefix"
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
};

interface CallQuery {
	scope: TranscriptReadScope;
	generations: readonly SessionGeneration[];
	input: AnalysisFindInput;
	/** Only the calls of these runs. */
	refs?: readonly RunRef[];
}

/**
 * Calls of the pinned generations with their command columns, and each call's
 * results reduced to one row. Copies of a record are identical, so filtering
 * before `FINAL` deduplicates exactly; results are reduced by `max`, so they
 * need no `FINAL`.
 */
function callsSql({ input, refs }: CallQuery): string {
	const filters = [
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
	return `calls AS (
			SELECT session_id, agent_id, record_idx, block_idx, turn_idx, toUnixTimestamp64Milli(ts) AS at_ms,
				tool_name, file_path, call_id, head, ${commandColumnsSql()}
			FROM ${records()} FINAL
			PREWHERE turn_idx >= 1 AND (kind = 'tool_call' OR (kind = 'file_change' AND file_op = 'write'))
			WHERE ${pinnedFilter()} AND command_from != ''
				${refs ? `AND (session_id, agent_id, turn_idx) IN (SELECT r.1, r.2, r.3 FROM (${REF_RUNS_SQL}))` : ""}
				${filters.map((filter) => `AND ${filter}`).join(" ")}
		), results AS (
			SELECT session_id, agent_id, call_id,
				max(is_error OR (exit_code IS NOT NULL AND exit_code != 0)) AS result_failed,
				anyIf(exit_code, exit_code IS NOT NULL) AS result_exit_code
			FROM ${records()}
			WHERE ${pinnedFilter()} AND kind = 'tool_result' AND call_id != ''
			GROUP BY session_id, agent_id, call_id
		)`;
}

function params(query: CallQuery) {
	const { input } = query;
	return {
		...pinnedParams(query.scope, query.generations),
		...refParams(query.refs),
		commandFrom: input.commandFrom ?? "",
		commandArgv0: input.commandArgv0 ?? "",
		commandPrefix: input.commandPrefix ?? "",
		commandFingerprint: input.commandFingerprint ?? "0",
		commandSimhash: input.commandSimhash ?? "0",
		commandChars: CALL_COMMAND_CHARS,
	};
}

/** The calls of one batch after `after`, newest first, at most `limit`. */
export function buildCallRowsStatement(
	query: CallQuery,
	after: CallCursor | undefined,
	limit: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${callsSql(query)}
			SELECT c.session_id AS session_id, c.agent_id AS agent_id, c.record_idx AS record_idx, c.block_idx AS block_idx,
				c.turn_idx AS turn_idx, c.at_ms AS at_ms, c.tool_name AS tool_name, c.file_path AS file_path,
				c.command_from AS command_from, substringUTF8(ifNull(c.command_text, c.head), 1, {commandChars:UInt32}) AS command,
				lengthUTF8(c.command_text) AS command_chars, c.command_argv0 AS command_argv0, c.command_prefix AS command_prefix,
				toString(c.command_fingerprint) AS command_fingerprint, toString(c.command_simhash) AS command_simhash,
				r.call_id != '' AS has_result, r.result_failed AS failed, r.result_exit_code AS exit_code
			FROM calls c LEFT ANY JOIN results r ON c.session_id = r.session_id AND c.agent_id = r.agent_id AND c.call_id = r.call_id
			${
				after
					? `WHERE c.at_ms < {afterAt:Int64} OR (c.at_ms = {afterAt:Int64}
				AND (c.session_id, c.agent_id, c.record_idx, c.block_idx) > ({afterSession:String}, {afterAgent:String}, {afterRecord:UInt32}, {afterBlock:UInt16}))`
					: ""
			}
			ORDER BY at_ms DESC, session_id, agent_id, record_idx, block_idx
			LIMIT {limit:UInt32}`,
		query_params: {
			...params(query),
			limit,
			afterAt: after?.[0] ?? 0,
			afterSession: after?.[1] ?? "",
			afterAgent: after?.[2] ?? "",
			afterRecord: after?.[3] ?? 0,
			afterBlock: after?.[4] ?? 0,
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
				min(text_first_ms) AS first_ms, max(text_last_ms) AS last_ms,
				arraySlice(arrayReverseSort(e -> e, groupArray((text_last_ms, example))), 1, 3) AS examples
			FROM (
				SELECT ${GROUP_COLUMNS[groupBy]} AS key, cityHash64(c.command_text) AS text_hash, count() AS n,
					uniqExactState(c.session_id) AS s, countIf(r.result_failed) AS f, min(c.at_ms) AS text_first_ms, max(c.at_ms) AS text_last_ms,
					argMax((c.session_id, c.agent_id, c.turn_idx, c.record_idx, c.block_idx), (c.at_ms, c.session_id, c.agent_id, c.record_idx, c.block_idx)) AS example
				FROM calls c LEFT ANY JOIN results r ON c.session_id = r.session_id AND c.agent_id = r.agent_id AND c.call_id = r.call_id
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
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, agent_id, record_idx, block_idx, command_from,
				substringUTF8(ifNull(command_text, head), 1, {commandChars:UInt32}) AS command,
				substringUTF8(command_normalized, 1, {commandChars:UInt32}) AS normalized
			FROM (
				SELECT session_id, agent_id, record_idx, block_idx, head, ${commandColumnsSql()}
				FROM ${records()}
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
