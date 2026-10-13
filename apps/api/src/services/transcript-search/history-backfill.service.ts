import { Buffer } from "node:buffer";
import { SEARCH_KINDS } from "@rudel/api-routes";
import {
	TRANSCRIPT_RECORD_EXCERPT_CHARS,
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { filterKnownSecrets } from "@rudel/secret-filter";
import { z } from "zod";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
import {
	type BackfillClock,
	REAL_BACKFILL_CLOCK,
	readClickHouseLoadAverage,
} from "../backfill-pacing.js";
import { TRANSCRIPT_RECORDS_TABLE } from "../transcript-records-ingest.service.js";
import type { SearchAccess } from "./access.js";
import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS } from "./chunks.js";
import type { TranscriptEmbedder } from "./config.js";
import type { EmbeddingQuota } from "./quota.js";
import {
	indexSessionText,
	type SessionIndexOutcome,
	type TRANSCRIPT_SEARCH_LIMITS,
} from "./session-index.service.js";
import { TRANSCRIPT_CHUNK_HITS_TABLE } from "./tables.js";

/**
 * The history backfill behind `backfill:transcript-search` (OPL-404): makes
 * sessions uploaded before search indexing existed searchable, through the
 * same pass an upload runs (`indexSessionText`: secret filter, chunking,
 * deduplication, the workspace's OpenAI quota, purge fences), and only for
 * the workspaces uploads are indexed for (listed, or paid where paid plans
 * are on: `access.ts`).
 *
 * - Preview by default: it reads ClickHouse and Postgres and reports the
 *   sessions, their estimated tokens and cost; it never calls OpenAI.
 * - Selection: sessions with a committed transcript-records generation whose
 *   search receipt is missing, of another generation, or still counts chunks
 *   without a vector; newest sessions first, at most `maxSessions`, after
 *   `after`. Sessions indexed at their current generation are left out.
 * - Paced: at most `sessionsPerMinute` indexing passes start a minute, and
 *   none while ClickHouse's `LoadAverage1` is above `maxLoad`.
 * - Stops cleanly, with `next` naming where to continue, when a workspace
 *   has used its quota or the run is interrupted.
 */

/** text-embedding-3-small. */
const USD_PER_MILLION_TOKENS = 0.02;
/** How long a run waits before reading ClickHouse's load again. */
const LOAD_RECHECK_MS = 30_000;
/** Passes over one session that the pass's limits (time, chunk cap) stopped short. */
const MAX_PASSES_PER_SESSION = 10;
/** Sessions per estimate statement. */
const ESTIMATE_BATCH = 200;
/** Issues kept in the summary. */
const MAX_ISSUES = 50;
/**
 * The most text a record gives search: its kept text and tail
 * (`searchableText` in the indexing pass), whatever its full length.
 */
const RECORD_SEARCH_MAX_CHARS =
	TRANSCRIPT_RECORD_TEXT_MAX_CHARS + TRANSCRIPT_RECORD_EXCERPT_CHARS;
/** Chunks repeat their overlap: text is embedded about this many times over. */
const CHUNK_OVERLAP_FACTOR =
	CHUNK_MAX_CHARS / (CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS);

