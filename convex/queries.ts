import { ConvexError, v } from "convex/values";
import {
	apiMutation,
	apiQuery,
	findAnalysis,
	findOutput,
	findQuery,
	findStep,
	withoutSystemFields,
} from "./functions";
import { analysisFull, MAX_QUERIES_PER_ANALYSIS } from "./limits";
import {
	query,
	querySession,
	querySummary,
	queryWithOutput,
} from "./validators";

export const create = apiMutation({
	args: {
		query,
		sessions: v.array(querySession),
		owners: v.array(v.string()),
		outputJson: v.union(v.string(), v.null()),
	},
	returns: v.null(),
	handler: async (
		ctx,
		{ query: value, sessions, owners: read, outputJson },
	) => {
		const analysis = await findAnalysis(value.analysisId, ctx);
		if (!analysis)
			throw new Error(`Analysis ${value.analysisId} is missing or deleting`);
		if (analysis.queryCount >= MAX_QUERIES_PER_ANALYSIS)
			throw new ConvexError(analysisFull("queries"));
		if (
			value.workspaceId !== analysis.workspaceId ||
			value.authorId !== analysis.authorId
		)
			throw new Error("A query belongs to its analysis's workspace and author");
		if ((await findStep(value.stepId, ctx))?.analysisId !== analysis.id)
			throw new Error(`Step ${value.stepId} is not in this analysis`);
		if (await findQuery(value.id, ctx))
			throw new Error(`Query ${value.id} already exists`);

		const distinct = [
			...new Map(
				sessions.map((session) => [session.sessionId, session]),
			).values(),
		];
		// Every member read, named in the result or not, decides who may read it.
		const owners = [
			...new Set([...read, ...distinct.map((session) => session.ownerId)]),
		];
		await ctx.db.insert("queries", {
			...value,
			hasOutput: outputJson !== null,
			...ownership(owners),
		});
		if (outputJson !== null)
			await ctx.db.insert("queryOutputs", {
				queryId: value.id,
				analysisId: value.analysisId,
				json: outputJson,
			});
		for (const session of distinct)
			await ctx.db.insert("querySessions", {
				...session,
				queryId: value.id,
				analysisId: value.analysisId,
			});
		for (const ownerId of owners)
			await ctx.db.insert("queryOwners", {
				queryId: value.id,
				analysisId: value.analysisId,
				ownerId,
			});
		await ctx.db.patch(analysis._id, {
			cutoff:
				analysis.cutoff < value.createdAt ? value.createdAt : analysis.cutoff,
			queryCount: analysis.queryCount + 1,
		});
		return null;
	},
});

export const get = apiQuery({
	args: { id: v.string() },
	returns: v.union(queryWithOutput, v.null()),
	handler: async (ctx, { id }) => {
		const value = await findQuery(id, ctx);
		if (!value) return null;
		const {
			hasOutput,
			sessionCount: _sessionCount,
			ownerCount: _ownerCount,
			onlyOwnerId: _onlyOwnerId,
			...fields
		} = withoutSystemFields(value);
		const output = hasOutput ? await findOutput(id, ctx) : null;
		const sessions = await ctx.db
			.query("querySessions")
			.withIndex("by_query", (index) => index.eq("queryId", id))
			.collect();
		const owners = await ctx.db
			.query("queryOwners")
			.withIndex("by_query", (index) => index.eq("queryId", id))
			.collect();
		return {
			...fields,
			outputJson: output?.json ?? null,
			sessions: sessions.map(
				({ sessionId, ownerId, revision, parserVersion }) => ({
					sessionId,
					ownerId,
					revision,
					parserVersion,
				}),
			),
			owners: owners.map((owner) => owner.ownerId),
		};
	},
});

/** At most 200 small documents per analysis, which `create` enforces. */
export const list = apiQuery({
	args: { analysisId: v.string() },
	returns: v.array(querySummary),
	handler: async (ctx, { analysisId }) => {
		const queries = await ctx.db
			.query("queries")
			.withIndex("by_analysis_created", (index) =>
				index.eq("analysisId", analysisId),
			)
			.collect();
		return Promise.all(
			queries.map(async (value) => {
				const {
					sessionCount: _sessionCount,
					ownerCount,
					onlyOwnerId,
					...fields
				} = withoutSystemFields(value);
				if (ownerCount !== undefined)
					return { ...fields, ownerCount, onlyOwnerId };
				const owners = await ctx.db
					.query("queryOwners")
					.withIndex("by_query", (index) => index.eq("queryId", value.id))
					.collect();
				return { ...fields, ...ownership(owners.map((row) => row.ownerId)) };
			}),
		);
	},
});

function ownership(owners: readonly string[]) {
	return {
		ownerCount: owners.length,
		onlyOwnerId: owners.length === 1 ? (owners[0] ?? null) : null,
	};
}
