import { makeFunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";
import {
	apiAction,
	apiMutation,
	findAnalysis,
	findStep,
	hasHeadroom,
	internalQuery,
} from "./functions";
import { embedding, embeddingMatch } from "./validators";

const DIMENSIONS = 1536;
/** Convex returns at most 256 vector matches. */
const MAX_MATCHES = 256;

type Match = Infer<typeof embeddingMatch>;

const matchArgs = { workspaceId: v.string(), ids: v.array(v.id("embeddings")) };
const visibleMatchesReference = makeFunctionReference<
	"query",
	{ workspaceId: string; ids: Infer<typeof matchArgs.ids> },
	Match[]
>("embeddings:visibleMatches");

export const add = apiMutation({
	args: { workspaceId: v.string(), embedding },
	returns: v.null(),
	handler: async (ctx, { workspaceId, embedding: value }) => {
		if (value.vector.length !== DIMENSIONS)
			throw new Error(`Embeddings have ${DIMENSIONS} dimensions`);
		const analysis = await findAnalysis(value.analysisId, ctx);
		if (analysis?.workspaceId !== workspaceId)
			throw new Error(`Analysis ${value.analysisId} is not in this workspace`);
		if (
			value.stepId !== null &&
			(await findStep(value.stepId, ctx))?.analysisId !== analysis.id
		)
			throw new Error(`Step ${value.stepId} is not in this analysis`);
		await ctx.db.insert("embeddings", {
			...value,
			workspaceId,
			space: spaceOf(workspaceId, value.model),
		});
		return null;
	},
});

/**
 * Vector search over one workspace's vectors of one model. It must run in an
 * action; the matched texts are read in one query.
 */
export const search = apiAction({
	args: {
		workspaceId: v.string(),
		model: v.string(),
		vector: v.array(v.number()),
		limit: v.number(),
	},
	returns: v.array(embeddingMatch),
	handler: async (ctx, { workspaceId, model, vector, limit }) => {
		if (limit < 1) return [];
		if (vector.length !== DIMENSIONS)
			throw new Error(`Searches use ${DIMENSIONS} dimensions`);
		const results = await ctx.vectorSearch("embeddings", "by_vector", {
			vector,
			limit: Math.min(limit, MAX_MATCHES),
			filter: (filter) => filter.eq("space", spaceOf(workspaceId, model)),
		});
		return ctx.runQuery(visibleMatchesReference, {
			workspaceId,
			ids: results.map((result) => result._id),
		});
	},
});

/**
 * The matched texts in search order, leaving out drafts and analyses being
 * deleted.
 * Each match reads its embedding and possibly its analysis, so the list ends
 * early when half the transaction is used.
 */
export const visibleMatches = internalQuery({
	args: matchArgs,
	returns: v.array(embeddingMatch),
	handler: async (ctx, { workspaceId, ids }) => {
		const visible = new Map<string, boolean>();
		const matches: Match[] = [];
		for (const id of ids) {
			if (!(await hasHeadroom(ctx))) break;
			const value = await ctx.db.get(id);
			if (value?.workspaceId !== workspaceId) continue;
			if (!visible.has(value.analysisId)) {
				const analysis = await findAnalysis(value.analysisId, ctx);
				visible.set(value.analysisId, !!analysis && analysis.draft !== true);
			}
			if (visible.get(value.analysisId))
				matches.push({
					analysisId: value.analysisId,
					stepId: value.stepId,
					kind: value.kind,
					text: value.text,
				});
		}
		return matches;
	},
});

function spaceOf(workspaceId: string, model: string): string {
	return `${workspaceId}\n${model}`;
}
