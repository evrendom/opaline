import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

// Usage digest emails (apps/desktop/server/src/services/usage-digest/). A member's
// choice per workspace; no row means both digests are on, so every member
// receives them until they turn one off in settings or unsubscribe.
export const usageDigestPreference = pgTable(
	"usage_digest_preference",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		daily: boolean("daily").notNull().default(true),
		weekly: boolean("weekly").notNull().default(true),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.organizationId] }),
		index("usage_digest_preference_organization_id_idx").on(
			table.organizationId,
		),
	],
);

// One row per workspace, digest kind and period: the hourly cron enqueues a
// period once it is due, and claims a row before any ClickHouse read or
// email, so two runs never send at once. Each member gets the email on their
// own clock (the weekly at 09:00 Monday, the daily at 19:00), so a row stays
// pending across runs until every member has had theirs. A claim older than the lease is taken over; a
// failed send returns the row to pending for the next run.
export const usageDigest = pgTable(
	"usage_digest",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** "daily" or "weekly". */
		kind: text("kind").notNull(),
		/** First day (UTC) of the period: the day, or the Monday of the week. */
		periodStart: date("period_start", { mode: "string" }).notNull(),
		/** "pending", "claimed" or "done". */
		status: text("status").default("pending").notNull(),
		/** How the period ended: "sent", "nudge", "quiet", "no_recipients", "failed" or "expired" (the next period came first). */
		outcome: text("outcome"),
		recipients: integer("recipients").default(0).notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		leaseToken: text("lease_token"),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "date",
		}),
	},
	(table) => [
		check("usage_digest_kind_check", sql`${table.kind} IN ('daily', 'weekly')`),
		check(
			"usage_digest_status_check",
			sql`${table.status} IN ('pending', 'claimed', 'done')`,
		),
		uniqueIndex("usage_digest_period_unique").on(
			table.organizationId,
			table.kind,
			table.periodStart,
		),
		index("usage_digest_status_idx").on(table.status),
	],
);

// Who already got a digest: one row per digest and member, written right
// after their email went out, so a later run sends only to those still due.
export const usageDigestDelivery = pgTable(
	"usage_digest_delivery",
	{
		digestId: text("digest_id")
			.notNull()
			.references(() => usageDigest.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
	},
	(table) => [primaryKey({ columns: [table.digestId, table.userId] })],
);
