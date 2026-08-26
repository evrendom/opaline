import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { INGEST_LIMIT_REASONS } from "@rudel/api-routes";
import type postgres from "postgres";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";

const logger = getLogger(["rudel", "api", "ingest-rate-limit"]);
// Postgres can wait 30 seconds for this row lock. Keeping windows at least 60
// seconds prevents queued statements with frozen CURRENT_TIMESTAMP values from
// rolling the same fixed window twice and losing an admitted count.
const MINIMUM_INGEST_WINDOW_SECONDS = 60;
const MAX_REJECTION_CACHE_ENTRIES = 10_000;

// A zero byte_count is the durable "no byte history" marker. The timestamp is
// still required by the schema, but the first positive charge must replace it.
const CONSUME_INGEST_RATE_LIMIT_SQL = `
INSERT INTO ingest_rate_limit_counter AS counter (
	limiter_key,
	api_key_id,
	user_id,
	request_window_started_at,
	request_count,
	byte_window_started_at,
	byte_count,
	last_request_allowed,
	last_byte_allowed,
	updated_at
)
VALUES (
	$1::text,
	$2::text,
	$3::text,
	CURRENT_TIMESTAMP,
	1,
	CURRENT_TIMESTAMP,
	CASE WHEN $4::bigint <= $6::bigint THEN $4::bigint ELSE 0 END,
	true,
	$4::bigint <= $6::bigint,
	CURRENT_TIMESTAMP
)
ON CONFLICT (limiter_key) DO UPDATE
SET
	request_window_started_at = CASE
		WHEN counter.request_window_started_at
			+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			THEN CURRENT_TIMESTAMP
		ELSE counter.request_window_started_at
	END,
	request_count = CASE
		WHEN counter.request_window_started_at
			+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			THEN 1
		WHEN counter.request_count + 1 <= $5::bigint
			THEN counter.request_count + 1
		ELSE counter.request_count
	END,
	byte_window_started_at = CASE
		WHEN (
			counter.request_window_started_at
				+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			OR counter.request_count + 1 <= $5::bigint
		)
			AND $4::bigint > 0
			AND (
				counter.byte_count = 0
				OR counter.byte_window_started_at
					+ ($8::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			)
			THEN CURRENT_TIMESTAMP
		ELSE counter.byte_window_started_at
	END,
	byte_count = CASE
		WHEN NOT (
			counter.request_window_started_at
				+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			OR counter.request_count + 1 <= $5::bigint
		) OR $4::bigint = 0 THEN counter.byte_count
		WHEN counter.byte_count = 0
			OR counter.byte_window_started_at
				+ ($8::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			THEN CASE WHEN $4::bigint <= $6::bigint THEN $4::bigint ELSE 0 END
		WHEN counter.byte_count + $4::bigint <= $6::bigint
			THEN counter.byte_count + $4::bigint
		ELSE counter.byte_count
	END,
	last_request_allowed = (
		counter.request_window_started_at
			+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
		OR counter.request_count + 1 <= $5::bigint
	),
	last_byte_allowed = (
		counter.request_window_started_at
			+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
		OR counter.request_count + 1 <= $5::bigint
	) AND CASE
		WHEN $4::bigint = 0 THEN true
		WHEN counter.byte_count = 0
			OR counter.byte_window_started_at
				+ ($8::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			THEN $4::bigint <= $6::bigint
		ELSE counter.byte_count + $4::bigint <= $6::bigint
	END,
	updated_at = CURRENT_TIMESTAMP
RETURNING
	last_request_allowed AS "requestAllowed",
	last_byte_allowed AS "byteAllowed",
	request_count::text AS "requestCount",
	byte_count::text AS "byteCount",
	GREATEST(
		EXTRACT(EPOCH FROM (
			request_window_started_at
				+ ($7::double precision * INTERVAL '1 second')
				- CURRENT_TIMESTAMP
		)),
		0
	)::double precision AS "requestResetAfterSeconds",
	GREATEST(
		EXTRACT(EPOCH FROM (
			byte_window_started_at
				+ ($8::double precision * INTERVAL '1 second')
				- CURRENT_TIMESTAMP
		)),
		0
	)::double precision AS "byteResetAfterSeconds"
`;

export interface IngestRateLimitConfig {
	readonly bytesMax: number;
	readonly bytesWindowSeconds: number;
	readonly requestsMax: number;
	readonly requestsWindowSeconds: number;
}

export interface IngestRateLimitSubject {
	readonly id: string;
	readonly kind: "user";
}

type IngestRateLimitParameter = number | string | null;

export interface IngestRateLimitEnvironment {
	readonly execute: (
		statement: string,
		parameters: readonly IngestRateLimitParameter[],
	) => Promise<unknown>;
}

