import { Buffer } from "node:buffer";
import { getLogger } from "@logtape/logtape";
import {
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
	type TranscriptRecordDraft,
	type TranscriptSource,
	type TranscriptSplitSummary,
} from "@rudel/api-routes/transcript-records";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { readBooleanEnv, readPositiveSafeIntegerEnv } from "../lib/env.js";
import {
	isLargeIngestSession,
	scaleSessionBudget,
} from "../lib/ingest-size.js";
import {
	type GitObservationExtractionInput,
	persistGitObservationsBestEffort,
} from "./git-observation-extraction.service.js";
import {
	hashTranscriptContent,
	hasMatchingTranscriptRecordsReceipt,
	readTranscriptRecordsReceipt,
	writeTranscriptRecords,
} from "./transcript-records-ingest.service.js";
import type {
	TranscriptRecordsSplitRequest,
	TranscriptRecordsWorkerCommand,
	TranscriptRecordsWorkerMessage,
} from "./transcript-records-stream.js";

const logger = getLogger(["rudel", "api", "transcript-records-extraction"]);

/** Drafts per batch crossing the worker boundary. */
const WORKER_BATCH_MAX_ROWS = 500;
const WORKER_BATCH_MAX_BYTES = 4 * 1024 * 1024;
const MAX_WAITING_JOBS = 8;

export interface TranscriptRecordsExtractionConfig {
	readonly enabled: boolean;
	/** Bytes of raw transcript admitted to extraction at once per process. */
	readonly queueMaxBytes: number;
	readonly queueMaxJobs: number;
	/** Drafts one session may expand to before extraction gives up. */
	readonly maxRows: number;
	readonly textBudgetChars: number;
	readonly textMaxChars: number;
	/** Wall-clock budget for one session, worker and inserts together. */
	readonly timeoutMs: number;
}

/**
 * Kill switch and limits. `TRANSCRIPT_RECORDS_EXTRACTION_ENABLED=false` keeps
 * raw ingest available while skipping record extraction entirely. Row, text and
 * time limits are sized for standard sessions; `scaleTranscriptRecordsLimits`
 * scales them for a larger one.
 */
export function readTranscriptRecordsExtractionConfig(): TranscriptRecordsExtractionConfig {
	return {
		enabled: readBooleanEnv("TRANSCRIPT_RECORDS_EXTRACTION_ENABLED", true),
		maxRows: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_RECORDS_MAX_ROWS",
			1_000_000,
		),
		queueMaxBytes: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_RECORDS_QUEUE_MAX_BYTES",
			256 * 1024 * 1024,
		),
		queueMaxJobs: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_RECORDS_QUEUE_MAX_JOBS",
			2,
		),
		textBudgetChars: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS",
			TRANSCRIPT_RECORDS_SESSION_TEXT_BUDGET_CHARS,
		),
		textMaxChars: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_RECORDS_TEXT_MAX_CHARS",
			TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
		),
		timeoutMs: readPositiveSafeIntegerEnv(
			"TRANSCRIPT_RECORDS_TIMEOUT_MS",
			120_000,
		),
	};
}

/**
 * Per-session limits: unchanged up to the standard session size, then scaled
 * with the session's bytes (2x at 256 MiB) so a large session that expands
 * proportionally is not cut off by budgets sized for 128 MiB.
 */
export function scaleTranscriptRecordsLimits<
	TLimits extends Pick<
		TranscriptRecordsExtractionConfig,
		"maxRows" | "textBudgetChars" | "timeoutMs"
	>,
>(limits: TLimits, bytes: number): TLimits {
	return {
		...limits,
		maxRows: scaleSessionBudget(limits.maxRows, bytes),
		textBudgetChars: scaleSessionBudget(limits.textBudgetChars, bytes),
		timeoutMs: scaleSessionBudget(limits.timeoutMs, bytes),
	};
}

export interface TranscriptRecordsJobGate {
	/**
	 * Resolves to a release function, or undefined when the job must be skipped:
	 * its bytes do not fit, the wait queue is full, the signal aborted, or the
	 * wait outlasted `timeoutMs`.
	 */
	acquire(
		bytes: number,
		options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
	): Promise<(() => void) | undefined>;
}

/**
 * Process-local admission for extraction jobs. At most `maxJobs` run at once,
 * and the raw bytes of every admitted job, running or waiting, stay under
 * `maxBytes`: a waiting job already holds its whole transcript in memory, and
 * the worker later holds a copy. Jobs that do not fit are rejected at
 * admission, a bounded number wait in FIFO order, and a waiter that is
 * cancelled or outlasts its deadline leaves the queue immediately, releasing
 * its bytes. A session above the standard size runs alone: if it fits
 * `maxBytes` on its own it waits for running jobs to finish instead of being
 * skipped, and nothing starts beside it. Skipped sessions are repaired by a
 * later identical upload or the backfill.
 */
