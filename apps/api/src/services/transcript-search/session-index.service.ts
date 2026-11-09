import { getLogger } from "@logtape/logtape";
import { SEARCH_KINDS, SEARCH_RECORD_TEXT_MAX_CHARS } from "@rudel/api-routes";
import {
	countCodePoints,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { filterKnownSecrets } from "@rudel/secret-filter";
import { z } from "zod";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
import {
	type GenerationRetirement,
	type GenerationRetirementOptions,
	retireGenerationsBelowNewestReceipt,
} from "../generation-retirement.js";
import { createTranscriptRecordsDeadline } from "../transcript-records-deadline.js";
import type { TranscriptRecordsIdentity } from "../transcript-records-ingest.service.js";
import { chunkRecords, quantizeVector, type RecordText } from "./chunks.js";
import { estimateEmbeddingTokens, type TranscriptEmbedder } from "./config.js";
import type { EmbeddingQuota } from "./quota.js";
import {
	TRANSCRIPT_CHUNK_HITS_TABLE,
	TRANSCRIPT_CHUNKS_TABLE,
} from "./tables.js";

/**
 * Makes a session's transcript searchable (docs/retro-architecture.md,
 * "Additions to the data stack"): the text of its committed transcript
 * records generation, through the secret filter again, is cut into chunks,
 * each distinct chunk is stored once per member and month and embedded once
 * per member, and every
 * place a chunk appeared is a hit naming its run. A receipt closes the
 * generation and says how many of its chunks still have no vector.
 *
 * Embedding stops, and the chunks stay searchable by exact string only, when
 * the workspace has used its OpenAI quota, when the embedder is off, or when
 * the pass runs out of time or chunks; the next upload of the session goes on
 * from there. Every write is fenced by the account and workspace purge.
 */

export const TRANSCRIPT_SEARCH_LIMITS = {
	/** The whole pass, reads and writes included. */
	passMs: 30_000,
	/** No embedding batch starts after this much of the pass. */
	embeddingMs: 12_000,
	/** Chunks embedded per pass; the rest wait for the session's next upload. */
	embedChunks: 3_000,
	/** Texts per OpenAI request (well under its 2,048 inputs and 300k tokens). */
	batchSize: 64,
	/** Hashes per lookup statement, inside ClickHouse's parameter size. */
	lookupHashes: 2_000,
	/** Hits per insert. */
	insertRows: 5_000,
	pageRecords: 256,
	pageMs: 0,
} as const;

const SCAN_SETTINGS = {
	max_execution_time: 20,
	timeout_before_checking_execution_speed: 0,
	max_rows_to_read: "5000000",
	max_bytes_to_read: String(512 * 1024 * 1024),
	max_result_bytes: String(96 * 1024 * 1024),
	result_overflow_mode: "throw",
	remote_filesystem_read_prefetch: 0,
} as const;

const logger = getLogger(["rudel", "api", "transcript-search"]);
let activeJobs = 0;

export interface SessionIndexInput extends TranscriptRecordsIdentity {
	/** Deletion fence; see `assertNoClickHousePurgeTombstone`. */
	readonly assertWritable: () => Promise<void>;
	readonly signal?: AbortSignal;
}

export interface SessionIndexEnv {
	readonly executor: ClickHouseExecutor;
	/** Null when the workspace's text is chunked but not embedded. */
	readonly embedder: TranscriptEmbedder | null;
	readonly quota: EmbeddingQuota;
	readonly now?: () => Date;
	readonly limits?: Partial<
		Record<keyof typeof TRANSCRIPT_SEARCH_LIMITS, number>
	>;
}

export type SessionIndexOutcome =
	| { readonly status: "skipped"; readonly reason: string }
	| { readonly status: "current" }
	| {
			readonly status: "written";
			readonly chunks: number;
			readonly hits: number;
			/** Chunks embedded by this pass. */
			readonly embedded: number;
			/** Chunks of the generation still without a vector. */
			readonly pending: number;
			/** Records searched by their stored prefix and tail only: their middle was not kept. */
			readonly truncated: number;
			/** Why embedding stopped short, if it did. */
			readonly stopped: "quota" | "no_embedder" | "limit" | "error" | null;
	  };

const GenerationSchema = z.object({
	revision_text: z.string(),
	parser_version: z.coerce.number(),
});
const ReceiptSchema = GenerationSchema.extend({
	pending_chunks: z.coerce.number(),
});
const RecordRowSchema = z.object({
	agent_id: z.string(),
	record_idx: z.coerce.number(),
	block_idx: z.coerce.number(),
	turn_idx: z.coerce.number(),
	kind: z.string(),
	tool_name: z.string(),
	ts: z.string(),
	text: z.string(),
	head: z.string(),
	tail: z.string(),
	text_chars: z.coerce.number(),
});
const KnownChunkSchema = z.object({
	chunk_hash: z.string(),
	months: z.array(z.string()),
	embedded_months: z.array(z.string()),
	vector: z.array(z.coerce.number()),
	vector_model: z.string(),
});

/**
 * Indexes the session best effort, never failing the upload: at most two
 * passes run per process, and a failure is logged and left to the next
 * upload of the session.
 */
export async function indexSessionTextBestEffort(
	input: SessionIndexInput,
	env: SessionIndexEnv,
): Promise<SessionIndexOutcome | { status: "failed" }> {
	if (activeJobs >= 2) {
		logger.warn(
			"Transcript search indexing admission full; the next upload retries (session_id={sessionId})",
			{ sessionId: input.sessionId },
		);
		return { status: "skipped", reason: "admission" };
	}
	activeJobs++;
	try {
		return await indexSessionText(input, env);
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError)
			return { status: "skipped", reason: "fenced" };
		logger.warn(
			"Transcript search indexing failed; upload remains accepted (session_id={sessionId} error={error})",
			{
				sessionId: input.sessionId,
				error: filterKnownSecrets(
					error instanceof Error ? error.message : "Indexing failed",
				).text.slice(0, 512),
			},
		);
		return { status: "failed" };
	} finally {
		activeJobs--;
	}
}

