import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import {
	constructStripeWebhookEvent,
	readRequestTextWithinLimit,
} from "./stripe-webhook-event.js";

const stripe = new Stripe("sk_test_opaline_webhook_test");
const webhookSecret = "whsec_opaline_webhook_test";
const payload = JSON.stringify({
	api_version: "2025-12-15.clover",
	created: Math.floor(Date.now() / 1000),
	data: { object: { id: "plink_test", object: "payment_link" } },
	id: "evt_ignored_test",
	livemode: false,
	object: "event",
	pending_webhooks: 1,
	request: null,
	type: "payment_link.updated",
});

describe("Stripe webhook verification", () => {
	test("constructs an authentic signed event", async () => {
		const signature = await stripe.webhooks.generateTestHeaderStringAsync({
			payload,
			secret: webhookSecret,
		});
		const event = await constructStripeWebhookEvent({
			client: stripe,
			payload,
			signature,
			webhookSecret,
		});

		expect(event?.id).toBe("evt_ignored_test");
		expect(event?.type).toBe("payment_link.updated");
	});

	test("rejects a modified or incorrectly signed event", async () => {
		const event = await constructStripeWebhookEvent({
			client: stripe,
			payload,
			signature: "invalid",
			webhookSecret,
		});

		expect(event).toBeNull();
	});

	test("rejects an oversized streamed body before signature processing", async () => {
		const chunk = new Uint8Array(600_000);
		const request = new Request(
			"https://api.opaline.test/api/webhooks/stripe",
			{
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(chunk);
						controller.enqueue(chunk);
						controller.close();
					},
				}),
				headers: { "stripe-signature": "invalid" },
				method: "POST",
			},
		);
		const body = await readRequestTextWithinLimit(request, 1_000_000);

		expect(body).toBeNull();
	});
});
