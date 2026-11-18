import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { sqlClient } from "../db.js";
import {
	enqueueStripeWebhookEvent,
	requeueBlockedStripeWebhookEvent,
} from "../services/billing.service.js";

const eventId = `evt_queue_${randomUUID()}`;

afterAll(async () => {
	await sqlClient.unsafe(
		"DELETE FROM stripe_webhook_event WHERE event_id = $1",
		[eventId],
	);
});

test("queues a Stripe event with its provider timestamp", async () => {
	process.env.STRIPE_BILLING_MODE = "sandbox";
	const created = 1_790_053_200;
	const event = {
		created,
		data: { object: { id: "plink_queue_test", object: "payment_link" } },
		id: eventId,
		livemode: false,
		object: "event",
		type: "payment_link.updated",
	} as Stripe.Event;

	await enqueueStripeWebhookEvent(event);

	const [queued] = await sqlClient.unsafe<
		Array<{ event_created_at: string; status: string }>
	>(
		"SELECT event_created_at, status FROM stripe_webhook_event WHERE event_id = $1",
		[eventId],
	);
	expect(queued?.status).toBe("pending");
	expect(new Date(queued?.event_created_at ?? 0).toISOString()).toBe(
		new Date(created * 1000).toISOString(),
	);
});

test("explicitly requeues a blocked Stripe event", async () => {
	await sqlClient.unsafe(
		`UPDATE stripe_webhook_event
		SET status = 'blocked', attempt_count = 36, last_error = 'test failure'
		WHERE event_id = $1`,
		[eventId],
	);

	expect(await requeueBlockedStripeWebhookEvent(eventId)).toBe(true);
	const [queued] = await sqlClient.unsafe<
		Array<{ attempt_count: number; last_error: string | null; status: string }>
	>(
		`SELECT attempt_count, last_error, status
		FROM stripe_webhook_event WHERE event_id = $1`,
		[eventId],
	);
	expect(queued).toEqual({
		attempt_count: 0,
		last_error: null,
		status: "pending",
	});
});
