import type { FilterBuilder, NamedTableInfo } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
	apiMutation,
	apiQuery,
	type DataModel,
	type Doc,
	findAnalysis,
	findStep,
	hasHeadroom,
	withoutSystemFields,
} from "./functions";
import { analysisFull, analysisSaved, MAX_STEPS_PER_ANALYSIS } from "./limits";
import { analysis, analysisPatch, analysisSave } from "./validators";

export const create = apiMutation({
	args: { analysis },
	returns: v.null(),
	handler: async (ctx, { analysis: value }) => {
		const existing = await ctx.db
			.query("analyses")
			.withIndex("by_app_id", (index) => index.eq("id", value.id))
			.first();
		if (existing) throw new Error(`Analysis ${value.id} already exists`);
		await ctx.db.insert("analyses", value);
		return null;
	},
});

export const get = apiQuery({
	args: { id: v.string() },
	returns: v.union(analysis, v.null()),
	handler: async (ctx, { id }) => {
		const value = await findAnalysis(id, ctx);
		return value && stored(value);
	},
});

export const update = apiMutation({
	args: { id: v.string(), patch: analysisPatch },
	returns: v.null(),
	handler: async (ctx, { id, patch }) => {
		const value = await findAnalysis(id, ctx);
		if (value)
			await ctx.db.patch(value._id, {
				...patch,
				// The API before `setShared` shares through here.
				...(patch.shared === undefined
					? {}
					: { visibilityRevision: (value.visibilityRevision ?? 0) + 1 }),
			});
		return null;
	},
});

/**
 * Shares or unshares an analysis and advances its visibility revision in the
 * same transaction; returns the new revision, or null for a missing or
 * deleting analysis. Copies of the visibility (the API's finding impact rows)
 * keep the highest revision's, so they end as the last change here.
 */
export const setShared = apiMutation({
	args: { id: v.string(), shared: v.boolean() },
	returns: v.union(v.number(), v.null()),
	handler: async (ctx, { id, shared }) => {
		const value = await findAnalysis(id, ctx);
		if (!value) return null;
		const visibilityRevision = (value.visibilityRevision ?? 0) + 1;
		await ctx.db.patch(value._id, { shared, visibilityRevision });
		return visibilityRevision;
	},
});

/**
 * Publishes an analysis: findings, clarification steps and the analysis
 * patch in one transaction, after which it is no longer a draft. Saving is
 * append-only: a saved (finished) analysis is refused with `analysisSaved`
 * ConvexError data. A refused save (also a foreign or duplicate step, a full
 * analysis) writes nothing.
 */
export const save = apiMutation({
	args: { id: v.string(), save: analysisSave },
	returns: v.null(),
	handler: async (ctx, { id, save: { findings, clarifications, patch } }) => {
		const value = await findAnalysis(id, ctx);
		if (!value) throw new Error(`Analysis ${id} is missing or deleting`);
		if (value.status === "finished") throw new ConvexError(analysisSaved());
		if (value.stepCount + clarifications.length > MAX_STEPS_PER_ANALYSIS)
			throw new ConvexError(analysisFull("steps"));
		const steps = [];
		for (const { stepId, finding } of findings) {
			const step = await findStep(stepId, ctx);
			if (step?.analysisId !== id)
				throw new Error(`Step ${stepId} is not in this analysis`);
			steps.push({ step, finding });
		}
		if (
			new Set(clarifications.map((step) => step.id)).size <
			clarifications.length
		)
			throw new Error("Clarification step ids repeat");
		for (const step of clarifications)
			if (
				step.analysisId !== id ||
				(await findStep(step.id, ctx)) ||
				(step.parentId !== null &&
					(await findStep(step.parentId, ctx))?.analysisId !== id)
			)
				throw new Error(`Step ${step.id} cannot be added to this analysis`);

		for (const { step, finding } of steps)
			await ctx.db.patch(step._id, { finding });
		for (const step of clarifications) await ctx.db.insert("steps", step);
		await ctx.db.patch(value._id, {
			...patch,
			draft: false,
			stepCount: value.stepCount + clarifications.length,
		});
		return null;
	},
});

