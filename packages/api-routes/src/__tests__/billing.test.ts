import { describe, expect, test } from "bun:test";
import {
	BillingConfigurationOutputSchema,
	CreateOrganizationBillingPortalOutputSchema,
	CreateOrganizationCheckoutInputSchema,
	CreateOrganizationCheckoutOutputSchema,
	findOpalineBillingOffer,
	findOpalineBillingOfferByPrice,
	OPALINE_BILLING_OFFERS,
	OrganizationBillingInputSchema,
	OrganizationBillingSummaryOutputSchema,
	stripeObjectMatchesBillingMode,
} from "../billing.js";
import {
	PRODUCT_ANALYTICS_EVENTS,
	parseProductAnalyticsEvent,
} from "../product-analytics.js";

describe("Opaline billing catalog", () => {
	test("accepts only a concrete paid checkout offer and organization", () => {
		expect(
			CreateOrganizationCheckoutInputSchema.parse({
				billingPeriod: "yearly",
				organizationId: "org-1",
				plan: "business",
			}),
		).toEqual({
			billingPeriod: "yearly",
			organizationId: "org-1",
			plan: "business",
		});
		expect(() =>
			CreateOrganizationCheckoutInputSchema.parse({
				billingPeriod: "monthly",
				organizationId: "",
				plan: "free",
			}),
		).toThrow();
	});

	test("defines every server-owned pricing option without public checkout URLs", () => {
		expect(OPALINE_BILLING_OFFERS).toHaveLength(4);
		for (const plan of ["basic", "business"] as const) {
			for (const billingPeriod of ["monthly", "yearly"] as const) {
				const offer = findOpalineBillingOffer(plan, billingPeriod);
				expect(offer).not.toBeNull();
				expect(offer).not.toHaveProperty("checkoutUrl");
			}
		}
	});

	test("uses the full annual per-member totals from pricing", () => {
		expect(findOpalineBillingOffer("basic", "yearly")?.unitAmount).toBe(25_200);
		expect(findOpalineBillingOffer("business", "yearly")?.unitAmount).toBe(
			50_400,
		);
	});

	test("recognizes only licensed per-unit prices matching the catalog", () => {
		const configuredOffer = findOpalineBillingOffer("basic", "yearly");
		expect(configuredOffer).not.toBeNull();
		const offer = findOpalineBillingOfferByPrice(
			{
				billingScheme: "per_unit",
				currency: "usd",
				interval: "year",
				intervalCount: 1,
				priceId: "price_basic_yearly",
				unitAmount: 25_200,
				usageType: "licensed",
			},
			configuredOffer
				? new Map([[configuredOffer, "price_basic_yearly"]])
				: new Map(),
		);

		expect(offer?.plan).toBe("basic");
		expect(offer?.billingPeriod).toBe("yearly");
	});

	test("rejects a configured price ID with altered price attributes", () => {
		const offer = findOpalineBillingOffer("business", "monthly");
		expect(offer).not.toBeNull();
		const configuredPriceIds = offer
			? new Map([[offer, "price_business_monthly"]])
			: new Map();

		expect(
			findOpalineBillingOfferByPrice(
				{
					billingScheme: "per_unit",
					currency: "usd",
					interval: "month",
					intervalCount: 1,
					priceId: "price_business_monthly",
					unitAmount: 4_999,
					usageType: "licensed",
				},
				configuredPriceIds,
			),
		).toBeNull();
	});

	test("keeps sandbox and live Stripe objects separate", () => {
		expect(stripeObjectMatchesBillingMode(false, "sandbox")).toBe(true);
		expect(stripeObjectMatchesBillingMode(true, "sandbox")).toBe(false);
		expect(stripeObjectMatchesBillingMode(true, "live")).toBe(true);
		expect(stripeObjectMatchesBillingMode(false, "live")).toBe(false);
	});

	test("exposes sandbox configuration and checkout mode to the product", () => {
		expect(
			BillingConfigurationOutputSchema.parse({
				configured: true,
				mode: "sandbox",
			}),
		).toEqual({ configured: true, mode: "sandbox" });
		expect(
			CreateOrganizationCheckoutOutputSchema.parse({
				billingMode: "sandbox",
				checkoutSessionId: "cs_test_123",
				checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
			}),
		).toMatchObject({ billingMode: "sandbox" });
	});

	test("exposes the owner billing summary and hosted portal contract", () => {
		expect(
			OrganizationBillingInputSchema.parse({ organizationId: "org-1" }),
		).toEqual({ organizationId: "org-1" });
		expect(
			OrganizationBillingSummaryOutputSchema.parse({
				hasBillingAccount: true,
				billingPeriod: "monthly",
				plan: "basic",
				seatQuantity: 2,
				status: "active",
			}),
		).toMatchObject({ hasBillingAccount: true, plan: "basic" });
		expect(
			OrganizationBillingSummaryOutputSchema.parse({
				hasBillingAccount: false,
			}),
		).toEqual({ hasBillingAccount: false });
		expect(
			CreateOrganizationBillingPortalOutputSchema.parse({
				billingMode: "sandbox",
				portalUrl: "https://billing.stripe.com/p/session/test_123",
			}),
		).toMatchObject({ billingMode: "sandbox" });
	});
});

