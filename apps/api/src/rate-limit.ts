import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { INGEST_LIMIT_REASONS } from "@rudel/api-routes";
import { isVercelRuntime } from "./lib/api-runtime.js";
import { readPositiveSafeIntegerEnv } from "./lib/env.js";

const logger = getLogger(["rudel", "api", "rate-limit"]);

// ── In-memory sliding-window rate limiter ─────────────────────────

interface SlidingWindowEntry {
	timestamps: number[];
}

type WeightedSample = { ts: number; weight: number };

interface WeightedWindowEntry {
	samples: WeightedSample[];
	total: number;
}

const organizationSessionCountWindows = new Map<string, SlidingWindowEntry>();
const wrappedShareCreateWindows = new Map<string, SlidingWindowEntry>();
const wrappedShareLookupWindows = new Map<string, SlidingWindowEntry>();
const wrappedShareLookupSourceWindows = new Map<string, SlidingWindowEntry>();
const wrappedResumeCreateWindows = new Map<string, SlidingWindowEntry>();
const wrappedDecimalClaimRedeemWindows = new Map<string, SlidingWindowEntry>();

const ORGANIZATION_SESSION_COUNT_MAX_REQUESTS = 300;
const ORGANIZATION_SESSION_COUNT_WINDOW_MS = 60_000;
const WRAPPED_SHARE_CREATE_MAX_REQUESTS = Number(
	process.env.RATE_LIMIT_WRAPPED_SHARE_CREATE_MAX ?? 12,
);
const WRAPPED_SHARE_CREATE_WINDOW_MS =
	Number(process.env.RATE_LIMIT_WRAPPED_SHARE_CREATE_WINDOW ?? 600) * 1000;
export const WRAPPED_SHARE_LOOKUP_MAX_REQUESTS = readPositiveSafeIntegerEnv(
	"RATE_LIMIT_WRAPPED_SHARE_LOOKUP_MAX",
	180,
);
export const WRAPPED_SHARE_LOOKUP_WINDOW_MS =
	readPositiveSafeIntegerEnv("RATE_LIMIT_WRAPPED_SHARE_LOOKUP_WINDOW", 60) *
	1000;
export const WRAPPED_SHARE_LOOKUP_CAPACITY = readPositiveSafeIntegerEnv(
	"RATE_LIMIT_WRAPPED_SHARE_LOOKUP_CAPACITY",
	5_000,
);
export const WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS =
	readPositiveSafeIntegerEnv("RATE_LIMIT_WRAPPED_SHARE_LOOKUP_SOURCE_MAX", 600);
// One source must be rejected before it can fill and start evicting the
// per-share cache with attacker-chosen IDs.
if (WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS > WRAPPED_SHARE_LOOKUP_CAPACITY) {
	throw new Error(
		"RATE_LIMIT_WRAPPED_SHARE_LOOKUP_SOURCE_MAX must not exceed RATE_LIMIT_WRAPPED_SHARE_LOOKUP_CAPACITY",
	);
}
const WRAPPED_RESUME_CREATE_MAX_REQUESTS = Number(
	process.env.RATE_LIMIT_WRAPPED_RESUME_CREATE_MAX ?? 6,
);
const WRAPPED_RESUME_CREATE_WINDOW_MS =
	Number(process.env.RATE_LIMIT_WRAPPED_RESUME_CREATE_WINDOW ?? 1800) * 1000;
const WRAPPED_DECIMAL_CLAIM_REDEEM_MAX_REQUESTS = Number(
	process.env.RATE_LIMIT_WRAPPED_DECIMAL_CLAIM_REDEEM_MAX ?? 10,
);
const WRAPPED_DECIMAL_CLAIM_REDEEM_WINDOW_MS =
	Number(process.env.RATE_LIMIT_WRAPPED_DECIMAL_CLAIM_REDEEM_WINDOW ?? 60) *
	1000;
export const INGEST_REQUESTS_MAX = readPositiveSafeIntegerEnv(
	"RATE_LIMIT_INGEST_REQUESTS_MAX",
	15_000,
);
export const INGEST_REQUESTS_WINDOW_MS =
	readPositiveSafeIntegerEnv("RATE_LIMIT_INGEST_REQUESTS_WINDOW", 3600) * 1000;
