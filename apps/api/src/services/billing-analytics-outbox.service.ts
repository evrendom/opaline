import { randomUUID } from "node:crypto";
import {
	findOpalineBillingOffer,
	type OpalineBillingPeriod,
	type OpalineBillingPlan,
	PRODUCT_ANALYTICS_EVENTS,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	deliverApiProductAnalyticsEvent,
	deliverApiProductAnalyticsPersonProperties,
} from "../lib/product-analytics.js";
import { getStripeBillingMode } from "../stripe-client.js";

type BillingSql = postgres.Sql | postgres.TransactionSql;
type AnalyticsProperties = Record<string, boolean | null | number | string>;
type DatabaseTimestamp = Date | string;

interface AnalyticsOutboxRow {
	attempt_count: number;
	event_name: string | null;
	id: string;
	kind: "event" | "traits";
	occurred_at: DatabaseTimestamp;
	properties: unknown;
	user_id: string;
}

interface UserBillingRow {
	billing_period: OpalineBillingPeriod | null;
	last_paid_amount: number | null;
	last_paid_at: DatabaseTimestamp | null;
	last_paid_currency: string | null;
	organization_id: string | null;
	plan: OpalineBillingPlan | null;
	role: string;
	seat_quantity: number | null;
	status: string | null;
	user_id: string;
}

const BillingPlanSchema = z.enum(["basic", "business"]);
const BillingPeriodSchema = z.enum(["monthly", "yearly"]);
const CheckoutStartedPropertiesSchema = z.object({
	billing_mode: z.enum(["sandbox", "live"]),
	billing_period: BillingPeriodSchema,
	catalog_recurring_amount: z.number().int().nonnegative(),
	catalog_unit_amount: z.number().int().nonnegative(),
	checkout_session_id: z.string().min(1),
	currency: z.string().length(3),
	organization_id: z.string().min(1),
	payment_provider: z.literal("stripe"),
	plan: BillingPlanSchema,
	seat_quantity: z.number().int().positive(),
	user_id: z.string().min(1),
});
const PlanChangeStartedPropertiesSchema = z.object({
	billing_mode: z.enum(["sandbox", "live"]),
	billing_period: BillingPeriodSchema,
	catalog_recurring_amount: z.number().int().nonnegative(),
	catalog_unit_amount: z.number().int().nonnegative(),
	currency: z.string().length(3),
	organization_id: z.string().min(1),
	payment_provider: z.literal("stripe"),
	plan: BillingPlanSchema,
	portal_session_id: z.string().min(1),
	seat_quantity: z.number().int().positive(),
	user_id: z.string().min(1),
});
const PaymentCompletedPropertiesSchema = z.object({
	amount_total: z.number().int().nonnegative(),
	billing_mode: z.enum(["sandbox", "live"]),
	billing_period: BillingPeriodSchema,
	catalog_recurring_amount: z.number().int().nonnegative(),
	catalog_unit_amount: z.number().int().nonnegative(),
	currency: z.string().length(3),
	organization_id: z.string().min(1),
	payment_provider: z.literal("stripe"),
	payment_status: z.literal("paid"),
	plan: BillingPlanSchema,
	seat_quantity: z.number().int().positive(),
	stripe_invoice_id: z.string().min(1),
	subscription_status: z.enum([
		"active",
		"canceled",
		"incomplete",
		"incomplete_expired",
		"past_due",
		"paused",
		"trialing",
		"unpaid",
	]),
	user_id: z.string().min(1),
});
const AnalyticsPropertiesSchema = z.record(
	z.union([z.boolean(), z.null(), z.number().finite(), z.string()]),
);
const MAX_ATTEMPTS = 36;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 3 * 60 * 60 * 1000;

