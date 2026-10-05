import { v } from "convex/values";
import {
	apiMutation,
	type Doc,
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
 * Account deletion, for analyses of any author: marks every analysis that
 * read one of the owner's sessions as deleting (hidden everywhere, refusing
 * writes) and drops those owner links, until half the transaction is used.
 * Repeat until `hasMore` is false, then call `sweep`.
 */
export const markReadingOwner = apiMutation({
	args: { ownerId: v.string() },
	returns: v.object({ hasMore: v.boolean() }),
	handler: async (ctx, { ownerId }) => {
		for await (const link of ctx.db
			.query("queryOwners")
			.withIndex("by_owner", (index) => index.eq("ownerId", ownerId))) {
			if (!(await hasHeadroom(ctx))) return { hasMore: true };
			const analysis = await ctx.db
				.query("analyses")
				.withIndex("by_app_id", (index) => index.eq("id", link.analysisId))
				.unique();
			if (analysis && !analysis.deleting)
				await ctx.db.patch(analysis._id, { deleting: true });
			await ctx.db.delete(link._id);
		}
		return { hasMore: false };
	},
});

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
