import type Stripe from "stripe";
import {
	enqueueStripeWebhookEvent,
	processStripeWebhookEvent,
} from "../services/billing.service.js";
import { runBillingAnalyticsOutboxPass } from "../services/billing-analytics-outbox.service.js";
import {
	constructStripeWebhookEvent,
	readRequestTextWithinLimit,
} from "./stripe-webhook-event.js";

export const STRIPE_WEBHOOK_PATH = "/api/webhooks/stripe";
const MAX_STRIPE_WEBHOOK_BODY_BYTES = 1_000_000;

export async function handleStripeWebhookRequest(
	request: Request,
	config: {
		client: Stripe;
		webhookSecret: string;
	},
): Promise<Response> {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", {
			headers: { Allow: "POST" },
			status: 405,
		});
	}

	const signature = request.headers.get("stripe-signature");
	if (!signature) {
		return Response.json(
			{ error: "Missing Stripe signature" },
			{ status: 400 },
		);
	}

	const contentLength = Number(request.headers.get("content-length") ?? 0);
	if (contentLength > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
		return Response.json(
			{ error: "Webhook payload too large" },
			{ status: 413 },
		);
	}
	const payload = await readRequestTextWithinLimit(
		request,
		MAX_STRIPE_WEBHOOK_BODY_BYTES,
	);
	if (payload === null) {
		return Response.json(
			{ error: "Webhook payload too large" },
			{ status: 413 },
		);
	}

	const event = await constructStripeWebhookEvent({
		client: config.client,
		payload,
		signature,
		webhookSecret: config.webhookSecret,
	});
	if (!event) {
		return Response.json(
			{ error: "Invalid Stripe signature" },
			{ status: 400 },
		);
	}

	await enqueueStripeWebhookEvent(event);
	const processingResult = await processStripeWebhookEvent(event.id);
	if (processingResult !== "processed") {
		return Response.json(
			{ error: "Stripe webhook processing failed", received: true },
			{ status: 500 },
		);
	}
	await runBillingAnalyticsOutboxPass(50);
	return Response.json({ processed: true, received: true });
}
