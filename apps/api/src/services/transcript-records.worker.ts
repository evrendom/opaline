import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	type TranscriptRecordDraft,
} from "@rudel/api-routes/transcript-records";
import {
	estimateDraftMemoryBytes,
	type TranscriptRecordsSplitRequest,
	type TranscriptRecordsWorkerCommand,
	type TranscriptRecordsWorkerMessage,
} from "./transcript-records-stream.js";

declare const self: {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<TranscriptRecordsWorkerCommand>) => void,
	): void;
	postMessage(message: TranscriptRecordsWorkerMessage): void;
};

let releaseBatch: (() => void) | undefined;

self.addEventListener(
	"message",
	(event: MessageEvent<TranscriptRecordsWorkerCommand>) => {
		if (event.data.type === "ack") {
			releaseBatch?.();
			releaseBatch = undefined;
			return;
		}
		void splitAndStream(event.data.request);
	},
);

function waitForAcknowledgement(): Promise<void> {
	return new Promise((resolve) => {
		releaseBatch = resolve;
	});
}

async function splitAndStream(
	request: TranscriptRecordsSplitRequest,
): Promise<void> {
	try {
		const stats = createSplitStats();
		let batch: TranscriptRecordDraft[] = [];
		let batchBytes = 0;
		let rows = 0;
		const flush = async () => {
			if (batch.length === 0) return;
			self.postMessage({ drafts: batch, type: "batch" });
			batch = [];
			batchBytes = 0;
			await waitForAcknowledgement();
		};
		for (const draft of splitSessionTranscript(
			{
				content: request.content,
				sessionDate: request.sessionDate,
				source: request.source,
				subagents: request.subagents,
				textBudgetChars: request.textBudgetChars,
				textMaxChars: request.textMaxChars,
			},
			stats,
		)) {
			rows++;
			if (rows > request.maxRows) {
				throw new Error(
					`Transcript expands to more than ${request.maxRows} records`,
				);
			}
			batch.push(draft);
			batchBytes += estimateDraftMemoryBytes(draft);
			if (
				batch.length >= request.batchMaxRows ||
				batchBytes >= request.batchMaxBytes
			) {
				await flush();
			}
		}
		await flush();
		self.postMessage({ summary: summarizeSplit(stats), type: "done" });
	} catch (error) {
		self.postMessage({
			message:
				error instanceof Error ? error.message : "Transcript split failed",
			type: "error",
		});
	}
}
