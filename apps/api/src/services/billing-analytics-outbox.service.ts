import { randomUUID } from "node:crypto";
import { PRODUCT_ANALYTICS_EVENTS } from "@rudel/api-routes";
import type postgres from "postgres";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	deliverApiProductAnalyticsEvent,
	deliverApiProductAnalyticsPersonProperties,
} from "../lib/product-analytics.js";
import {
	billingAnalyticsRetryDelayMs,
	buildUserBillingTraits,
	type DatabaseTimestamp,
	parseBillingDatabaseTimestamp,
	type UserBillingRow,
} from "./billing-analytics-domain.js";
import { refreshCustomerAccountSnapshot } from "./customer-account-snapshot.service.js";

type BillingSql = postgres.Sql | postgres.TransactionSql;

interface AnalyticsOutboxRow {
	attempt_count: number;
	event_name: string | null;
	id: string;
	kind: "event" | "traits";
	occurred_at: DatabaseTimestamp;
	properties: unknown;
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
	z.string(),
	z.union([z.boolean(), z.null(), z.number().finite(), z.string()]),
);
const MAX_ATTEMPTS = 36;

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
	await refreshCustomerAccountSnapshot(organizationId, executor);
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
			await deliverAnalyticsRow(row, transaction);
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

async function deliverAnalyticsRow(
	row: AnalyticsOutboxRow,
	transaction: postgres.TransactionSql,
): Promise<void> {
	if (row.kind === "traits") {
		await deliverApiProductAnalyticsPersonProperties({
			distinctId: row.user_id,
			properties: AnalyticsPropertiesSchema.parse(row.properties),
			sql: transaction,
		});
		return;
	}
	if (row.event_name === PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED) {
		await deliverApiProductAnalyticsEvent({
			distinctId: row.user_id,
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED,
			eventUuid: row.id,
			occurredAt: parseBillingDatabaseTimestamp(row.occurred_at),
			payload: CheckoutStartedPropertiesSchema.parse(row.properties),
			sql: transaction,
		});
		return;
	}
	if (row.event_name === PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED) {
		await deliverApiProductAnalyticsEvent({
			distinctId: row.user_id,
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED,
			eventUuid: row.id,
			occurredAt: parseBillingDatabaseTimestamp(row.occurred_at),
			payload: PaymentCompletedPropertiesSchema.parse(row.properties),
			sql: transaction,
		});
		return;
	}
	if (row.event_name === PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED) {
		await deliverApiProductAnalyticsEvent({
			distinctId: row.user_id,
			event: PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED,
			eventUuid: row.id,
			occurredAt: parseBillingDatabaseTimestamp(row.occurred_at),
			payload: PlanChangeStartedPropertiesSchema.parse(row.properties),
			sql: transaction,
		});
		return;
	}
	throw new Error(
		`Unsupported billing analytics event: ${row.event_name ?? "none"}`,
	);
}
