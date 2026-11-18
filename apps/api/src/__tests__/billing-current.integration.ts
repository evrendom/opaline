import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	BillingPricingStateOutputSchema,
	OrganizationBillingSummaryOutputSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { sqlClient } from "../db.js";
import { FreeWorkspaceMonthlyAgentRunLimitExceededError } from "../services/billing-entitlements.service.js";
import { refreshCustomerAccountSnapshot } from "../services/customer-account-snapshot.service.js";
import { claimSessionIngestOwnership } from "../services/session-ownership.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const email = `billing-current-${randomUUID()}@example.test`;
const password = "billing-current-integration-password";
let server: ApiTestServer;
let token = "";
let userId = "";
let teammateToken = "";
let teammateUserId = "";
let quotaUserId = "";
let workspaceSlug = "";

beforeAll(async () => {
	server = await startApiTestServer();
	const signup = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, name: "Billing Current Test", password }),
	});
	expect(signup.status).toBe(200);
	const identity = z
		.object({ token: z.string(), user: z.object({ id: z.string() }) })
		.parse(await signup.json());
	token = identity.token;
	userId = identity.user.id;
	const [workspace] = await sqlClient<Array<{ slug: string }>>`
		SELECT slug FROM organization WHERE id = ${userId}
	`;
	expect(workspace).toBeDefined();
	workspaceSlug = workspace?.slug ?? "";
	await sqlClient`
		INSERT INTO billing_subscription (
			stripe_subscription_id, organization_id, purchaser_user_id,
			stripe_customer_id, stripe_subscription_item_id, plan,
			billing_period, status, seat_quantity, last_paid_amount,
			last_paid_currency, last_paid_at
		) VALUES (
			${`sub_${randomUUID()}`}, ${userId}, ${userId},
			${`cus_${randomUUID()}`}, ${`si_${randomUUID()}`}, 'business',
			'yearly', 'active', 3, 151200, 'usd', NOW()
		)
	`;
	const teammateSignup = await fetch(
		`${server.baseUrl}/api/auth/sign-up/email`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: `billing-current-teammate-${randomUUID()}@example.test`,
				name: "Billing Current Teammate",
				password,
			}),
		},
	);
	expect(teammateSignup.status).toBe(200);
	const teammateIdentity = z
		.object({ token: z.string(), user: z.object({ id: z.string() }) })
		.parse(await teammateSignup.json());
	teammateToken = teammateIdentity.token;
	teammateUserId = teammateIdentity.user.id;
	await sqlClient`
		INSERT INTO member (id, organization_id, user_id, role)
		VALUES (${randomUUID()}, ${userId}, ${teammateUserId}, 'member')
	`;
	await sqlClient`
		UPDATE session
		SET active_organization_id = ${userId}
		WHERE user_id = ${teammateUserId}
	`;
});

afterAll(async () => {
	await server?.stop();
	if (teammateUserId)
		await sqlClient`DELETE FROM "user" WHERE id = ${teammateUserId}`;
	if (quotaUserId)
		await sqlClient`DELETE FROM "user" WHERE id = ${quotaUserId}`;
	if (userId) await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
});

test("returns the active paid workspace plan to a teammate", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/billing/current`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${teammateToken}`,
			"Content-Type": "application/json",
		},
		body: "{}",
	});

	expect(response.status).toBe(200);
	const result = z
		.object({ json: OrganizationBillingSummaryOutputSchema })
		.parse(await response.json());
	expect(result.json).toMatchObject({
		billingPeriod: "yearly",
		hasBillingAccount: true,
		plan: "business",
	});
});

test("projects current account and payment state for CRM delivery", async () => {
	await refreshCustomerAccountSnapshot(userId);
	const [account] = await sqlClient<
		Array<{
			billing_period: string;
			billing_plan: string;
			member_count: number;
			payment_status: string;
			seat_quantity: number;
			subscription_status: string;
		}>
	>`SELECT
		billing_period,
		billing_plan,
		member_count,
		payment_status,
		seat_quantity,
		subscription_status
	FROM customer_account_snapshot
	WHERE organization_id = ${userId}`;

	expect(account).toEqual({
		billing_period: "yearly",
		billing_plan: "business",
		member_count: 2,
		payment_status: "paid",
		seat_quantity: 3,
		subscription_status: "active",
	});
});