const SELECTION_SETTINGS = {
	join_use_nulls: 0,
	max_execution_time: 120,
	max_rows_to_read: "1000000000",
	max_bytes_to_read: String(32 * 1024 * 1024 * 1024),
	max_memory_usage: String(4 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

export type TranscriptSearchBackfillReason =
	| "missing"
	| "generation"
	| "pending";

export interface TranscriptSearchBackfillCursor {
	/** The session's `session_date` as ClickHouse prints it. */
	readonly sessionDate: string;
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
}

export interface TranscriptSearchBackfillOptions {
	/** One workspace; undefined means every workspace search indexes. */
	readonly organizationId: string | undefined;
	readonly maxSessions: number;
	readonly after: TranscriptSearchBackfillCursor | undefined;
	readonly sessionsPerMinute: number;
	readonly maxLoad: number;
	/** Stops the run before its next pass. */
	readonly signal?: AbortSignal;
}

export interface TranscriptSearchBackfillEnv {
	readonly executor: ClickHouseExecutor;
	readonly access: SearchAccess;
	readonly quota: EmbeddingQuota;
	/** Every workspace, for a run over all of them. */
	readonly listWorkspaces: () => Promise<readonly string[]>;
	/** Deletion fence of the session's member and workspace. */
	readonly assertWritable: (target: {
		organizationId: string;
		userId: string;
	}) => Promise<void>;
	readonly clock?: BackfillClock;
	/** Progress lines (stderr in the script). */
	readonly log?: (line: string) => void;
	readonly limits?: Partial<
		Record<keyof typeof TRANSCRIPT_SEARCH_LIMITS, number>
	>;
}

export interface TranscriptSearchBackfillExecuteEnv
	extends TranscriptSearchBackfillEnv {
	readonly embedder: TranscriptEmbedder;
}

interface TranscriptSearchBackfillSummary {
	organizationId: string | null;
	/** Workspaces in scope search does not index (`access.ts`). */
	workspacesNotIndexed: number;
	/** Sessions the selection found. */
	candidates: number;
	byReason: Record<TranscriptSearchBackfillReason, number>;
	message: string | null;
	/** More sessions remain: continue with `--after next`. */
	hasMore: boolean;
	next: string | null;
}

export interface TranscriptSearchWorkspaceEstimate {
	organizationId: string;
	sessions: number;
	estimatedTokens: number;
	quotaUsed: number;
	quotaLimit: number;
	/** The estimate fits in what is left of the workspace's quota. */
	fitsQuota: boolean;
}

export interface TranscriptSearchBackfillPreview
	extends TranscriptSearchBackfillSummary {
	status: "preview";
	/** Text tokens before deduplication: an upper bound of what OpenAI bills. */
	estimatedTokens: number;
	estimatedCostUsd: number;
	workspaces: TranscriptSearchWorkspaceEstimate[];
}

export interface TranscriptSearchBackfillIssue {
	organizationId: string;
	userId: string;
	sessionId: string;
	error: string;
}

export interface TranscriptSearchBackfillExecuted
	extends TranscriptSearchBackfillSummary {
	status: "executed";
	/** Every chunk has a vector. */
	indexed: number;
	/** Indexed meanwhile (by an upload) at their current generation. */
	alreadyCurrent: number;
	/** Chunks still without a vector after the pass limit (or an OpenAI error). */
	incomplete: number;
	/** No transcript records to index. */
	skipped: number;
	/** Their member or workspace is being deleted. */
	fenced: number;
	failed: number;
	passes: number;
	embeddedChunks: number;
	tokensCharged: number;
	costUsd: number;
	loadPausedSeconds: number;
	stopped: "quota" | "interrupted" | null;
	issues: TranscriptSearchBackfillIssue[];
}

const CandidateRowSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	session_id: z.string(),
	source: z.enum(["claude_code", "codex"]),
	session_date: z.string(),
	reason: z.enum(["missing", "generation", "pending"]),
});
type CandidateRow = z.infer<typeof CandidateRowSchema>;

const EstimateRowSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	session_id: z.string(),
	chars: z.coerce.number(),
});

/**
 * Sessions of the workspaces (null: every workspace) whose committed
 * transcript-records generation is not fully indexed for search: no search
 * receipt, a receipt of another generation, or one that counts chunks
 * without a vector. Newest first (`session_date`, then key), after `after`.
 */
