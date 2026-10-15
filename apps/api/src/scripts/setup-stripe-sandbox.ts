import {
	OPALINE_BILLING_OFFERS,
	type OpalineBillingOffer,
	stripeObjectMatchesBillingMode,
} from "@rudel/api-routes";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../stripe-client.js";

const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
if (!secretKey.startsWith("sk_test_")) {
	throw new Error(
		"STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...).",
	);
}

const stripe = new Stripe(secretKey, {
	apiVersion: STRIPE_API_VERSION,
	maxNetworkRetries: 2,
	timeout: 10_000,
});
const priceIds = new Map<string, string>();

for (const offer of OPALINE_BILLING_OFFERS) {
	const price = await findOrCreateSandboxPrice(stripe, offer);
	priceIds.set(offer.stripePriceEnvironmentVariable, price.id);
}

console.log("# Add these values to apps/api/.env.local");
console.log("STRIPE_BILLING_MODE=sandbox");
for (const offer of OPALINE_BILLING_OFFERS) {
	const priceId = priceIds.get(offer.stripePriceEnvironmentVariable);
	if (!priceId)
		throw new Error("Stripe sandbox price provisioning was incomplete");
	console.log(`${offer.stripePriceEnvironmentVariable}=${priceId}`);
}

async function findOrCreateSandboxPrice(
	client: Stripe,
	offer: OpalineBillingOffer,
): Promise<Stripe.Price> {
	const lookupKey = buildLookupKey(offer);
	const existing = await client.prices.list({
		active: true,
		limit: 2,
		lookup_keys: [lookupKey],
	});
	if (existing.data.length > 1) {
		throw new Error(
			`Multiple active Stripe prices use lookup key ${lookupKey}`,
		);
	}
	const price =
		existing.data[0] ??
		(await client.prices.create({
			currency: offer.currency,
			lookup_key: lookupKey,
			metadata: {
				opaline_billing_period: offer.billingPeriod,
				opaline_billing_mode: "sandbox",
				opaline_plan: offer.plan,
			},
			product_data: {
				name: `Opaline ${capitalize(offer.plan)} (Sandbox)`,
			},
			recurring: {
				interval: offer.interval,
				interval_count: offer.intervalCount,
				usage_type: "licensed",
			},
			unit_amount: offer.unitAmount,
		}));
	assertPriceMatchesOffer(price, offer);
	return price;
}

function assertPriceMatchesOffer(
	price: Stripe.Price,
	offer: OpalineBillingOffer,
): void {
	const recurring = price.recurring;
	if (
		!price.active ||
		!stripeObjectMatchesBillingMode(price.livemode, "sandbox") ||
		price.billing_scheme !== "per_unit" ||
		price.currency !== offer.currency ||
		price.unit_amount !== offer.unitAmount ||
		!recurring ||
		recurring.interval !== offer.interval ||
		recurring.interval_count !== offer.intervalCount ||
		recurring.usage_type !== "licensed"
	) {
		throw new Error(
			`Stripe price ${price.id} does not match ${offer.plan} ${offer.billingPeriod}`,
		);
	}
}

function buildLookupKey(offer: OpalineBillingOffer): string {
	return `opaline_${offer.plan}_${offer.billingPeriod}_sandbox_v2`;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
