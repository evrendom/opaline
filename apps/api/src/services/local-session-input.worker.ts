import { lowerWorkerThreadPriority } from "../lib/background-work.js";
import { prepareLocalSession } from "../selfhost/local-ingest/prepare.js";
import type {
	LocalSessionInputRequest,
	LocalSessionInputWorkerResponse,
} from "./local-session-input.types.js";

void lowerWorkerThreadPriority();

declare const self: {
	addEventListener(
		type: "message",
		listener: (
			event: MessageEvent<{
				readonly requestId: number;
				readonly request: LocalSessionInputRequest;
			}>,
		) => void,
	): void;
	postMessage(
		message: LocalSessionInputWorkerResponse,
		transfer?: ArrayBuffer[],
	): void;
};

self.addEventListener("message", (event) => {
	const { requestId, request } = event.data;
	void (async () => {
		try {
			const prepared = await prepareLocalSession(request);
			self.postMessage(
				{ requestId, status: "ok", prepared },
				prepared.kind === "skipped"
					? []
					: prepared.images.map((image) => image.bytes.buffer as ArrayBuffer),
			);
		} catch (error) {
			self.postMessage({
				requestId,
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	})();
});