export async function enqueueBillingAnalyticsEvent(
	input:
		| {
				event: typeof PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED;
				properties: z.infer<typeof CheckoutStartedPropertiesSchema>;
		  }
		| {
				event: typeof PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED;
				properties: z.infer<typeof PaymentCompletedPropertiesSchema>;
		  }
		| {
				event: typeof PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED;
				properties: z.infer<typeof PlanChangeStartedPropertiesSchema>;
		  },
	options: {
		eventId?: string;
		occurredAt?: Date;
		transaction?: postgres.TransactionSql;
	} = {},
): Promise<void> {
	const executor = options.transaction ?? sqlClient;
	let properties:
		| z.infer<typeof CheckoutStartedPropertiesSchema>
		| z.infer<typeof PaymentCompletedPropertiesSchema>
		| z.infer<typeof PlanChangeStartedPropertiesSchema>;
	if (input.event === PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED) {
		properties = CheckoutStartedPropertiesSchema.parse(input.properties);
	} else if (
		input.event === PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED
	) {
		properties = PlanChangeStartedPropertiesSchema.parse(input.properties);
	} else {
		properties = PaymentCompletedPropertiesSchema.parse(input.properties);
	}
	await executor.unsafe(
		`INSERT INTO billing_analytics_outbox (
			id, kind, user_id, event_name, properties, occurred_at
		) VALUES ($1::uuid, 'event', $2, $3, $4::jsonb, $5)
		ON CONFLICT (id) DO NOTHING`,
		[
			options.eventId ?? randomUUID(),
			properties.user_id,
			input.event,
			JSON.stringify(properties),
			(options.occurredAt ?? new Date()).toISOString(),
		],
	);
}

export async function enqueueBillingTraitsForUsers(
	userIds: readonly string[],
	executor?: postgres.TransactionSql,
): Promise<void> {
	if (!executor) {
		await sqlClient.begin((transaction) =>
			enqueueBillingTraitsForUsers(userIds, transaction),
		);
		return;
	}
	const uniqueUserIds = [...new Set(userIds)].filter(Boolean).sort();
	if (uniqueUserIds.length === 0) return;
	for (const userId of uniqueUserIds) {
		await executor.unsafe(
			"SELECT pg_advisory_xact_lock(731827, hashtext($1))",
			[userId],
		);
	}
	const rows = await readUserBillingRows(uniqueUserIds, executor);
	for (const userId of uniqueUserIds) {
		const properties = buildUserBillingTraits(
			rows.filter((row) => row.user_id === userId),
		);
		await executor.unsafe(
			`DELETE FROM billing_analytics_outbox
			WHERE kind = 'traits' AND user_id = $1 AND delivered_at IS NULL`,
			[userId],
		);
		await executor.unsafe(
			`INSERT INTO billing_analytics_outbox (
				id, kind, user_id, properties
			) VALUES ($1::uuid, 'traits', $2, $3::jsonb)`,
			[randomUUID(), userId, JSON.stringify(properties)],
		);
	}
}

export async function enqueueBillingTraitsForOrganization(
	organizationId: string,
	executor?: postgres.TransactionSql,
): Promise<void> {
	if (!executor) {
		await sqlClient.begin((transaction) =>
			enqueueBillingTraitsForOrganization(organizationId, transaction),
		);
		return;
	}
	const members = await executor.unsafe<Array<{ user_id: string }>>(
		"SELECT user_id FROM member WHERE organization_id = $1",
		[organizationId],
	);
	await enqueueBillingTraitsForUsers(
		members.map((member) => member.user_id),
		executor,
	);
}

export async function runBillingAnalyticsOutboxPass(
	limit = 20,
): Promise<number> {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new Error("Billing analytics batch size must be between 1 and 100");
	}
	let processed = 0;
	for (let index = 0; index < limit; index += 1) {
		const found = await processNextAnalyticsRow();
		if (!found) break;
		processed += 1;
	}
	return processed;
}

export async function readBlockedBillingAnalyticsCount(): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		`SELECT COUNT(*)::int AS count
		FROM billing_analytics_outbox
		WHERE delivered_at IS NULL AND attempt_count >= $1`,
		[MAX_ATTEMPTS],
	);
	return row?.count ?? 0;
}

