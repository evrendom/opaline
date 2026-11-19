import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type {
	OpalineBillingPeriod,
	OpalineBillingPlan,
} from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import { createOrganizationCheckoutSession } from "../services/billing.service.js";
import { getStripeClient, requireStripeBillingMode } from "../stripe-client.js";

const organizationId = randomUUID();
const ownerId = randomUUID();
const teammateId = randomUUID();
const suffix = randomUUID();
const createdSessionIds: string[] = [];

setDefaultTimeout(30_000);

afterAll(async () => {
	const stripe = getStripeClient();
	if (stripe) {
		for (const sessionId of createdSessionIds) {
			const session = await stripe.checkout.sessions.retrieve(sessionId);
			if (session.status === "open") {
				await stripe.checkout.sessions.expire(sessionId);
			}
		}
		const [customer] = await sqlClient.unsafe<
			Array<{ stripe_customer_id: string }>
		>(
			"SELECT stripe_customer_id FROM billing_customer WHERE organization_id = $1",
			[organizationId],
		);
		if (customer) await stripe.customers.del(customer.stripe_customer_id);
	}
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = ANY($1::text[])', [
		[ownerId, teammateId],
	]);
});

test("reuses Checkout safely and replaces it when seat quantity changes", async () => {
	expect(requireStripeBillingMode()).toBe("sandbox");
	const stripe = getStripeClient();
	assert(stripe);
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email)
		VALUES ($1, 'Checkout Owner', $2), ($3, 'Checkout Teammate', $4)`,
		[
			ownerId,
			`checkout-owner-${suffix}@example.test`,
			teammateId,
			`checkout-teammate-${suffix}@example.test`,
		],
	);
	await sqlClient.unsafe(
		`INSERT INTO organization (id, name, slug)
		VALUES ($1, 'Checkout Sandbox Test', $2)`,
		[organizationId, `checkout-sandbox-${suffix}`],
	);
	await sqlClient.unsafe(
		`INSERT INTO member (id, organization_id, user_id, role)
		VALUES ($1, $2, $3, 'owner')`,
		[randomUUID(), organizationId, ownerId],
	);

	const billingPeriod: OpalineBillingPeriod = "monthly";
	const plan: OpalineBillingPlan = "basic";
	const input = {
		billingPeriod,
		cancelUrl: "http://localhost:4011/test/settings/workspace",
		organizationId,
		plan,
		successUrl: "http://localhost:4011/test/settings/workspace",
		userEmail: `checkout-owner-${suffix}@example.test`,
		userId: ownerId,
	};
	const first = await createOrganizationCheckoutSession(input);
	createdSessionIds.push(first.checkoutSessionId);
	await sqlClient.unsafe(
		`UPDATE billing_checkout_attempt
		SET stripe_checkout_session_id = NULL,
			stripe_checkout_url = NULL,
			status = 'creating',
			expires_at = NULL
		WHERE organization_id = $1`,
		[organizationId],
	);
	const retry = await createOrganizationCheckoutSession(input);
	expect(retry).toEqual(first);

	const firstLineItems = await stripe.checkout.sessions.listLineItems(
		first.checkoutSessionId,
	);
	expect(firstLineItems.data[0]?.quantity).toBe(1);
	const firstSession = await stripe.checkout.sessions.retrieve(
		first.checkoutSessionId,
	);

	await sqlClient.unsafe(
		`INSERT INTO member (id, organization_id, user_id, role)
		VALUES ($1, $2, $3, 'member')`,
		[randomUUID(), organizationId, teammateId],
	);
	const resized = await createOrganizationCheckoutSession(input);
	createdSessionIds.push(resized.checkoutSessionId);
	expect(resized.checkoutSessionId).not.toBe(first.checkoutSessionId);
	expect(
		(await stripe.checkout.sessions.retrieve(first.checkoutSessionId)).status,
	).toBe("expired");
	const resizedLineItems = await stripe.checkout.sessions.listLineItems(
		resized.checkoutSessionId,
	);
	expect(resizedLineItems.data[0]?.quantity).toBe(2);
	const resizedSession = await stripe.checkout.sessions.retrieve(
		resized.checkoutSessionId,
	);
	expect(resizedSession.customer).toBe(firstSession.customer);
	expect(
		(await createOrganizationCheckoutSession(input)).checkoutSessionId,
	).toBe(resized.checkoutSessionId);

	const [customerState] = await sqlClient.unsafe<
		Array<{ attempts: number; customers: number }>
	>(
		`SELECT
			(SELECT COUNT(*)::int FROM billing_checkout_attempt
				WHERE organization_id = $1) AS attempts,
			(SELECT COUNT(*)::int FROM billing_customer
				WHERE organization_id = $1) AS customers`,
		[organizationId],
	);
	expect(customerState).toEqual({ attempts: 1, customers: 1 });
});
