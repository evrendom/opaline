import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { deleteAnalyses } from "./deletion";
import {
	apiMutation,
	type Doc,
	findAnalysis,
	findOutput,
	hasHeadroom,
	internalMutation,
	type MutationCtx,
} from "./functions";

const DAY_MS = 86_400_000;
/** Mirrors `unavailableReason` in apps/api/src/services/analysis-log/analysis-log.service.ts (ADR 0001). */
const RESULT_RETENTION_MS = 90 * DAY_MS;
const SHARED_RESULT_RETENTION_MS = 365 * DAY_MS;
/** Mirrors `DRAFT_RETENTION_MS` in apps/api/src/services/analysis-log/limits.ts. */
const DRAFT_RETENTION_MS = 7 * DAY_MS;
/**
 * Queries per page. With their analyses (each under ~140 KB together) a page
 * of retained queries reads under 5 MB, inside the headroom check's 8 MiB.
 */
const PAGE_SIZE = 32;

const expireDraftsReference = makeFunctionReference<
	"mutation",
	Record<string, never>
>("retention:expireDraftsDaily");

const expireReference = makeFunctionReference<
	"mutation",
	{ cursor: string | null; now?: number }
>("retention:expireQueryResults");

/**
 * Drops results older than 90 days, or a year in shared or pinned analyses.
 * Only queries that still hold a result are scanned; each page schedules the
 * next with the same clock. The daily cron starts it without a clock.
 *
 * Results are up to 256 KiB, so a page stops once half the transaction is
 * used and the next run repeats it: dropped results have left the index, so
 * every run makes progress.
 */
export const expireQueryResults = internalMutation({
	args: { cursor: v.union(v.string(), v.null()), now: v.optional(v.number()) },
	returns: v.null(),
	handler: async (ctx, { cursor, now = Date.now() }) => {
		const page = await ctx.db
			.query("queries")
			.withIndex("by_output_created", (index) =>
				index
					.eq("hasOutput", true)
					.lt("createdAt", new Date(now - RESULT_RETENTION_MS).toISOString()),
			)
			.paginate({ cursor, numItems: PAGE_SIZE });
		const analyses = new Map<string, Doc<"analyses"> | null>();
		let finished = true;
		for (const query of page.page) {
			if (!(await hasHeadroom(ctx))) {
				finished = false;
				break;
			}
			if (!analyses.has(query.analysisId))
				analyses.set(
					query.analysisId,
					await findAnalysis(query.analysisId, ctx),
				);
			const analysis = analyses.get(query.analysisId);
			const retention =
				analysis?.shared || analysis?.pinned
					? SHARED_RESULT_RETENTION_MS
					: RESULT_RETENTION_MS;
			if (now - Date.parse(query.createdAt) <= retention) continue;
			await ctx.db.patch(query._id, { hasOutput: false });
			const output = await findOutput(query.id, ctx);
			if (output) await ctx.db.delete(output._id);
		}
		if (!finished || !page.isDone)
			await ctx.scheduler.runAfter(0, expireReference, {
				cursor: finished ? page.continueCursor : cursor,
				now,
			});
		return null;
	},
});

/**
 * Unsaved drafts (analyses find/read built that were never saved) are
 * deleted with their children 7 days after they were started. Saved
 * analyses never match: saving clears `draft`. Each call deletes until half
 * the transaction is used.
 */
async function expireDraftsBatch(ctx: MutationCtx) {
	return deleteAnalyses(
		ctx.db
			.query("analyses")
			.withIndex("by_draft_created", (index) =>
				index
					.eq("draft", true)
					.lt(
						"createdAt",
						new Date(Date.now() - DRAFT_RETENTION_MS).toISOString(),
					),
			),
		ctx,
	);
}

/** The daily cron's entry: repeats itself until no expired draft is left. */
export const expireDraftsDaily = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const { hasMore } = await expireDraftsBatch(ctx);
		if (hasMore) await ctx.scheduler.runAfter(0, expireDraftsReference, {});
		return null;
	},
});

/**
 * The same expiry for the API (`AnalysisStore.expireDrafts`, used by the
 * store contract tests); it can only delete drafts the cron would.
 */
export const expireDrafts = apiMutation({
	args: {},
	returns: v.object({ hasMore: v.boolean() }),
	handler: (ctx) => expireDraftsBatch(ctx),
});
