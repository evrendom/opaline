import { sqlClient } from "../db.js";
import { runBillingMaintenancePass } from "../handlers/billing-reconciliation-maintenance.js";
import { shutdownApiProductAnalytics } from "../lib/product-analytics.js";
import { requireStripeBillingMode } from "../stripe-client.js";

if (requireStripeBillingMode() !== "sandbox") {
	throw new Error("The local billing worker only runs in Stripe sandbox mode");
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		stopping = true;
	});
}

console.log("Stripe sandbox billing worker started");
while (!stopping) {
	try {
		const result = await runBillingMaintenancePass();
		if (result.webhooks + result.seats + result.analytics > 0) {
			console.log("Stripe sandbox billing pass", result);
		}
	} catch (error) {
		console.error("Stripe sandbox billing pass failed", error);
	}
	await Bun.sleep(2_000);
}

await shutdownApiProductAnalytics();
await sqlClient.end({ timeout: 5 });
