import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./auth-schema.js";

/**
 * The per-workspace OpenAI quota of transcript search: tokens embedded in one
 * fixed window per workspace. Deleted with the workspace.
 */
export const transcriptEmbeddingQuota = pgTable("transcript_embedding_quota", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	windowStartedAt: timestamp("window_started_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
	tokenCount: bigint("token_count", { mode: "number" }).notNull(),
});
