import { createHash } from "node:crypto";
import type {
	ProductAnalyticsEventName,
	ProductAnalyticsEventPayload,
} from "@rudel/api-routes";
import {
	PRODUCT_ANALYTICS_EVENT_VERSION,
	parseProductAnalyticsEvent,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { PostHog } from "posthog-node";
import { sqlClient } from "../db.js";
import { isVercelRuntime } from "./api-runtime.js";
import { readProductAnalyticsExcludedOrgIds } from "./env.js";
import { isSelfHosted } from "./self-hosted.js";

type ApiAutoProps = "event_version" | "surface" | "environment";
type ApiCapturePayload<Name extends ProductAnalyticsEventName> = Omit<
	ProductAnalyticsEventPayload<Name>,
	ApiAutoProps
>;

let client: PostHog | null | undefined;

function isAnalyticsEnabled() {
	return (
		!isSelfHosted() &&
		(process.env.POSTHOG_ENABLED ?? process.env.VITE_POSTHOG_ENABLED) === "true"
	);
}

function getEnvironment(): "production" | "staging" | "development" | "local" {
	const appUrl = process.env.APP_URL ?? "";
	if (appUrl.includes("localhost") || appUrl.includes("127.0.0.1")) {
		return "local";
	}
	if (appUrl.includes("staging")) {
		return "staging";
	}
	if (process.env.NODE_ENV === "production") {
		return "production";
	}
	return "development";
}

function getClient() {
	if (client !== undefined) {
		return client;
	}

	const key = (
		process.env.POSTHOG_KEY ??
		process.env.VITE_POSTHOG_KEY ??
		""
	).trim();
	const host = (
		process.env.POSTHOG_HOST ??
		process.env.VITE_POSTHOG_HOST ??
		""
	).trim();
	if (!isAnalyticsEnabled() || key.length === 0 || host.length === 0) {
		client = null;
		return client;
	}

	client = new PostHog(key, { host });
	return client;
}

type AnalyticsSql = postgres.Sql | postgres.TransactionSql;

// Server-side distinct IDs are user IDs, so membership decides exclusion.
// Callers that hold a transaction must pass it as `sql`: a second pool
// connection per delivery can exhaust the pool and deadlock.
export async function isExcludedFromProductAnalytics(
	distinctId: string,
	{
		excludedOrgIds = readProductAnalyticsExcludedOrgIds(),
		sql = sqlClient,
	}: { excludedOrgIds?: readonly string[]; sql?: AnalyticsSql } = {},
): Promise<boolean> {
	if (excludedOrgIds.length === 0) {
		return false;
	}
	const rows = await sql.unsafe<Array<{ excluded: boolean }>>(
		`SELECT EXISTS (
			SELECT 1 FROM member
			WHERE user_id = $1 AND organization_id = ANY($2::text[])
		) AS excluded`,
		[distinctId, [...excludedOrgIds]],
	);
	return rows[0]?.excluded === true;
}

function buildPayload<Name extends ProductAnalyticsEventName>(
	event: Name,
	payload: ApiCapturePayload<Name>,
) {
	return parseProductAnalyticsEvent(event, {
		...payload,
		event_version: PRODUCT_ANALYTICS_EVENT_VERSION,
		surface: "api",
		environment: getEnvironment(),
	});
}

export async function captureApiProductAnalyticsEvent<
	Name extends ProductAnalyticsEventName,
>(options: {
	distinctId: string;
	event: Name;
	eventId?: string;
	payload: ApiCapturePayload<Name>;
}) {
	const instance = getClient();
	if (!instance) {
		return;
	}

	try {
		if (await isExcludedFromProductAnalytics(options.distinctId)) {
			return;
		}
		const message = {
			distinctId: options.distinctId,
			event: options.event,
			properties: buildPayload(options.event, options.payload),
			uuid: options.eventId,
		};
		// Vercel functions may freeze right after the response, so the event
		// must be delivered before returning. Fly keeps the queued client to
		// stay off the request path.
		if (isVercelRuntime()) {
			await instance.captureImmediate(message);
		} else {
			instance.capture(message);
		}
	} catch {
		// Analytics must never break the request path.
	}
}

export class ProductAnalyticsUnavailableError extends Error {
	constructor() {
		super("PostHog product analytics is not configured");
		this.name = "ProductAnalyticsUnavailableError";
	}
}

export async function deliverApiProductAnalyticsEvent<
	Name extends ProductAnalyticsEventName,
>(options: {
	distinctId: string;
	event: Name;
	eventUuid: string;
	occurredAt: Date;
	payload: ApiCapturePayload<Name>;
	sql: AnalyticsSql;
}): Promise<void> {
	const instance = getClient();
	if (!instance) throw new ProductAnalyticsUnavailableError();
	if (
		await isExcludedFromProductAnalytics(options.distinctId, {
			sql: options.sql,
		})
	) {
		return;
	}
	await instance.captureImmediate({
		distinctId: options.distinctId,
		event: options.event,
		properties: buildPayload(options.event, options.payload),
		timestamp: options.occurredAt,
		uuid: options.eventUuid,
	});
}

export async function deliverApiProductAnalyticsPersonProperties(options: {
	distinctId: string;
	properties: Readonly<Record<string, boolean | null | number | string>>;
	sql: AnalyticsSql;
}): Promise<void> {
	const instance = getClient();
	if (!instance) throw new ProductAnalyticsUnavailableError();
	if (
		await isExcludedFromProductAnalytics(options.distinctId, {
			sql: options.sql,
		})
	) {
		return;
	}
	await instance.identifyImmediate({
		distinctId: options.distinctId,
		properties: options.properties,
	});
}

export async function shutdownApiProductAnalytics(timeoutMs = 5_000) {
	const instance = getClient();
	if (!instance) {
		return;
	}

	try {
		await instance.shutdown(timeoutMs);
	} catch {
		// Ignore shutdown failures.
	}
}

export function hashProjectPath(projectPath: string) {
	return createHash("sha256").update(projectPath).digest("hex").slice(0, 24);
}

export function bucketContentSize(bytes: number) {
	if (bytes < 100_000) {
		return "lt_100kb";
	}
	if (bytes <= 1_000_000) {
		return "100kb_to_1mb";
	}
	return "gt_1mb";
}
