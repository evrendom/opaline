import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import {
	filterSessionTextFields,
	getUtf8ByteLength,
} from "@rudel/secret-filter";
import { createIngestFilterWorkerError } from "./ingest-filter.error.js";
import type {
	IngestFilterFields,
	IngestFilterResult,
	IngestFilterWorkerRequest,
	IngestFilterWorkerResponse,
} from "./ingest-filter.types.js";

declare const self: {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<IngestFilterWorkerRequest>) => void,
	): void;
	postMessage(message: IngestFilterWorkerResponse): void;
};

self.addEventListener(
	"message",
	(event: MessageEvent<IngestFilterWorkerRequest>) => {
		const response = filterIngestText(event.data);
		self.postMessage(response);
	},
);

function filterIngestText(
	request: IngestFilterWorkerRequest,
): IngestFilterWorkerResponse {
	try {
		return {
			status: "success",
			requestId: request.requestId,
			result: slimAndFilterSecrets(request.fields),
		};
	} catch (error) {
		return createIngestFilterWorkerError(request.requestId, error);
	}
}

/**
 * Every upload path (direct ingest, R2 commit and repair) filters here, so
 * every client, including CLIs that predate client-side slimming, stores
 * slimmed transcripts (image omission markers, deduplicated Codex command
 * output and compaction history). The CLI applies the same rules, so this is
 * a no-op on its uploads. Slimming runs first: secret filtering then never
 * scans removed bytes, and the redaction budget is measured against the text
 * that is stored, whichever client uploaded it. Each stream (main transcript,
 * each subagent) is slimmed on its own.
 */
function slimAndFilterSecrets(fields: IngestFilterFields): IngestFilterResult {
	const content = slimTranscriptText(fields.content);
	let filterInputBytes = getUtf8ByteLength(content);
	const subagents = fields.subagents?.map((subagent) => {
		const slimmed = slimTranscriptText(subagent.content);
		filterInputBytes += getUtf8ByteLength(slimmed);
		return { ...subagent, content: slimmed };
	});
	return {
		...filterSessionTextFields({ content, subagents }),
		filterInputBytes,
	};
}