/** One pass over the session's committed generation; throws on failure. */
export async function indexSessionText(
	input: SessionIndexInput,
	env: SessionIndexEnv,
): Promise<SessionIndexOutcome> {
	const limits = { ...TRANSCRIPT_SEARCH_LIMITS, ...env.limits };
	const now = env.now ?? (() => new Date());
	const startedAt = Date.now();
	let deadlineAt = startedAt + limits.passMs;
	let deadline = passDeadline(deadlineAt, input.signal);
	const identity = {
		organizationId: input.organizationId,
		userId: input.userId,
		source: input.source,
		sessionId: input.sessionId,
	};
	const read = async <TRow>(
		schema: z.ZodType<TRow, unknown>,
		query: string,
		params: Record<string, unknown> = {},
	): Promise<TRow[]> =>
		z.array(schema).parse(
			await deadline.wait(() =>
				env.executor.query<unknown>({
					abortSignal: deadline.signal,
					clickhouse_settings: SCAN_SETTINGS,
					query,
					query_params: { ...identity, ...params },
				}),
			),
		);
	const write = async (table: string, values: object[]) => {
		await deadline.wait(input.assertWritable);
		await deadline.wait(() =>
			env.executor.insert({
				abortSignal: deadline.signal,
				asyncInsert: false,
				deduplicationToken: `transcript-search:${crypto.randomUUID()}`,
				table,
				values,
			}),
		);
	};
	try {
		const [generation] = await read(
			GenerationSchema,
			`SELECT toString(revision) AS revision_text, parser_version FROM rudel.transcript_records
			WHERE ${SESSION_FILTER} AND kind = 'receipt'
			ORDER BY revision DESC, parser_version DESC LIMIT 1`,
		);
		if (!generation)
			return { status: "skipped", reason: "no transcript records" };
		const [receipt] = await read(
			ReceiptSchema,
			`SELECT toString(revision) AS revision_text, parser_version, pending_chunks
			FROM ${TRANSCRIPT_CHUNK_HITS_TABLE} FINAL
			WHERE ${SESSION_FILTER} AND agent_id = '' AND record_idx = ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}
			ORDER BY revision DESC, parser_version DESC LIMIT 1`,
		);
		const sameGeneration =
			receipt !== undefined &&
			receipt.revision_text === generation.revision_text &&
			receipt.parser_version === generation.parser_version;
		// The same generation is done when nothing waits for a vector, or nothing
		// can be embedded now (no embedder, or the quota is used up).
		if (
			receipt &&
			sameGeneration &&
			(receipt.pending_chunks === 0 ||
				env.embedder === null ||
				(await quotaUsedUp(env.quota, input.organizationId, deadline.wait)))
		)
			return { status: "current" };

		const writtenAt = now().toISOString().replace("T", " ").replace("Z", "");
		const base = {
			organization_id: input.organizationId,
			user_id: input.userId,
			source: input.source,
			session_id: input.sessionId,
			revision: generation.revision_text,
			parser_version: generation.parser_version,
			written_at: writtenAt,
		};
		const stored = new Map<string, StoredChunk>();
		const embedding = createChunkEmbedding({
			embedder: env.embedder,
			quota: env.quota,
			workspaceId: input.organizationId,
			maxChunks: limits.embedChunks,
			batchSize: limits.batchSize,
			stopAt: startedAt + limits.embeddingMs,
			wait: (operation) => deadline.wait(operation),
			signal: () => deadline.signal,
		});
		let truncated = 0;
		let unembedded = 0;
		let hitCount = 0;
		let after: z.infer<typeof RecordRowSchema> | undefined;
		for (let page = 0; ; page++) {
			if (page > 0 && limits.pageMs > 0) {
				deadline.dispose();
				deadlineAt += limits.pageMs;
				deadline = passDeadline(deadlineAt, input.signal);
			}
			const rows = await read(
				RecordRowSchema,
				`SELECT agent_id, record_idx, block_idx, turn_idx, kind, tool_name,
					toString(ts) AS ts, substringUTF8(text, 1, {searchChars:UInt32}) AS text, head, tail, text_chars
				FROM rudel.transcript_records FINAL
				WHERE ${SESSION_FILTER} AND revision = {revision:UInt64} AND parser_version = {parserVersion:UInt16}
					AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX} AND turn_idx >= 1
					AND kind IN {kinds:Array(String)} AND (text != '' OR head != '')${after ? AFTER_RECORD_FILTER : ""}
				ORDER BY agent_id, record_idx, block_idx
				LIMIT {pageRecords:UInt32}`,
				{
					revision: generation.revision_text,
					parserVersion: generation.parser_version,
					kinds: [...SEARCH_KINDS],
					searchChars: SEARCH_RECORD_TEXT_MAX_CHARS,
					pageRecords: limits.pageRecords,
					...(after && {
						afterAgentId: after.agent_id,
						afterRecordIdx: after.record_idx,
						afterBlockIdx: after.block_idx,
					}),
				},
			);
			if (rows.length === 0) break;
			after = rows.at(-1);
			const records: RecordText[] = rows.flatMap((row) => {
				const searchable = searchableText(row);
				if (searchable === null) return [];
				if (searchable.truncated) truncated++;
				return [
					{
						agentId: row.agent_id,
						recordIdx: row.record_idx,
						blockIdx: row.block_idx,
						turnIdx: row.turn_idx,
						kind: row.kind,
						toolName: row.tool_name,
						ts: row.ts,
						text: searchable.text,
					},
				];
			});
			const { chunks, hits } = chunkRecords(records);
			hitCount += hits.length;

			const months = new Map<string, Set<string>>();
			for (const hit of hits)
				months.set(
					hit.hash,
					(months.get(hit.hash) ?? new Set()).add(monthOf(hit.ts)),
				);
			// What the member's sessions already hold of these chunks: the months
			// stored, those with a vector, and a vector to copy to another month.
			const lookup = [...chunks.keys()].filter((hash) => {
				const chunk = stored.get(hash);
				if (!chunk) return true;
				return (
					chunk.vector &&
					!embedding.vectors.has(hash) &&
					[...(months.get(hash) ?? [])].some(
						(month) => !chunk.embeddedMonths.has(month),
					)
				);
			});
			const known = new Map<string, z.infer<typeof KnownChunkSchema>>();
			for (let start = 0; start < lookup.length; start += limits.lookupHashes)
				for (const row of await read(
					KnownChunkSchema,
					`SELECT chunk_hash, groupUniqArray(toString(month)) AS months,
						groupUniqArrayIf(toString(month), notEmpty(embedding)) AS embedded_months,
						argMaxIf(embedding, embedded_at, notEmpty(embedding)) AS vector,
						argMaxIf(model, embedded_at, notEmpty(embedding)) AS vector_model
					FROM ${TRANSCRIPT_CHUNKS_TABLE}
					WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
						AND chunk_hash IN {hashes:Array(String)}
					GROUP BY chunk_hash`,
					{ hashes: lookup.slice(start, start + limits.lookupHashes) },
				))
					known.set(row.chunk_hash, row);

			const fresh: string[] = [];
			for (const hash of chunks.keys()) {
				if (stored.has(hash)) continue;
				const row = known.get(hash);
				stored.set(hash, {
					months: new Set(row?.months),
					embeddedMonths: new Set(row?.embedded_months),
					vector: (row?.embedded_months.length ?? 0) > 0,
				});
				if ((row?.embedded_months.length ?? 0) === 0) fresh.push(hash);
			}
			unembedded += fresh.length;
			await embedding.embed(
				fresh.map((hash) => ({ hash, text: chunks.get(hash) ?? "" })),
			);

			const chunkRows = [...chunks.keys()].flatMap((hash) => {
				const chunk = stored.get(hash);
				if (!chunk) return [];
				const looked = known.get(hash);
				const made = embedding.vectors.get(hash);
				const vector =
					made ?? (looked?.vector.length ? looked.vector : undefined);
				const model = made
					? (env.embedder?.model ?? "")
					: vector
						? (looked?.vector_model ?? "")
						: "";
				return [...(months.get(hash) ?? [])]
					.filter((month) =>
						vector
							? !chunk.embeddedMonths.has(month)
							: !chunk.months.has(month),
					)
					.map((month) => {
						chunk.months.add(month);
						if (vector) chunk.embeddedMonths.add(month);
						return {
							organization_id: input.organizationId,
							user_id: input.userId,
							month,
							chunk_hash: hash,
							text: chunks.get(hash) ?? "",
							embedding: vector ?? [],
							model,
							embedded_at: vector ? writtenAt : "1970-01-01 00:00:00.000",
						};
					});
			});
			for (let start = 0; start < chunkRows.length; start += limits.insertRows)
				await write(
					TRANSCRIPT_CHUNKS_TABLE,
					chunkRows.slice(start, start + limits.insertRows),
				);

			// A later pass over the same generation adds vectors only: its hits are stored.
			if (!sameGeneration) {
				const hitRows = hits.map((hit) => ({
					...base,
					agent_id: hit.agentId,
					record_idx: hit.recordIdx,
					block_idx: hit.blockIdx,
					chunk_idx: hit.chunkIdx,
					turn_idx: hit.turnIdx,
					kind: hit.kind,
					tool_name: hit.toolName,
					ts: hit.ts,
					chunk_hash: hit.hash,
					pending_chunks: 0,
					truncated_records: 0,
				}));
				for (let start = 0; start < hitRows.length; start += limits.insertRows)
					await write(
						TRANSCRIPT_CHUNK_HITS_TABLE,
						hitRows.slice(start, start + limits.insertRows),
					);
			}
			if (rows.length < limits.pageRecords) break;
		}

		const pending = unembedded - embedding.vectors.size;
		await write(TRANSCRIPT_CHUNK_HITS_TABLE, [
			{
				...base,
				agent_id: "",
				record_idx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
				block_idx: 0,
				chunk_idx: 0,
				turn_idx: 0,
				kind: "receipt",
				tool_name: "",
				ts: writtenAt,
				chunk_hash: "",
				pending_chunks: pending,
				truncated_records: truncated,
			},
		]);
		if (embedding.stopped === "quota")
			logger.info(
				"Transcript search: the workspace used its OpenAI quota; {pending} chunks wait without a vector (organization_id={organizationId} session_id={sessionId})",
				{
					pending,
					organizationId: input.organizationId,
					sessionId: input.sessionId,
				},
			);
		return {
			status: "written",
			chunks: stored.size,
			hits: hitCount,
			embedded: embedding.vectors.size,
			pending,
			truncated,
			stopped: pending > 0 ? embedding.stopped : null,
		};
	} catch (error) {
		// A purge began during the pass: remove the session's hits now; the
		// purge's follow-up pass removes any chunk written meanwhile.
		if (error instanceof ClickHouseWriteFencedError)
			await env.executor.execute({
				clickhouse_settings: {
					...SCAN_SETTINGS,
					lightweight_deletes_sync: "3",
				},
				query: `DELETE FROM ${TRANSCRIPT_CHUNK_HITS_TABLE} WHERE ${SESSION_FILTER}`,
				query_params: identity,
			});
		throw error;
	} finally {
		deadline.dispose();
	}
}

