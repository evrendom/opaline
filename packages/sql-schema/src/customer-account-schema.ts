import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./auth-schema.js";

export const customerAccountSnapshot = pgTable(
	"customer_account_snapshot",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		organizationName: text("organization_name").notNull(),
		organizationSlug: text("organization_slug").notNull(),
		organizationCreatedAt: timestamp("organization_created_at", {
			mode: "date",
			withTimezone: true,
		}).notNull(),
		billingPlan: text("billing_plan").notNull().default("free"),
		billingPeriod: text("billing_period").notNull().default("none"),
		subscriptionStatus: text("subscription_status").notNull().default("none"),
		paymentStatus: text("payment_status").notNull().default("free"),
		seatQuantity: integer("seat_quantity").notNull().default(0),
		memberCount: integer("member_count").notNull().default(0),
		lastPaidAmount: integer("last_paid_amount"),
		lastPaidCurrency: text("last_paid_currency"),
		lastPaidAt: timestamp("last_paid_at", {
			mode: "date",
			withTimezone: true,
		}),
		agentRuns7d: integer("agent_runs_7d").notNull().default(0),
		agentRuns30d: integer("agent_runs_30d").notNull().default(0),
		activeMembers30d: integer("active_members_30d").notNull().default(0),
		lastActiveAt: timestamp("last_active_at", {
			mode: "date",
			withTimezone: true,
		}),
		usageRefreshedAt: timestamp("usage_refreshed_at", {
			mode: "date",
			withTimezone: true,
		}),
		attioSyncPendingAt: timestamp("attio_sync_pending_at", {
			mode: "date",
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		attioSyncedAt: timestamp("attio_synced_at", {
			mode: "date",
			withTimezone: true,
		}),
		attioSyncAttemptCount: integer("attio_sync_attempt_count")
			.notNull()
			.default(0),
		attioNextAttemptAt: timestamp("attio_next_attempt_at", {
			mode: "date",
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		attioLastError: text("attio_last_error"),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("customer_account_snapshot_usage_refresh_idx").on(
			table.usageRefreshedAt,
		),
		index("customer_account_snapshot_attio_due_idx").on(
			table.attioSyncedAt,
			table.attioNextAttemptAt,
		),
		check(
			"customer_account_snapshot_billing_plan_check",
			sql`${table.billingPlan} IN ('free', 'basic', 'business')`,
		),
		check(
			"customer_account_snapshot_billing_period_check",
			sql`${table.billingPeriod} IN ('none', 'monthly', 'yearly')`,
		),
		check(
			"customer_account_snapshot_counts_check",
			sql`${table.seatQuantity} >= 0 AND ${table.memberCount} >= 0 AND ${table.agentRuns7d} >= 0 AND ${table.agentRuns30d} >= 0 AND ${table.activeMembers30d} >= 0 AND ${table.attioSyncAttemptCount} >= 0`,
		),
	],
);

export type CustomerAccountSnapshotInsert =
	typeof customerAccountSnapshot.$inferInsert;
export type CustomerAccountSnapshotSelect =
	typeof customerAccountSnapshot.$inferSelect;
