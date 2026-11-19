import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { loggableError } from "./errors.js";
import type { FindingImpact, Visibility } from "./finding-impact.js";
import type { AnalysisLog, AnalysisStore } from "./types.js";

const logger = getLogger(["rudel", "api", "analysis-log"]);

/**
 * Finding impact rows follow the analysis log's visibility (ADR 0001 as
 * amended): the log (Convex) is authoritative and advances an analysis's
 * `visibilityRevision` with every share and unshare; the rows keep the
 * visibility of the highest revision they were handed, so writes that land
 * out of order cannot leave an unshared analysis readable. A share or
 * unshare requests a sync here before it changes the analysis and clears it
 * once the rows follow; a request left by a failed write is retried by the
 * minute maintenance pass (`runVisibilitySyncPass`), which copies the
 * analysis's visibility as the log holds it then.
 */

export interface SyncTarget {
	workspaceId: string;
	analysisId: string;
}

export interface VisibilitySyncs {
	/** Requests a sync of the analysis's rows; returns the request's ticket. */
	request(target: SyncTarget): Promise<number>;
	/** Clears the request, unless a newer one (another ticket) arrived. */
	clear(analysisId: string, ticket: number): Promise<void>;
	/** Retries the request later, unless a newer one arrived. */
	defer(analysisId: string, ticket: number): Promise<void>;
	/** Requests due now, oldest first. */
	due(limit: number): Promise<(SyncTarget & { ticket: number })[]>;
}

/** Requests handled by one maintenance pass. */
const PASS_LIMIT = 100;

/**
 * Hands the rows the visibility this share or unshare wrote, then clears
 * `ticket`. A failure is logged and leaves the request for the pass.
 */
export async function followVisibility(
	impact: FindingImpact,
	syncs: VisibilitySyncs,
	target: SyncTarget,
	ticket: number,
	visibility: Visibility | null,
): Promise<void> {
	try {
		if (visibility) await impact.share(target, visibility);
		await syncs.clear(target.analysisId, ticket);
	} catch (error) {
		logger.warn(
			"Finding impact of {analysisId} will follow its visibility on the next maintenance pass: {error}",
			{ analysisId: target.analysisId, error: loggableError(error) },
		);
	}
}

/** Makes the rows follow the analysis's visibility as the log holds it now. */
async function syncFromLog(
	store: AnalysisStore,
	impact: FindingImpact,
	target: SyncTarget,
): Promise<void> {
	const analysis = await store.getAnalysis(target.analysisId);
	// A deleted analysis's rows go with the purge that deleted it.
	if (analysis)
		await impact.share(
			{ workspaceId: target.workspaceId, analysisId: target.analysisId },
			{
				shared: analysis.shared,
				revision: analysis.visibilityRevision,
			},
		);
}

/**
 * Requests a sync and runs it now from the log: for a write that may have
 * missed a share or unshare made meanwhile (saving writes its rows while
 * the analysis can already be shared). A failure leaves the request.
 */
export async function syncVisibility(
	store: AnalysisStore,
	impact: FindingImpact,
	syncs: VisibilitySyncs,
	target: SyncTarget,
): Promise<void> {
	const ticket = await syncs.request(target);
	try {
		await syncFromLog(store, impact, target);
		await syncs.clear(target.analysisId, ticket);
	} catch (error) {
		logger.warn(
			"Finding impact of {analysisId} will follow its visibility on the next maintenance pass: {error}",
			{ analysisId: target.analysisId, error: loggableError(error) },
		);
	}
}

/**
 * The maintenance pass: every due request is synced from the log as it is
 * now and cleared, or deferred when the log or ClickHouse fails.
 */
export async function runVisibilitySyncPass(env: {
	impact: FindingImpact;
	syncs: VisibilitySyncs;
	logOf: (workspaceId: string) => AnalysisLog | null;
}): Promise<{ attempted: number; synced: number; hasMore: boolean }> {
	const due = await env.syncs.due(PASS_LIMIT);
	let synced = 0;
	for (const request of due) {
		try {
			const log = env.logOf(request.workspaceId);
			if (!log) throw new Error("The analysis log is off for the workspace");
			await syncFromLog(log.store, env.impact, request);
			await env.syncs.clear(request.analysisId, request.ticket);
			synced++;
		} catch (error) {
			await env.syncs.defer(request.analysisId, request.ticket);
			logger.warn(
				"Finding impact of {analysisId} did not follow its visibility; retrying later: {error}",
				{ analysisId: request.analysisId, error: loggableError(error) },
			);
		}
	}
	return {
		attempted: due.length,
		synced,
		hasMore: due.length === PASS_LIMIT,
	};
}

/** In-process requests for tests: every request is due at once. */
export function createMemoryVisibilitySyncs(): VisibilitySyncs & {
	/** Analyses with a request, oldest first. */
	pending(): string[];
} {
	const requests = new Map<string, SyncTarget & { ticket: number }>();
	return {
		pending: () => [...requests.keys()],
		async request(target) {
			const ticket = (requests.get(target.analysisId)?.ticket ?? 0) + 1;
			requests.delete(target.analysisId);
			requests.set(target.analysisId, { ...target, ticket });
			return ticket;
		},
		async clear(analysisId, ticket) {
			if (requests.get(analysisId)?.ticket === ticket)
				requests.delete(analysisId);
		},
		async defer() {},
		async due(limit) {
			return [...requests.values()].slice(0, limit);
		},
	};
}

/** Retry delays grow from one minute to an hour. */
const RETRY_BASE_SECONDS = 60;
const RETRY_MAX_SECONDS = 3_600;

/** Requests in Postgres (`analysis_visibility_sync`), deleted with their workspace. */
export function createPostgresVisibilitySyncs(
	sql: postgres.Sql,
): VisibilitySyncs {
	return {
		async request({ workspaceId, analysisId }) {
			const [row] = await sql<{ ticket: string | number }[]>`
				INSERT INTO analysis_visibility_sync (analysis_id, organization_id)
				VALUES (${analysisId}, ${workspaceId})
				ON CONFLICT (analysis_id) DO UPDATE SET
					ticket = analysis_visibility_sync.ticket + 1,
					attempt_count = 0,
					next_attempt_at = now()
				RETURNING ticket
			`;
			if (!row) throw new Error("The visibility sync request was not stored");
			return Number(row.ticket);
		},
		async clear(analysisId, ticket) {
			await sql`
				DELETE FROM analysis_visibility_sync
				WHERE analysis_id = ${analysisId} AND ticket = ${ticket}
			`;
		},
		async defer(analysisId, ticket) {
			await sql`
				UPDATE analysis_visibility_sync SET
					attempt_count = attempt_count + 1,
					next_attempt_at = now() + least(
						${RETRY_MAX_SECONDS}::int,
						${RETRY_BASE_SECONDS}::int * power(2, least(attempt_count, 10))::int
					) * interval '1 second'
				WHERE analysis_id = ${analysisId} AND ticket = ${ticket}
			`;
		},
		async due(limit) {
			const rows = await sql<
				{ analysis_id: string; organization_id: string; ticket: string }[]
			>`
				SELECT analysis_id, organization_id, ticket
				FROM analysis_visibility_sync
				WHERE next_attempt_at <= now()
				ORDER BY next_attempt_at, analysis_id
				LIMIT ${limit}
			`;
			return rows.map((row) => ({
				workspaceId: row.organization_id,
				analysisId: row.analysis_id,
				ticket: Number(row.ticket),
			}));
		},
	};
}