interface IngestRateLimitDecision {
	readonly byteAllowed: boolean;
	readonly byteCount: number;
	readonly byteResetAfterSeconds: number;
	readonly requestAllowed: boolean;
	readonly requestCount: number;
	readonly requestResetAfterSeconds: number;
}

interface RequestRejectionCacheEntry {
	readonly current: number;
	readonly limit: number;
	readonly rejectUntilMonotonicMs: number;
	readonly windowSeconds: number;
}

// These bounded caches are per environment, and therefore per API instance in
// production. They are not authorities for admissions; expired or absent
// entries fall through to the locked row. Durations returned by Postgres are
// anchored to a monotonic timestamp sampled before the query, so ordinary
// query/lock delay expires entries conservatively early. A later forward
// database wall-clock correction can extend a cached 429 until this deadline,
// bounded by the configured window duration.
const requestRejectionCaches = new WeakMap<
	IngestRateLimitEnvironment,
	Map<string, RequestRejectionCacheEntry>
>();

export const INGEST_RATE_LIMIT_CONFIG: IngestRateLimitConfig = {
	bytesMax: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_BYTES_MAX",
		10 * 1024 * 1024 * 1024,
	),
	bytesWindowSeconds: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_BYTES_WINDOW",
		3600,
		MINIMUM_INGEST_WINDOW_SECONDS,
	),
	requestsMax: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_REQUESTS_MAX",
		15_000,
	),
	requestsWindowSeconds: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_REQUESTS_WINDOW",
		3600,
		MINIMUM_INGEST_WINDOW_SECONDS,
	),
};

export async function checkIngestRateLimit(
	subject: IngestRateLimitSubject,
	bytes: number,
	config: IngestRateLimitConfig,
	env: IngestRateLimitEnvironment,
): Promise<void> {
	assertValidBytes(bytes);
	const requestCacheKey = `${subject.kind}:${subject.id}:request`;
	const cachedRequestRejection = readCachedRequestRejection(
		env,
		requestCacheKey,
		config,
	);
	// Statement shedding is request-cache-only by design: a byte-side cache
	// cannot short-circuit exactly without also proving the request bucket's
	// state, and whenever this instance holds a valid request rejection the
	// branch below already skips the statement. Byte rejections therefore stay
	// database-backed, bounded by the request cap per window.
	if (cachedRequestRejection) {
		throwLimitExceeded({
			current: cachedRequestRejection.current,
			limit: cachedRequestRejection.limit,
			reason: INGEST_LIMIT_REASONS.requestLimit,
			subject,
			unit: "requests",
			windowSeconds: cachedRequestRejection.windowSeconds,
		});
	}

	let decision: IngestRateLimitDecision;
	const queryStartedAtMonotonicMs = performance.now();
	try {
		const rows = await env.execute(
			CONSUME_INGEST_RATE_LIMIT_SQL,
			buildQueryParameters(subject, bytes, config),
		);
		decision = parseDecision(rows);
	} catch (error) {
		throwUnavailableError(subject, error);
	}

	if (!decision.requestAllowed) {
		cacheRequestRejection(env, requestCacheKey, {
			current: decision.requestCount + 1,
			limit: config.requestsMax,
			rejectUntilMonotonicMs:
				queryStartedAtMonotonicMs + decision.requestResetAfterSeconds * 1000,
			windowSeconds: config.requestsWindowSeconds,
		});
		throwLimitExceeded({
			current: decision.requestCount + 1,
			limit: config.requestsMax,
			reason: INGEST_LIMIT_REASONS.requestLimit,
			subject,
			unit: "requests",
			windowSeconds: config.requestsWindowSeconds,
		});
	}

	if (!decision.byteAllowed) {
		throwLimitExceeded({
			current: decision.byteCount + bytes,
			limit: config.bytesMax,
			reason: INGEST_LIMIT_REASONS.byteLimit,
			subject,
			unit: "bytes",
			windowSeconds: config.bytesWindowSeconds,
		});
	}
}

export function createPostgresIngestRateLimitEnvironment(
	database: postgres.Sql,
): IngestRateLimitEnvironment {
	return {
		execute: async (statement, parameters) =>
			database.unsafe(statement, [...parameters]),
	};
}

export function resolveIngestRateLimitSubject(
	userId: string,
): IngestRateLimitSubject {
	return { id: userId, kind: "user" };
}

function buildQueryParameters(
	subject: IngestRateLimitSubject,
	bytes: number,
	config: IngestRateLimitConfig,
): readonly IngestRateLimitParameter[] {
	return [
		`${subject.kind}:${subject.id}`,
		null,
		subject.id,
		bytes,
		config.requestsMax,
		config.bytesMax,
		config.requestsWindowSeconds,
		config.bytesWindowSeconds,
	];
}