interface StoredChunk {
	readonly months: Set<string>;
	readonly embeddedMonths: Set<string>;
	readonly vector: boolean;
}

const AFTER_RECORD_FILTER = `
					AND (agent_id > {afterAgentId:String}
						OR (agent_id = {afterAgentId:String} AND (record_idx > {afterRecordIdx:UInt32}
							OR (record_idx = {afterRecordIdx:UInt32} AND block_idx > {afterBlockIdx:UInt16}))))`;

function passDeadline(deadlineAt: number, signal: AbortSignal | undefined) {
	return createTranscriptRecordsDeadline({ deadlineAt, now: Date.now, signal });
}

export function retireOlderTranscriptChunkHits(
	executor: ClickHouseExecutor,
	options: GenerationRetirementOptions = {},
): Promise<GenerationRetirement> {
	return retireGenerationsBelowNewestReceipt(
		executor,
		TRANSCRIPT_CHUNK_HITS_TABLE,
		options,
	);
}

async function quotaUsedUp(
	quota: EmbeddingQuota,
	workspaceId: string,
	wait: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>,
): Promise<boolean> {
	const usage = await wait(() => quota.usage(workspaceId));
	return usage.used >= usage.limit;
}

/**
 * A record's text as search reads it: all of it where transcript records
 * kept it, else the kept prefix (or head) and the tail, flagged as truncated.
 * It goes through the secret filter again: the upload was filtered as
 * serialized JSON, where an escaped credential can slip past, and records
 * hold the decoded text. Null when the filter cannot settle on a result: the
 * record is left out rather than risked.
 */
