import { isRecord } from "./line-items.js";

/**
 * Stored in the `head` of the per-revision receipt row. A revision is
 * searchable only when its receipt exists, so a crash mid-extraction leaves an
 * incomplete revision that the next ingest or backfill repairs.
 */
export interface TranscriptRecordsReceipt {
	/** Hash of the raw transcript content the rows were derived from. */
	readonly contentSha256: string;
	readonly lineCount: number;
	readonly oversizedLineCount: number;
	readonly parserVersion: number;
	/**
	 * ISO time the generation was published. Retirement of a superseded
	 * generation is measured from the publication that superseded it.
	 */
	readonly publishedAt: string;
	/** Rows written for the revision, excluding the receipt itself. */
	readonly rowCount: number;
	readonly streamCount: number;
	readonly textTruncated: boolean;
	readonly unparseableLineCount: number;
}

export function encodeTranscriptRecordsReceipt(
	receipt: TranscriptRecordsReceipt,
): string {
	return JSON.stringify(receipt);
}

export function decodeTranscriptRecordsReceipt(
	value: string,
): TranscriptRecordsReceipt | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	const {
		contentSha256,
		lineCount,
		oversizedLineCount,
		parserVersion,
		publishedAt,
		rowCount,
		streamCount,
		textTruncated,
		unparseableLineCount,
	} = parsed;
	if (
		typeof contentSha256 !== "string" ||
		typeof lineCount !== "number" ||
		typeof oversizedLineCount !== "number" ||
		typeof parserVersion !== "number" ||
		typeof publishedAt !== "string" ||
		typeof rowCount !== "number" ||
		typeof streamCount !== "number" ||
		typeof textTruncated !== "boolean" ||
		typeof unparseableLineCount !== "number"
	) {
		return undefined;
	}
	return {
		contentSha256,
		lineCount,
		oversizedLineCount,
		parserVersion,
		publishedAt,
		rowCount,
		streamCount,
		textTruncated,
		unparseableLineCount,
	};
}
