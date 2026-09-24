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
import {
	refreshAllCustomerAccountSnapshots,
	refreshCustomerUsageSnapshots,
	runCustomerAccountCRMPass,
} from "../services/customer-account-snapshot.service.js";

const logger = getLogger(["rudel", "api", "billing-maintenance"]);

export interface BillingMaintenanceResult {
	analytics: number;
	blockedAnalytics: number;
	blockedWebhooks: number;
	customerAccounts: number;
	customerUsage: number;
	crm: number;
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
	const { crm, customerAccounts, customerUsage } =
		await runCustomerAccountMaintenance();
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
		crm,
		blockedAnalytics,
		blockedWebhooks,
		customerAccounts,
		customerUsage,
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

async function runCustomerAccountMaintenance(): Promise<{
	crm: number;
	customerAccounts: number;
	customerUsage: number;
}> {
	let customerAccounts = 0;
	let customerUsage = 0;
	let crm = 0;
	try {
		customerAccounts = await refreshAllCustomerAccountSnapshots();
	} catch (error) {
		logger.error("Customer account projection refresh failed: {error}", {
			error: String(error),
		});
	}
	try {
		customerUsage = await refreshCustomerUsageSnapshots(100);
	} catch (error) {
		logger.error("Customer account usage refresh failed: {error}", {
			error: String(error),
		});
	}
	try {
		crm = await runCustomerAccountCRMPass(
			{ accessToken: process.env.CRM_ACCESS_TOKEN },
			50,
		);
	} catch (error) {
		logger.error("Customer account CRM delivery failed: {error}", {
			error: String(error),
		});
	}
	return { crm, customerAccounts, customerUsage };
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
