import { getLogger } from "@logtape/logtape";
import type { RudelSessionGitObservationsRow } from "@rudel/ch-schema/generated";
import { filterKnownSecrets } from "@rudel/secret-filter";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import {
	baseRow,
	GIT_OBSERVATION_MAX_RAW_BYTES,
	GIT_TOOL_PATTERN,
	GITHUB_CI_TOOL_PATTERN,
	GITHUB_PR_TOOL_PATTERN,
	type GitObservationParseInput,
	type GitObservationRecord,
	gitObservationGenerationVersion,
} from "./git-observation-parser.js";
import { enqueueSessionEdgesBestEffort } from "./l1-edges/l1-edge-enqueue.js";
import { readRawTranscriptLine } from "./transcript-raw-line.service.js";
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
	/** Runs after a generation is written; queues the session's L1 edges by default. */
	onWritten?: (session: TranscriptRecordsIdentity) => Promise<void>;
	/**
	 * Deletes the session's older observation generations (default). A backfill
	 * turns it off and calls `retireOlderGitObservations` once at the end: one
	 * lightweight DELETE per session queues behind every other mutation of the
	 * table, which made it most of a backfilled session's time.
	 */
	retireOlder?: boolean;
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
			if (input.retireOlder !== false)
				await retireOlder(executor, scope, deadline.signal);
			return "skipped";
		}
		const candidates = await deadline.wait(() =>
			executor.query<GitObservationRecord>({
				abortSignal: deadline.signal,
				clickhouse_settings: SCAN_SETTINGS,
				query: `SELECT ${recordColumns()} FROM rudel.transcript_records FINAL WHERE ${recordsFilter()} AND (
				(kind = 'tool_call' AND (match(text, {gitPattern:String}) OR match(tool_name, {mcpPattern:String}) OR text_chars > lengthUTF8(text) OR (source = 'codex' AND match(tool_name, '(^|[.])write_stdin$'))))
				OR (source = 'codex' AND kind = 'meta' AND subtype = 'session_meta')
				OR (kind = 'meta' AND subtype = 'pr-link')
				OR (kind = 'tool_result' AND notEmpty(git_operation))) ORDER BY agent_id, record_idx, block_idx LIMIT ${MAX_CALLS + 1}`,
				query_params: {
					...scope,
					gitPattern: `(?i)${GIT_TOOL_PATTERN.source}`,
					mcpPattern: `(?i)(?:${GITHUB_PR_TOOL_PATTERN.source})|(?:${GITHUB_CI_TOOL_PATTERN.source})`,
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
		// A result with recorded git operations can be both a candidate and the
		// result of a candidate call: keep one copy.
		const seen = new Set<string>();
		const records = [...candidates, ...results].filter((record) => {
			const key = `${record.agent_id}\u0000${record.record_idx}\u0000${record.block_idx}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		let rawBytes = 0;
		let rawReads = 0;
		for (const record of records) {
			deadline.assertActive();
			// Only Codex session_meta is read from the raw line; other records need
			// it only when their stored text was capped.
			if (
				!(record.kind === "meta" && record.subtype === "session_meta") &&
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
		if (input.retireOlder !== false)
			await deadline.wait(() => retireOlder(executor, scope, deadline.signal));
		await (input.onWritten ?? enqueueSessionEdgesBestEffort)({
			organizationId: input.organizationId,
			userId: input.userId,
			source: input.source,
			sessionId: input.sessionId,
		});
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
	const raw = await readRawTranscriptLine(
		executor,
		{
			...input,
			revision,
			agentId: record.agent_id,
			byteStart: Number(record.byte_start),
			byteLen: record.byte_len,
		},
		{ abortSignal: signal, clickhouseSettings: SCAN_SETTINGS },
	);
	if (raw === undefined)
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

interface OlderObservationGeneration {
	organization_id: string;
	user_id: string;
	source: string;
	session_id: string;
	revision: string;
	parser_version: number;
}

/** Older generations one batched retirement DELETE removes at most. */
export const OLDER_GIT_OBSERVATIONS_PER_DELETE = 500;

/**
 * Deletes every session's observation generations older than its newest
 * receipt, as `retireOlder` does per session: the generations are read first,
 * then deleted by exact key in bounded statements. Returns how many were.
 */
export async function retireOlderGitObservations(
	executor: ClickHouseExecutor,
	options: { organizationId?: string; signal?: AbortSignal } = {},
): Promise<number> {
	const organizationFilter =
		options.organizationId === undefined
			? ""
			: "AND organization_id = {organizationId:String}";
	const older = await executor.query<OlderObservationGeneration>({
		abortSignal: options.signal,
		clickhouse_settings: {
			max_execution_time: 120,
			timeout_before_checking_execution_speed: 0,
		},
		query: `SELECT DISTINCT o.organization_id AS organization_id, o.user_id AS user_id, o.source AS source,
				o.session_id AS session_id, toString(o.revision) AS revision, o.parser_version AS parser_version
			FROM ${SESSION_GIT_OBSERVATIONS_TABLE} AS o
			INNER JOIN (
				SELECT organization_id, user_id, source, session_id, max(tuple(revision, parser_version)) AS head
				FROM ${SESSION_GIT_OBSERVATIONS_TABLE}
				WHERE kind = 'receipt' ${organizationFilter}
				GROUP BY organization_id, user_id, source, session_id
			) AS h
				ON o.organization_id = h.organization_id AND o.user_id = h.user_id
				AND o.source = h.source AND o.session_id = h.session_id
			WHERE tuple(o.revision, o.parser_version) < h.head ${organizationFilter.replace("organization_id", "o.organization_id")}
			ORDER BY organization_id, user_id, source, session_id, revision, parser_version`,
		query_params:
			options.organizationId === undefined
				? {}
				: { organizationId: options.organizationId },
	});
	for (
		let start = 0;
		start < older.length;
		start += OLDER_GIT_OBSERVATIONS_PER_DELETE
	) {
		options.signal?.throwIfAborted();
		await executor.execute(
			buildOlderGitObservationsDelete(
				older.slice(start, start + OLDER_GIT_OBSERVATIONS_PER_DELETE),
				options.signal,
			),
		);
	}
	return older.length;
}

/** One lightweight DELETE of the given generations, matched by exact key. */
export function buildOlderGitObservationsDelete(
	generations: readonly OlderObservationGeneration[],
	abortSignal?: AbortSignal,
) {
	return {
		abortSignal,
		clickhouse_settings: {
			lightweight_deletes_sync: "1",
			max_execution_time: 110,
		},
		query: `DELETE FROM ${SESSION_GIT_OBSERVATIONS_TABLE}
			WHERE organization_id IN {organizationIds:Array(String)}
				AND has(arrayZip({organizations:Array(String)}, {users:Array(String)}, {sources:Array(String)}, {sessions:Array(String)}, {revisions:Array(String)}, {parsers:Array(UInt16)}),
					(organization_id, user_id, source, session_id, toString(revision), parser_version))`,
		query_params: {
			organizationIds: [...new Set(generations.map((g) => g.organization_id))],
			organizations: generations.map((g) => g.organization_id),
			users: generations.map((g) => g.user_id),
			sources: generations.map((g) => g.source),
			sessions: generations.map((g) => g.session_id),
			revisions: generations.map((g) => g.revision),
			parsers: generations.map((g) => g.parser_version),
		},
	};
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
	return "agent_id, record_idx, block_idx, call_id, kind, subtype, tool_name, is_error, exit_code, ts, text, text_chars, toString(byte_start) AS byte_start, byte_len, facts, git_operation";
}
