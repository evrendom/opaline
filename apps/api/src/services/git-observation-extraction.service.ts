import { Buffer } from "node:buffer";
import { getLogger } from "@logtape/logtape";
import type { RudelSessionGitObservationsRow } from "@rudel/ch-schema/generated";
import { filterKnownSecrets } from "@rudel/secret-filter";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import {
	baseRow,
	GIT_OBSERVATION_MAX_RAW_BYTES,
	GIT_TOOL_PATTERN,
	GITHUB_PR_TOOL_PATTERN,
	type GitObservationParseInput,
	type GitObservationRecord,
	gitObservationGenerationVersion,
} from "./git-observation-parser.js";
import { createTranscriptRecordsDeadline } from "./transcript-records-deadline.js";
import type { TranscriptRecordsIdentity } from "./transcript-records-ingest.service.js";

export const SESSION_GIT_OBSERVATIONS_TABLE = "rudel.session_git_observations";
const MAX_CALLS = 2_000;
const MAX_RESULTS = 8_000;
const MAX_RAW_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_RAW_READS = 256;
const TIMEOUT_MS = 30_000;
const SCAN_SETTINGS = {
	max_execution_time: 20,
	timeout_before_checking_execution_speed: 0,
	max_rows_to_read: "5000000",
	max_bytes_to_read: String(256 * 1024 * 1024),
	max_result_bytes: String(64 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;
const logger = getLogger(["rudel", "api", "git-observation-extraction"]);
let activeJobs = 0;

export interface GitObservationExtractionInput
	extends TranscriptRecordsIdentity {
	assertWritable: () => Promise<void>;
	signal?: AbortSignal;
	deadlineAt?: number;
	expectedGeneration?: { revision: string; parserVersion: number };
}

interface Generation {
	revision: string;
	parser_version: number;
	ts: string;
}

export async function persistGitObservationsBestEffort(
	executor: ClickHouseExecutor,
	input: GitObservationExtractionInput,
): Promise<"written" | "skipped" | "failed"> {
	if (process.env.GIT_OBSERVATION_EXTRACTION_ENABLED === "false")
		return "skipped";
	if (activeJobs >= 2) {
		logger.warn(
			"Git observation extraction admission full; backfill can retry",
		);
		return "skipped";
	}
	activeJobs++;
	try {
		return await extractGitObservations(executor, input);
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError) return "skipped";
		logger.warn(
			"Git observation extraction failed; upload remains accepted (session_id={sessionId} error={error})",
			{
				sessionId: input.sessionId,
				error: filterKnownSecrets(
					error instanceof Error ? error.message : "Extraction failed",
				).text.slice(0, 512),
			},
		);
		return "failed";
	} finally {
		activeJobs--;
	}
}

export async function extractGitObservations(
	executor: ClickHouseExecutor,
	input: GitObservationExtractionInput,
): Promise<"written" | "skipped"> {
	const deadline = createTranscriptRecordsDeadline({
		deadlineAt: Math.min(
			input.deadlineAt ?? Number.POSITIVE_INFINITY,
			Date.now() + TIMEOUT_MS,
		),
		now: Date.now,
		signal: input.signal,
	});
	const params = identityParams(input);
	try {
		const receipts = await deadline.wait(() =>
			executor.query<Generation>({
				abortSignal: deadline.signal,
				clickhouse_settings: SCAN_SETTINGS,
				query: `SELECT toString(revision) AS revision, parser_version, ts FROM rudel.transcript_records WHERE ${identityFilter()} AND kind = 'receipt' ORDER BY toUInt64(revision) DESC, parser_version DESC LIMIT 1`,
				query_params: params,
			}),
		);
		const receipt = receipts[0];
		if (!receipt) return "skipped";
		if (
			input.expectedGeneration &&
			(receipt.revision !== input.expectedGeneration.revision ||
				receipt.parser_version !== input.expectedGeneration.parserVersion)
		)
			return "skipped";
		const parserVersion = gitObservationGenerationVersion(
			receipt.parser_version,
		);
		const parseIdentity = {
			organizationId: input.organizationId,
			userId: input.userId,
			source: input.source,
			sessionId: input.sessionId,
			revision: receipt.revision,
			transcriptParserVersion: receipt.parser_version,
		};
		const scope = {
			...params,
			revision: receipt.revision,
			transcriptParserVersion: receipt.parser_version,
			parserVersion,
		};
		const committed = await deadline.wait(() =>
			executor.query<Generation>({
				abortSignal: deadline.signal,
				clickhouse_settings: SCAN_SETTINGS,
				query: `SELECT toString(revision) AS revision, parser_version, ts FROM ${SESSION_GIT_OBSERVATIONS_TABLE} WHERE ${identityFilter()} AND kind = 'receipt' ORDER BY toUInt64(revision) DESC, parser_version DESC LIMIT 1`,
				query_params: params,
			}),
		);
		const current = committed[0];
		if (
			current &&
			compareGeneration(current, {
				revision: receipt.revision,
				parser_version: parserVersion,
			}) >= 0
		) {
			await retireOlder(executor, scope, deadline.signal);
			return "skipped";
		}
		const candidates = await deadline.wait(() =>
			executor.query<GitObservationRecord>({
				abortSignal: deadline.signal,
				clickhouse_settings: SCAN_SETTINGS,
				query: `SELECT ${recordColumns()} FROM rudel.transcript_records FINAL WHERE ${recordsFilter()} AND (
				(kind = 'tool_call' AND (match(text, {gitPattern:String}) OR match(tool_name, {mcpPattern:String}) OR text_chars > lengthUTF8(text) OR (source = 'codex' AND match(tool_name, '(^|[.])write_stdin$'))))
				OR (source = 'codex' AND kind = 'meta' AND subtype = 'session_meta')) ORDER BY agent_id, record_idx, block_idx LIMIT ${MAX_CALLS + 1}`,
				query_params: {
					...scope,
					gitPattern: `(?i)${GIT_TOOL_PATTERN.source}`,
					mcpPattern: `(?i)${GITHUB_PR_TOOL_PATTERN.source}`,
				},
			}),
		);
		if (candidates.length > MAX_CALLS)
			throw new Error("Git observation candidate bound exceeded");
		const calls = candidates.filter((row) => row.kind === "tool_call");
		const results =
			calls.length === 0
				? []
				: await deadline.wait(() =>
						executor.query<GitObservationRecord>({
							abortSignal: deadline.signal,
							clickhouse_settings: SCAN_SETTINGS,
							query: `SELECT ${recordColumns()} FROM rudel.transcript_records FINAL WHERE ${recordsFilter()} AND kind = 'tool_result' AND call_id IN {callIds:Array(String)} ORDER BY agent_id, record_idx, block_idx LIMIT ${MAX_RESULTS + 1}`,
							query_params: {
								...scope,
								callIds: [...new Set(calls.map((row) => row.call_id))],
							},
						}),
					);
		if (results.length > MAX_RESULTS)
			throw new Error("Git observation result bound exceeded");
		const records = [...candidates, ...results];
		let rawBytes = 0;
		let rawReads = 0;
		for (const record of records) {
			deadline.assertActive();
			if (
				record.kind !== "meta" &&
				record.text_chars <= [...record.text].length
			)
				continue;
			if (
				record.byte_len > GIT_OBSERVATION_MAX_RAW_BYTES ||
				record.byte_len <= 0 ||
				rawBytes + record.byte_len > MAX_RAW_TOTAL_BYTES ||
				++rawReads > MAX_RAW_READS
			)
				throw new Error("Git observation raw fallback bound exceeded");
			rawBytes += record.byte_len;
			record.raw = await deadline.wait(() =>
				readRawRange(
					executor,
					input,
					receipt.revision,
					record,
					deadline.signal,
				),
			);
		}
		const rows = await deadline.wait(() =>
			parseOffThread({ ...parseIdentity, records }, deadline.signal),
		);
		await deadline.wait(input.assertWritable);
		await deadline.wait(() =>
			executor.insert({
				abortSignal: deadline.signal,
				asyncInsert: false,
				deduplicationToken: `git-observations:${crypto.randomUUID()}`,
				table: SESSION_GIT_OBSERVATIONS_TABLE,
				values: [
					...rows,
					{
						...baseRow(parseIdentity, {
							agent_id: "",
							record_idx: 4_294_967_295,
							block_idx: 0,
							call_id: "",
							ts: new Date().toISOString(),
						}),
						kind: "receipt",
						label: "",
					},
				],
			}),
		);
		await deadline.wait(input.assertWritable);
		await deadline.wait(() => retireOlder(executor, scope, deadline.signal));
		return "written";
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError)
			await executor.execute({
				clickhouse_settings: {
					...SCAN_SETTINGS,
					lightweight_deletes_sync: "3",
				},
				query: `DELETE FROM ${SESSION_GIT_OBSERVATIONS_TABLE} WHERE ${identityFilter()}`,
				query_params: params,
			});
		throw error;
	} finally {
		deadline.dispose();
	}
}