export async function requeueBlockedBillingAnalyticsDeliveries(): Promise<number> {
	const rows = await sqlClient.unsafe<Array<{ id: string }>>(
		`UPDATE billing_analytics_outbox
		SET attempt_count = 0, next_attempt_at = NOW(), last_error = NULL
		WHERE delivered_at IS NULL AND attempt_count >= $1
		RETURNING id`,
		[MAX_ATTEMPTS],
	);
	return rows.length;
}

export function billingAnalyticsRetryDelayMs(attemptCount: number): number {
	if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
		throw new Error(
			"Billing analytics attempt count must be a positive integer",
		);
	}
	return Math.min(
		BASE_RETRY_DELAY_MS * 2 ** (attemptCount - 1),
		MAX_RETRY_DELAY_MS,
	);
}

function readUserBillingRows(
	userIds: readonly string[],
	executor: BillingSql,
): Promise<UserBillingRow[]> {
	return executor.unsafe<UserBillingRow[]>(
		`SELECT
			member.user_id,
			member.role,
			subscription.organization_id,
			subscription.plan,
			subscription.billing_period,
			subscription.status,
			subscription.seat_quantity,
			subscription.last_paid_amount,
			subscription.last_paid_currency,
			subscription.last_paid_at
		FROM member
		LEFT JOIN billing_subscription subscription
			ON subscription.organization_id = member.organization_id
		WHERE member.user_id = ANY($1::text[])`,
		[userIds],
	);
}

export function buildUserBillingTraits(
	rows: readonly UserBillingRow[],
): AnalyticsProperties {
	const subscription = rows
		.filter(isCurrentSubscriptionBillingRow)
		.sort(compareSubscriptionWorkspace)[0];
	const hasPaidWorkspace = rows.some(isPaidAccessBillingRow);
	return {
		billing_mode: getStripeBillingMode() ?? "unconfigured",
		billing_last_payment_amount: subscription?.last_paid_amount ?? null,
		billing_last_payment_at: subscription?.last_paid_at
			? parseDatabaseTimestamp(subscription.last_paid_at).toISOString()
			: null,
		billing_last_payment_currency: subscription?.last_paid_currency ?? null,
		billing_period: subscription?.billing_period ?? "none",
		billing_plan: subscription?.plan ?? "free",
		billing_seat_quantity: subscription?.seat_quantity ?? 0,
		billing_subscription_status: subscription?.status ?? "none",
		billing_subscription_type: subscription
			? `${subscription.plan}_${subscription.billing_period}`
			: "free",
		has_paid_workspace: hasPaidWorkspace,
		payment_status: subscription
			? billingPaymentStatus(subscription.status)
			: "free",
		was_invited_to_team: rows.some((row) => row.role !== "owner"),
	};
}

interface SubscriptionBillingRow extends UserBillingRow {
	billing_period: OpalineBillingPeriod;
	organization_id: string;
	plan: OpalineBillingPlan;
	seat_quantity: number;
	status: string;
}

interface PaidAccessBillingRow extends SubscriptionBillingRow {
	status: "active" | "past_due" | "trialing";
}

function isCurrentSubscriptionBillingRow(
	row: UserBillingRow,
): row is SubscriptionBillingRow {
	return (
		row.status !== null &&
		row.status !== "canceled" &&
		row.status !== "incomplete_expired" &&
		row.billing_period !== null &&
		row.organization_id !== null &&
		row.plan !== null &&
		row.seat_quantity !== null
	);
}

function isPaidAccessBillingRow(
	row: UserBillingRow,
): row is PaidAccessBillingRow {
	return (
		(row.status === "active" ||
			row.status === "trialing" ||
			row.status === "past_due") &&
		row.billing_period !== null &&
		row.organization_id !== null &&
		row.plan !== null &&
		row.seat_quantity !== null
	);
}

