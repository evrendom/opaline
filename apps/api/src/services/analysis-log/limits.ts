/**
 * Ceilings of one analysis. Listing an analysis reads all its queries or all
 * its steps in one Convex call, which may read 16 MiB and return 8,192
 * elements: 200 queries of at most 32 KiB arguments stay under 7 MiB, and 200
 * steps (at most 6,500 characters, under 20 KiB) under 4 MiB. Stores enforce
 * the counts atomically when inserting; convex/limits.ts mirrors them.
 */
export const MAX_QUERIES_PER_ANALYSIS = 200;
export const MAX_STEPS_PER_ANALYSIS = 200;
/** Chat sessions linked to one analysis (a chat, its parents and subagents). */
export const MAX_SESSIONS_PER_ANALYSIS = 200;
export const MAX_QUERY_ARGS_BYTES = 32 * 1024;
/**
 * Unsaved drafts are deleted this long after they were started; the service
 * treats older drafts as gone before the daily cleanup reaches them.
 * Mirrored in convex/retention.ts.
 */
export const DRAFT_RETENTION_MS = 7 * 86_400_000;