async function readRawRange(
	executor: ClickHouseExecutor,
	input: TranscriptRecordsIdentity,
	revision: string,
	record: GitObservationRecord,
	signal: AbortSignal,
): Promise<string> {
	const table = getSafeClickHouseTable(
		input.source === "codex" ? "rudel.codex_sessions" : "rudel.claude_sessions",
	);
	const stream =
		input.source === "claude_code"
			? "if(mapContains(subagents, {agentId:String}), subagents[{agentId:String}], content)"
			: "content";
	const rows = await executor.query<{ raw: string }>({
		abortSignal: signal,
		clickhouse_settings: SCAN_SETTINGS,
		query: `SELECT substring(${stream}, {byteStart:UInt64} + 1, {byteLen:UInt32}) AS raw FROM ${table} WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = {sessionId:String} AND revision = {revision:UInt64} LIMIT 1`,
		query_params: {
			...identityParams(input),
			revision,
			agentId: record.agent_id,
			byteStart: record.byte_start,
			byteLen: record.byte_len,
		},
	});
	const raw = rows[0]?.raw;
	if (raw === undefined || Buffer.byteLength(raw, "utf8") !== record.byte_len)
		throw new Error("Missing exact raw revision/range for git observation");
	return raw;
}

function parseOffThread(
	input: GitObservationParseInput,
	signal: AbortSignal,
): Promise<RudelSessionGitObservationsRow[]> {
	const worker = new Worker(
		new URL("./git-observation-extraction.worker.ts", import.meta.url).href,
	);
	return new Promise<RudelSessionGitObservationsRow[]>((resolve, reject) => {
		const cancel = () => finish(() => reject(signal.reason));
		const finish = (complete: () => void) => {
			signal.removeEventListener("abort", cancel);
			worker.terminate();
			complete();
		};
		worker.onmessage = (
			event: MessageEvent<
				| { type: "result"; rows: RudelSessionGitObservationsRow[] }
				| { type: "error"; message: string }
			>,
		) =>
			finish(() =>
				event.data.type === "result"
					? resolve(event.data.rows)
					: reject(new Error(event.data.message)),
			);
		worker.onerror = () =>
			finish(() => reject(new Error("Git observation worker failed")));
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		else {
			try {
				worker.postMessage(input);
			} catch (error) {
				finish(() => reject(error));
			}
		}
	});
}

