import { ORPCError } from "@orpc/server";
import type { RunRef } from "@rudel/api-routes";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";

/**
 * Per-statement guardrails; result overflow throws so nothing looks complete
 * when it isn't. Remote-storage prefetch is off: on S3-backed tables its
 * read-ahead buffers grow with the ranges a statement reads and dominated the
 * memory of transcript-record scans, while the reads stay as fast without it.
 */
export const ANALYSIS_QUERY_SETTINGS = {
	join_use_nulls: 0,
	remote_filesystem_read_prefetch: 0,
	max_execution_time: 30,
	max_rows_to_read: "50000000",
	max_bytes_to_read: "4294967296",
	max_result_rows: "100000",
	max_result_bytes: "16777216",
	max_memory_usage: "1073741824",
	timeout_before_checking_execution_speed: 0,
	result_overflow_mode: "throw",
} as const;

export const records = () => getSafeClickHouseTable("rudel.transcript_records");

/** A failed tool call: an explicit error or a non-zero exit code on its result. */
export function toolErrorSql(alias = ""): string {
	const column = (name: string) => (alias ? `${alias}.${name}` : name);
	return `${column("kind")} = 'tool_result' AND (${column("is_error")} OR (${column("exit_code")} IS NOT NULL AND ${column("exit_code")} != 0))`;
}

/** A prompt the human typed (a parent's delegated task to a subagent is not one). */
export const GENUINE_PROMPT_SQL =
	"kind = 'user_prompt' AND subtype != 'delegation'";

/** Records of the given sessions, pinned to each session's committed generation. */
export function pinnedFilter(): string {
	return `organization_id = {organizationId:String} AND user_id = {userId:String}
		AND session_id IN {sessionIds:Array(String)}
		AND (session_id, revision, parser_version) IN (
			SELECT g.1, toUInt64(g.2), g.3 FROM (SELECT arrayJoin(arrayZip({sessionIds:Array(String)}, {revisions:Array(String)}, {parserVersions:Array(UInt16)})) AS g)
		) AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}`;
}

export function pinnedParams(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
) {
	return {
		...scope,
		sessionIds: generations.map((generation) => generation.sessionId),
		revisions: generations.map((generation) => generation.revision),
		parserVersions: generations.map((generation) => generation.parserVersion),
	};
}

/** Rows `r` of (sessionId, agentId, turn) for the `refs` parameters. */
export const REF_RUNS_SQL =
	"SELECT arrayJoin(arrayZip({refSessionIds:Array(String)}, {refAgentIds:Array(String)}, {refTurns:Array(UInt32)})) AS r";

export function refParams(refs: readonly RunRef[] | undefined) {
	return {
		refSessionIds: refs?.map((ref) => ref.sessionId) ?? [],
		refAgentIds: refs?.map((ref) => ref.agentId) ?? [],
		refTurns: refs?.map((ref) => ref.turn) ?? [],
	};
}

export const GenerationRowSchema = z
	.object({
		session_id: z.string(),
		revision_text: z.string(),
		parser_version: z.number(),
	})
	.transform(
		(row): SessionGeneration => ({
			sessionId: row.session_id,
			revision: row.revision_text,
			parserVersion: row.parser_version,
		}),
	);

/** ClickHouse refused because a row, byte or memory ceiling was hit (not a bug or a deadline). */
export function isAnalysisWorkLimit(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (isClickHouseMemoryPressure(error)) return false;
	const type =
		"type" in error && typeof error.type === "string" ? error.type : "";
	return (
		/TOO_MANY_ROWS|TOO_MANY_BYTES|MEMORY_LIMIT_EXCEEDED/u.test(type) ||
		/TOO_MANY_ROWS|TOO_MANY_BYTES|MEMORY_LIMIT_EXCEEDED|Limit for (rows|bytes|result)|Memory limit.*exceeded/iu.test(
			error.message,
		)
	);
}

export function isClickHouseMemoryPressure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		/memory limit/iu.test(error.message) &&
		/\((?:total|for user)\)|(?:total|user) memory limit|OvercommitTracker/iu.test(
			error.message,
		)
	);
}

export const CLICKHOUSE_MEMORY_PRESSURE =
	"ClickHouse ran out of memory for all of its queries (its server-wide limit), so nothing was counted. This is not an empty result: retry in a minute, and if it keeps happening give ClickHouse more memory.";

export function clickHouseMemoryPressureError(
	cause: unknown,
): ORPCError<"SERVICE_UNAVAILABLE", { reason: string; kind: string }> {
	return new ORPCError("SERVICE_UNAVAILABLE", {
		message: CLICKHOUSE_MEMORY_PRESSURE,
		data: { reason: "clickhouse_memory_pressure", kind: "retry" },
		cause,
	});
}

/** Runs a statement and validates every row. */
export async function query<Row>(
	executor: ClickHouseExecutor,
	schema: z.ZodType<Row, unknown>,
	statement: ClickHouseStatement,
): Promise<Row[]> {
	return z.array(schema).parse(await executor.query<unknown>(statement));
}

/**
 * Query parameters travel in the request URL, or in a multipart body once the
 * URL is long (`moveLongQueryParamsToBody`), where ClickHouse caps one form
 * field at 128 KiB (`http_max_field_value_size`); one statement's array
 * parameters stay below it together.
 */
export const PARAM_BYTES_PER_STATEMENT = 96 * 1024;

/**
 * The bytes one array element takes in the request URL: clickhouse-js
 * formats it as a quoted literal (escaping tab, newline, carriage return,
 * quote and backslash) and writes it with URLSearchParams, then a separator.
 */
export function paramValueBytes(value: string | number): number {
	const literal =
		typeof value === "number"
			? String(value)
			: `'${value.replace(/[\t\n\r'\\]/gu, (char) =>
					char === "\t"
						? "\\t"
						: char === "\n"
							? "\\n"
							: char === "\r"
								? "\\r"
								: `\\${char}`,
				)}'`;
	// The literal, URL-encoded, and its encoded comma.
	return new URLSearchParams([["", literal]]).toString().length - 1 + 3;
}

/**
 * Consecutive groups of items whose array parameter values (as
 * `values(item)` lists them, one entry per array the item adds to) fit in
 * `budget` URL bytes; an item larger than the budget gets a group of its own.
 */
export function chunkByParamBytes<T>(
	items: readonly T[],
	values: (item: T) => readonly (string | number)[],
	budget = PARAM_BYTES_PER_STATEMENT,
): T[][] {
	const groups: T[][] = [];
	let current: T[] = [];
	let bytes = 0;
	for (const item of items) {
		const size = values(item).reduce<number>(
			(sum, value) => sum + paramValueBytes(value),
			0,
		);
		if (current.length > 0 && bytes + size > budget) {
			groups.push(current);
			current = [];
			bytes = 0;
		}
		current.push(item);
		bytes += size;
	}
	if (current.length > 0) groups.push(current);
	return groups;
}
