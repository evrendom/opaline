import { v } from "convex/values";
import {
	apiMutation,
	type Doc,
	findQuery,
	findStep,
	hasHeadroom,
	type MutationCtx,
} from "./functions";

/**
 * Each call deletes the author's analyses until half the transaction is used
 * and reports whether any remain. An analysis is first marked deleting, which
 * hides it and blocks writes to it, and goes once its children are gone.
 * Repeating a call is safe and continues where the last stopped.
 */
export const byAuthor = apiMutation({
	args: { authorId: v.string() },
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx, { authorId }) =>
		deleteAnalyses(
			ctx.db
				.query("analyses")
				.withIndex("by_author", (index) => index.eq("authorId", authorId)),
			ctx,
		),
});

/** As `byAuthor`, for every analysis of the workspace. */
export const byWorkspace = apiMutation({
	args: { workspaceId: v.string() },
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx, { workspaceId }) =>
		deleteAnalyses(
			ctx.db
				.query("analyses")
				.withIndex("by_workspace_author_cutoff", (index) =>
					index.eq("workspaceId", workspaceId),
				),
			ctx,
		),
});

/**
 * Account deletion as Opaline's API before ADR 0001's amendment calls it:
 * marks every analysis that read one of the owner's sessions as deleting
 * (hidden everywhere, refusing writes) and drops those owner links, until
 * half the transaction is used. Repeat until `hasMore` is false, then call
 * `sweep`. Kept unchanged for that API until it is replaced; the current API
 * calls `removeOwnerEvidence`.
 */
export const markReadingOwner = apiMutation({
	args: { ownerId: v.string() },
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx, { ownerId }) => {
		for await (const link of ctx.db
			.query("queryOwners")
			.withIndex("by_owner", (index) => index.eq("ownerId", ownerId))) {
			if (!(await hasHeadroom(ctx))) return { hasMore: true };
			await markDeleting(link.analysisId, ctx);
			await ctx.db.delete(link._id);
		}
		return { hasMore: false };
	},
});

/**
 * Account deletion, for analyses of any author (ADR 0001 as amended). For
 * every query that read one of the owner's sessions, marks its analysis
 * deleting (hidden everywhere, refusing writes) when the query returned text
 * from the sessions it read (`counts` is not true: queries recorded before
 * it count as quoting) or when its step's finding sits on a result naming one
 * of the owner's sessions. Otherwise removes the query's result: its
 * `queryOutputs` row and the owner's `querySessions` rows go, it is
 * `removed`, its `redaction` replaces its arguments and step label, and the
 * analysis stays. Drops each owner link once handled, until half the
 * transaction is used. Repeat until `hasMore` is false, then call `sweep`.
 */
export const removeOwnerEvidence = apiMutation({
	args: { ownerId: v.string() },
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx, { ownerId }) => {
		for await (const link of ctx.db
			.query("queryOwners")
			.withIndex("by_owner", (index) => index.eq("ownerId", ownerId))) {
			if (!(await hasHeadroom(ctx))) return { hasMore: true };
			const query = await findQuery(link.queryId, ctx);
			if (!query || (await deletesAnalysis(query, ownerId, ctx))) {
				await markDeleting(link.analysisId, ctx);
				await ctx.db.delete(link._id);
				continue;
			}
			if (!(await removeResult(query, ownerId, ctx))) return { hasMore: true };
			await ctx.db.delete(link._id);
			// The members it read, now without the owner.
			const owners = await ctx.db
				.query("queryOwners")
				.withIndex("by_query", (index) => index.eq("queryId", query.id))
				.collect();
			await ctx.db.patch(query._id, {
				ownerCount: owners.length,
				onlyOwnerId: owners.length === 1 ? (owners[0]?.ownerId ?? null) : null,
			});
		}
		return { hasMore: false };
	},
});

/**
 * Whether deleting the owner deletes the query's analysis: the query quoted
 * the sessions it read, or its step's finding sits on a result naming one
 * of the owner's sessions. Stable across retries: removing a result happens
 * only when this is false, and only makes it false again.
 */
async function deletesAnalysis(
	query: Doc<"queries">,
	ownerId: string,
	ctx: MutationCtx,
): Promise<boolean> {
	if (query.counts !== true) return true;
	const step = await findStep(query.stepId, ctx);
	if (step?.finding == null) return false;
	const named = await ctx.db
		.query("querySessions")
		.withIndex("by_query", (index) => index.eq("queryId", query.id))
		.filter((row) => row.eq(row.field("ownerId"), ownerId))
		.first();
	return named !== null;
}

