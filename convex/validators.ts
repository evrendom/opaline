import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());

export const analysis = v.object({
	id: v.string(),
	workspaceId: v.string(),
	authorId: v.string(),
	host: v.union(
		v.literal("plugin"),
		v.literal("home"),
		v.literal("cli"),
		v.literal("scheduled"),
		v.literal("eval"),
	),
	question: v.string(),
	status: v.union(v.literal("finished"), v.literal("unfinished")),
	shared: v.boolean(),
	pinned: v.boolean(),
	createdAt: v.string(),
	cutoff: v.string(),
	scope: v.object({
		from: nullableString,
		to: nullableString,
		filters: v.record(v.string(), v.string()),
	}),
	finalAnswer: nullableString,
	topics: v.array(v.string()),
	updates: nullableString,
	notes: v.array(v.string()),
	cost: v.union(
		v.object({
			source: v.union(v.literal("linked"), v.literal("reported")),
			model: v.string(),
			inputTokens: v.number(),
			cachedInputTokens: v.number(),
			cacheWriteTokens: v.number(),
			outputTokens: v.number(),
			reasoningTokens: v.number(),
			costUsd: v.union(v.number(), v.null()),
		}),
		v.null(),
	),
	queryCount: v.number(),
	stepCount: v.number(),
});

export const analysisPatch = analysis
	.omit(
		"id",
		"workspaceId",
		"authorId",
		"createdAt",
		"cutoff",
		"queryCount",
		"stepCount",
	)
	.partial();

export const step = v.object({
	id: v.string(),
	analysisId: v.string(),
	parentId: nullableString,
	ordinal: v.number(),
	question: v.string(),
	reply: nullableString,
	finding: nullableString,
	createdAt: v.string(),
});

/** One save, written atomically by `analyses:save`. */
export const analysisSave = v.object({
	findings: v.array(v.object({ stepId: v.string(), finding: v.string() })),
	clarifications: v.array(step),
	patch: analysisPatch,
});

/** A query without its result or sessions. Arguments are JSON so any keys survive. */
export const query = v.object({
	id: v.string(),
	analysisId: v.string(),
	stepId: v.string(),
	workspaceId: v.string(),
	authorId: v.string(),
	tool: v.union(v.literal("find"), v.literal("read")),
	argsJson: v.string(),
	outputChars: v.number(),
	createdAt: v.string(),
	removed: v.boolean(),
});

export const querySession = v.object({
	sessionId: v.string(),
	ownerId: v.string(),
	revision: v.string(),
	parserVersion: v.number(),
});

/** A query as listed: who it read is summarized from every row of `queryOwners`. */
export const querySummary = query.extend({
	hasOutput: v.boolean(),
	ownerCount: v.number(),
	/** The only member the query read; null for none or several. */
	onlyOwnerId: nullableString,
});

export const queryWithOutput = query.extend({
	outputJson: nullableString,
	sessions: v.array(querySession),
	owners: v.array(v.string()),
});

export const embedding = v.object({
	analysisId: v.string(),
	stepId: nullableString,
	kind: v.union(v.literal("question"), v.literal("step"), v.literal("topics")),
	text: v.string(),
	vector: v.array(v.number()),
	model: v.string(),
});

export const embeddingMatch = embedding.omit("vector", "model");
