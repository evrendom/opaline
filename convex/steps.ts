import { ConvexError, v } from "convex/values";
import {
	apiMutation,
	apiQuery,
	findAnalysis,
	findStep,
	withoutSystemFields,
} from "./functions";
import { analysisFull, analysisSaved, MAX_STEPS_PER_ANALYSIS } from "./limits";
import { step } from "./validators";

export const create = apiMutation({
	args: { step },
	returns: v.null(),
	handler: async (ctx, { step: value }) => {
		const analysis = await findAnalysis(value.analysisId, ctx);
		if (!analysis)
			throw new Error(`Analysis ${value.analysisId} is missing or deleting`);
		if (analysis.status === "finished") throw new ConvexError(analysisSaved());
		if (analysis.stepCount >= MAX_STEPS_PER_ANALYSIS)
			throw new ConvexError(analysisFull("steps"));
		if (await findStep(value.id, ctx))
			throw new Error(`Step ${value.id} already exists`);
		if (value.parentId !== null) {
			const parent = await findStep(value.parentId, ctx);
			if (parent?.analysisId !== value.analysisId)
				throw new Error(
					`Parent step ${value.parentId} is not in this analysis`,
				);
		}
		await ctx.db.insert("steps", value);
		await ctx.db.patch(analysis._id, { stepCount: analysis.stepCount + 1 });
		return null;
	},
});

export const list = apiQuery({
	args: { analysisId: v.string() },
	returns: v.array(step),
	handler: async (ctx, { analysisId }) => {
		const steps = await ctx.db
			.query("steps")
			.withIndex("by_analysis_ordinal", (index) =>
				index.eq("analysisId", analysisId),
			)
			.collect();
		return steps.map(withoutSystemFields);
	},
});
