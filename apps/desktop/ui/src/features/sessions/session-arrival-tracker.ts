import type { SessionArrival } from "@rudel/api-routes";

// Keep identities for the lifetime of the workspace subscription, including
// sessions that disappear and later return after a retry or re-upload.
export function collectNewSessionArrivals(
	seen: ReadonlySet<string>,
	sessions: readonly SessionArrival[],
) {
	const nextSeen = new Set(seen);
	const arrivals: SessionArrival[] = [];
	for (const session of sessions) {
		if (nextSeen.has(session.sessionId)) continue;
		nextSeen.add(session.sessionId);
		arrivals.push(session);
	}
	return { seen: nextSeen, arrivals };
}
