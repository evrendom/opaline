import {
	findOpalineBillingOffer,
	type OpalineBillingPeriod,
	type OpalineBillingPlan,
} from "@rudel/api-routes";
import { getStripeBillingMode } from "../stripe-client.js";

export type AnalyticsProperties = Record<
	string,
	boolean | null | number | string
>;
export type DatabaseTimestamp = Date | string;

export interface UserBillingRow {
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

const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 3 * 60 * 60 * 1000;

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
			? parseBillingDatabaseTimestamp(subscription.last_paid_at).toISOString()
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

export function parseBillingDatabaseTimestamp(value: DatabaseTimestamp): Date {
	return value instanceof Date ? value : new Date(value);
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
