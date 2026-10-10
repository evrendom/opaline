import { getLogger } from "@logtape/logtape";
import { enqueueL1EdgeScope } from "./l1-edge-queue.service.js";

const logger = getLogger(["rudel", "api", "l1-edges"]);
/** Sessions are re-uploaded often; their rebuild waits for the uploads to settle. */
export const L1_EDGE_SESSION_DEBOUNCE_MS = 2 * 60_000;

interface QueuedSession {
	organizationId: string;
	userId: string;
	source: string;
	sessionId: string;
}

/**
 * Requests a rebuild of a session's edges after its evidence changed (git
 * observations are written after every transcript-records publication:
 * ingest, backfill and repair). Best effort: evidence is stored either way.
 * The run index is never queued here, so no upload waits on its queue row:
 * the worker queues it after building the session's edges, and the run index
 * census (`requeueStaleRunIndexScopes`) re-queues a session whose request was
 * lost or whose usage changed later.
 */
export async function enqueueSessionEdgesBestEffort(
	session: QueuedSession,
	/** 1 for backfills, so live uploads are built first. */
	options: { priority?: 0 | 1 } = {},
): Promise<void> {
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
			{ debounceMs: L1_EDGE_SESSION_DEBOUNCE_MS, priority: options.priority },
		);
	} catch (error) {
		logger.warn("Could not queue edges for session {sessionId}: {error}", {
			sessionId: session.sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
