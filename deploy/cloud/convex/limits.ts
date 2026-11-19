/**
 * Children one analysis may hold, so listing its queries or steps fits one
 * Convex call (see README). Mirrors
 * apps/api/src/services/analysis-log/limits.ts; a full analysis rejects the
 * insert with `AnalysisFull` as ConvexError data.
 */
export const MAX_QUERIES_PER_ANALYSIS = 200;
export const MAX_STEPS_PER_ANALYSIS = 200;
export const MAX_SESSIONS_PER_ANALYSIS = 200;

export function analysisFull(child: "queries" | "steps" | "sessions") {
	return { kind: "analysisFull", child } as const;
}

/** ConvexError data of a write refused because the analysis is saved (append-only). */
export function analysisSaved() {
	return { kind: "analysisSaved" } as const;
}