export const INGEST_BYTES_MAX = readPositiveSafeIntegerEnv(
	"RATE_LIMIT_INGEST_BYTES_MAX",
	10 * 1024 * 1024 * 1024,
);
export const INGEST_BYTES_WINDOW_MS =
	readPositiveSafeIntegerEnv("RATE_LIMIT_INGEST_BYTES_WINDOW", 3600) * 1000;

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

// Saturday share abuse protection stays intentionally small and auditable.
// These are not meant to replace edge or IP-based rate limits later. They are
// just enough to keep one user or one share id from being hammered unchecked.
export function checkWrappedShareCreateRateLimit(userId: string) {
	checkSlidingWindowRateLimit({
		entityId: userId,
		errorMessage: `Wrapped share creation is temporarily rate limited. Maximum ${WRAPPED_SHARE_CREATE_MAX_REQUESTS} requests per ${Math.round(WRAPPED_SHARE_CREATE_WINDOW_MS / 1000)} seconds.`,
		maxRequests: WRAPPED_SHARE_CREATE_MAX_REQUESTS,
		map: wrappedShareCreateWindows,
		operationName: "wrapped share creation",
		windowMs: WRAPPED_SHARE_CREATE_WINDOW_MS,
	});
}

let wrappedShareLookupEvictions = 0;
let wrappedShareLookupRejectedTraffic = 0;

if (!isVercelRuntime()) {
	const wrappedShareLookupCleanupTimer = setInterval(
		() => {
			const now = Date.now();
			evictExpiredWrappedShareLookupWindows(now);
			evictExpiredWrappedShareLookupSourceWindows(now);
		},
		Math.min(WRAPPED_SHARE_LOOKUP_WINDOW_MS, 60_000),
	);
	wrappedShareLookupCleanupTimer.unref();
}

export function checkWrappedShareLookupRateLimit(
	shareId: string,
	source: string,
): void {
	checkWrappedShareLookupSourceRateLimit(source);

	const now = Date.now();
	const cutoff = now - WRAPPED_SHARE_LOOKUP_WINDOW_MS;
	evictExpiredWrappedShareLookupWindows(now);

	let entry = wrappedShareLookupWindows.get(shareId);
	if (!entry) {
		if (wrappedShareLookupWindows.size >= WRAPPED_SHARE_LOOKUP_CAPACITY) {
			evictOldestWrappedShareLookupWindow();
		}

		entry = { timestamps: [] };
	}

	entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff);

	if (entry.timestamps.length >= WRAPPED_SHARE_LOOKUP_MAX_REQUESTS) {
		wrappedShareLookupRejectedTraffic += 1;
		logger.warn(
			"Wrapped share lookup rate limit exceeded for {shareId}: {count}/{max} in {window}s",
			{
				count: entry.timestamps.length,
				max: WRAPPED_SHARE_LOOKUP_MAX_REQUESTS,
				shareId,
				window: Math.round(WRAPPED_SHARE_LOOKUP_WINDOW_MS / 1000),
			},
		);
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: `Wrapped share lookup is temporarily rate limited. Maximum ${WRAPPED_SHARE_LOOKUP_MAX_REQUESTS} requests per ${Math.round(WRAPPED_SHARE_LOOKUP_WINDOW_MS / 1000)} seconds.`,
		});
	}

	entry.timestamps.push(now);

	// Map insertion order tracks the last accepted request, so the first entry
	// is always the right one to evict for both expiry and capacity pressure.
	wrappedShareLookupWindows.delete(shareId);
	wrappedShareLookupWindows.set(shareId, entry);
}

export function getWrappedShareLookupRateLimitMetrics() {
	const now = Date.now();
	evictExpiredWrappedShareLookupWindows(now);
	evictExpiredWrappedShareLookupSourceWindows(now);

	return {
		cardinality: wrappedShareLookupWindows.size,
		evictions: wrappedShareLookupEvictions,
		rejectedTraffic: wrappedShareLookupRejectedTraffic,
		sourceCardinality: wrappedShareLookupSourceWindows.size,
	};
}

