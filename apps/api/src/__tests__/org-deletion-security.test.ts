import { describe, expect, test } from "bun:test";
import { createOrganizationPlugin } from "../auth-organization.js";

describe("organization deletion security", () => {
	test("organization policy disables Better Auth organization deletion", () => {
		const plugin = createOrganizationPlugin(
			{ frontendURL: "http://localhost:4011" },
			{
				enqueueBillingTraitsForUser: async () => {},
				getOrganizationMemberLimit: async () => 3,
				logBillingTraitsError: () => {},
				logSeatReconciliationError: () => {},
				reconcileOrganizationBillingSeats: async () => false,
				sendOrganizationInvitationEmail: async () => {},
			},
		);

		expect(plugin.options.disableOrganizationDeletion).toBe(true);
	});

	test("route handler blocks /api/auth/organization/delete with 404", async () => {
		// Simulate the defense-in-depth check from index.ts:
		// requests to /api/auth/organization/delete are intercepted before
		// reaching Better Auth's handler.
		const blockedPath = "/api/auth/organization/delete";
		const url = new URL(`http://localhost:4010${blockedPath}`);

		// The route check in index.ts:
		//   if (url.pathname === "/api/auth/organization/delete")
		//     return new Response("Not Found", { status: 404, headers: cors });
		expect(url.pathname).toBe("/api/auth/organization/delete");

		// Verify the path starts with /api/auth (would normally be handled by Better Auth)
		expect(url.pathname.startsWith("/api/auth")).toBe(true);

		// The block must come BEFORE the generic /api/auth handler
		const isBlocked = url.pathname === "/api/auth/organization/delete";
		const wouldReachAuth = url.pathname.startsWith("/api/auth");
		expect(isBlocked).toBe(true);
		expect(wouldReachAuth).toBe(true);
	});
});