export function buildTranscriptSearchBackfillStatement(input: {
	readonly organizationIds: readonly string[] | null;
	readonly after: TranscriptSearchBackfillCursor | undefined;
	readonly limit: number;
}): ClickHouseStatement {
	const organizationFilter =
		input.organizationIds === null
			? ""
			: "AND organization_id IN {organizationIds:Array(String)}";
	const afterFilter =
		input.after === undefined
			? ""
			: `AND (records.started, records.organization_id, records.user_id, records.session_id)
				< ({afterSessionDate:DateTime64(3, 'UTC')}, {afterOrganizationId:String}, {afterUserId:String}, {afterSessionId:String})`;
	return {
		clickhouse_settings: {
			...SELECTION_SETTINGS,
			max_result_rows: String(input.limit),
		},
		query: `WITH records AS (
				SELECT organization_id, user_id, session_id,
					argMax(source, (revision, parser_version)) AS session_source,
					argMax(session_date, (revision, parser_version)) AS started,
					max((revision, parser_version)) AS generation
				FROM ${TRANSCRIPT_RECORDS_TABLE}
				WHERE kind = 'receipt' AND agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND block_idx = 0
					${organizationFilter}
				GROUP BY organization_id, user_id, session_id
			),
			indexed AS (
				SELECT organization_id, user_id, session_id, toUInt8(1) AS present,
					argMax(tuple(revision, parser_version, pending_chunks),
						tuple(revision, parser_version, written_at)) AS committed
				FROM ${TRANSCRIPT_CHUNK_HITS_TABLE}
				WHERE agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND kind = 'receipt'
					${organizationFilter}
				GROUP BY organization_id, user_id, session_id
			)
			SELECT records.organization_id AS organization_id, records.user_id AS user_id,
				records.session_id AS session_id, records.session_source AS source,
				toString(records.started) AS session_date,
				multiIf(indexed.present = 0, 'missing',
					tuple(indexed.committed.1, indexed.committed.2) != records.generation, 'generation',
					'pending') AS reason
			FROM records
			LEFT JOIN indexed ON records.organization_id = indexed.organization_id
				AND records.user_id = indexed.user_id AND records.session_id = indexed.session_id
			WHERE records.session_source IN ('claude_code', 'codex')
				AND (indexed.present = 0
					OR tuple(indexed.committed.1, indexed.committed.2) != records.generation
					OR indexed.committed.3 > 0)
				${afterFilter}
			ORDER BY records.started DESC, organization_id DESC, user_id DESC, session_id DESC
			LIMIT {limit:UInt32}`,
		query_params: {
			afterOrganizationId: input.after?.organizationId ?? "",
			afterSessionDate: input.after?.sessionDate ?? "1970-01-01 00:00:00.000",
			afterSessionId: input.after?.sessionId ?? "",
			afterUserId: input.after?.userId ?? "",
			limit: input.limit,
			organizationIds: input.organizationIds ?? [],
			receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		},
	};
}

/** Reads what a run would index and what it would cost; never writes or calls OpenAI. */
export async function previewTranscriptSearchBackfill(
	env: TranscriptSearchBackfillEnv,
	options: TranscriptSearchBackfillOptions,
): Promise<TranscriptSearchBackfillPreview> {
	const selection = await select(env, options);
	const chars = await estimateChars(env.executor, selection.rows);
	const byWorkspace = new Map<string, { sessions: number; tokens: number }>();
	for (const row of selection.rows) {
		const workspace = byWorkspace.get(row.organization_id) ?? {
			sessions: 0,
			tokens: 0,
		};
		workspace.sessions++;
		workspace.tokens += tokensOfChars(chars.get(sessionKey(row)) ?? 0);
		byWorkspace.set(row.organization_id, workspace);
	}
	const workspaces: TranscriptSearchWorkspaceEstimate[] = [];
	for (const [organizationId, workspace] of byWorkspace) {
		const usage = await env.quota.usage(organizationId);
		workspaces.push({
			organizationId,
			sessions: workspace.sessions,
			estimatedTokens: workspace.tokens,
			quotaUsed: usage.used,
			quotaLimit: usage.limit,
			fitsQuota: usage.used + workspace.tokens <= usage.limit,
		});
	}
	const estimatedTokens = workspaces.reduce(
		(sum, workspace) => sum + workspace.estimatedTokens,
		0,
	);
	const last = selection.rows.at(-1);
	return {
		status: "preview",
		...selection.summary,
		hasMore: selection.full,
		next:
			selection.full && last
				? encodeTranscriptSearchBackfillCursor(cursorOf(last))
				: null,
		estimatedTokens,
		estimatedCostUsd: costOf(estimatedTokens),
		workspaces,
	};
}

