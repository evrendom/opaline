import type {
	TranscriptRecordDraft,
	TranscriptSource,
	TranscriptSplitSummary,
} from "@rudel/api-routes/transcript-records";

/**
 * Wire protocol between the API process and the transcript-records worker.
 *
 * The worker splits one session and hands the drafts over in bounded batches.
 * It sends the next batch only after the API acknowledged the previous one, so
 * the API never holds more than one batch beyond the rows it is inserting and
 * the worker never races ahead of ClickHouse.
 */

export interface TranscriptRecordsSplitRequest {
	/** Bytes of draft memory per batch (see `estimateDraftMemoryBytes`). */
	readonly batchMaxBytes: number;
	readonly batchMaxRows: number;
	readonly content: string;
	/** Hard cap on drafts for one session; exceeding it fails the split. */
	readonly maxRows: number;
	readonly sessionDate: string;
	readonly source: TranscriptSource;
	readonly subagents: Readonly<Record<string, string>>;
	readonly textBudgetChars: number;
	readonly textMaxChars: number;
}

export type TranscriptRecordsWorkerCommand =
	| { readonly request: TranscriptRecordsSplitRequest; readonly type: "start" }
	| { readonly type: "ack" };

export type TranscriptRecordsWorkerMessage =
	| {
			readonly drafts: readonly TranscriptRecordDraft[];
			readonly type: "batch";
	  }
	| { readonly summary: TranscriptSplitSummary; readonly type: "done" }
	| { readonly message: string; readonly type: "error" };

/**
 * Heap cost of one draft. Strings are UTF-16 in memory, and the fixed part
 * covers the object, its numeric fields, and the short identifier strings, so
 * a record of bookkeeping with no text still counts.
 */
export function estimateDraftMemoryBytes(draft: TranscriptRecordDraft): number {
	const characters =
		draft.head.length +
		draft.tail.length +
		draft.text.length +
		draft.filePath.length +
		draft.callId.length +
		draft.toolName.length +
		draft.subtype.length;
	return characters * 2 + 400;
}
