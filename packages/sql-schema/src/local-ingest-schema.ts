import {
	bigint,
	doublePrecision,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const localIngestFile = pgTable(
	"local_ingest_file",
	{
		path: text("path").primaryKey(),
		source: text("source").notNull(),
		role: text("role").notNull(),
		sessionPath: text("session_path").notNull(),
		sessionId: text("session_id"),
		organizationId: text("organization_id"),
		userId: text("user_id"),
		device: text("device").notNull(),
		inode: text("inode").notNull(),
		size: bigint("size", { mode: "number" }).notNull(),
		mtimeMs: doublePrecision("mtime_ms").notNull(),
		headSha256: text("head_sha256"),
		ingestedSize: bigint("ingested_size", { mode: "number" }),
		ingestedTailSha256: text("ingested_tail_sha256"),
		ingestedMtimeMs: doublePrecision("ingested_mtime_ms"),
		state: text("state").default("pending").notNull(),
		reason: text("reason"),
		attempts: integer("attempts").default(0).notNull(),
		nextAttemptAt: timestamp("next_attempt_at", {
			withTimezone: true,
			mode: "date",
		}),
		ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "date" }),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("local_ingest_file_session_path_idx").on(table.sessionPath),
	],
);

export type LocalIngestFileSelect = typeof localIngestFile.$inferSelect;

export const localIngestMilestone = pgTable("local_ingest_milestone", {
	name: text("name").primaryKey(),
	reachedAt: timestamp("reached_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});