async function markDeleting(analysisId: string, ctx: MutationCtx) {
	const analysis = await ctx.db
		.query("analyses")
		.withIndex("by_app_id", (index) => index.eq("id", analysisId))
		.unique();
	if (analysis && !analysis.deleting)
		await ctx.db.patch(analysis._id, { deleting: true });
}

/**
 * Removes a counting query's result, the owner's session rows and the
 * arguments its `redaction` leaves out, while there is headroom; true once
 * done. Repeating it is safe.
 */
async function removeResult(
	query: Doc<"queries">,
	ownerId: string,
	ctx: MutationCtx,
): Promise<boolean> {
	if (query.hasOutput || !query.removed)
		await ctx.db.patch(query._id, { hasOutput: false, removed: true });
	if (query.redaction && query.argsJson !== query.redaction.argsJson) {
		await ctx.db.patch(query._id, { argsJson: query.redaction.argsJson });
		const step = await findStep(query.stepId, ctx);
		if (step) await ctx.db.patch(step._id, { question: query.redaction.label });
	}
	const rows = [
		ctx.db
			.query("queryOutputs")
			.withIndex("by_query", (index) => index.eq("queryId", query.id)),
		ctx.db
			.query("querySessions")
			.withIndex("by_query", (index) => index.eq("queryId", query.id))
			.filter((row) => row.eq(row.field("ownerId"), ownerId)),
	];
	for (const documents of rows)
		for await (const row of documents) {
			if (!(await hasHeadroom(ctx))) return false;
			await ctx.db.delete(row._id);
		}
	return true;
}

/**
 * Account deletion: the owner's chats linked to any analysis, until half the
 * transaction is used. The analyses themselves stay.
 */
export const sessionsByOwner = apiMutation({
	args: { ownerId: v.string() },
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx, { ownerId }) => {
		for await (const link of ctx.db
			.query("analysisSessions")
			.withIndex("by_owner", (index) => index.eq("ownerId", ownerId))) {
			if (!(await hasHeadroom(ctx))) return { hasMore: true };
			await ctx.db.delete(link._id);
		}
		return { hasMore: false };
	},
});

/** Deletes analyses marked deleting with their children, as `byAuthor` does. */
export const sweep = apiMutation({
	args: {},
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx) =>
		deleteAnalyses(
			ctx.db
				.query("analyses")
				.withIndex("by_deleting", (index) => index.eq("deleting", true)),
			ctx,
		),
});

/**
 * Deletes the given analyses with their children until half the transaction
 * is used; `hasMore` while any remain. Also used by draft retention.
 */
export async function deleteAnalyses(
	analyses: AsyncIterable<Doc<"analyses">>,
	ctx: MutationCtx,
): Promise<{ hasMore: boolean }> {
	for await (const analysis of analyses) {
		if (!(await hasHeadroom(ctx))) return { hasMore: true };
		if (!analysis.deleting)
			await ctx.db.patch(analysis._id, { deleting: true });
		if (!(await deleteChildren(analysis.id, ctx))) return { hasMore: true };
		await ctx.db.delete(analysis._id);
	}
	return { hasMore: false };
}

/** Deletes an analysis's children while there is headroom; true once none are left. */
async function deleteChildren(
	analysisId: string,
	ctx: MutationCtx,
): Promise<boolean> {
	const children = [
		ctx.db
			.query("queryOutputs")
			.withIndex("by_analysis", (index) => index.eq("analysisId", analysisId)),
		ctx.db
			.query("queries")
			.withIndex("by_analysis_created", (index) =>
				index.eq("analysisId", analysisId),
			),
		ctx.db
			.query("querySessions")
			.withIndex("by_analysis", (index) => index.eq("analysisId", analysisId)),
		ctx.db
			.query("queryOwners")
			.withIndex("by_analysis", (index) => index.eq("analysisId", analysisId)),
		ctx.db
			.query("steps")
			.withIndex("by_analysis_ordinal", (index) =>
				index.eq("analysisId", analysisId),
			),
		ctx.db
			.query("embeddings")
			.withIndex("by_analysis", (index) => index.eq("analysisId", analysisId)),
		ctx.db
			.query("analysisSessions")
			.withIndex("by_analysis_session", (index) =>
				index.eq("analysisId", analysisId),
			),
	];
	for (const rows of children)
		for await (const row of rows) {
			if (!(await hasHeadroom(ctx))) return false;
			await ctx.db.delete(row._id);
		}
	return true;
}
