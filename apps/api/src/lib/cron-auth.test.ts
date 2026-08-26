import { describe, expect, test } from "bun:test";
import { isAuthorizedCronRequest } from "./cron-auth.js";

describe("Vercel cron authorization", () => {
	test("accepts the exact bearer secret", () => {
		const secret = "cron-secret-at-least-sixteen-characters";
		const request = new Request("https://example.test/api/cron/repair", {
			headers: { Authorization: `Bearer ${secret}` },
		});

		expect(isAuthorizedCronRequest(request, secret)).toBe(true);
	});

	test("fails closed for missing, short, or mismatched secrets", () => {
		const request = new Request("https://example.test/api/cron/repair", {
			headers: { Authorization: "Bearer wrong-secret-value" },
		});

		expect(isAuthorizedCronRequest(request, undefined)).toBe(false);
		expect(isAuthorizedCronRequest(request, "short")).toBe(false);
		expect(
			isAuthorizedCronRequest(
				request,
				"cron-secret-at-least-sixteen-characters",
			),
		).toBe(false);
	});
});