function parseDecision(value: unknown): IngestRateLimitDecision {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new Error("Ingest rate-limit query returned an invalid row count");
	}

	const row: unknown = value[0];
	if (
		typeof row !== "object" ||
		row === null ||
		!("requestAllowed" in row) ||
		typeof row.requestAllowed !== "boolean" ||
		!("byteAllowed" in row) ||
		typeof row.byteAllowed !== "boolean" ||
		!("requestCount" in row) ||
		!("byteCount" in row) ||
		!("byteResetAfterSeconds" in row) ||
		!("requestResetAfterSeconds" in row)
	) {
		throw new Error("Ingest rate-limit query returned an invalid decision");
	}

	return {
		byteAllowed: row.byteAllowed,
		byteCount: readCounter(row.byteCount, "byteCount"),
		byteResetAfterSeconds: readDuration(
			row.byteResetAfterSeconds,
			"byteResetAfterSeconds",
		),
		requestAllowed: row.requestAllowed,
		requestCount: readCounter(row.requestCount, "requestCount"),
		requestResetAfterSeconds: readDuration(
			row.requestResetAfterSeconds,
			"requestResetAfterSeconds",
		),
	};
}

function readDuration(value: unknown, name: string): number {
	const parsed = typeof value === "string" ? Number(value) : value;
	if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Ingest rate-limit query returned an invalid ${name}`);
	}
	return parsed;
}

function readCachedRequestRejection(
	env: IngestRateLimitEnvironment,
	cacheKey: string,
	config: IngestRateLimitConfig,
): RequestRejectionCacheEntry | null {
	const cache = requestRejectionCaches.get(env);
	const entry = cache?.get(cacheKey);
	if (!entry) {
		return null;
	}
	if (
		entry.limit !== config.requestsMax ||
		entry.windowSeconds !== config.requestsWindowSeconds ||
		entry.rejectUntilMonotonicMs <= performance.now()
	) {
		cache?.delete(cacheKey);
		return null;
	}
	return entry;
}

function cacheRequestRejection(
	env: IngestRateLimitEnvironment,
	cacheKey: string,
	entry: RequestRejectionCacheEntry,
): void {
	if (entry.rejectUntilMonotonicMs <= performance.now()) {
		return;
	}

	let cache = requestRejectionCaches.get(env);
	if (!cache) {
		cache = new Map();
		requestRejectionCaches.set(env, cache);
	}
	cache.delete(cacheKey);
	while (cache.size >= MAX_REJECTION_CACHE_ENTRIES) {
		const oldestKey = cache.keys().next().value;
		if (typeof oldestKey !== "string") {
			break;
		}
		cache.delete(oldestKey);
	}
	cache.set(cacheKey, entry);
}

function readCounter(value: unknown, name: string): number {
	const parsed = typeof value === "string" ? Number(value) : value;
	if (
		typeof parsed !== "number" ||
		!Number.isSafeInteger(parsed) ||
		parsed < 0
	) {
		throw new Error(`Ingest rate-limit query returned an invalid ${name}`);
	}
	return parsed;
}

function assertValidBytes(bytes: number): void {
	if (!Number.isSafeInteger(bytes) || bytes < 0) {
		throw new Error(
			"Ingest rate-limit bytes must be a non-negative safe integer",
		);
	}
}

function throwLimitExceeded(input: {
	readonly current: number;
	readonly limit: number;
	readonly reason: string;
	readonly subject: IngestRateLimitSubject;
	readonly unit: "bytes" | "requests";
	readonly windowSeconds: number;
}): never {
	logger.warn("Ingest rate limit exceeded for {subjectKind} {subjectId}", {
		current: input.current,
		limit: input.limit,
		reason: input.reason,
		subjectId: input.subject.id,
		subjectKind: input.subject.kind,
	});
	throw new ORPCError("TOO_MANY_REQUESTS", {
		data: {
			current: input.current,
			limit: input.limit,
			reason: input.reason,
			windowSeconds: input.windowSeconds,
		},
		message: `Rate limit exceeded. Maximum ${input.limit} ingest ${input.unit} per ${Math.round(input.windowSeconds / 60)} minutes. Try again later.`,
	});
}

function throwUnavailableError(
	subject: IngestRateLimitSubject,
	error: unknown,
): never {
	logger.error(
		"Postgres ingest rate-limit check failed closed for {subjectKind} {subjectId}: {error}",
		{
			error: error instanceof Error ? error.message : String(error),
			subjectId: subject.id,
			subjectKind: subject.kind,
		},
	);
	throw new ORPCError("SERVICE_UNAVAILABLE", {
		data: {
			reason: "ingest_rate_limit_unavailable",
			retryAfterMs: 1_000,
		},
		message:
			"Ingest rate limiting is temporarily unavailable. Try again shortly.",
	});
}