export function createTranscriptRecordsJobGate(limits: {
	readonly maxBytes: number;
	readonly maxJobs: number;
	readonly maxWaiting?: number;
}): TranscriptRecordsJobGate {
	let activeJobs = 0;
	let exclusiveActive = false;
	let reservedBytes = 0;
	const waiting: {
		bytes: number;
		grant: (release: () => void) => void;
	}[] = [];
	const canStart = (bytes: number): boolean =>
		!exclusiveActive &&
		activeJobs < limits.maxJobs &&
		(!isLargeIngestSession(bytes) || activeJobs === 0);
	const start = (bytes: number): (() => void) => {
		activeJobs++;
		const exclusive = isLargeIngestSession(bytes);
		if (exclusive) exclusiveActive = true;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			activeJobs--;
			if (exclusive) exclusiveActive = false;
			reservedBytes -= bytes;
			for (
				let next = waiting[0];
				next !== undefined && canStart(next.bytes);
				next = waiting[0]
			) {
				waiting.shift();
				next.grant(start(next.bytes));
			}
		};
	};
	return {
		acquire(bytes, options = {}) {
			if (options.signal?.aborted) return Promise.resolve(undefined);
			const fits = isLargeIngestSession(bytes)
				? bytes <= limits.maxBytes
				: reservedBytes + bytes <= limits.maxBytes;
			if (!fits) return Promise.resolve(undefined);
			if (waiting.length === 0 && canStart(bytes)) {
				reservedBytes += bytes;
				return Promise.resolve(start(bytes));
			}
			if (waiting.length >= (limits.maxWaiting ?? MAX_WAITING_JOBS)) {
				return Promise.resolve(undefined);
			}
			reservedBytes += bytes;
			return new Promise((resolve) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const leave = () => {
					clearTimeout(timer);
					options.signal?.removeEventListener("abort", expire);
				};
				const waiter = {
					bytes,
					grant: (release: () => void) => {
						leave();
						resolve(release);
					},
				};
				const expire = () => {
					const index = waiting.indexOf(waiter);
					if (index === -1) return;
					waiting.splice(index, 1);
					reservedBytes -= bytes;
					leave();
					resolve(undefined);
				};
				if (options.timeoutMs !== undefined) {
					timer = setTimeout(expire, options.timeoutMs);
				}
				options.signal?.addEventListener("abort", expire, { once: true });
				waiting.push(waiter);
			});
		},
	};
}

export interface TranscriptRecordStream {
	readonly drafts: AsyncGenerator<TranscriptRecordDraft>;
	/** Valid once `drafts` completed. */
	summary(): TranscriptSplitSummary;
}

/**
 * Split one session in a dedicated worker and stream its drafts back in
 * bounded batches. The worker sends the next batch only after this side
 * finished the previous one, so memory stays proportional to a batch no matter
 * how far the transcript expands, and inserts pace the split. The worker is
 * terminated when the generator finishes, fails, or is abandoned, and on the
 * deadline or the caller's abort.
 */
export function streamTranscriptRecordDrafts(
	request: TranscriptRecordsSplitRequest,
	options: { readonly signal?: AbortSignal; readonly timeoutMs: number },
): TranscriptRecordStream {
	let summary: TranscriptSplitSummary | undefined;
	async function* drafts(): AsyncGenerator<TranscriptRecordDraft> {
		const worker = new Worker(
			new URL("./transcript-records.worker.js", import.meta.url).href,
		);
		const inbox: TranscriptRecordsWorkerMessage[] = [];
		let failure: Error | undefined;
		let wake: (() => void) | undefined;
		const fail = (error: Error) => {
			failure ??= error;
			wake?.();
		};
		worker.addEventListener(
			"message",
			(event: MessageEvent<TranscriptRecordsWorkerMessage>) => {
				inbox.push(event.data);
				wake?.();
			},
		);
		worker.addEventListener("error", (event) => fail(new Error(event.message)));
		worker.addEventListener("close", () =>
			fail(new Error("Transcript records worker stopped unexpectedly")),
		);
		const timer = setTimeout(
			() => fail(new Error("Transcript records extraction timed out")),
			options.timeoutMs,
		);
		const onAbort = () =>
			fail(new Error("Transcript records extraction was cancelled"));
		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.signal?.aborted) onAbort();
		const post = (command: TranscriptRecordsWorkerCommand) =>
			worker.postMessage(command);
		try {
			post({ request, type: "start" });
			while (true) {
				if (failure) throw failure;
				const message = inbox.shift();
				if (message === undefined) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					wake = undefined;
					continue;
				}
				if (message.type === "error") throw new Error(message.message);
				if (message.type === "done") {
					summary = message.summary;
					return;
				}
				yield* message.drafts;
				post({ type: "ack" });
			}
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			worker.terminate();
		}
	}
	return {
		drafts: drafts(),
		summary() {
			if (summary === undefined) {
				throw new Error("Transcript records split did not complete");
			}
			return summary;
		},
	};
}

