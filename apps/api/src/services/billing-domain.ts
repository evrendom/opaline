import {
	type BillingPricingOfferAction,
	OPALINE_BILLING_OFFERS,
	type OpalineBillingPeriod,
	type OpalineBillingPlan,
} from "@rudel/api-routes";

type BillingSubscriptionStatus =
	| "active"
	| "canceled"
	| "incomplete"
	| "incomplete_expired"
	| "past_due"
	| "paused"
	| "trialing"
	| "unpaid";

const MAX_WEBHOOK_RETRY_DELAY_MS = 3 * 60 * 60 * 1000;
const WEBHOOK_RETRY_BASE_DELAY_MS = 60 * 1000;

export function buildBillingPricingOfferActions(input: {
	billingPeriod: OpalineBillingPeriod | null;
	canManageBilling: boolean;
	plan: OpalineBillingPlan | null;
	status: BillingSubscriptionStatus | null;
}): BillingPricingOfferAction[] {
	const hasPaidAccess =
		input.status === "active" || input.status === "trialing";
	const canStartCheckout =
		input.status === null ||
		input.status === "canceled" ||
		input.status === "incomplete_expired";
	return OPALINE_BILLING_OFFERS.map((offer) => {
		const isCurrent =
			hasPaidAccess &&
			input.plan === offer.plan &&
			input.billingPeriod === offer.billingPeriod;
		let action: BillingPricingOfferAction["action"];
		if (isCurrent) action = "current";
		else if (!input.canManageBilling) action = "owner_required";
		else if (hasPaidAccess || canStartCheckout) action = "select";
		else action = "resolve_payment";
		return {
			action,
			billingPeriod: offer.billingPeriod,
			plan: offer.plan,
		};
	});
}

export function stripeWebhookRetryDelayMs(attemptCount: number): number {
	if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
		throw new Error("Stripe webhook attempt count must be a positive integer");
	}
	return Math.min(
		WEBHOOK_RETRY_BASE_DELAY_MS * 2 ** Math.min(attemptCount - 1, 20),
		MAX_WEBHOOK_RETRY_DELAY_MS,
	);
}
