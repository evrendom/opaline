import { z } from "zod";

export const OPALINE_BILLING_PLANS = ["basic", "business"] as const;
export const OPALINE_BILLING_PERIODS = ["monthly", "yearly"] as const;
export const OPALINE_BILLING_MODES = ["sandbox", "live"] as const;
export const OPALINE_BILLING_PRICING_ACTIONS = [
	"current",
	"select",
	"owner_required",
	"resolve_payment",
] as const;
export const OPALINE_BILLING_SUBSCRIPTION_STATUSES = [
	"active",
	"canceled",
	"incomplete",
	"incomplete_expired",
	"past_due",
	"paused",
	"trialing",
	"unpaid",
] as const;

export const BillingConfigurationOutputSchema = z.object({
	configured: z.boolean(),
	mode: z.enum(OPALINE_BILLING_MODES).nullable(),
});

export const CreateOrganizationCheckoutInputSchema = z.object({
	billingPeriod: z.enum(OPALINE_BILLING_PERIODS),
	organizationId: z.string().min(1),
	plan: z.enum(OPALINE_BILLING_PLANS),
});

export const CreateOrganizationCheckoutOutputSchema = z.object({
	billingMode: z.enum(OPALINE_BILLING_MODES),
	checkoutSessionId: z.string().min(1),
	checkoutUrl: z.string().url(),
});

export const BillingPricingStateInputSchema = z.object({
	workspaceSlug: z.string().trim().min(1).max(128).optional(),
});

export const BillingPricingOfferActionSchema = z.object({
	action: z.enum(OPALINE_BILLING_PRICING_ACTIONS),
	billingPeriod: z.enum(OPALINE_BILLING_PERIODS),
	plan: z.enum(OPALINE_BILLING_PLANS),
});

export const BillingPricingStateOutputSchema = z.discriminatedUnion(
	"hasWorkspace",
	[
		z.object({ hasWorkspace: z.literal(false) }),
		z.object({
			canManageBilling: z.boolean(),
			hasWorkspace: z.literal(true),
			offers: z.array(BillingPricingOfferActionSchema).length(4),
			organizationId: z.string().min(1),
			status: z.enum(OPALINE_BILLING_SUBSCRIPTION_STATUSES).nullable(),
			workspaceSlug: z.string().min(1),
		}),
	],
);

export const SelectOrganizationPlanOutputSchema = z.object({
	redirectKind: z.enum(["checkout", "portal"]),
	redirectUrl: z.string().url(),
});

export const OrganizationBillingInputSchema = z.object({
	organizationId: z.string().min(1),
});

export const OrganizationBillingSummaryOutputSchema = z.discriminatedUnion(
	"hasBillingAccount",
	[
		z.object({ hasBillingAccount: z.literal(false) }),
		z.object({
			billingPeriod: z.enum(OPALINE_BILLING_PERIODS),
			hasBillingAccount: z.literal(true),
			plan: z.enum(OPALINE_BILLING_PLANS),
			seatQuantity: z.number().int().positive(),
			status: z.enum(OPALINE_BILLING_SUBSCRIPTION_STATUSES),
		}),
	],
);

export const CreateOrganizationBillingPortalOutputSchema = z.object({
	billingMode: z.enum(OPALINE_BILLING_MODES),
	portalUrl: z.string().url(),
});

export const OPALINE_BILLING_OFFERS = [
	{
		billingPeriod: "monthly",
		currency: "usd",
		interval: "month",
		intervalCount: 1,
		monthlyPriceUsd: 25,
		plan: "basic",
		stripePriceEnvironmentVariable: "STRIPE_PRICE_BASIC_MONTHLY",
		unitAmount: 2_500,
	},
	{
		billingPeriod: "yearly",
		currency: "usd",
		interval: "year",
		intervalCount: 1,
		monthlyPriceUsd: 21,
		plan: "basic",
		stripePriceEnvironmentVariable: "STRIPE_PRICE_BASIC_YEARLY",
		unitAmount: 25_200,
	},
	{
		billingPeriod: "monthly",
		currency: "usd",
		interval: "month",
		intervalCount: 1,
		monthlyPriceUsd: 50,
		plan: "business",
		stripePriceEnvironmentVariable: "STRIPE_PRICE_BUSINESS_MONTHLY",
		unitAmount: 5_000,
	},
	{
		billingPeriod: "yearly",
		currency: "usd",
		interval: "year",
		intervalCount: 1,
		monthlyPriceUsd: 42,
		plan: "business",
		stripePriceEnvironmentVariable: "STRIPE_PRICE_BUSINESS_YEARLY",
		unitAmount: 50_400,
	},
] as const;

