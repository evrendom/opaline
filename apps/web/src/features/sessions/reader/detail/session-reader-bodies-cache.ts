import type {
	SessionDetailBodyChunks,
	SessionDetailWindow,
} from "@rudel/api-routes";
import type { QueryClient } from "@tanstack/react-query";
import {
	sessionDetailTurnQueryPrefix,
	sessionDetailWindowQueryPrefix,
} from "../../components/session-detail-fast-query";
import type { SessionReaderBody } from "../model/session-reader-model";

export function cachedBodies(
	queryClient: QueryClient,
	sessionId: string,
	revision: string,
): {
	bodies: Map<string, SessionReaderBody>;
	oversized: Map<string, SessionDetailBodyChunks | undefined>;
} {
	const bodies = new Map<string, SessionReaderBody>();
	const oversized = new Map<string, SessionDetailBodyChunks | undefined>();
	const windows = queryClient.getQueriesData<SessionDetailWindow>({
		queryKey: sessionDetailWindowQueryPrefix(sessionId),
	});
	for (const [, window] of windows) {
		if (!window || window.revision !== revision) continue;
		for (const turn of window.turns) {
			if (turn.body) bodies.set(turn.turnId, turn.body);
			else if (turn.bodyOmitted === "oversized")
				oversized.set(
					turn.turnId,
					turn.bodyChunks ?? oversized.get(turn.turnId),
				);
		}
	}
	const turns = queryClient.getQueriesData<SessionReaderBody>({
		queryKey: sessionDetailTurnQueryPrefix({ revision, sessionId }),
	});
	for (const [key, turn] of turns) {
		const turnId = key.at(-1);
		if (!turn || typeof turnId !== "string") continue;
		bodies.set(turnId, {
			responseItems: turn.responseItems,
			userItems: turn.userItems,
		});
	}
	return { bodies, oversized };
}
