import { ConvexError, v } from "convex/values";
import {
	apiMutation,
	apiQuery,
	type Doc,
	findAnalysis,
	findStep,
	hasHeadroom,
	withoutSystemFields,
} from "./functions";
import { analysisFull, MAX_STEPS_PER_ANALYSIS } from "./limits";
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
		if (value) await ctx.db.patch(value._id, patch);
		return null;
	},
});

/**
 * Findings, clarification steps and the analysis patch in one transaction:
 * a refused save (a foreign or duplicate step, a full analysis) writes
 * nothing.
 */
export const save = apiMutation({
	args: { id: v.string(), save: analysisSave },
	returns: v.null(),
	handler: async (ctx, { id, save: { findings, clarifications, patch } }) => {
		const value = await findAnalysis(id, ctx);
		if (!value) throw new Error(`Analysis ${id} is missing or deleting`);
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
			.filter((filter) => filter.neq(filter.field("deleting"), true))
			.first();
		return value && stored(value);
	},
});

/**
 * The viewer's own and the workspace's shared analyses, newest first: both
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
			.filter((filter) => filter.neq(filter.field("deleting"), true))
			[Symbol.asyncIterator]();
		const shared = ctx.db
			.query("analyses")
			.withIndex("by_workspace_shared_cutoff", (index) =>
				index.eq("workspaceId", workspaceId).eq("shared", true),
			)
			.order("desc")
			.filter((filter) => filter.neq(filter.field("deleting"), true))
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

function stored(value: Doc<"analyses">) {
	const { deleting, ...fields } = withoutSystemFields(value);
	return fields;
}
