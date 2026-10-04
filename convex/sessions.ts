import { ConvexError, v } from "convex/values";
import {
	apiMutation,
	apiQuery,
	findAnalysis,
	withoutSystemFields,
} from "./functions";
import { analysisFull, MAX_SESSIONS_PER_ANALYSIS } from "./limits";
import { sessionLink } from "./validators";

/**
 * Links an uploaded chat to its analysis, or moves an existing link's
 * `uploadedAt` to this upload. The count check and the insert share one
 * transaction, so concurrent uploads cannot pass the ceiling.
 */
export const link = apiMutation({
	args: { link: sessionLink },
	returns: v.null(),
	handler: async (ctx, { link: value }) => {
		const analysis = await findAnalysis(value.analysisId, ctx);
		if (!analysis)
			throw new Error(`Analysis ${value.analysisId} is missing or deleting`);
		const linked = await ctx.db
			.query("analysisSessions")
			.withIndex("by_analysis_session", (index) =>
				index.eq("analysisId", value.analysisId),
			)
			.take(MAX_SESSIONS_PER_ANALYSIS + 1);
		const existing = linked.find(
			(row) => row.source === value.source && row.sessionId === value.sessionId,
		);
		if (existing) {
			await ctx.db.patch(existing._id, { uploadedAt: value.uploadedAt });
			return null;
		}
		if (linked.length >= MAX_SESSIONS_PER_ANALYSIS)
			throw new ConvexError(analysisFull("sessions"));
		await ctx.db.insert("analysisSessions", value);
		return null;
	},
});

/** At most 200 small documents per analysis, which `link` enforces. */
export const list = apiQuery({
	args: { analysisId: v.string() },
	returns: v.array(sessionLink),
	handler: async (ctx, { analysisId }) => {
		const links = await ctx.db
			.query("analysisSessions")
			.withIndex("by_analysis_uploaded", (index) =>
				index.eq("analysisId", analysisId),
			)
			.collect();
		return links.map(withoutSystemFields);
	},
});