/**
 * Indexes the selected sessions one after another, newest first, paced, and
 * stops at the first workspace out of quota or when `signal` aborts.
 */
export async function backfillTranscriptSearch(
	env: TranscriptSearchBackfillExecuteEnv,
	options: TranscriptSearchBackfillOptions,
): Promise<TranscriptSearchBackfillExecuted> {
	const selection = await select(env, options);
	const clock = env.clock ?? REAL_BACKFILL_CLOCK;
	const log = env.log ?? (() => {});
	const result: TranscriptSearchBackfillExecuted = {
		status: "executed",
		...selection.summary,
		hasMore: selection.full,
		next: null,
		indexed: 0,
		alreadyCurrent: 0,
		incomplete: 0,
		skipped: 0,
		fenced: 0,
		failed: 0,
		passes: 0,
		embeddedChunks: 0,
		tokensCharged: 0,
		costUsd: 0,
		loadPausedSeconds: 0,
		stopped: null,
		issues: [],
	};
	// The tokens OpenAI billed this run, as the quota is charged.
	const quota: EmbeddingQuota = {
		tokens: env.quota.tokens,
		windowMs: env.quota.windowMs,
		usage: (workspaceId) => env.quota.usage(workspaceId),
		charge: async (workspaceId, tokens) => {
			await env.quota.charge(workspaceId, tokens);
			result.tokensCharged += tokens;
		},
	};
	const intervalMs = 60_000 / options.sessionsPerMinute;
	let lastStartAt: number | null = null;
	/** Waits for the rate and for ClickHouse's load; false when interrupted. */
	const pace = async (): Promise<boolean> => {
		if (lastStartAt !== null) {
			const wait = lastStartAt + intervalMs - clock.now();
			if (wait > 0) await clock.sleep(wait, options.signal);
		}
		for (;;) {
			if (options.signal?.aborted) return false;
			const load = await readClickHouseLoadAverage(env.executor);
			if (load <= options.maxLoad) break;
			log(
				`ClickHouse LoadAverage1 is ${load}, above ${options.maxLoad}: pausing ${LOAD_RECHECK_MS / 1_000}s`,
			);
			const pausedAt = clock.now();
			await clock.sleep(LOAD_RECHECK_MS, options.signal);
			result.loadPausedSeconds += (clock.now() - pausedAt) / 1_000;
		}
		lastStartAt = clock.now();
		return true;
	};

	let done: TranscriptSearchBackfillCursor | undefined = options.after;
	sessions: for (const [position, row] of selection.rows.entries()) {
		if (options.signal?.aborted) {
			result.stopped = "interrupted";
			break;
		}
		const usage = await env.quota.usage(row.organization_id);
		if (usage.used >= usage.limit) {
			result.stopped = "quota";
			result.message = quotaMessage(row.organization_id, usage);
			break;
		}
		const input = {
			organizationId: row.organization_id,
			userId: row.user_id,
			source: row.source,
			sessionId: row.session_id,
			assertWritable: () =>
				env.assertWritable({
					organizationId: row.organization_id,
					userId: row.user_id,
				}),
		};
		let outcome: SessionIndexOutcome | null = null;
		for (let pass = 1; pass <= MAX_PASSES_PER_SESSION; pass++) {
			if (!(await pace())) {
				result.stopped = "interrupted";
				break sessions;
			}
			result.passes++;
			try {
				outcome = await indexSessionText(input, {
					executor: env.executor,
					embedder: env.embedder,
					quota,
					limits: env.limits,
				});
			} catch (error) {
				outcome = null;
				if (error instanceof ClickHouseWriteFencedError) result.fenced++;
				else {
					result.failed++;
					if (result.issues.length < MAX_ISSUES)
						result.issues.push({
							organizationId: row.organization_id,
							userId: row.user_id,
							sessionId: row.session_id,
							error: filterKnownSecrets(
								error instanceof Error ? error.message : "Indexing failed",
							).text.slice(0, 512),
						});
				}
				break;
			}
			if (outcome.status === "written")
				result.embeddedChunks += outcome.embedded;
			// A pass stopped by its time or chunk cap goes on while it makes progress.
			if (
				outcome.status !== "written" ||
				outcome.stopped !== "limit" ||
				outcome.embedded === 0
			)
				break;
		}
		if (outcome?.status === "written" && outcome.stopped === "quota") {
			// Left before this session: continuing indexes the rest of it.
			result.stopped = "quota";
			result.message = quotaMessage(
				row.organization_id,
				await env.quota.usage(row.organization_id),
			);
			break;
		}
		if (outcome?.status === "written") {
			if (outcome.pending === 0) result.indexed++;
			else result.incomplete++;
		} else if (outcome?.status === "current") result.alreadyCurrent++;
		else if (outcome?.status === "skipped") result.skipped++;
		done = cursorOf(row);
		if ((position + 1) % 10 === 0)
			log(
				`${position + 1}/${selection.rows.length} sessions, ${result.tokensCharged} tokens`,
			);
	}

	result.costUsd = costOf(result.tokensCharged);
	if (result.stopped !== null) {
		result.hasMore = true;
		if (result.stopped === "interrupted")
			result.message = "Interrupted: the run stopped before its next session.";
	}
	result.next =
		result.hasMore && done ? encodeTranscriptSearchBackfillCursor(done) : null;
	if (result.stopped !== null)
		result.message = `${result.message ?? ""} ${
			result.next
				? `Continue with --after ${result.next}.`
				: "Continue by running it again without --after."
		}`.trim();
	return result;
}

