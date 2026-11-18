import { lowerWorkerThreadPriority } from "../lib/background-work.js";
import { slimAndFilterSecrets } from "./ingest-filter.core.js";
import { createIngestFilterWorkerError } from "./ingest-filter.error.js";
import type {
	IngestFilterWorkerRequest,
	IngestFilterWorkerResponse,
} from "./ingest-filter.types.js";

void lowerWorkerThreadPriority();

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
