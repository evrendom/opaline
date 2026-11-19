import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Pooler-safe mutual exclusion for work that outlives one transaction. A row
// is a lease on `name` held by the random `holder` until `expires_at`; the
// API's postgres-lease service acquires, renews and releases it. Session-level
// advisory locks are not used because a transaction-mode pooler does not pin a
// client to one server session.
export const coordinationLease = pgTable("coordination_lease", {
	name: text("name").primaryKey(),
	holder: text("holder").notNull(),
	acquiredAt: timestamp("acquired_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull(),
	expiresAt: timestamp("expires_at", {
		withTimezone: true,
		mode: "date",
	}).notNull(),
});

export type CoordinationLeaseSelect = typeof coordinationLease.$inferSelect;
export type CoordinationLeaseInsert = typeof coordinationLease.$inferInsert;
