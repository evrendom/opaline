import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema.js";

export const billingSubscription = pgTable(
	"billing_subscription",
	{
		stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		purchaserUserId: text("purchaser_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		stripeCustomerId: text("stripe_customer_id").notNull(),
		stripeSubscriptionItemId: text("stripe_subscription_item_id").notNull(),
		plan: text("plan").notNull(),
		billingPeriod: text("billing_period").notNull(),
		status: text("status").notNull(),
		seatQuantity: integer("seat_quantity").notNull(),
		pendingSeatQuantity: integer("pending_seat_quantity"),
		pendingSeatExpiresAt: timestamp("pending_seat_expires_at", {
			mode: "date",
			withTimezone: true,
		}),
		lastPaidAmount: integer("last_paid_amount"),
		lastPaidCurrency: text("last_paid_currency"),
		lastPaidAt: timestamp("last_paid_at", {
			mode: "date",
			withTimezone: true,
		}),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("billing_subscription_organization_unique").on(
			table.organizationId,
		),
		index("billing_subscription_customer_idx").on(table.stripeCustomerId),
		check(
			"billing_subscription_plan_check",
			sql`${table.plan} IN ('basic', 'business')`,
		),
		check(
			"billing_subscription_period_check",
			sql`${table.billingPeriod} IN ('monthly', 'yearly')`,
		),
		check(
			"billing_subscription_status_check",
			sql`${table.status} IN ('active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid')`,
		),
		check("billing_subscription_seat_check", sql`${table.seatQuantity} > 0`),
		check(
			"billing_subscription_pending_seat_check",
			sql`(${table.pendingSeatQuantity} IS NULL AND ${table.pendingSeatExpiresAt} IS NULL) OR (${table.pendingSeatQuantity} > 0 AND ${table.pendingSeatExpiresAt} IS NOT NULL)`,
		),
		check(
			"billing_subscription_payment_amount_check",
			sql`${table.lastPaidAmount} IS NULL OR ${table.lastPaidAmount} >= 0`,
		),
	],
);

export const billingCustomer = pgTable(
	"billing_customer",
	{
		organizationId: text("organization_id")
			.primaryKey()
			.references(() => organization.id, { onDelete: "cascade" }),
		stripeCustomerId: text("stripe_customer_id").notNull(),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("billing_customer_stripe_customer_unique").on(
			table.stripeCustomerId,
		),
	],
);

export const billingCheckoutAttempt = pgTable(
	"billing_checkout_attempt",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		purchaserUserId: text("purchaser_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		stripeCustomerId: text("stripe_customer_id").notNull(),
		stripeCheckoutSessionId: text("stripe_checkout_session_id"),
		stripeCheckoutUrl: text("stripe_checkout_url"),
		plan: text("plan").notNull(),
		billingPeriod: text("billing_period").notNull(),
		seatQuantity: integer("seat_quantity").notNull(),
		status: text("status").notNull().default("creating"),
		expiresAt: timestamp("expires_at", {
			mode: "date",
			withTimezone: true,
		}),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("billing_checkout_attempt_organization_unique").on(
			table.organizationId,
		),
		uniqueIndex("billing_checkout_attempt_session_unique").on(
			table.stripeCheckoutSessionId,
		),
		check(
			"billing_checkout_attempt_plan_check",
			sql`${table.plan} IN ('basic', 'business')`,
		),
		check(
			"billing_checkout_attempt_period_check",
			sql`${table.billingPeriod} IN ('monthly', 'yearly')`,
		),
		check(
			"billing_checkout_attempt_status_check",
			sql`${table.status} IN ('creating', 'open', 'completed', 'expired')`,
		),
		check(
			"billing_checkout_attempt_seat_check",
			sql`${table.seatQuantity} > 0`,
		),
		check(
			"billing_checkout_attempt_session_check",
			sql`(${table.status} = 'creating' AND ${table.stripeCheckoutSessionId} IS NULL AND ${table.stripeCheckoutUrl} IS NULL AND ${table.expiresAt} IS NULL) OR (${table.status} <> 'creating' AND ${table.stripeCheckoutSessionId} IS NOT NULL)`,
		),
	],
);

export const organizationMonthlyUsage = pgTable(
	"organization_monthly_usage",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		monthStart: date("month_start", { mode: "date" }).notNull(),
		agentRuns: integer("agent_runs").notNull().default(0),
		updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.organizationId, table.monthStart],
			name: "organization_monthly_usage_pkey",
		}),
		check(
			"organization_monthly_usage_agent_runs_check",
			sql`${table.agentRuns} >= 0`,
		),
	],
);

export const stripeWebhookEvent = pgTable(
	"stripe_webhook_event",
	{
		eventId: text("event_id").primaryKey(),
		eventType: text("event_type").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		eventCreatedAt: timestamp("event_created_at", {
			mode: "date",
			withTimezone: true,
		}).notNull(),
		status: text("status").notNull().default("pending"),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: timestamp("next_attempt_at", {
			mode: "date",
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		lastError: text("last_error"),
		processedAt: timestamp("processed_at", {
			mode: "date",
			withTimezone: true,
		}),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("stripe_webhook_event_due_idx").on(table.status, table.nextAttemptAt),
		check(
			"stripe_webhook_event_status_check",
			sql`${table.status} IN ('pending', 'processed', 'blocked')`,
		),
		check(
			"stripe_webhook_event_attempt_check",
			sql`${table.attemptCount} >= 0`,
		),
	],
);

export const billingAnalyticsOutbox = pgTable(
	"billing_analytics_outbox",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		kind: text("kind").notNull(),
		userId: text("user_id").notNull(),
		eventName: text("event_name"),
		properties: jsonb("properties")
			.$type<Record<string, string | number | boolean | null>>()
			.notNull(),
		occurredAt: timestamp("occurred_at", {
			mode: "date",
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		attemptCount: integer("attempt_count").notNull().default(0),
		nextAttemptAt: timestamp("next_attempt_at", {
			mode: "date",
			withTimezone: true,
		})
			.defaultNow()
			.notNull(),
		lastError: text("last_error"),
		deliveredAt: timestamp("delivered_at", {
			mode: "date",
			withTimezone: true,
		}),
		createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("billing_analytics_outbox_due_idx").on(
			table.deliveredAt,
			table.nextAttemptAt,
		),
		check(
			"billing_analytics_outbox_kind_check",
			sql`${table.kind} IN ('event', 'traits')`,
		),
		check(
			"billing_analytics_outbox_event_check",
			sql`(${table.kind} = 'event' AND ${table.eventName} IS NOT NULL) OR (${table.kind} = 'traits' AND ${table.eventName} IS NULL)`,
		),
	],
);

export type BillingSubscriptionInsert = typeof billingSubscription.$inferInsert;
export type BillingSubscriptionSelect = typeof billingSubscription.$inferSelect;
export type BillingCustomerInsert = typeof billingCustomer.$inferInsert;
export type BillingCustomerSelect = typeof billingCustomer.$inferSelect;
export type BillingCheckoutAttemptInsert =
	typeof billingCheckoutAttempt.$inferInsert;
export type BillingCheckoutAttemptSelect =
	typeof billingCheckoutAttempt.$inferSelect;
export type OrganizationMonthlyUsageInsert =
	typeof organizationMonthlyUsage.$inferInsert;
export type OrganizationMonthlyUsageSelect =
	typeof organizationMonthlyUsage.$inferSelect;
export type StripeWebhookEventInsert = typeof stripeWebhookEvent.$inferInsert;
export type StripeWebhookEventSelect = typeof stripeWebhookEvent.$inferSelect;