async function select(
	env: TranscriptSearchBackfillEnv,
	options: TranscriptSearchBackfillOptions,
): Promise<{
	rows: CandidateRow[];
	full: boolean;
	summary: Omit<TranscriptSearchBackfillSummary, "hasMore" | "next">;
}> {
	validateOptions(options);
	const inScope =
		options.organizationId === undefined
			? await env.listWorkspaces()
			: [options.organizationId];
	const indexed: string[] = [];
	for (const workspaceId of inScope)
		if (await env.access.indexes(workspaceId)) indexed.push(workspaceId);
	const summary: Omit<TranscriptSearchBackfillSummary, "hasMore" | "next"> = {
		organizationId: options.organizationId ?? null,
		workspacesNotIndexed: inScope.length - indexed.length,
		candidates: 0,
		byReason: { missing: 0, generation: 0, pending: 0 },
		message: null,
	};
	if (indexed.length === 0) {
		summary.message =
			options.organizationId === undefined
				? "No workspace is indexed for search: none is listed in TRANSCRIPT_EMBEDDINGS_WORKSPACES, or paid with TRANSCRIPT_EMBEDDINGS_PAID_PLANS=true."
				: `${env.access.notIndexed}, and TRANSCRIPT_EMBEDDINGS_WORKSPACES does not list it.`;
		return { rows: [], full: false, summary };
	}
	const rows = z.array(CandidateRowSchema).parse(
		await env.executor.query<unknown>(
			buildTranscriptSearchBackfillStatement({
				// Every workspace is indexed (`*`): no list to send.
				organizationIds:
					options.organizationId === undefined &&
					indexed.length === inScope.length
						? null
						: indexed,
				after: options.after,
				limit: options.maxSessions,
			}),
		),
	);
	summary.candidates = rows.length;
	for (const row of rows) summary.byReason[row.reason]++;
	return { rows, full: rows.length >= options.maxSessions, summary };
}

/** Bounds are the script's (`parseTranscriptSearchBackfillArgs`); this checks the cursor's scope. */
function validateOptions(options: TranscriptSearchBackfillOptions): void {
	if (
		options.after !== undefined &&
		options.organizationId !== undefined &&
		options.after.organizationId !== options.organizationId
	)
		throw new Error("--after must name a session of --organization-id");
}

/**
 * Characters each session gives search, at most a record's kept text and
 * tail per record, read from `text_chars` (light) rather than the text.
 */
