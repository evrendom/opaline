import { encodedSessionDetailBodies } from "./session-detail-body-store.js";
import { deriveSessionDetail } from "./session-detail-derivation.service.js";
import type {
	SessionDetailDerivationWorkerRequest,
	SessionDetailDerivationWorkerResponse,
} from "./session-detail-derivation.types.js";

declare const self: {
	addEventListener(
		type: "message",
		listener: (
			event: MessageEvent<SessionDetailDerivationWorkerRequest>,
		) => void,
	): void;
	postMessage(
		message: SessionDetailDerivationWorkerResponse,
		transfer?: ArrayBuffer[],
	): void;
};

self.addEventListener(
	"message",
	(event: MessageEvent<SessionDetailDerivationWorkerRequest>) => {
		const { requestId, snapshot } = event.data;
		try {
			const {
				rawSubagents: _,
				turnBodies,
				...derivation
			} = deriveSessionDetail(snapshot);
			const bodies = encodedSessionDetailBodies(turnBodies);
			if (!bodies) throw new Error("Session detail bodies are not encoded");
			self.postMessage(
				{
					derivation: { ...derivation, turnBodies: bodies },
					requestId,
					status: "success",
				},
				[...bodies.values()].map((buffer) => buffer.buffer),
			);
		} catch (error) {
			self.postMessage({
				message:
					error instanceof Error
						? error.message
						: "Session detail derivation failed",
				requestId,
				status: "error",
			});
		}
	},
);
