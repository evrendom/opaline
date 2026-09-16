import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { INGEST_LIMIT_REASONS } from "@rudel/api-routes";

const logger = getLogger(["rudel", "api", "rate-limit"]);

// ── In-memory sliding-window rate limiter ─────────────────────────

interface SlidingWindowEntry {
	timestamps: number[];
}

const organizationSessionCountWindows = new Map<string, SlidingWindowEntry>();

const ORGANIZATION_SESSION_COUNT_MAX_REQUESTS = 300;
const ORGANIZATION_SESSION_COUNT_WINDOW_MS = 60_000;
export function checkOrganizationSessionCountRateLimit(
	userId: string,
	organizationId: string,
): void {
	checkSlidingWindowRateLimit({
		entityId: JSON.stringify([userId, organizationId]),
		errorMessage:
			"Session count refresh is temporarily limited. Please wait a moment and try again.",
		maxRequests: ORGANIZATION_SESSION_COUNT_MAX_REQUESTS,
		map: organizationSessionCountWindows,
		operationName: "organization session count refresh",
		windowMs: ORGANIZATION_SESSION_COUNT_WINDOW_MS,
	});
}

// Ingest caps split by upload mode. Every accepted attempt counts, including
// repeated uploads of the same session. Hook and manual buckets are independent:
// a bulk historical import does not affect the live-hook budget, and vice versa.

interface SessionIngestEntry {
	timestamps: number[];
}

const hookIngestWindows = new Map<string, SessionIngestEntry>();
const manualIngestWindows = new Map<string, SessionIngestEntry>();

const HOOK_INGEST_MAX = Number(process.env.RATE_LIMIT_INGEST_MAX ?? 500);
const HOOK_INGEST_WINDOW_MS =
	Number(process.env.RATE_LIMIT_INGEST_WINDOW ?? 3600) * 1000;

const MANUAL_INGEST_MAX = Number(
	process.env.RATE_LIMIT_INGEST_MANUAL_MAX ?? 10_000,
);
const MANUAL_INGEST_WINDOW_MS =
	Number(process.env.RATE_LIMIT_INGEST_MANUAL_WINDOW ?? 3600) * 1000;

function checkSessionIngestRateLimit(input: {
	windows: Map<string, SessionIngestEntry>;
	max: number;
	windowMs: number;
	label: string;
	userId: string;
	sessionId: string;
}): void {
	const { windows, max, windowMs, label, userId } = input;
	const now = Date.now();
	const cutoff = now - windowMs;

	let entry = windows.get(userId);
	if (!entry) {
		entry = { timestamps: [] };
		windows.set(userId, entry);
	}

	entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff);

	if (entry.timestamps.length >= max) {
		logger.warn(
			"{label} ingest rate limit exceeded for user {userId}: {count}/{max} attempts in {window}s",
			{
				label,
				userId,
				count: entry.timestamps.length,
				max,
				window: windowMs / 1000,
			},
		);
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: `Rate limit exceeded. Maximum ${max} ingest attempts per ${Math.round(windowMs / 60_000)} minutes. Try again later.`,
			data: {
				reason: INGEST_LIMIT_REASONS.sessionLimit,
				limit: max,
				windowSeconds: windowMs / 1000,
				current: entry.timestamps.length,
			},
		});
	}

	entry.timestamps.push(now);
}

export function checkHookIngestRateLimit(
	userId: string,
	sessionId: string,
): void {
	checkSessionIngestRateLimit({
		windows: hookIngestWindows,
		max: HOOK_INGEST_MAX,
		windowMs: HOOK_INGEST_WINDOW_MS,
		label: "Hook",
		userId,
		sessionId,
	});
}

export function checkManualIngestRateLimit(
	userId: string,
	sessionId: string,
): void {
	checkSessionIngestRateLimit({
		windows: manualIngestWindows,
		max: MANUAL_INGEST_MAX,
		windowMs: MANUAL_INGEST_WINDOW_MS,
		label: "Manual",
		userId,
		sessionId,
	});
}

function checkSlidingWindowRateLimit(input: {
	entityId: string;
	errorMessage: string;
	maxRequests: number;
	map: Map<string, SlidingWindowEntry>;
	operationName: string;
	windowMs: number;
}) {
	const { entityId, errorMessage, maxRequests, map, operationName, windowMs } =
		input;
	const now = Date.now();
	const cutoff = now - windowMs;

	let entry = map.get(entityId);
	if (!entry) {
		entry = { timestamps: [] };
		map.set(entityId, entry);
	}

	entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff);

	if (entry.timestamps.length >= maxRequests) {
		logger.warn(
			"{operationName} rate limit exceeded for {entityId}: {count}/{max} in {window}s",
			{
				count: entry.timestamps.length,
				entityId,
				max: maxRequests,
				operationName,
				window: Math.round(windowMs / 1000),
			},
		);
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: errorMessage,
		});
	}

	entry.timestamps.push(now);
}
