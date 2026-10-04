import { Buffer } from "node:buffer";
import type { TranscriptSource } from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../clickhouse.js";

/**
 * One raw JSONL line of a transcript record, read from the exact raw revision
 * the record was derived from. A record's `byte_start`/`byte_len` are exact
 * UTF-8 offsets into its stream: the main `content`, or a Claude Code subagent
 * transcript in `subagents`. Codex sub-agents attributed inside one file share
 * that file's `content`.
 */
export interface RawTranscriptLineAddress {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
	readonly source: TranscriptSource;
	/** Raw revision of the record's generation (decimal UInt64). */
	readonly revision: string;
	readonly agentId: string;
	readonly byteStart: number;
	readonly byteLen: number;
}

/** Bounds for reading a raw line; the whole raw row is decompressed to slice it. */
export const RAW_LINE_QUERY_SETTINGS = {
	max_execution_time: 20,
	timeout_before_checking_execution_speed: 0,
	max_rows_to_read: "5000000",
	max_bytes_to_read: String(1024 * 1024 * 1024),
	max_result_bytes: String(64 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

/**
 * The raw line, or undefined when that revision or range no longer exists
 * (a newer upload replaced the revision, or the range does not fit).
 */
export async function readRawTranscriptLine(
	executor: ClickHouseExecutor,
	address: RawTranscriptLineAddress,
	options: {
		readonly abortSignal?: AbortSignal;
		readonly clickhouseSettings?: ClickHouseStatement["clickhouse_settings"];
	} = {},
): Promise<string | undefined> {
	const table = getSafeClickHouseTable(
		address.source === "codex"
			? "rudel.codex_sessions"
			: "rudel.claude_sessions",
	);
	const stream =
		address.source === "claude_code"
			? "if(mapContains(subagents, {agentId:String}), subagents[{agentId:String}], content)"
			: "content";
	const rows = await executor.query<{ raw: string }>({
		abortSignal: options.abortSignal,
		clickhouse_settings: options.clickhouseSettings ?? RAW_LINE_QUERY_SETTINGS,
		query: `SELECT substring(${stream}, {byteStart:UInt64} + 1, {byteLen:UInt32}) AS raw FROM ${table} WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = {sessionId:String} AND revision = {revision:UInt64} LIMIT 1`,
		query_params: {
			organizationId: address.organizationId,
			userId: address.userId,
			sessionId: address.sessionId,
			revision: address.revision,
			agentId: address.agentId,
			byteStart: address.byteStart,
			byteLen: address.byteLen,
		},
	});
	const raw = rows[0]?.raw;
	return raw !== undefined && Buffer.byteLength(raw, "utf8") === address.byteLen
		? raw
		: undefined;
}
