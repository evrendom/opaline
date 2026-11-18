import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

// The newest Opaline CLI version each user uploaded with. Written best-effort
// on successful transcript ingest and read by the dashboard's update notice.
export const userCliVersion = pgTable("user_cli_version", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	version: text("version").notNull(),
	seenAt: timestamp("seen_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
});

export type UserCliVersionSelect = typeof userCliVersion.$inferSelect;
export type UserCliVersionInsert = typeof userCliVersion.$inferInsert;