export type OpalineBillingOffer = (typeof OPALINE_BILLING_OFFERS)[number];
export type OpalineBillingPlan = OpalineBillingOffer["plan"];
export type OpalineBillingPeriod = OpalineBillingOffer["billingPeriod"];
export type OpalineBillingMode = (typeof OPALINE_BILLING_MODES)[number];
export type BillingConfiguration = z.infer<
	typeof BillingConfigurationOutputSchema
>;
export type CreateOrganizationCheckoutInput = z.infer<
	typeof CreateOrganizationCheckoutInputSchema
>;
export type CreateOrganizationCheckoutOutput = z.infer<
	typeof CreateOrganizationCheckoutOutputSchema
>;
export type BillingPricingStateInput = z.infer<
	typeof BillingPricingStateInputSchema
>;
export type BillingPricingOfferAction = z.infer<
	typeof BillingPricingOfferActionSchema
>;
export type BillingPricingState = z.infer<
	typeof BillingPricingStateOutputSchema
>;
export type OrganizationBillingInput = z.infer<
	typeof OrganizationBillingInputSchema
>;
export type OrganizationBillingSummary = z.infer<
	typeof OrganizationBillingSummaryOutputSchema
>;
export type CreateOrganizationBillingPortalOutput = z.infer<
	typeof CreateOrganizationBillingPortalOutputSchema
>;
export type SelectOrganizationPlanOutput = z.infer<
	typeof SelectOrganizationPlanOutputSchema
>;

export interface OpalineBillingPriceIdentity {
	billingScheme: string;
	currency: string;
	interval: string;
	intervalCount: number;
	priceId: string;
	unitAmount: number | null;
	usageType: string;
}

export function findOpalineBillingOffer(
	plan: OpalineBillingPlan,
	billingPeriod: OpalineBillingPeriod,
): OpalineBillingOffer | null {
	return (
		OPALINE_BILLING_OFFERS.find(
			(offer) => offer.plan === plan && offer.billingPeriod === billingPeriod,
		) ?? null
	);
}

export function findOpalineBillingOfferByPrice(
	price: OpalineBillingPriceIdentity,
	configuredPriceIds: ReadonlyMap<OpalineBillingOffer, string>,
): OpalineBillingOffer | null {
	const matchingConfiguredOffer = OPALINE_BILLING_OFFERS.find(
		(offer) => configuredPriceIds.get(offer) === price.priceId,
	);
	if (matchingConfiguredOffer) {
		return priceMatchesOffer(price, matchingConfiguredOffer)
			? matchingConfiguredOffer
			: null;
	}

	return null;
}

export function isOpalineBillingPlan(
	value: string | null | undefined,
): value is OpalineBillingPlan {
	return value === "basic" || value === "business";
}

export function isOpalineBillingPeriod(
	value: string | null | undefined,
): value is OpalineBillingPeriod {
	return value === "monthly" || value === "yearly";
}

export function stripeObjectMatchesBillingMode(
	liveMode: boolean,
	billingMode: OpalineBillingMode,
): boolean {
	return liveMode === (billingMode === "live");
}

function priceMatchesOffer(
	price: OpalineBillingPriceIdentity,
	offer: OpalineBillingOffer,
): boolean {
	return (
		price.billingScheme === "per_unit" &&
		price.currency.toLowerCase() === offer.currency &&
		price.interval === offer.interval &&
		price.intervalCount === offer.intervalCount &&
		price.unitAmount === offer.unitAmount &&
		price.usageType === "licensed"
	);
}
