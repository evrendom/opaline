import { ORPCError } from "@orpc/server";
import {
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	INGEST_DIRECT_CONTENT_MAX_BYTES,
	INGEST_LIMIT_REASONS,
	type IngestSessionInput,
	LOCAL_INGEST_CONTENT_MAX_BYTES,
} from "@rudel/api-routes";
import { isSelfHosted } from "./self-hosted.js";

type Environment = Readonly<Record<string, string | undefined>>;

export function ingestContentCeiling(env: Environment = process.env): number {
	return isSelfHosted(env)
		? LOCAL_INGEST_CONTENT_MAX_BYTES
		: INGEST_AGGREGATE_CONTENT_MAX_BYTES;
}

/**
 * Sessions up to this size are "standard": every per-process budget (queues,
 * timeouts, row and text limits) was sized for them and they keep today's
 * behaviour. Larger R2 sessions (up to `INGEST_AGGREGATE_CONTENT_MAX_BYTES`)
 * run alone in each queue and get budgets scaled to their size.
 */
export const STANDARD_SESSION_MAX_BYTES = INGEST_DIRECT_CONTENT_MAX_BYTES;

/**
 * R2 sessions above this size are materialized in production only by the
 * large-ingest worker (`deploy/cloud/large-ingest`, 4 GB, one job per process). The
 * main Vercel project's functions (2 GB commit with several requests per
 * instance, 1 GB recovery cron) never materialize them: peak memory is about
 * ten times the session size. Per-session budgets still scale from
 * `STANDARD_SESSION_MAX_BYTES`.
 */
export const LARGE_INGEST_MIN_BYTES = 48 * 1024 * 1024;

export function isLargeIngestSession(bytes: number): boolean {
	return bytes > STANDARD_SESSION_MAX_BYTES;
}

/**
 * Scales a per-session budget sized for standard sessions to `bytes`:
 * unchanged up to `STANDARD_SESSION_MAX_BYTES`, then proportional to the
 * session size, capped at the ratio of the largest accepted session (2x).
 */
export function scaleSessionBudget(base: number, bytes: number): number {
	if (!Number.isFinite(bytes)) return base;
	const boundedBytes = Math.min(
		Math.max(bytes, STANDARD_SESSION_MAX_BYTES),
		ingestContentCeiling(),
	);
	return Math.ceil((base * boundedBytes) / STANDARD_SESSION_MAX_BYTES);
}

export function clampIngestAggregateContentMaxBytes(
	override: number | undefined,
): number {
	// NaN defeats Math.min and every downstream comparison, so only a
	// nonnegative safe integer may lower the production ceiling.
	if (
		override === undefined ||
		!Number.isSafeInteger(override) ||
		override < 0
	) {
		return ingestContentCeiling();
	}
	return Math.min(override, ingestContentCeiling());
}

export function enforceIngestAggregateSize(
	input: IngestSessionInput,
	maxBytes: number,
): number {
	const actualBytes = measureIngestAggregateSize(input);
	enforceMeasuredIngestAggregateSize(actualBytes, maxBytes);
	return actualBytes;
}

export function measureIngestAggregateSize(input: IngestSessionInput): number {
	return (
		Buffer.byteLength(input.content, "utf8") +
		(input.subagents ?? []).reduce(
			(total, subagent) => total + Buffer.byteLength(subagent.content, "utf8"),
			0,
		)
	);
}

export function enforceMeasuredIngestAggregateSize(
	actualBytes: number,
	maxBytes: number,
): void {
	if (actualBytes > maxBytes) {
		throw new ORPCError("PAYLOAD_TOO_LARGE", {
			data: {
				reason: INGEST_LIMIT_REASONS.transcriptTooLarge,
				maxBytes,
				actualBytes,
			},
		});
	}
}
