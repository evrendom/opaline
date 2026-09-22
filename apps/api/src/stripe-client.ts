import {
	type BillingConfiguration,
	OPALINE_BILLING_OFFERS,
	type OpalineBillingMode,
} from "@rudel/api-routes";
import Stripe from "stripe";

export interface StripeWebhookConfig {
	client: Stripe;
	webhookSecret: string;
}

let stripeClient: Stripe | null = null;
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
const LOOPBACK_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function getStripeBillingConfiguration(): BillingConfiguration {
	const mode = getStripeBillingMode();
	return {
		configured:
			mode !== null &&
			(mode === "live" || sandboxUsesLocalDatabase()) &&
			Boolean(process.env.STRIPE_SECRET_KEY?.trim()) &&
			Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()) &&
			OPALINE_BILLING_OFFERS.every((offer) =>
				Boolean(process.env[offer.stripePriceEnvironmentVariable]?.trim()),
			),
		mode,
	};
}

export function getStripeBillingMode(): OpalineBillingMode | null {
	const value = process.env.STRIPE_BILLING_MODE?.trim();
	if (!value) return null;
	if (value === "sandbox" || value === "live") return value;
	throw new Error("STRIPE_BILLING_MODE must be sandbox or live");
}

export function requireStripeBillingMode(): OpalineBillingMode {
	const mode = getStripeBillingMode();
	if (!mode) throw new Error("STRIPE_BILLING_MODE is required");
	if (mode === "sandbox" && !sandboxUsesLocalDatabase()) {
		throw new Error(
			"Stripe sandbox billing requires a loopback PostgreSQL database",
		);
	}
	return mode;
}

export function getStripeWebhookConfig(): StripeWebhookConfig | null {
	if (!getStripeBillingConfiguration().configured) return null;
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
	const client = getStripeClient();
	return client && webhookSecret ? { client, webhookSecret } : null;
}

export function getStripeClient(): Stripe | null {
	const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
	if (!secretKey) return null;
	assertSecretKeyMatchesBillingMode(secretKey, requireStripeBillingMode());
	stripeClient ??= new Stripe(secretKey, {
		apiVersion: STRIPE_API_VERSION,
		maxNetworkRetries: 2,
		timeout: 10_000,
	});
	return stripeClient;
}

function assertSecretKeyMatchesBillingMode(
	secretKey: string,
	billingMode: OpalineBillingMode,
): void {
	const isTestKey =
		secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_");
	const isLiveKey =
		secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
	if (billingMode === "sandbox" && !isTestKey) {
		throw new Error("Sandbox billing requires a Stripe test-mode secret key");
	}
	if (billingMode === "live" && !isLiveKey) {
		throw new Error("Live billing requires a Stripe live-mode secret key");
	}
}

function sandboxUsesLocalDatabase(): boolean {
	const connectionString = process.env.PG_CONNECTION_STRING?.trim();
	if (!connectionString) return false;
	try {
		return LOOPBACK_DATABASE_HOSTS.has(new URL(connectionString).hostname);
	} catch {
		return false;
	}
}
