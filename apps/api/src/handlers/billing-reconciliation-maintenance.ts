import { getLogger } from "@logtape/logtape";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";
import { syncAttioCustomer360 } from "../services/attio-company.service.js";
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
} from "../services/customer-account-snapshot.service.js";

const logger = getLogger(["rudel", "api", "billing-maintenance"]);

export interface BillingMaintenanceResult {
	analytics: number;
	blockedAnalytics: number;
	blockedWebhooks: number;
	customerAccounts: number;
	customerUsage: number;
	attio: number;
	attioCompanies: number;
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
	const { attio, attioCompanies, customerAccounts, customerUsage } =
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
		attio,
		attioCompanies,
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
	attio: number;
	attioCompanies: number;
	customerAccounts: number;
	customerUsage: number;
}> {
	let customerAccounts = 0;
	let customerUsage = 0;
	let attio = 0;
	let attioCompanies = 0;
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
		const result = await syncAttioCustomer360(
			{ accessToken: process.env.ATTIO_ACCESS_TOKEN },
			sqlClient,
			getClickhouse(),
		);
		attio = result.people;
		attioCompanies = result.companies;
	} catch (error) {
		logger.error("Attio company delivery failed: {error}", {
			error: String(error),
		});
	}
	return { attio, attioCompanies, customerAccounts, customerUsage };
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
