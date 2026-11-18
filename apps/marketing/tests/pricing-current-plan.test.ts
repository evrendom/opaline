import { describe, expect, test } from "bun:test";
import {
	findPricingOfferState,
	readPricingWorkspaceState,
} from "../src/scripts/pricing-current-plan";

describe("pricing current plan", () => {
	test("recognizes a server billing response", () => {
		const state = readPricingWorkspaceState({
			json: {
				canManageBilling: true,
				hasWorkspace: true,
				offers: [
					{ action: "select", billingPeriod: "monthly", plan: "basic" },
					{ action: "select", billingPeriod: "yearly", plan: "basic" },
					{ action: "select", billingPeriod: "monthly", plan: "business" },
					{ action: "current", billingPeriod: "yearly", plan: "business" },
				],
				organizationId: "org_123",
				status: "active",
				workspaceSlug: "acme",
			},
		});

		expect(state?.workspaceSlug).toBe("acme");
		expect(
			state ? findPricingOfferState(state, "business", "yearly") : null,
		).toEqual({
			action: "current",
			billingPeriod: "yearly",
			plan: "business",
		});
	});

	test("ignores missing, invalid, or incomplete server responses", () => {
		expect(
			readPricingWorkspaceState({ json: { hasWorkspace: false } }),
		).toBeNull();
		expect(
			readPricingWorkspaceState({
				json: {
					canManageBilling: true,
					hasWorkspace: true,
					offers: [
						{ action: "current", billingPeriod: "monthly", plan: "enterprise" },
					],
					organizationId: "org_123",
					workspaceSlug: "acme",
				},
			}),
		).toBeNull();
		expect(readPricingWorkspaceState(null)).toBeNull();
	});
});
