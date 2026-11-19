import { sqlClient } from "../db.js";
import { requeueBlockedStripeWebhookEvent } from "../services/billing.service.js";

const eventId = process.argv[2]?.trim() ?? "";
if (!eventId.startsWith("evt_")) {
	throw new Error("Usage: bun run billing:webhook:requeue -- evt_...");
}

const requeued = await requeueBlockedStripeWebhookEvent(eventId);
if (!requeued) {
	throw new Error(`Blocked Stripe webhook ${eventId} was not found`);
}

console.log(`Requeued Stripe webhook ${eventId}`);
await sqlClient.end({ timeout: 5 });