function searchableText(
	row: z.infer<typeof RecordRowSchema>,
): { text: string; truncated: boolean } | null {
	const prefix = row.text !== "" ? row.text : row.head;
	const prefixChars = countCodePoints(prefix);
	const truncated = row.text_chars > prefixChars;
	const tail =
		truncated && row.tail !== "" && !prefix.endsWith(row.tail) ? row.tail : "";
	const kept = tail === "" ? prefix : `${prefix}\n…\n${tail}`;
	try {
		return {
			text: filterKnownSecrets(kept).text,
			truncated: row.text_chars > prefixChars + countCodePoints(tail),
		};
	} catch {
		return null;
	}
}

/** The first day of the month of a ClickHouse UTC time ("2026-10-12 …" → "2026-10-01"). */
function monthOf(ts: string): string {
	return `${ts.slice(0, 7)}-01`;
}

const SESSION_FILTER =
	"organization_id = {organizationId:String} AND user_id = {userId:String} AND source = {source:String} AND session_id = {sessionId:String}";

/**
 * Vectors for as many chunks as the quota, the chunk cap and the time allow,
 * in order, charging the tokens of each batch to the workspace.
 */
function createChunkEmbedding(options: {
	embedder: TranscriptEmbedder | null;
	quota: EmbeddingQuota;
	workspaceId: string;
	maxChunks: number;
	batchSize: number;
	stopAt: number;
	wait: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
	signal: () => AbortSignal;
}) {
	const vectors = new Map<string, number[]>();
	let stopped: "quota" | "no_embedder" | "limit" | "error" | null = null;
	let usage: { used: number; limit: number } | undefined;
	let sent = 0;
	const embed = async (
		pending: readonly { hash: string; text: string }[],
	): Promise<void> => {
		if (pending.length === 0 || stopped) return;
		const { embedder } = options;
		if (!embedder) {
			stopped = "no_embedder";
			return;
		}
		usage ??= {
			...(await options.wait(() => options.quota.usage(options.workspaceId))),
		};
		for (let start = 0; start < pending.length; ) {
			if (usage.used >= usage.limit) {
				stopped = "quota";
				return;
			}
			if (sent >= options.maxChunks || Date.now() >= options.stopAt) {
				stopped = "limit";
				return;
			}
			const batch = pending.slice(
				start,
				start + Math.min(options.batchSize, options.maxChunks - sent),
			);
			start += batch.length;
			sent += batch.length;
			const texts = batch.map((chunk) => chunk.text);
			let result: { vectors: number[][]; tokens: number };
			try {
				result = await options.wait(() =>
					embedder.embed(texts, options.signal()),
				);
			} catch (error) {
				// Out of time or cancelled: nothing more can be written, and OpenAI
				// may bill the abandoned request, so it is charged as estimated. An
				// OpenAI failure stops embedding only; the chunks are still stored.
				if (options.signal().aborted) {
					await options.quota
						.charge(options.workspaceId, estimateEmbeddingTokens(texts))
						.catch(() => {});
					throw error;
				}
				logger.warn("Transcript search embedding failed: {error}", {
					error: filterKnownSecrets(
						error instanceof Error ? error.message : "Embedding failed",
					).text.slice(0, 512),
				});
				stopped = "error";
				return;
			}
			const tokens =
				result.tokens > 0 ? result.tokens : estimateEmbeddingTokens(texts);
			await options.wait(() =>
				options.quota.charge(options.workspaceId, tokens),
			);
			usage.used += tokens;
			batch.forEach((chunk, index) => {
				const vector = result.vectors[index];
				if (vector) vectors.set(chunk.hash, quantizeVector(vector));
			});
		}
	};
	return {
		vectors,
		embed,
		get stopped() {
			return stopped;
		},
	};
}
