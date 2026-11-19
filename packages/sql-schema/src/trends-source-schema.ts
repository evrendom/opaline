import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Trends' sources, one row each: the last good capture the API's cron
// stored, served to the marketing build. Slopalytics' rolling window is
// merged in, so days it no longer publishes stay.
export const trendsSource = pgTable("trends_source", {
	source: text("source").primaryKey(),
	payload: jsonb("payload").notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});