test("returns server-decided pricing actions for the selected workspace", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/billing/pricing`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${teammateToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: { workspaceSlug } }),
	});

	expect(response.status).toBe(200);
	const result = z
		.object({ json: BillingPricingStateOutputSchema })
		.parse(await response.json());
	expect(result.json).toMatchObject({
		canManageBilling: false,
		hasWorkspace: true,
		organizationId: userId,
		workspaceSlug,
	});
	if (!result.json.hasWorkspace) throw new Error("Expected a workspace");
	expect(
		result.json.offers.find(
			(offer) => offer.plan === "business" && offer.billingPeriod === "yearly",
		),
	).toMatchObject({ action: "current" });
	expect(
		result.json.offers
			.filter((offer) => offer.action !== "current")
			.every((offer) => offer.action === "owner_required"),
	).toBe(true);
});

test("rejects a pricing workspace outside the signed-in user's memberships", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/billing/pricing`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: { workspaceSlug: `other-${randomUUID()}` } }),
	});

	expect(response.status).toBe(403);
});

test("returns the signed-in user's server-owned current plan", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/billing/current`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: "{}",
	});

	expect(response.status).toBe(200);
	const result = z
		.object({ json: OrganizationBillingSummaryOutputSchema })
		.parse(await response.json());
	expect(result.json).toEqual({
		billingPeriod: "yearly",
		hasBillingAccount: true,
		plan: "business",
		seatQuantity: 3,
		status: "active",
	});
});

test("does not expose billing state without authentication", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/billing/current`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});

	expect(response.status).toBe(401);
});

test("blocks only free workspaces at 50,000 monthly agent runs", async () => {
	const signup = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `billing-quota-${randomUUID()}@example.test`,
			name: "Billing Quota Test",
			password,
		}),
	});
	expect(signup.status).toBe(200);
	const identity = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await signup.json());
	quotaUserId = identity.user.id;
	await sqlClient`
		INSERT INTO organization_monthly_usage (
			organization_id, month_start, agent_runs
		) VALUES (
			${quotaUserId}, date_trunc('month', NOW() AT TIME ZONE 'UTC')::date, 50000
		)
	`;
	await expect(
		claimSessionIngestOwnership(
			quotaUserId,
			`free-over-limit-${randomUUID()}`,
			quotaUserId,
		),
	).rejects.toBeInstanceOf(FreeWorkspaceMonthlyAgentRunLimitExceededError);

	await sqlClient`
		INSERT INTO billing_subscription (
			stripe_subscription_id, organization_id, purchaser_user_id,
			stripe_customer_id, stripe_subscription_item_id, plan,
			billing_period, status, seat_quantity
		) VALUES (
			${`sub_${randomUUID()}`}, ${quotaUserId}, ${quotaUserId},
			${`cus_${randomUUID()}`}, ${`si_${randomUUID()}`}, 'basic',
			'monthly', 'active', 1
		)
	`;
	const paidSessionId = `paid-over-limit-${randomUUID()}`;
	const paidClaim = await claimSessionIngestOwnership(
		quotaUserId,
		paidSessionId,
		quotaUserId,
	);
	expect(paidClaim.owned).toBe(true);
	await sqlClient`
		UPDATE billing_subscription SET status = 'past_due'
		WHERE organization_id = ${quotaUserId}
	`;
	const gracePeriodClaim = await claimSessionIngestOwnership(
		quotaUserId,
		`past-due-over-limit-${randomUUID()}`,
		quotaUserId,
	);
	expect(gracePeriodClaim.owned).toBe(true);
	await sqlClient`
		UPDATE billing_subscription SET status = 'canceled'
		WHERE organization_id = ${quotaUserId}
	`;
	const repeatedClaim = await claimSessionIngestOwnership(
		quotaUserId,
		paidSessionId,
		quotaUserId,
	);
	expect(repeatedClaim.owned).toBe(true);
	const [unchangedUsage] = await sqlClient<Array<{ agent_runs: number }>>`
		SELECT agent_runs FROM organization_monthly_usage
		WHERE organization_id = ${quotaUserId}
			AND month_start = date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
	`;
	expect(unchangedUsage?.agent_runs).toBe(50_000);

	await sqlClient`
		DELETE FROM organization_monthly_usage
		WHERE organization_id = ${quotaUserId}
	`;
	await sqlClient`
		INSERT INTO organization_monthly_usage (
			organization_id, month_start, agent_runs
		) VALUES (
			${quotaUserId},
			(date_trunc('month', NOW() AT TIME ZONE 'UTC') - interval '1 month')::date,
			50000
		)
	`;
	const nextMonthClaim = await claimSessionIngestOwnership(
		quotaUserId,
		`new-month-${randomUUID()}`,
		quotaUserId,
	);
	expect(nextMonthClaim.owned).toBe(true);
	const [newMonthUsage] = await sqlClient<Array<{ agent_runs: number }>>`
		SELECT agent_runs FROM organization_monthly_usage
		WHERE organization_id = ${quotaUserId}
			AND month_start = date_trunc('month', NOW() AT TIME ZONE 'UTC')::date
	`;
	expect(newMonthUsage?.agent_runs).toBe(1);
});
