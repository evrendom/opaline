import type { RunRef } from "@rudel/api-routes";
import { z } from "zod";
import type { ClickHouseStatement } from "../../clickhouse.js";
import {
	pinnedParams,
	pinnedRecords,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	GENUINE_PROMPT_SQL,
	REF_RUNS_SQL,
	records,
	refParams,
	toolErrorSql,
} from "./sql.js";
import { TOOL_GROUPS, toolGroupSql } from "./tool-groups.js";

/*
 * Copies of one record identity are identical (a generation is deterministic),
 * so filtering before `FINAL` deduplicates them is exact. ClickHouse does not
 * move filters to PREWHERE under `FINAL` by itself, so the scans that must
 * count each record once name their PREWHERE and skip the wide text columns
 * of every other record; lookups that keep one row per key skip `FINAL`.
 */

/** Keyset position: the last (session, agent, record, block) already scanned. */
export type ScanCursor = readonly [string, string, number, number];

export interface ScanPage {
	refs?: readonly RunRef[];
	after?: ScanCursor;
	limit: number;
}

/** Text longer than this is scanned only up to here and the row is marked partial. */
/** As much of a record's text as a scan reads; the run index scans prompts as far. */
export const SCAN_TEXT_CHARS = 16_384;

export const FailureRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	record_idx: z.number(),
	block_idx: z.number(),
	turn_idx: z.number(),
	started_ms: z.coerce.number(),
	tool_name: z.string(),
	tool_group: z.enum(TOOL_GROUPS),
	command_class: z.string(),
	exit_code: z.number().nullable(),
	head: z.string(),
	tail: z.string(),
	command: z.string(),
	partial: z.union([z.boolean(), z.number()]).transform(Boolean),
});
export type FailureRow = z.infer<typeof FailureRowSchema>;

export const TextRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	record_idx: z.number(),
	block_idx: z.number(),
	turn_idx: z.number(),
	started_ms: z.coerce.number(),
	kind: z.string(),
	subtype: z.string(),
	text: z.string(),
	partial: z.union([z.boolean(), z.number()]).transform(Boolean),
});
export type TextRow = z.infer<typeof TextRowSchema>;

/** One page of failed tool results with their call's tool, command and tool group. */
export function buildFailureScanStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	page: ScanPage,
): ClickHouseStatement {
	return pageStatement(
		scope,
		generations,
		page,
		`WITH failures AS (
			SELECT session_id, agent_id, record_idx, block_idx, turn_idx, ts, tool_name, command_class, exit_code, call_id, head, tail
			FROM ${records()} FINAL
			PREWHERE turn_idx >= 1 AND ${toolErrorSql()}
			WHERE ${pinnedRecords()} ${refsFilter(page)} ${cursorFilter(page)}
			ORDER BY session_id, agent_id, record_idx, block_idx LIMIT {limit:UInt32}
		), calls AS (
			SELECT session_id, agent_id, call_id, tool_name, command_class,
				substringUTF8(if(empty(text), head, text), 1, {textChars:UInt32}) AS command,
				lengthUTF8(text) < text_chars OR lengthUTF8(text) > {textChars:UInt32} AS command_partial
			FROM ${records()}
			WHERE ${pinnedRecords()} AND kind = 'tool_call'
				AND (session_id, agent_id, call_id) IN (SELECT session_id, agent_id, call_id FROM failures WHERE call_id != '')
		)
		SELECT f.session_id AS session_id, f.agent_id AS agent_id, f.record_idx AS record_idx, f.block_idx AS block_idx,
			f.turn_idx AS turn_idx, toUnixTimestamp64Milli(f.ts) AS started_ms,
			coalesce(nullIf(c.tool_name, ''), f.tool_name) AS tool_name,
			${toolGroupSql("coalesce(nullIf(c.tool_name, ''), f.tool_name)", "c.command")} AS tool_group,
			coalesce(nullIf(c.command_class, ''), f.command_class) AS command_class,
			f.exit_code AS exit_code, f.head AS head, f.tail AS tail, c.command AS command, c.command_partial AS partial
		FROM failures f LEFT ANY JOIN calls c ON f.session_id = c.session_id AND f.agent_id = c.agent_id AND f.call_id = c.call_id
		ORDER BY session_id, agent_id, record_idx, block_idx`,
	);
}

/** One page of genuine prompts and assistant messages, with their text for the lexicon scan. */
export function buildTextScanStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	page: ScanPage,
): ClickHouseStatement {
	return pageStatement(
		scope,
		generations,
		page,
		`SELECT session_id, agent_id, record_idx, block_idx, turn_idx, toUnixTimestamp64Milli(ts) AS started_ms, kind, subtype,
			${scanTextSql()} AS text, ${partialSql()} AS partial
		FROM ${records()} FINAL
		PREWHERE turn_idx >= 1 AND ((${GENUINE_PROMPT_SQL}) OR kind = 'assistant_text')
		WHERE ${pinnedRecords()} ${refsFilter(page)} ${cursorFilter(page)}
		ORDER BY session_id, agent_id, record_idx, block_idx LIMIT {limit:UInt32}`,
	);
}

/** The genuine prompt that opens each given run (used for the reaction to the run before it). */
export function buildOpeningPromptsStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	refs: readonly RunRef[],
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, agent_id, record_idx, block_idx, turn_idx, toUnixTimestamp64Milli(ts) AS started_ms, kind, subtype,
				${scanTextSql()} AS text, ${partialSql()} AS partial
			FROM ${records()}
			WHERE ${pinnedRecords()} AND ${GENUINE_PROMPT_SQL}
				AND (session_id, agent_id, turn_idx) IN (SELECT r.1, r.2, r.3 FROM (${REF_RUNS_SQL}))
			ORDER BY session_id, agent_id, record_idx, block_idx
			LIMIT 1 BY session_id, agent_id, turn_idx`,
		query_params: {
			...pinnedParams(scope, generations),
			...refParams(refs),
			textChars: SCAN_TEXT_CHARS,
		},
	};
}

function pageStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
	page: ScanPage,
	query: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: {
			...ANALYSIS_QUERY_SETTINGS,
			max_result_rows: String(page.limit),
			max_block_size: String(page.limit),
		},
		query,
		query_params: {
			...pinnedParams(scope, generations),
			...refParams(page.refs),
			limit: page.limit,
			textChars: SCAN_TEXT_CHARS,
			afterSession: page.after?.[0] ?? "",
			afterAgent: page.after?.[1] ?? "",
			afterRecord: page.after?.[2] ?? 0,
			afterBlock: page.after?.[3] ?? 0,
		},
	};
}

function scanTextSql(): string {
	return "substringUTF8(if(empty(text), concat(head, '\\n', tail), text), 1, {textChars:UInt32})";
}

/** Stored text was capped at extraction, or is longer than the scan reads. */
function partialSql(): string {
	return "lengthUTF8(text) < text_chars OR lengthUTF8(text) > {textChars:UInt32}";
}

function refsFilter(page: ScanPage): string {
	return page.refs
		? `AND (session_id, agent_id, turn_idx) IN (SELECT r.1, r.2, r.3 FROM (${REF_RUNS_SQL}))`
		: "";
}

function cursorFilter(page: ScanPage): string {
	return page.after
		? "AND (session_id, agent_id, record_idx, block_idx) > ({afterSession:String}, {afterAgent:String}, {afterRecord:UInt32}, {afterBlock:UInt16})"
		: "";
}
