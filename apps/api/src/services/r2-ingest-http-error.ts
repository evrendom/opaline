import { ORPCError } from "@orpc/server";
import {
	type R2IngestCommitError,
	R2IngestCommitQueuedError,
} from "./r2-ingest-processing-error.js";

export function toR2IngestCommitOrpcError(error: R2IngestCommitError) {
	if (error.code === "R2_INGEST_JOB_NOT_FOUND") {
		return new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error.retryable) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: error.code,
				retryAfterMs: 1_000,
				...(error instanceof R2IngestCommitQueuedError ? { queued: true } : {}),
			},
			message: error.message,
		});
	}
	if (error.code === "R2_INGEST_JOB_FAILED") {
		return new ORPCError("CONFLICT", { message: error.message });
	}
	return new ORPCError("BAD_REQUEST", {
		data: { reason: error.code },
		message: error.message,
	});
}
