import { createHash } from "node:crypto";

/**
 * Transcript text cut into chunks for search (docs/retro-architecture.md,
 * "Additions to the data stack"). Chunks are cut the same way every time, so
 * the same text (a file read 30 times, a prompt pasted again) is the same
 * chunk with the same hash and is stored and embedded once per member; every
 * place it appeared is a hit that names its run.
 */

/** Longest chunk: about 300 to 600 tokens, well inside the embedding model's input. */
export const CHUNK_MAX_CHARS = 1_200;
/**
 * Each chunk after the first repeats the last this many characters before
 * its cut, separators included, so any string up to this long is whole in
 * some chunk and found by exact search wherever the cuts fall.
 */
export const CHUNK_OVERLAP_CHARS = 200;
/** Shorter text ("ok", "y") says nothing to search for. */
const CHUNK_MIN_CHARS = 3;
/** A cut at a line end is preferred when it keeps at least this share of the chunk. */
const LINE_CUT_MIN_SHARE = 0.5;

/** One record's (or content block's) text, after the secret filter, as transcript records store it. */
export interface RecordText {
	readonly agentId: string;
	readonly recordIdx: number;
	readonly blockIdx: number;
	readonly turnIdx: number;
	readonly kind: string;
	readonly toolName: string;
	readonly ts: string;
	readonly text: string;
}

/** Where a chunk appeared: its record, its place in the record's text and its run. */
export interface ChunkHit {
	readonly agentId: string;
	readonly recordIdx: number;
	readonly blockIdx: number;
	readonly chunkIdx: number;
	readonly turnIdx: number;
	readonly kind: string;
	readonly toolName: string;
	readonly ts: string;
	readonly hash: string;
}

/** The distinct chunks by hash, and a hit for every place one appeared. */
export function chunkRecords(records: readonly RecordText[]): {
	chunks: Map<string, string>;
	hits: ChunkHit[];
} {
	const chunks = new Map<string, string>();
	const hits: ChunkHit[] = [];
	for (const record of records)
		splitText(record.text).forEach((text, chunkIdx) => {
			const hash = chunkHash(text);
			chunks.set(hash, text);
			hits.push({
				agentId: record.agentId,
				recordIdx: record.recordIdx,
				blockIdx: record.blockIdx,
				chunkIdx,
				turnIdx: record.turnIdx,
				kind: record.kind,
				toolName: record.toolName,
				ts: record.ts,
				hash,
			});
		});
	return { chunks, hits };
}

/**
 * The vector as signed 8-bit integers, scaled so its largest component is
 * ±127. Cosine similarity does not depend on the scale, so none is stored.
 */
export function quantizeVector(vector: readonly number[]): number[] {
	const largest = vector.reduce(
		(max, value) => Math.max(max, Math.abs(value)),
		0,
	);
	if (largest === 0) return vector.map(() => 0);
	return vector.map((value) => Math.round((value / largest) * 127));
}

/** 128 bits of SHA-256 of the exact text, as hex. */
function chunkHash(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Pieces of at most `CHUNK_MAX_CHARS`, cut at the last line end in the window
 * when that keeps at least half of it, else at the window's end; each piece
 * after the first starts `CHUNK_OVERLAP_CHARS` before the previous cut.
 * Pieces are trimmed; blank and near-empty ones are dropped.
 */
function splitText(text: string): string[] {
	const pieces: string[] = [];
	let rest = text.trim();
	while (rest.length > 0) {
		if (rest.length <= CHUNK_MAX_CHARS) {
			if (rest.length >= CHUNK_MIN_CHARS) pieces.push(rest.trimEnd());
			break;
		}
		const lineEnd = rest.lastIndexOf("\n", CHUNK_MAX_CHARS);
		const cut =
			lineEnd >= CHUNK_MAX_CHARS * LINE_CUT_MIN_SHARE
				? lineEnd
				: CHUNK_MAX_CHARS;
		const piece = rest.slice(0, cut).trim();
		if (piece.length >= CHUNK_MIN_CHARS) pieces.push(piece);
		rest = rest.slice(cut - CHUNK_OVERLAP_CHARS).trimStart();
	}
	return pieces;
}
