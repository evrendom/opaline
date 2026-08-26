import { ORPCError } from "@orpc/server";
import {
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	INGEST_LIMIT_REASONS,
	type IngestSessionInput,
} from "@rudel/api-routes";

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
		return INGEST_AGGREGATE_CONTENT_MAX_BYTES;
	}
	return Math.min(override, INGEST_AGGREGATE_CONTENT_MAX_BYTES);
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