export interface PersistTranscriptRecordsInput {
	/** Deletion fence; see `assertNoClickHousePurgeTombstone`. */
	readonly assertWritable: () => Promise<void>;
	readonly config: TranscriptRecordsExtractionConfig;
	readonly content: string;
	readonly gate?: TranscriptRecordsJobGate;
	readonly onWritten?: GitObservationExtractionInput["onWritten"];
	readonly organizationId: string;
	readonly revision: string;
	readonly sessionDate: string;
	readonly sessionId: string;
	readonly signal?: AbortSignal;
	readonly source: TranscriptSource;
	readonly subagents: Readonly<Record<string, string>>;
	readonly userId: string;
}

let sharedGate: TranscriptRecordsJobGate | undefined;

function getSharedGate(
	config: TranscriptRecordsExtractionConfig,
): TranscriptRecordsJobGate {
	sharedGate ??= createTranscriptRecordsJobGate({
		maxBytes: config.queueMaxBytes,
		maxJobs: config.queueMaxJobs,
	});
	return sharedGate;
}

/**
 * Extract and persist the transcript records of one raw-session revision.
 *
 * Derived data must never endanger the upload or the required usage and skill
 * extraction, so this runs in its own worker, under its own admission limits
 * and deadline, and converts every failure into a logged result: raw ingest
 * already succeeded, and the next identical upload or the backfill repairs a
 * missing or stale receipt.
 */
export async function persistTranscriptRecordsBestEffort(
	executor: ClickHouseExecutor,
	input: PersistTranscriptRecordsInput,
): Promise<"failed" | "skipped" | "written"> {
	if (!input.config.enabled) return "skipped";
	const log = {
		organizationId: input.organizationId,
		sessionId: input.sessionId,
	};
	try {
		const contentBytes = measureBytes(input.content, input.subagents);
		const limits = scaleTranscriptRecordsLimits(input.config, contentBytes);
		const release = await (input.gate ?? getSharedGate(input.config)).acquire(
			contentBytes,
			{ signal: input.signal, timeoutMs: limits.timeoutMs },
		);
		if (release === undefined) {
			logger.warn(
				"Transcript records extraction skipped because the extraction queue is full (organization_id={organizationId} session_id={sessionId} bytes={bytes})",
				{ ...log, bytes: contentBytes },
			);
			return "skipped";
		}
		try {
			const stream = streamTranscriptRecordDrafts(
				{
					batchMaxBytes: WORKER_BATCH_MAX_BYTES,
					batchMaxRows: WORKER_BATCH_MAX_ROWS,
					content: input.content,
					maxRows: limits.maxRows,
					sessionDate: input.sessionDate,
					source: input.source,
					subagents: input.subagents,
					textBudgetChars: limits.textBudgetChars,
					textMaxChars: limits.textMaxChars,
				},
				{ signal: input.signal, timeoutMs: limits.timeoutMs },
			);
			await writeTranscriptRecords(executor, {
				assertWritable: input.assertWritable,
				contentSha256: hashTranscriptContent(input.content, input.subagents),
				drafts: stream.drafts,
				organizationId: input.organizationId,
				revision: input.revision,
				sessionDate: input.sessionDate,
				sessionId: input.sessionId,
				source: input.source,
				summary: stream.summary,
				userId: input.userId,
			});
			await persistGitObservationsBestEffort(executor, input);
			return "written";
		} finally {
			release();
		}
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError) {
			logger.info(
				"Transcript records skipped because the account or organization is being deleted (organization_id={organizationId} session_id={sessionId})",
				log,
			);
			return "skipped";
		}
		logger.error(
			"Transcript records were not written after raw ingest (organization_id={organizationId} session_id={sessionId} error={error})",
			{
				...log,
				error: error instanceof Error ? error.message : String(error),
			},
		);
		return "failed";
	}
}

/**
 * True when the duplicate-upload fast path may skip record extraction: the
 * kill switch is off or the receipt matches the content. A failed receipt
 * lookup is not proof of a current receipt: the upload is reprocessed, whose
 * extraction is best-effort, so the upload still never fails because of
 * derived data.
 */
export async function isTranscriptRecordsCurrent(
	executor: ClickHouseExecutor,
	input: {
		readonly config: TranscriptRecordsExtractionConfig;
		readonly content: string;
		readonly organizationId: string;
		readonly sessionId: string;
		readonly subagents: Readonly<Record<string, string>>;
		readonly userId: string;
	},
): Promise<boolean> {
	if (!input.config.enabled) return true;
	try {
		const state = await readTranscriptRecordsReceipt(executor, input);
		return hasMatchingTranscriptRecordsReceipt(state, {
			contentSha256: hashTranscriptContent(input.content, input.subagents),
		});
	} catch (error) {
		logger.warn(
			"Transcript records receipt lookup failed; reprocessing the upload (organization_id={organizationId} session_id={sessionId} error={error})",
			{
				error: error instanceof Error ? error.message : String(error),
				organizationId: input.organizationId,
				sessionId: input.sessionId,
			},
		);
		return false;
	}
}

function measureBytes(
	content: string,
	subagents: Readonly<Record<string, string>>,
): number {
	let bytes = Buffer.byteLength(content, "utf8");
	for (const value of Object.values(subagents)) {
		bytes += Buffer.byteLength(value, "utf8");
	}
	return bytes;
}
