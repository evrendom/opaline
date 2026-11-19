import { sqlClient } from "../db.js";
import { requeueBlockedBillingAnalyticsDeliveries } from "../services/billing-analytics-outbox.service.js";

try {
	const count = await requeueBlockedBillingAnalyticsDeliveries();
	console.log(`Requeued ${count} blocked billing analytics deliveries.`);
} finally {
	await sqlClient.end();
}
