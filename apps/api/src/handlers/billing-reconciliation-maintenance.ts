import { getLogger } from "@logtape/logtape";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";
import {
	readBlockedStripeWebhookCount,
	readPendingSeatChargeCount,
	readRetryingStripeWebhookCount,
	reconcileBillingSeats,
	runStripeWebhookPass,
} from "../services/billing.service.js";
import {
	readBlockedBillingAnalyticsCount,
	runBillingAnalyticsOutboxPass,
} from "../services/billing-analytics-outbox.service.js";

const logger = getLogger(["rudel", "api", "billing-maintenance"]);

export interface BillingMaintenanceResult {
	analytics: number;
	blockedAnalytics: number;
	blockedWebhooks: number;
	ok: boolean;
	pendingSeatCharges: number;
	seats: number;
	retryingWebhooks: number;
	webhooks: number;
}

export async function runBillingMaintenancePass(): Promise<BillingMaintenanceResult> {
	const webhooks = await runStripeWebhookPass(20);
	const seats = await reconcileBillingSeats(5);
	const analytics = await runBillingAnalyticsOutboxPass(50);
	const blockedWebhooks = await readBlockedStripeWebhookCount();
	const blockedAnalytics = await readBlockedBillingAnalyticsCount();
	const retryingWebhooks = await readRetryingStripeWebhookCount();
	const pendingSeatCharges = await readPendingSeatChargeCount();
	if (blockedWebhooks > 0) {
		logger.error("Stripe webhook queue has blocked events (count={count})", {
			count: blockedWebhooks,
		});
	}
	if (retryingWebhooks > 0) {
		logger.warn("Stripe webhook queue has retrying events (count={count})", {
			count: retryingWebhooks,
		});
	}
	if (blockedAnalytics > 0) {
		logger.error(
			"Billing analytics outbox has blocked deliveries (count={count})",
			{
				count: blockedAnalytics,
			},
		);
	}
	if (pendingSeatCharges > 0) {
		logger.error(
			"Stripe seat increases are awaiting successful payment (count={count})",
			{ count: pendingSeatCharges },
		);
	}
	return {
		analytics,
		blockedAnalytics,
		blockedWebhooks,
		ok:
			blockedAnalytics === 0 &&
			blockedWebhooks === 0 &&
			pendingSeatCharges === 0,
		pendingSeatCharges,
		retryingWebhooks,
		seats,
		webhooks,
	};
}

export async function handleBillingReconciliationMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const result = await runBillingMaintenancePass();
		return Response.json(result, { status: result.ok ? 200 : 503 });
	} catch (error) {
		logger.error("Billing maintenance failed: {error}", {
			error: String(error),
		});
		return Response.json(
			{ error: "Billing maintenance failed" },
			{ status: 500 },
		);
	}
}
