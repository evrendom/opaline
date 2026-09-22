import { describe, expect, test } from "bun:test";
import {
	billingAnalyticsRetryDelayMs,
	buildUserBillingTraits,
} from "./billing-analytics-outbox.service.js";

describe("billing analytics traits", () => {
	test("keeps a past-due teammate's plan identity during payment recovery", () => {
		const traits = buildUserBillingTraits([
			{
				billing_period: "yearly",
				last_paid_amount: 151_200,
				last_paid_at: new Date("2026-09-01T00:00:00.000Z"),
				last_paid_currency: "usd",
				organization_id: "org-paid",
				plan: "business",
				role: "member",
				seat_quantity: 6,
				status: "past_due",
				user_id: "user-1",
			},
		]);

		expect(traits).toMatchObject({
			billing_period: "yearly",
			billing_plan: "business",
			billing_subscription_status: "past_due",
			billing_subscription_type: "business_yearly",
			has_paid_workspace: true,
			payment_status: "past_due",
			was_invited_to_team: true,
		});
	});

	test("preserves an unpaid plan without granting paid access", () => {
		const traits = buildUserBillingTraits([
			{
				billing_period: "monthly",
				last_paid_amount: 5_000,
				last_paid_at: new Date("2026-08-01T00:00:00.000Z"),
				last_paid_currency: "usd",
				organization_id: "org-unpaid",
				plan: "business",
				role: "owner",
				seat_quantity: 1,
				status: "unpaid",
				user_id: "user-2",
			},
		]);

		expect(traits).toMatchObject({
			billing_plan: "business",
			billing_subscription_status: "unpaid",
			has_paid_workspace: false,
			payment_status: "unpaid",
		});
	});
});

describe("billing analytics retry timing", () => {
	test("retries for multiple days without exceeding a three-hour delay", () => {
		expect(billingAnalyticsRetryDelayMs(1)).toBe(60_000);
		expect(billingAnalyticsRetryDelayMs(8)).toBe(7_680_000);
		expect(billingAnalyticsRetryDelayMs(9)).toBe(10_800_000);
		expect(billingAnalyticsRetryDelayMs(36)).toBe(10_800_000);
	});
});
