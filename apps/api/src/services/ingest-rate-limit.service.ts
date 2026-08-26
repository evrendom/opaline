import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { INGEST_LIMIT_REASONS } from "@rudel/api-routes";
import type postgres from "postgres";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";

const logger = getLogger(["rudel", "api", "ingest-rate-limit"]);

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
		WHEN counter.byte_window_started_at
			+ ($8::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			THEN CURRENT_TIMESTAMP
		ELSE counter.byte_window_started_at
	END,
	byte_count = CASE
		WHEN NOT (
			counter.request_window_started_at
				+ ($7::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			OR counter.request_count + 1 <= $5::bigint
		) THEN CASE
			WHEN counter.byte_window_started_at
				+ ($8::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
				THEN 0
			ELSE counter.byte_count
		END
		WHEN counter.byte_window_started_at
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
		WHEN counter.byte_window_started_at
			+ ($8::double precision * INTERVAL '1 second') <= CURRENT_TIMESTAMP
			THEN $4::bigint <= $6::bigint
		ELSE counter.byte_count + $4::bigint <= $6::bigint
	END,
	updated_at = CURRENT_TIMESTAMP
RETURNING
	last_request_allowed AS "requestAllowed",
	last_byte_allowed AS "byteAllowed",
	request_count::text AS "requestCount",
	byte_count::text AS "byteCount"
`;

export interface IngestRateLimitConfig {
	readonly bytesMax: number;
	readonly bytesWindowSeconds: number;
	readonly requestsMax: number;
	readonly requestsWindowSeconds: number;
}

export type IngestRateLimitSubject =
	| { readonly id: string; readonly kind: "api_key" }
	| { readonly id: string; readonly kind: "legacy_user" };

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
	readonly requestAllowed: boolean;
	readonly requestCount: number;
}

export const INGEST_RATE_LIMIT_CONFIG: IngestRateLimitConfig = {
	bytesMax: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_BYTES_MAX",
		10 * 1024 * 1024 * 1024,
	),
	bytesWindowSeconds: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_BYTES_WINDOW",
		3600,
	),
	requestsMax: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_REQUESTS_MAX",
		15_000,
	),
	requestsWindowSeconds: readPositiveSafeIntegerEnv(
		"RATE_LIMIT_INGEST_REQUESTS_WINDOW",
		3600,
	),
};

export async function checkIngestRateLimit(
	subject: IngestRateLimitSubject,
	bytes: number,
	config: IngestRateLimitConfig,
	env: IngestRateLimitEnvironment,
): Promise<void> {
	assertValidBytes(bytes);

	let decision: IngestRateLimitDecision;
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
	apiKeyId: string | null,
	userId: string,
): IngestRateLimitSubject {
	return apiKeyId
		? { id: apiKeyId, kind: "api_key" }
		: { id: userId, kind: "legacy_user" };
}

function buildQueryParameters(
	subject: IngestRateLimitSubject,
	bytes: number,
	config: IngestRateLimitConfig,
): readonly IngestRateLimitParameter[] {
	const apiKeyId = subject.kind === "api_key" ? subject.id : null;
	const userId = subject.kind === "legacy_user" ? subject.id : null;
	return [
		`${subject.kind}:${subject.id}`,
		apiKeyId,
		userId,
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
		!("byteCount" in row)
	) {
		throw new Error("Ingest rate-limit query returned an invalid decision");
	}

	return {
		byteAllowed: row.byteAllowed,
		byteCount: readCounter(row.byteCount, "byteCount"),
		requestAllowed: row.requestAllowed,
		requestCount: readCounter(row.requestCount, "requestCount"),
	};
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