async function estimateChars(
	executor: ClickHouseExecutor,
	rows: readonly CandidateRow[],
): Promise<Map<string, number>> {
	const chars = new Map<string, number>();
	for (let start = 0; start < rows.length; start += ESTIMATE_BATCH) {
		const batch = rows.slice(start, start + ESTIMATE_BATCH);
		const unique = (values: string[]) => [...new Set(values)];
		const found = z.array(EstimateRowSchema).parse(
			await executor.query<unknown>({
				clickhouse_settings: SELECTION_SETTINGS,
				query: `SELECT organization_id, user_id, session_id,
					sum(least(text_chars, {recordMaxChars:UInt32})) AS chars
				FROM ${TRANSCRIPT_RECORDS_TABLE}
				WHERE organization_id IN {organizationIds:Array(String)}
					AND user_id IN {userIds:Array(String)}
					AND session_id IN {sessionIds:Array(String)}
					AND (organization_id, user_id, session_id, revision, parser_version) IN (
						SELECT organization_id, user_id, session_id, generation.1, generation.2
						FROM (
							SELECT organization_id, user_id, session_id, max((revision, parser_version)) AS generation
							FROM ${TRANSCRIPT_RECORDS_TABLE}
							WHERE organization_id IN {organizationIds:Array(String)}
								AND user_id IN {userIds:Array(String)}
								AND session_id IN {sessionIds:Array(String)}
								AND kind = 'receipt' AND agent_id = '' AND record_idx = {receiptRecordIdx:UInt32}
							GROUP BY organization_id, user_id, session_id
						)
					)
					AND record_idx < {receiptRecordIdx:UInt32} AND turn_idx >= 1
					AND kind IN {kinds:Array(String)} AND text_chars > 0
				GROUP BY organization_id, user_id, session_id`,
				query_params: {
					kinds: [...SEARCH_KINDS],
					organizationIds: unique(batch.map((row) => row.organization_id)),
					receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
					recordMaxChars: RECORD_SEARCH_MAX_CHARS,
					sessionIds: unique(batch.map((row) => row.session_id)),
					userIds: unique(batch.map((row) => row.user_id)),
				},
			}),
		);
		for (const row of found) chars.set(sessionKey(row), row.chars);
	}
	return chars;
}

function quotaMessage(
	workspaceId: string,
	usage: { used: number; limit: number; resetsAt: Date },
): string {
	return `Stopped: workspace ${workspaceId} has used its OpenAI quota (${usage.used} of ${usage.limit} tokens); it resets at ${usage.resetsAt.toISOString()}.`;
}

function tokensOfChars(chars: number): number {
	return Math.ceil((chars * CHUNK_OVERLAP_FACTOR) / 4);
}

/** Dollars, to a hundredth of a cent. */
function costOf(tokens: number): number {
	return (
		Math.round((tokens / 1_000_000) * USD_PER_MILLION_TOKENS * 10_000) / 10_000
	);
}

function sessionKey(row: {
	organization_id: string;
	user_id: string;
	session_id: string;
}): string {
	return JSON.stringify([row.organization_id, row.user_id, row.session_id]);
}

function cursorOf(row: CandidateRow): TranscriptSearchBackfillCursor {
	return {
		sessionDate: row.session_date,
		organizationId: row.organization_id,
		userId: row.user_id,
		sessionId: row.session_id,
	};
}

/** An opaque `--after` value: the last session a run went through, newest first. */
export function encodeTranscriptSearchBackfillCursor(
	cursor: TranscriptSearchBackfillCursor,
): string {
	return Buffer.from(
		JSON.stringify([
			cursor.sessionDate,
			cursor.organizationId,
			cursor.userId,
			cursor.sessionId,
		]),
	).toString("base64url");
}

export function decodeTranscriptSearchBackfillCursor(
	value: string,
): TranscriptSearchBackfillCursor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		parsed = undefined;
	}
	const tuple = z
		.tuple([
			z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/u),
			z.string().min(1),
			z.string().min(1),
			z.string().min(1),
		])
		.safeParse(parsed);
	if (!tuple.success)
		throw new Error("--after must be the `next` value a previous run printed.");
	const [sessionDate, organizationId, userId, sessionId] = tuple.data;
	return { sessionDate, organizationId, userId, sessionId };
}
