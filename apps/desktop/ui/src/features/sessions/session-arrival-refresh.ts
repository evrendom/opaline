import type { QueryKey } from "@tanstack/react-query";

export const SESSION_ARRIVAL_REFRESH_DELAY_MS = 2_000;

export type SessionArrivalChange = {
	sessionIds: ReadonlySet<string>;
	lineage: boolean;
};

const SESSION_SCOPED_KEYS = new Set([
	"liveSession",
	"session-native-relationships",
	"skill-runs",
]);
const LINEAGE_KEYS = new Set(["session-native-relationships"]);
const UNCHANGED_PROCEDURES = [
	"admin",
	"analysis.history",
	"analytics.moments.access",
	"analytics.moments.settings",
	"cli",
	"repositorySettings",
	"sessionAccess",
];

export function mergeSessionArrivalChange(
	change: SessionArrivalChange | null,
	sessionIds: readonly string[],
): SessionArrivalChange {
	return {
		sessionIds: new Set([...(change?.sessionIds ?? []), ...sessionIds]),
		lineage: (change?.lineage ?? false) || sessionIds.length === 0,
	};
}

function inputSessionId(options: unknown): string | null {
	if (!options || typeof options !== "object" || !("input" in options))
		return null;
	const { input } = options;
	if (!input || typeof input !== "object" || !("sessionId" in input))
		return null;
	return typeof input.sessionId === "string" ? input.sessionId : null;
}

function sessionScope(key: QueryKey): string | null {
	const kind = key[2];
	if (typeof kind === "string")
		return SESSION_SCOPED_KEYS.has(kind) ? String(key[3]) : null;
	return inputSessionId(key[3]);
}

export function isOrganizationQueryChangedByArrival(
	key: QueryKey,
	organizationId: string,
	change: SessionArrivalChange,
): boolean {
	if (key[0] !== "org" || key[1] !== organizationId) return false;
	const sessionId = sessionScope(key);
	if (sessionId !== null)
		return (
			change.sessionIds.has(sessionId) ||
			(change.lineage && LINEAGE_KEYS.has(String(key[2])))
		);
	const procedure = Array.isArray(key[2]) ? key[2].join(".") : null;
	return (
		procedure === null ||
		!UNCHANGED_PROCEDURES.some(
			(unchanged) =>
				procedure === unchanged || procedure.startsWith(`${unchanged}.`),
		)
	);
}

export function isSessionDetailChangedByArrival(
	sessionId: unknown,
	change: SessionArrivalChange,
): boolean {
	return (
		typeof sessionId === "string" &&
		(change.lineage || change.sessionIds.has(sessionId))
	);
}