function checkWrappedShareLookupSourceRateLimit(source: string): void {
	const now = Date.now();
	const cutoff = now - WRAPPED_SHARE_LOOKUP_WINDOW_MS;
	evictExpiredWrappedShareLookupSourceWindows(now);

	let entry = wrappedShareLookupSourceWindows.get(source);
	if (!entry) {
		if (wrappedShareLookupSourceWindows.size >= WRAPPED_SHARE_LOOKUP_CAPACITY) {
			const oldestSource = wrappedShareLookupSourceWindows.keys().next().value;
			if (typeof oldestSource === "string") {
				wrappedShareLookupSourceWindows.delete(oldestSource);
				wrappedShareLookupEvictions += 1;
			}
		}

		entry = { timestamps: [] };
	}

	entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > cutoff);

	if (entry.timestamps.length >= WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS) {
		wrappedShareLookupRejectedTraffic += 1;
		logger.warn(
			"Wrapped share lookup source rate limit exceeded: {count}/{max} in {window}s",
			{
				count: entry.timestamps.length,
				max: WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS,
				window: Math.round(WRAPPED_SHARE_LOOKUP_WINDOW_MS / 1000),
			},
		);
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: `Wrapped share lookup is temporarily rate limited. Maximum ${WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS} requests per ${Math.round(WRAPPED_SHARE_LOOKUP_WINDOW_MS / 1000)} seconds.`,
		});
	}

	entry.timestamps.push(now);
	wrappedShareLookupSourceWindows.delete(source);
	wrappedShareLookupSourceWindows.set(source, entry);
}

function evictExpiredWrappedShareLookupWindows(now: number): void {
	const cutoff = now - WRAPPED_SHARE_LOOKUP_WINDOW_MS;

	for (const [shareId, entry] of wrappedShareLookupWindows) {
		const latestTimestamp = entry.timestamps.at(-1);
		if (latestTimestamp !== undefined && latestTimestamp > cutoff) {
			break;
		}

		wrappedShareLookupWindows.delete(shareId);
		wrappedShareLookupEvictions += 1;
	}
}

function evictExpiredWrappedShareLookupSourceWindows(now: number): void {
	const cutoff = now - WRAPPED_SHARE_LOOKUP_WINDOW_MS;

	for (const [source, entry] of wrappedShareLookupSourceWindows) {
		const latestTimestamp = entry.timestamps.at(-1);
		if (latestTimestamp !== undefined && latestTimestamp > cutoff) {
			break;
		}

		wrappedShareLookupSourceWindows.delete(source);
		wrappedShareLookupEvictions += 1;
	}
}

function evictOldestWrappedShareLookupWindow(): void {
	const oldestShareId = wrappedShareLookupWindows.keys().next().value;
	if (typeof oldestShareId !== "string") {
		return;
	}

	wrappedShareLookupWindows.delete(oldestShareId);
	wrappedShareLookupEvictions += 1;
}

export function checkWrappedResumeCreateRateLimit(userId: string) {
	checkSlidingWindowRateLimit({
		entityId: userId,
		errorMessage: `Desktop resume links are temporarily rate limited. Maximum ${WRAPPED_RESUME_CREATE_MAX_REQUESTS} requests per ${Math.round(WRAPPED_RESUME_CREATE_WINDOW_MS / 1000)} seconds.`,
		maxRequests: WRAPPED_RESUME_CREATE_MAX_REQUESTS,
		map: wrappedResumeCreateWindows,
		operationName: "wrapped desktop resume creation",
		windowMs: WRAPPED_RESUME_CREATE_WINDOW_MS,
	});
}

// Per-user redemption limit. Tokens are 256 bits so brute force is impossible;
// this is a thin guardrail to keep a single account from hammering the redeem
// endpoint by accident or otherwise.
export function checkWrappedDecimalClaimRedeemRateLimit(userId: string) {
	checkSlidingWindowRateLimit({
		entityId: userId,
		errorMessage: `Decimal claim redemption is temporarily rate limited. Maximum ${WRAPPED_DECIMAL_CLAIM_REDEEM_MAX_REQUESTS} requests per ${Math.round(WRAPPED_DECIMAL_CLAIM_REDEEM_WINDOW_MS / 1000)} seconds.`,
		maxRequests: WRAPPED_DECIMAL_CLAIM_REDEEM_MAX_REQUESTS,
		map: wrappedDecimalClaimRedeemWindows,
		operationName: "wrapped decimal claim redemption",
		windowMs: WRAPPED_DECIMAL_CLAIM_REDEEM_WINDOW_MS,
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
