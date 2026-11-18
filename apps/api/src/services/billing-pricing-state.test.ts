import { describe, expect, test } from "bun:test";
import {
	buildBillingPricingOfferActions,
	stripeWebhookRetryDelayMs,
} from "./billing-domain.js";

describe("billing pricing actions", () => {
	test("lets an owner keep or change an active plan", () => {
		const actions = buildBillingPricingOfferActions({
			billingPeriod: "yearly",
			canManageBilling: true,
			plan: "business",
			status: "active",
		});

		expect(actions).toEqual([
			{ action: "select", billingPeriod: "monthly", plan: "basic" },
			{ action: "select", billingPeriod: "yearly", plan: "basic" },
			{ action: "select", billingPeriod: "monthly", plan: "business" },
			{ action: "current", billingPeriod: "yearly", plan: "business" },
		]);
	});

	test("shows teammates the current plan without granting billing control", () => {
		const actions = buildBillingPricingOfferActions({
			billingPeriod: "monthly",
			canManageBilling: false,
			plan: "basic",
			status: "trialing",
		});

		expect(actions[0]?.action).toBe("current");
		expect(
			actions.slice(1).every((offer) => offer.action === "owner_required"),
		).toBe(true);
	});

	test("does not call canceled or delinquent subscriptions current", () => {
		const canceled = buildBillingPricingOfferActions({
			billingPeriod: "monthly",
			canManageBilling: true,
			plan: "basic",
			status: "canceled",
		});
		const unpaid = buildBillingPricingOfferActions({
			billingPeriod: "monthly",
			canManageBilling: true,
			plan: "basic",
			status: "unpaid",
		});

		expect(canceled.every((offer) => offer.action === "select")).toBe(true);
		expect(unpaid.every((offer) => offer.action === "resolve_payment")).toBe(
			true,
		);
	});
});

describe("Stripe webhook retry timing", () => {
	test("backs off exponentially and caps retries at three hours", () => {
		expect(stripeWebhookRetryDelayMs(1)).toBe(60_000);
		expect(stripeWebhookRetryDelayMs(2)).toBe(120_000);
		expect(stripeWebhookRetryDelayMs(8)).toBe(7_680_000);
		expect(stripeWebhookRetryDelayMs(9)).toBe(10_800_000);
		expect(stripeWebhookRetryDelayMs(36)).toBe(10_800_000);
	});

	test("rejects invalid attempt counts", () => {
		expect(() => stripeWebhookRetryDelayMs(0)).toThrow(
			"attempt count must be a positive integer",
		);
	});
});
