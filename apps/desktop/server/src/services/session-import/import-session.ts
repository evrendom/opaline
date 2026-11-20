import { type IngestSessionInput, R2_INGEST_PROTOCOL } from "@rudel/api-routes";
import { readBooleanEnv } from "../../lib/env.js";
import { computeIngestContentHashes } from "../../lib/ingest-content-hash.js";
import type { AppContext } from "../../middleware.js";
import {
	type AnalysisUploadEnv,
	createAnalysisUploadEnv,
	linkUploadedSession,
} from "../analysis-log/analysis-uploads.js";
import type { IngestProcessingFailpoint } from "../ingest-processing-boundary.js";
import type { ClaimedIngestProcessingLedger } from "../ingest-processing-ledger.service.js";
import type { R2IngestProcessorResult } from "../r2-ingest-commit.service.js";
import { readR2IngestAvailability } from "../r2-ingest-storage.service.js";
import { readTranscriptRecordsExtractionConfig } from "../transcript-records-extraction.service.js";
import { hasMatchingUsageExtractionReceipt } from "../usage-event-ingest.service.js";
import { admitSession } from "./admission.js";
import { claimSession } from "./claim.js";
import {
	resolveDependencies,
	type SessionImportDependencies,
	type SessionImportOverrides,
} from "./dependencies.js";
import { storeDerivedFacts } from "./derived.js";
import { duplicateExit } from "./duplicate.js";
import { ledgerExecutor, processInLedger } from "./durable.js";
import type { IngestErrorFactories } from "./errors.js";
import { storeRevision } from "./revision.js";
import type { ImportRun, PreparedSession } from "./scope.js";

export interface SessionImportRequest {
	readonly aggregateContentMaxBytes?: number;
	readonly allowQuiescedIngest?: boolean;
	/** Where `input.analysisId` links are recorded; the configured log by default. */
	readonly analysisUploads?: AnalysisUploadEnv;
	readonly awaitBestEffortLanguageSignals?: boolean;
	readonly awaitLanguageSignals: boolean;
	/** `input` was slimmed by the caller with the same rules (local import). */
	readonly contentSlimmed?: boolean;
	readonly context: {
		readonly apiKeyId: string | null;
		readonly session: AppContext["session"];
		readonly user: { readonly id: string };
	};
	readonly durableProcessing?: {
		readonly failpoint: IngestProcessingFailpoint | undefined;
		readonly operationId: string;
	};
	readonly enforceRateLimits: boolean;
	readonly errorFactories: IngestErrorFactories;
	readonly input: IngestSessionInput;
	readonly signal?: AbortSignal;
}

export async function processIngestSession(
	request: SessionImportRequest,
	overrides: SessionImportOverrides = {},
): Promise<R2IngestProcessorResult> {
	const deps = resolveDependencies(overrides);
	const admitted = await admitSession(request, deps);
	const claimed = await claimSession(request, deps, admitted);
	// Hash the exact bytes and filter version stored by the server. This makes
	// an old unfiltered CLI upload and a current pre-filtered CLI upload
	// converge after server filtering instead of creating duplicate rows.
	const subagents: Record<string, string> = {};
	for (const subagent of claimed.filteredInput.subagents ?? []) {
		subagents[subagent.agentId] = subagent.content;
	}
	const hashes = computeIngestContentHashes(claimed.filteredInput, subagents);
	const prepared: PreparedSession = {
		...claimed,
		contentHash: hashes.contentSha256,
		subagents,
		transcriptHash: hashes.transcriptSha256,
	};
	const processed = request.durableProcessing
		? await processInLedger(
				{
					contentHash: prepared.contentHash,
					failpoint: request.durableProcessing.failpoint,
					organizationId: prepared.orgId,
					sessionId: request.input.sessionId,
					signal: request.signal,
				},
				(ledger, signal) =>
					processPrepared(deps, prepared, { ...request, signal }, ledger),
			)
		: await processPrepared(deps, prepared, request, undefined);
	const { analysisId } = request.input;
	if (!analysisId) return processed;
	// After the upload is stored, so every path (direct, R2 commit and its
	// recovery, identical re-uploads) records the link; the echo tells the CLI.
	const linked = await linkUploadedSession(
		{
			analysisId,
			organizationId: prepared.orgId,
			sessionId: request.input.sessionId,
			source: prepared.filteredInput.source,
			uploadedAt: new Date().toISOString(),
			userId: request.context.user.id,
		},
		request.analysisUploads ?? createAnalysisUploadEnv(),
	);
	return linked
		? {
				...processed,
				result: { ...processed.result, analysisId },
			}
		: processed;
}

async function processPrepared(
	deps: SessionImportDependencies,
	prepared: PreparedSession,
	request: SessionImportRequest,
	claimedLedger: ClaimedIngestProcessingLedger | undefined,
): Promise<R2IngestProcessorResult> {
	const run = openRun(deps, prepared, request, claimedLedger);
	return (
		(await duplicateExit(run)) ??
		storeDerivedFacts(run, await storeRevision(run))
	);
}

function openRun(
	deps: SessionImportDependencies,
	prepared: PreparedSession,
	request: SessionImportRequest,
	claimedLedger: ClaimedIngestProcessingLedger | undefined,
): ImportRun {
	const { contentHash, filteredText, ownership } = prepared;
	return {
		claimedLedger,
		clickhouse: claimedLedger
			? ledgerExecutor(
					deps.stores.executor(),
					claimedLedger,
					request.durableProcessing?.failpoint,
				)
			: deps.stores.executor(),
		deps,
		enabled: {
			usage: readBooleanEnv("USAGE_EVENT_EXTRACTION_ENABLED", true),
			skills: readBooleanEnv("SKILL_EXTRACTION_ENABLED", true),
			records: readTranscriptRecordsExtractionConfig(),
		},
		prepared,
		request,
		response: {
			success: true as const,
			sessionId: request.input.sessionId,
			...(readR2IngestAvailability().enabled
				? { upgradeHint: { protocol: R2_INGEST_PROTOCOL } }
				: {}),
			redacted: filteredText.counts,
			redactedBytes: filteredText.redactedBytes,
			usageChecksum: hasMatchingUsageExtractionReceipt(ownership, contentHash)
				? (ownership.lastUsageChecksum ?? undefined)
				: undefined,
		},
	};
}