describe("payment analytics contract", () => {
	const payload = {
		amount_total: 25_00,
		billing_mode: "sandbox",
		billing_period: "monthly",
		catalog_recurring_amount: 25_00,
		catalog_unit_amount: 25_00,
		currency: "usd",
		environment: "production",
		event_version: 1,
		organization_id: "org-1",
		payment_provider: "stripe",
		payment_status: "paid",
		plan: "basic",
		seat_quantity: 1,
		stripe_invoice_id: "in_123",
		subscription_status: "active",
		surface: "api",
		user_id: "user-1",
	} as const;

	test("accepts the server-owned Payment Completed event", () => {
		expect(
			parseProductAnalyticsEvent(
				PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED,
				payload,
			),
		).toEqual(payload);
	});

	test("accepts the server-owned checkout-started event", () => {
		expect(
			parseProductAnalyticsEvent(
				PRODUCT_ANALYTICS_EVENTS.PAYMENT_CHECKOUT_STARTED,
				{
					billing_mode: "sandbox",
					billing_period: "monthly",
					catalog_recurring_amount: 5_000,
					catalog_unit_amount: 2_500,
					checkout_session_id: "cs_test_123",
					currency: "usd",
					environment: "production",
					event_version: 1,
					organization_id: "org_123",
					payment_provider: "stripe",
					plan: "basic",
					seat_quantity: 2,
					surface: "api",
					user_id: "user_123",
				},
			),
		).toBeTruthy();
	});

	test("accepts the server-owned plan-change-started event", () => {
		expect(
			parseProductAnalyticsEvent(
				PRODUCT_ANALYTICS_EVENTS.PAYMENT_PLAN_CHANGE_STARTED,
				{
					billing_mode: "sandbox",
					billing_period: "yearly",
					catalog_recurring_amount: 48_000,
					catalog_unit_amount: 24_000,
					currency: "usd",
					environment: "production",
					event_version: 1,
					organization_id: "org_123",
					payment_provider: "stripe",
					plan: "business",
					portal_session_id: "bps_123",
					seat_quantity: 2,
					surface: "api",
					user_id: "user_123",
				},
			),
		).toBeTruthy();
	});

	test("rejects accidental PII in payment events", () => {
		expect(() =>
			parseProductAnalyticsEvent(PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED, {
				...payload,
				email: "buyer@example.com",
			}),
		).toThrow();
	});

	test("does not count a no-payment checkout as completed funds", () => {
		expect(() =>
			parseProductAnalyticsEvent(PRODUCT_ANALYTICS_EVENTS.PAYMENT_COMPLETED, {
				...payload,
				payment_status: "no_payment_required",
			}),
		).toThrow();
	});
});
