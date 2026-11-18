import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlClient } from "../db.js";
import { isExcludedFromProductAnalytics } from "../lib/product-analytics.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const password = "product-analytics-exclusion-password";
let server: ApiTestServer;
let memberUserId = "";
let outsiderUserId = "";

async function signUp(email: string): Promise<string> {
	const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name: "Analytics Exclusion", password }),
	});
	expect(response.status).toBe(200);
	return z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await response.json()).user.id;
}

beforeAll(async () => {
	server = await startApiTestServer();
	memberUserId = await signUp(`analytics-member-${randomUUID()}@example.test`);
	outsiderUserId = await signUp(
		`analytics-outsider-${randomUUID()}@example.test`,
	);
});

afterAll(async () => {
	await server.stop();
});

test("excludes members of an excluded workspace", async () => {
	// Signup creates a personal workspace whose ID is the user's ID.
	expect(
		await isExcludedFromProductAnalytics(memberUserId, {
			excludedOrgIds: ["some-other-workspace", memberUserId],
		}),
	).toBe(true);
});

test("keeps users who are not members of an excluded workspace", async () => {
	expect(
		await isExcludedFromProductAnalytics(outsiderUserId, {
			excludedOrgIds: [memberUserId],
		}),
	).toBe(false);
});

test("excludes nobody when no workspace is configured", async () => {
	expect(
		await isExcludedFromProductAnalytics(memberUserId, { excludedOrgIds: [] }),
	).toBe(false);
});

test("answers inside transactions that hold every pool connection", async () => {
	// The billing outbox delivers inside a transaction; five concurrent
	// deliveries hold the whole pool, so the lookup must reuse that connection.
	const results = await Promise.all(
		Array.from({ length: 5 }, () =>
			sqlClient.begin((transaction) =>
				isExcludedFromProductAnalytics(memberUserId, {
					excludedOrgIds: [memberUserId],
					sql: transaction,
				}),
			),
		),
	);
	expect(results).toEqual([true, true, true, true, true]);
});
