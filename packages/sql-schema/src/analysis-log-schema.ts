import {
	bigserial,
	boolean,
	customType,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; default: false }>({
	dataType() {
		return "bytea";
	},
});

export const analysisLogAnalysis = pgTable(
	"analysis_log_analysis",
	{
		id: text("id").primaryKey(),
		seq: bigserial("seq", { mode: "number" }).notNull(),
		workspaceId: text("workspace_id").notNull(),
		authorId: text("author_id").notNull(),
		host: text("host").notNull(),
		question: text("question").notNull(),
		status: text("status").notNull(),
		draft: boolean("draft").notNull(),
		shared: boolean("shared").notNull(),
		pinned: boolean("pinned").notNull(),
		createdAt: text("created_at").notNull(),
		cutoff: text("cutoff").notNull(),
		scope: jsonb("scope").notNull(),
		finalAnswer: text("final_answer"),
		topics: jsonb("topics").notNull(),
		updates: text("updates"),
		changes: jsonb("changes").notNull(),
		notes: jsonb("notes").notNull(),
		cost: jsonb("cost"),
		queryCount: integer("query_count").notNull(),
		stepCount: integer("step_count").notNull(),
		visibilityRevision: integer("visibility_revision").notNull(),
	},
	(table) => [
		index("analysis_log_analysis_workspace_idx").on(
			table.workspaceId,
			table.authorId,
		),
		index("analysis_log_analysis_author_idx").on(table.authorId),
		index("analysis_log_analysis_updates_idx").on(
			table.workspaceId,
			table.updates,
		),
		index("analysis_log_analysis_draft_idx").on(table.draft, table.createdAt),
	],
);

export const analysisLogStep = pgTable(
	"analysis_log_step",
	{
		id: text("id").primaryKey(),
		seq: bigserial("seq", { mode: "number" }).notNull(),
		analysisId: text("analysis_id")
			.notNull()
			.references(() => analysisLogAnalysis.id, { onDelete: "cascade" }),
		parentId: text("parent_id"),
		ordinal: doublePrecision("ordinal").notNull(),
		question: text("question").notNull(),
		reply: text("reply"),
		finding: text("finding"),
		createdAt: text("created_at").notNull(),
	},
	(table) => [index("analysis_log_step_analysis_idx").on(table.analysisId)],
);

export const analysisLogQuery = pgTable(
	"analysis_log_query",
	{
		id: text("id").primaryKey(),
		seq: bigserial("seq", { mode: "number" }).notNull(),
		analysisId: text("analysis_id")
			.notNull()
			.references(() => analysisLogAnalysis.id, { onDelete: "cascade" }),
		stepId: text("step_id").notNull(),
		workspaceId: text("workspace_id").notNull(),
		authorId: text("author_id").notNull(),
		tool: text("tool").notNull(),
		argsJson: text("args_json").notNull(),
		outputChars: integer("output_chars").notNull(),
		hasOutput: boolean("has_output").notNull(),
		ownerIds: text("owner_ids").array().notNull(),
		createdAt: text("created_at").notNull(),
		removed: boolean("removed").notNull(),
		counts: boolean("counts").notNull(),
		redactionArgsJson: text("redaction_args_json"),
		redactionLabel: text("redaction_label"),
	},
	(table) => [
		index("analysis_log_query_analysis_idx").on(table.analysisId),
		index("analysis_log_query_owner_ids_idx").using("gin", table.ownerIds),
		index("analysis_log_query_output_created_idx").on(
			table.hasOutput,
			table.createdAt,
		),
	],
);

export const analysisLogQueryOutput = pgTable("analysis_log_query_output", {
	queryId: text("query_id")
		.primaryKey()
		.references(() => analysisLogQuery.id, { onDelete: "cascade" }),
	json: text("json").notNull(),
});

export const analysisLogQuerySession = pgTable(
	"analysis_log_query_session",
	{
		queryId: text("query_id")
			.notNull()
			.references(() => analysisLogQuery.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		ownerId: text("owner_id").notNull(),
		revision: text("revision").notNull(),
		parserVersion: integer("parser_version").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.queryId, table.sessionId] }),
		index("analysis_log_query_session_owner_idx").on(table.ownerId),
	],
);

export const analysisLogSessionLink = pgTable(
	"analysis_log_session_link",
	{
		analysisId: text("analysis_id").notNull(),
		source: text("source").notNull(),
		sessionId: text("session_id").notNull(),
		ownerId: text("owner_id").notNull(),
		uploadedAt: text("uploaded_at").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.analysisId, table.source, table.sessionId],
		}),
		foreignKey({
			name: "analysis_log_session_link_analysis_id_fk",
			columns: [table.analysisId],
			foreignColumns: [analysisLogAnalysis.id],
		}).onDelete("cascade"),
		index("analysis_log_session_link_owner_idx").on(table.ownerId),
	],
);

export const analysisLogEmbedding = pgTable(
	"analysis_log_embedding",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		analysisId: text("analysis_id")
			.notNull()
			.references(() => analysisLogAnalysis.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id").notNull(),
		stepId: text("step_id"),
		kind: text("kind").notNull(),
		text: text("text").notNull(),
		model: text("model").notNull(),
		vector: bytea("vector").notNull(),
	},
	(table) => [
		index("analysis_log_embedding_space_idx").on(
			table.workspaceId,
			table.model,
		),
		index("analysis_log_embedding_analysis_idx").on(table.analysisId),
	],
);
