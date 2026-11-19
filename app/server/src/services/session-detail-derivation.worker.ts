import { encodedSessionDetailBodies } from "./session-detail-body-store.js";
import {
	deriveSessionDetail,
	type SessionDetailRawSnapshot,
} from "./session-detail-derivation.service.js";
import type {
	LoadedSessionDetailSnapshot,
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
		void respond(event.data);
	},
);

async function respond(
	request: SessionDetailDerivationWorkerRequest,
): Promise<void> {
	const { requestId } = request;
	try {
		let snapshot: SessionDetailRawSnapshot;
		let loaded: LoadedSessionDetailSnapshot | undefined;
		if ("load" in request) {
			const { getSessionDetailRawSnapshot } = await import(
				"./session-detail-snapshot.service.js"
			);
			const read = await getSessionDetailRawSnapshot(
				request.load.organizationId,
				request.load.sessionId,
				request.load.ownerId,
				{
					revision: request.load.revision,
					source: request.load.source === "codex" ? "codex" : "claude_code",
				},
			);
			if (!read) {
				self.postMessage({ requestId, status: "missing" });
				return;
			}
			snapshot = read;
			loaded = {
				revision: read.revision,
				source: read.source,
				rawBytes:
					Buffer.byteLength(read.content, "utf8") +
					Object.values(read.subagents).reduce(
						(total, content) => total + Buffer.byteLength(content, "utf8"),
						0,
					),
				subagents: read.subagents,
			};
		} else snapshot = request.snapshot;
		const derived = deriveSessionDetail(snapshot);
		if (
			loaded &&
			"load" in request &&
			loaded.revision === request.load.revision &&
			loaded.source === request.load.source
		) {
			const { writeStoredSessionDetail } = await import(
				"./session-detail-store.js"
			);
			await writeStoredSessionDetail(request.load, derived);
		}
		const { rawSubagents: _, turnBodies, ...derivation } = derived;
		const bodies = encodedSessionDetailBodies(turnBodies);
		if (!bodies) throw new Error("Session detail bodies are not encoded");
		self.postMessage(
			{
				derivation: { ...derivation, turnBodies: bodies },
				requestId,
				status: "success",
				...(loaded ? { loaded } : {}),
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
}