function retireOlder(
	executor: ClickHouseExecutor,
	scope: Record<string, unknown>,
	signal: AbortSignal,
): Promise<void> {
	return executor.execute({
		abortSignal: signal,
		clickhouse_settings: { ...SCAN_SETTINGS, lightweight_deletes_sync: "1" },
		query: `DELETE FROM ${SESSION_GIT_OBSERVATIONS_TABLE} WHERE ${identityFilter()} AND (revision, parser_version) < (SELECT max(tuple(revision, parser_version)) FROM ${SESSION_GIT_OBSERVATIONS_TABLE} WHERE ${identityFilter()} AND kind = 'receipt')`,
		query_params: scope,
	});
}

function compareGeneration(
	left: Pick<Generation, "revision" | "parser_version">,
	right: Pick<Generation, "revision" | "parser_version">,
): number {
	return BigInt(left.revision) === BigInt(right.revision)
		? left.parser_version - right.parser_version
		: BigInt(left.revision) > BigInt(right.revision)
			? 1
			: -1;
}

function identityParams(
	input: TranscriptRecordsIdentity,
): Record<string, unknown> {
	return {
		organizationId: input.organizationId,
		userId: input.userId,
		source: input.source,
		sessionId: input.sessionId,
	};
}
function identityFilter(): string {
	return "organization_id = {organizationId:String} AND user_id = {userId:String} AND source = {source:String} AND session_id = {sessionId:String}";
}
function recordsFilter(): string {
	return `${identityFilter()} AND revision = {revision:UInt64} AND parser_version = {transcriptParserVersion:UInt16}`;
}
function recordColumns(): string {
	return "agent_id, record_idx, block_idx, call_id, kind, subtype, tool_name, is_error, exit_code, ts, text, text_chars, toString(byte_start) AS byte_start, byte_len";
}
