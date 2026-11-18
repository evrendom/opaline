export type PaidPricingPlan = "basic" | "business";
export type PricingBillingPeriod = "monthly" | "yearly";
export type PricingOfferAction =
	| "current"
	| "select"
	| "owner_required"
	| "resolve_payment";

export interface PricingOfferState {
	readonly action: PricingOfferAction;
	readonly billingPeriod: PricingBillingPeriod;
	readonly plan: PaidPricingPlan;
}

export interface PricingWorkspaceState {
	readonly canManageBilling: boolean;
	readonly hasWorkspace: true;
	readonly offers: readonly PricingOfferState[];
	readonly organizationId: string;
	readonly workspaceSlug: string;
}

export function readPricingWorkspaceState(
	response: unknown,
): PricingWorkspaceState | null {
	if (!isObject(response) || !isObject(response.json)) return null;
	const state = response.json;
	if (state.hasWorkspace !== true) return null;
	if (
		typeof state.canManageBilling !== "boolean" ||
		typeof state.organizationId !== "string" ||
		typeof state.workspaceSlug !== "string" ||
		!Array.isArray(state.offers)
	) {
		return null;
	}
	const offers = state.offers.map(readPricingOfferState);
	if (offers.some((offer) => offer === null)) return null;
	return {
		canManageBilling: state.canManageBilling,
		hasWorkspace: true,
		offers: offers.filter((offer) => offer !== null),
		organizationId: state.organizationId,
		workspaceSlug: state.workspaceSlug,
	};
}

export function findPricingOfferState(
	state: PricingWorkspaceState,
	plan: string,
	billingPeriod: PricingBillingPeriod,
): PricingOfferState | null {
	return (
		state.offers.find(
			(offer) => offer.plan === plan && offer.billingPeriod === billingPeriod,
		) ?? null
	);
}

function readPricingOfferState(value: unknown): PricingOfferState | null {
	if (!isObject(value)) return null;
	if (
		!isPaidPricingPlan(value.plan) ||
		!isPricingBillingPeriod(value.billingPeriod) ||
		!isPricingOfferAction(value.action)
	) {
		return null;
	}
	return {
		action: value.action,
		billingPeriod: value.billingPeriod,
		plan: value.plan,
	};
}

function isPaidPricingPlan(value: unknown): value is PaidPricingPlan {
	return value === "basic" || value === "business";
}

function isPricingBillingPeriod(value: unknown): value is PricingBillingPeriod {
	return value === "monthly" || value === "yearly";
}

function isPricingOfferAction(value: unknown): value is PricingOfferAction {
	return (
		value === "current" ||
		value === "select" ||
		value === "owner_required" ||
		value === "resolve_payment"
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