function billingPaymentStatus(status: string): string {
	if (status === "active" || status === "trialing") return "paid";
	return status;
}

function compareSubscriptionWorkspace(
	left: SubscriptionBillingRow,
	right: SubscriptionBillingRow,
): number {
	const leftOffer = findOpalineBillingOffer(left.plan, left.billing_period);
	const rightOffer = findOpalineBillingOffer(right.plan, right.billing_period);
	return (
		billingStatusPriority(right.status) - billingStatusPriority(left.status) ||
		(rightOffer?.monthlyPriceUsd ?? 0) * right.seat_quantity -
			(leftOffer?.monthlyPriceUsd ?? 0) * left.seat_quantity ||
		left.organization_id.localeCompare(right.organization_id)
	);
}

function billingStatusPriority(status: string): number {
	if (status === "active" || status === "trialing") return 3;
	if (status === "past_due") return 2;
	return 1;
}

async function processNextAnalyticsRow(): Promise<boolean> {
	return sqlClient.begin(async (transaction) => {
		const [row] = await transaction.unsafe<AnalyticsOutboxRow[]>(
			`SELECT id, kind, user_id, event_name, properties, occurred_at, attempt_count
			FROM billing_analytics_outbox
			WHERE delivered_at IS NULL AND next_attempt_at <= NOW()
				AND attempt_count < $1
			ORDER BY next_attempt_at, created_at
			LIMIT 1
			FOR UPDATE SKIP LOCKED`,
			[MAX_ATTEMPTS],
		);
		if (!row) return false;
		try {
			await deliverAnalyticsRow(row);
			await transaction.unsafe(
				`UPDATE billing_analytics_outbox
				SET delivered_at = NOW(), last_error = NULL
				WHERE id = $1::uuid`,
				[row.id],
			);
		} catch (error) {
			const attempts = row.attempt_count + 1;
			const nextAttemptAt = new Date(
				Date.now() + billingAnalyticsRetryDelayMs(attempts),
			);
			await transaction.unsafe(
				`UPDATE billing_analytics_outbox
				SET attempt_count = attempt_count + 1,
					next_attempt_at = $2,
					last_error = left($3, 1000)
				WHERE id = $1::uuid`,
				[
					row.id,
					nextAttemptAt.toISOString(),
					error instanceof Error ? error.message : String(error),
				],
			);
		}
		return true;
	});
}

async function deliverAnalyticsRow(row: AnalyticsOutboxRow): Promise<void> {
	if (row.kind === "traits") {
		await deliverApiProductAnalyticsPersonProperties({
			distinctId: row.user_id,
			properties: AnalyticsPropertiesSchema.parse(row.properties),
		});
		return;
	}
	if (row.event_name === PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED) {
		await deliverApiProductAnalyticsEvent({
			distinctId: row.user_id,
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED,
			eventUuid: row.id,
			occurredAt: parseDatabaseTimestamp(row.occurred_at),
			payload: CheckoutStartedPropertiesSchema.parse(row.properties),
		});
		return;
	}
	if (row.event_name === PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED) {
		await deliverApiProductAnalyticsEvent({
			distinctId: row.user_id,
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED,
			eventUuid: row.id,
			occurredAt: parseDatabaseTimestamp(row.occurred_at),
			payload: PaymentCompletedPropertiesSchema.parse(row.properties),
		});
		return;
	}
	if (row.event_name === PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED) {
		await deliverApiProductAnalyticsEvent({
			distinctId: row.user_id,
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED,
			eventUuid: row.id,
			occurredAt: parseDatabaseTimestamp(row.occurred_at),
			payload: PlanChangeStartedPropertiesSchema.parse(row.properties),
		});
		return;
	}
	throw new Error(
		`Unsupported billing analytics event: ${row.event_name ?? "none"}`,
	);
}

function parseDatabaseTimestamp(value: DatabaseTimestamp): Date {
	return value instanceof Date ? value : new Date(value);
}