export const latestOpen = apiQuery({
	args: { workspaceId: v.string(), authorId: v.string(), since: v.string() },
	returns: v.union(analysis, v.null()),
	handler: async (ctx, { workspaceId, authorId, since }) => {
		const value = await ctx.db
			.query("analyses")
			.withIndex("by_workspace_author_status_cutoff", (index) =>
				index
					.eq("workspaceId", workspaceId)
					.eq("authorId", authorId)
					.eq("status", "unfinished")
					.gte("cutoff", since),
			)
			.order("desc")
			.filter((filter) =>
				filter.and(
					filter.neq(filter.field("deleting"), true),
					filter.eq(filter.field("draft"), true),
				),
			)
			.first();
		return value && stored(value);
	},
});

/**
 * The viewer's own and the workspace's shared analyses without drafts,
 * newest first: both
 * indexes are read in step and merged, so little more than the returned
 * analyses is read. Analyses are up to ~100 KB, so the list ends early when
 * half the transaction is used.
 */
export const recent = apiQuery({
	args: { workspaceId: v.string(), viewerId: v.string(), limit: v.number() },
	returns: v.array(analysis),
	handler: async (ctx, { workspaceId, viewerId, limit }) => {
		if (limit < 1) return [];
		const own = ctx.db
			.query("analyses")
			.withIndex("by_workspace_author_cutoff", (index) =>
				index.eq("workspaceId", workspaceId).eq("authorId", viewerId),
			)
			.order("desc")
			.filter(isListed)
			[Symbol.asyncIterator]();
		const shared = ctx.db
			.query("analyses")
			.withIndex("by_workspace_shared_cutoff", (index) =>
				index.eq("workspaceId", workspaceId).eq("shared", true),
			)
			.order("desc")
			.filter(isListed)
			[Symbol.asyncIterator]();
		const listed = new Map<string, Doc<"analyses">>();
		let nextOwn = await own.next();
		let nextShared = await shared.next();
		while (listed.size < limit && (await hasHeadroom(ctx))) {
			const fromOwn =
				!nextOwn.done &&
				(nextShared.done || nextOwn.value.cutoff >= nextShared.value.cutoff);
			const next = fromOwn ? nextOwn : nextShared;
			if (next.done) break;
			listed.set(next.value.id, next.value);
			if (fromOwn) nextOwn = await own.next();
			else nextShared = await shared.next();
		}
		await Promise.all([own.return?.(), shared.return?.()]);
		return [...listed.values()].map(stored);
	},
});

/**
 * Saved analyses of the workspace that revise `id` (`updates`), without
 * drafts, oldest first; at most `limit` (each up to ~100 KB).
 */
export const updatedBy = apiQuery({
	args: { workspaceId: v.string(), id: v.string(), limit: v.number() },
	returns: v.array(analysis),
	handler: async (ctx, { workspaceId, id, limit }) => {
		if (limit < 1) return [];
		const values = await ctx.db
			.query("analyses")
			.withIndex("by_workspace_updates", (index) =>
				index.eq("workspaceId", workspaceId).eq("updates", id),
			)
			.filter(isListed)
			.take(limit);
		return values.map(stored);
	},
});

/** Listed analyses: neither being deleted nor drafts. */
function isListed(
	filter: FilterBuilder<NamedTableInfo<DataModel, "analyses">>,
) {
	return filter.and(
		filter.neq(filter.field("deleting"), true),
		filter.neq(filter.field("draft"), true),
	);
}

/** As the API stores it: analyses recorded before drafts read as not drafts. */
function stored(value: Doc<"analyses">) {
	const { deleting, draft, changes, ...fields } = withoutSystemFields(value);
	return { ...fields, draft: draft === true, changes: changes ?? [] };
}
