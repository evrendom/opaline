import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { analysis, embedding, query, querySession, step } from "./validators";

export const schema = defineSchema({
	analyses: defineTable(
		analysis.extend({ deleting: v.optional(v.literal(true)) }),
	)
		.index("by_app_id", ["id"])
		.index("by_author", ["authorId"])
		.index("by_workspace_author_cutoff", ["workspaceId", "authorId", "cutoff"])
		.index("by_workspace_author_status_cutoff", [
			"workspaceId",
			"authorId",
			"status",
			"cutoff",
		])
		.index("by_workspace_shared_cutoff", ["workspaceId", "shared", "cutoff"])
		.index("by_deleting", ["deleting"]),
	steps: defineTable(step)
		.index("by_app_id", ["id"])
		.index("by_analysis_ordinal", ["analysisId", "ordinal"]),
	queries: defineTable(
		query.extend({
			hasOutput: v.boolean(),
			onlyOwnerId: v.union(v.string(), v.null()),
			// Absent on queries recorded before it; `queries:list` then counts
			// their `queryOwners` rows. `sessionCount` is no longer written.
			ownerCount: v.optional(v.number()),
			sessionCount: v.optional(v.number()),
		}),
	)
		.index("by_app_id", ["id"])
		.index("by_analysis_created", ["analysisId", "createdAt"])
		.index("by_output_created", ["hasOutput", "createdAt"]),
	// Results live apart from their queries so listings, deletion and
	// retention never read them.
	queryOutputs: defineTable({
		queryId: v.string(),
		analysisId: v.string(),
		json: v.string(),
	})
		.index("by_query", ["queryId"])
		.index("by_analysis", ["analysisId"]),
	// One row per session a query read, so query documents stay small and
	// deleted owners' sessions can be found by index.
	// One row per member whose sessions a query read, shown in its result or
	// not: account deletion finds analyses through `by_owner`.
	queryOwners: defineTable({
		queryId: v.string(),
		analysisId: v.string(),
		ownerId: v.string(),
	})
		.index("by_query", ["queryId", "ownerId"])
		.index("by_owner", ["ownerId"])
		.index("by_analysis", ["analysisId"]),
	querySessions: defineTable(
		querySession.extend({ queryId: v.string(), analysisId: v.string() }),
	)
		.index("by_query", ["queryId", "sessionId"])
		.index("by_owner", ["ownerId"])
		.index("by_analysis", ["analysisId"]),
	// Vector filters only test equality, so `space` joins workspace and model:
	// a search never compares vectors of different models.
	embeddings: defineTable(
		embedding.extend({ workspaceId: v.string(), space: v.string() }),
	)
		.index("by_analysis", ["analysisId"])
		.vectorIndex("by_vector", {
			vectorField: "vector",
			dimensions: 1536,
			filterFields: ["space"],
		}),
});

export default schema;
