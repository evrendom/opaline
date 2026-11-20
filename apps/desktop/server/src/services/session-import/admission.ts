import { ORPCError } from "@orpc/server";
import {
	getAdapter,
	getMissingTranscriptTimestampMessage,
	InvalidTranscriptTimestampError,
	type SessionTimestamps,
} from "@rudel/agent-adapters";
import type { IngestSessionInput } from "@rudel/api-routes";
import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import { getRedactionBudgetAnomaly } from "@rudel/secret-filter";
import { readBooleanEnv } from "../../lib/env.js";
import {
	clampIngestAggregateContentMaxBytes,
	enforceMeasuredIngestAggregateSize,
	measureIngestAggregateSize,
} from "../../lib/ingest-size.js";
import {
	checkHookIngestRateLimit,
	checkManualIngestRateLimit,
} from "../../rate-limit.js";
import { recordIngestPhase } from "../ingest-phase-timings.js";
import {
	checkIngestRateLimit,
	INGEST_RATE_LIMIT_CONFIG,
	resolveIngestRateLimitSubject,
} from "../ingest-rate-limit.service.js";
import { ingestRateLimitEnvironment } from "../ingest-rate-limit-environment.js";
import {
	assertIngestTimestampWindow,
	IngestTimestampWindowError,
} from "../ingest-timestamp-window.service.js";
import type { SessionImportDependencies } from "./dependencies.js";
import { filterFailure } from "./errors.js";
import type { SessionImportRequest } from "./import-session.js";
import type { AdmittedSession } from "./scope.js";

export async function admitSession(
	{
		aggregateContentMaxBytes,
		allowQuiescedIngest = false,
		contentSlimmed = false,
		context,
		enforceRateLimits,
		errorFactories,
		input,
		signal,
	}: SessionImportRequest,
	deps: SessionImportDependencies,
): Promise<AdmittedSession> {
	if (
		readBooleanEnv("SESSION_INGEST_QUIESCED", false) &&
		!allowQuiescedIngest
	) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			data: { reason: "session_ingest_quiesced" },
			message:
				"Session uploads are temporarily paused for an analytics rebuild. Retry shortly.",
		});
	}
	const effectiveAggregateContentMaxBytes = clampIngestAggregateContentMaxBytes(
		aggregateContentMaxBytes,
	);
	const aggregateBytes = measureIngestAggregateSize(input);
	if (enforceRateLimits) {
		await checkIngestRateLimit(
			resolveIngestRateLimitSubject(context.user.id),
			aggregateBytes > effectiveAggregateContentMaxBytes ? 0 : aggregateBytes,
			INGEST_RATE_LIMIT_CONFIG,
			ingestRateLimitEnvironment(),
		);
	}
	enforceMeasuredIngestAggregateSize(
		aggregateBytes,
		effectiveAggregateContentMaxBytes,
	);
	const filterStartedAt = performance.now();
	const filteredText = await deps.workers
		.filter({
			bytes: aggregateBytes,
			fields: {
				content: input.content,
				subagents: input.subagents,
				slimmed: contentSlimmed,
			},
			signal,
			userId: context.user.id,
		})
		.catch((error: unknown) => {
			throw filterFailure(error, errorFactories);
		});
	recordIngestPhase(
		"server.slim_and_secret_filter",
		performance.now() - filterStartedAt,
	);
	const redactionBudgetAnomaly = getRedactionBudgetAnomaly(
		filteredText.redactedBytes,
		filteredText.filterInputBytes,
		filteredText.counts,
	);
	if (redactionBudgetAnomaly) {
		throw errorFactories.redactionBudgetExceeded({
			...redactionBudgetAnomaly,
			ruleIds: [...redactionBudgetAnomaly.ruleIds],
		});
	}
	const filteredInput: IngestSessionInput = {
		...input,
		content: filteredText.content,
		subagents: filteredText.subagents ? [...filteredText.subagents] : undefined,
		filter_version: SESSION_INGEST_FILTER_VERSION,
	};
	const adapter = getAdapter(filteredInput.source);
	const timestamps = readTimestamps(adapter, filteredInput);
	if (enforceRateLimits) {
		if (input.upload_mode === "manual" || input.upload_mode === "retry") {
			checkManualIngestRateLimit(context.user.id, input.sessionId);
		} else {
			checkHookIngestRateLimit(context.user.id, input.sessionId);
		}
	}
	return { adapter, filteredInput, filteredText, timestamps };
}

function readTimestamps(
	adapter: ReturnType<typeof getAdapter>,
	filteredInput: IngestSessionInput,
): SessionTimestamps {
	let timestamps: SessionTimestamps | null;
	try {
		timestamps = adapter.extractTimestamps(filteredInput.content);
	} catch (error) {
		if (error instanceof InvalidTranscriptTimestampError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
	if (!timestamps) {
		throw new ORPCError("BAD_REQUEST", {
			message: getMissingTranscriptTimestampMessage(filteredInput.source),
		});
	}
	try {
		assertIngestTimestampWindow(timestamps);
	} catch (error) {
		if (error instanceof IngestTimestampWindowError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
	return timestamps;
}
