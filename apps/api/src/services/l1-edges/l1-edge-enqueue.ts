import { getLogger } from "@logtape/logtape";
import { enqueueL1EdgeScope } from "./l1-edge-queue.service.js";

const logger = getLogger(["rudel", "api", "l1-edges"]);
/** Sessions are re-uploaded often; their rebuild waits for the uploads to settle. */
export const L1_EDGE_SESSION_DEBOUNCE_MS = 2 * 60_000;

/**
 * Requests a rebuild of a session's edges after its evidence changed. Best
 * effort: evidence is stored either way, and the daily census re-queues a
 * session whose request was lost.
 */
export async function enqueueSessionEdgesBestEffort(session: {
	organizationId: string;
	userId: string;
	source: string;
	sessionId: string;
}): Promise<void> {
	if (
		process.env.L1_EDGES_ENQUEUE_ENABLED === "false" ||
		!process.env.PG_CONNECTION_STRING
	)
		return;
	try {
		const { sqlClient } = await import("../../db.js");
		await enqueueL1EdgeScope(
			sqlClient,
			{ kind: "session", ...session },
			{ debounceMs: L1_EDGE_SESSION_DEBOUNCE_MS },
		);
	} catch (error) {
		logger.warn("Could not queue edges for session {sessionId}: {error}", {
			sessionId: session.sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
