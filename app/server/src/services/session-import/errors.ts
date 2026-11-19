import { ORPCError } from "@orpc/server";
import {
	SecretFilterConvergenceError,
	SecretFilterJsonIntegrityError,
} from "@rudel/secret-filter";
import { FreeWorkspaceMonthlyAgentRunLimitExceededError } from "../billing-entitlements.service.js";
import {
	IngestFilterQueueAbortedError,
	IngestFilterQueueClosedError,
	IngestFilterQueueFullError,
	IngestFilterQueueTimeoutError,
} from "../ingest-filter.service.js";
import {
	IngestFilterWorkerOperationalError,
	SessionLanguageSignalScannerOperationalError,
} from "../ingest-worker-operational.error.js";
import {
	type UsageExtractionExecutionError,
	UsageExtractionQueueAbortedError,
	UsageExtractionQueueClosedError,
	UsageExtractionQueueFullError,
	UsageExtractionQueueTimeoutError,
} from "../usage-extraction.service.js";

export interface IngestErrorFactories {
	redactionBudgetExceeded: (data: {
		inputBytes: number;
		redactedBytes: number;
		ruleIds: string[];
	}) => unknown;
	redactionDidNotConverge: (maxPasses: number) => unknown;
	secretFilterJsonIntegrity: () => unknown;
	sessionOwnershipConflict: () => unknown;
	sessionUploadShrinkRejected: (data: {
		currentAssistantLineCount: number;
		currentContentBytes: number;
		previousAssistantLineCount: number;
		previousContentBytes: number;
	}) => unknown;
}

export function rethrowAgentRunLimitAsForbidden(error: unknown): never {
	if (error instanceof FreeWorkspaceMonthlyAgentRunLimitExceededError) {
		throw new ORPCError("FORBIDDEN", { message: error.message });
	}
	throw error;
}

export function createBackgroundIngestErrorFactories(): IngestErrorFactories {
	return {
		redactionBudgetExceeded: () =>
			new ORPCError("BAD_REQUEST", {
				message: "Transcript redaction exceeded the safety budget",
			}),
		redactionDidNotConverge: () =>
			new ORPCError("BAD_REQUEST", {
				message: "Transcript redaction did not converge",
			}),
		secretFilterJsonIntegrity: () =>
			new ORPCError("BAD_REQUEST", {
				message: "Transcript redaction changed JSON structure",
			}),
		sessionOwnershipConflict: () =>
			new ORPCError("CONFLICT", {
				message: "Session belongs to another organization member",
			}),
		sessionUploadShrinkRejected: () =>
			new ORPCError("CONFLICT", {
				message: "Replacement transcript is unexpectedly smaller",
			}),
	};
}

export function filterFailure(
	error: unknown,
	errorFactories: IngestErrorFactories,
): unknown {
	if (error instanceof SecretFilterConvergenceError) {
		return errorFactories.redactionDidNotConverge(error.maxPasses);
	}
	if (error instanceof SecretFilterJsonIntegrityError) {
		return errorFactories.secretFilterJsonIntegrity();
	}
	if (error instanceof IngestFilterQueueFullError) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: "ingest_filter_queue_full",
				limit: error.limit,
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	if (error instanceof IngestFilterQueueClosedError) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: "ingest_filter_queue_closed",
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	if (error instanceof IngestFilterQueueTimeoutError) {
		return new ORPCError("GATEWAY_TIMEOUT", {
			data: {
				reason: "ingest_filter_queue_timeout",
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	if (error instanceof IngestFilterQueueAbortedError) {
		return new ORPCError("CLIENT_CLOSED_REQUEST", {
			message: error.message,
		});
	}
	if (error instanceof IngestFilterWorkerOperationalError) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: "ingest_filter_worker_failed",
				retryAfterMs: error.retryAfterMs,
			},
			message: "Transcript filtering temporarily failed. Retry shortly.",
		});
	}
	return error;
}

export function languageSignalFailure(error: unknown): unknown {
	if (error instanceof SessionLanguageSignalScannerOperationalError) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: "language_signal_scanner_failed",
				retryAfterMs: error.retryAfterMs,
			},
			message: "Language-signal scanning temporarily failed. Retry shortly.",
		});
	}
	return error;
}

export function usageExtractionFailure(
	error: UsageExtractionExecutionError,
): ORPCError<string, unknown> {
	if (error instanceof UsageExtractionQueueFullError) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				limit: error.limit,
				reason: "usage_extraction_queue_full",
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	if (error instanceof UsageExtractionQueueClosedError) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: "usage_extraction_queue_closed",
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	if (error instanceof UsageExtractionQueueTimeoutError) {
		return new ORPCError("GATEWAY_TIMEOUT", {
			data: {
				reason: "usage_extraction_timeout",
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	if (error instanceof UsageExtractionQueueAbortedError) {
		return new ORPCError("CLIENT_CLOSED_REQUEST", {
			data: {
				reason: "usage_extraction_aborted",
				retryAfterMs: error.retryAfterMs,
			},
			message: error.message,
		});
	}
	return new ORPCError("SERVICE_UNAVAILABLE", {
		data: { reason: "usage_extraction_execution_failed" },
		message:
			"Raw session data was stored, but usage extraction failed. Retry the upload.",
	});
}
