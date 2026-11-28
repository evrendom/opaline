import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import type { UsageExtractionResult } from "@rudel/usage-events";
import {
	shouldAwaitBestEffortLanguageSignals,
	shouldPersistUsageExtractionFailureReceipt,
	shouldStartBestEffortLanguageSignals,
} from "../ingest-derived-fact-policy.js";
import { timedIngestPhase } from "../ingest-phase-timings.js";
import { passIngestProcessingBoundary } from "../ingest-processing-boundary.js";
import { reserveLedgerUsageGeneration } from "../ingest-processing-ledger.service.js";
import { getNextIngestedAt } from "../ingest-timestamp.service.js";
import type { R2IngestProcessorResult } from "../r2-ingest-commit.service.js";
import type { SessionLanguageSignalScanInput } from "../session-language-signal-persistence.service.js";
import { UsageExtractionSupersededError } from "../session-ownership.service.js";
import type { SkillExtractionResult } from "../skill-extraction.types.js";
import { shouldReplaceUsageEventsForVersion } from "../usage-event-ingest.service.js";
import { UsageExtractionExecutionError } from "../usage-extraction.service.js";
import type { SessionStores } from "./dependencies.js";
import { languageSignalFailure, usageExtractionFailure } from "./errors.js";
import {
	type ImportRun,
	importedSession,
	type StoredRevision,
	storedResult,
} from "./scope.js";

const logger = getLogger(["rudel", "api", "router"]);
const languageSignalLogger = getLogger([
	"rudel",
	"api",
	"session-language-signals",
]);

export async function storeDerivedFacts(
	run: ImportRun,
	stored: StoredRevision,
): Promise<R2IngestProcessorResult> {
	const { deps, enabled, prepared, request } = run;
	const { filteredInput, orgId, timestamps } = prepared;
	const { context, input, signal } = request;
	const languageSignalInput: SessionLanguageSignalScanInput = {
		content: filteredInput.content,
		organizationId: orgId,
		rawIngestedAt: stored.ingestedAt,
		rawRevision: stored.revision,
		sessionDate: timestamps.sessionDate,
		sessionId: input.sessionId,
		source: filteredInput.source,
		userId: context.user.id,
	};
	if (enabled.languageSignals)
		await startLanguageSignals(run, languageSignalInput, stored.ingestedAt);

	// Derived data must never endanger the upload or the required extraction
	// below: the job never rejects, runs in its own worker under its own limits,
	// and is only awaited (in `finally`) so the response sees its receipt.
	const transcriptRecordsJob = enabled.records.enabled
		? persistRecordsThenQueueIndex(run, stored)
		: Promise.resolve("skipped" as const);

	try {
		return await extractAndStoreFacts(run, stored);
	} finally {
		// Search indexing runs after the records extraction slot is released,
		// for uploads only; it is bounded and never fails the upload.
		if ((await transcriptRecordsJob) === "written")
			await timedIngestPhase("server.search_index", () =>
				deps.stores.indexSearch(deps.stores.executor(), {
					organizationId: orgId,
					sessionId: input.sessionId,
					signal,
					source: filteredInput.source,
					userId: context.user.id,
				}),
			);
		if (
			enabled.languageSignals &&
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals:
					request.awaitBestEffortLanguageSignals ?? false,
				awaitLanguageSignals: request.awaitLanguageSignals,
				durableProcessing: request.durableProcessing !== undefined,
			})
		) {
			await timedIngestPhase("server.language_signals", () =>
				writeLanguageSignalsBestEffort(deps.stores, languageSignalInput),
			);
		}
	}
}

function persistRecordsThenQueueIndex(
	run: ImportRun,
	stored: StoredRevision,
): Promise<"failed" | "skipped" | "written"> {
	const { deps, enabled, prepared, request } = run;
	const { filteredInput, orgId, timestamps } = prepared;
	const { context, input, signal } = request;
	return deps.stores
		.persistRecords(deps.stores.executor(), {
			config: enabled.records,
			content: filteredInput.content,
			contentSha256: prepared.transcriptHash,
			organizationId: orgId,
			revision: stored.revision,
			sessionDate: timestamps.sessionDate,
			sessionId: input.sessionId,
			signal,
			source: filteredInput.source,
			subagents: prepared.subagents,
			userId: context.user.id,
		})
		.then(async (records) => {
			if (records === "written")
				await deps.runIndex.enqueue(importedSession(run));
			return records;
		});
}

async function startLanguageSignals(
	{ claimedLedger, clickhouse, deps, request }: ImportRun,
	input: SessionLanguageSignalScanInput,
	ingestedAt: Date,
): Promise<void> {
	if (request.awaitLanguageSignals) {
		try {
			await deps.stores.writeLanguageSignals(
				claimedLedger ? clickhouse : deps.stores.executor(),
				input,
				claimedLedger ? () => ingestedAt : () => new Date(),
			);
		} catch (error) {
			throw languageSignalFailure(error);
		}
	} else if (
		shouldStartBestEffortLanguageSignals({
			awaitLanguageSignals: request.awaitLanguageSignals,
			durableProcessing: request.durableProcessing !== undefined,
		})
	) {
		void timedIngestPhase("server.language_signals", () =>
			writeLanguageSignalsBestEffort(deps.stores, input),
		);
	}
}

async function writeLanguageSignalsBestEffort(
	stores: SessionStores,
	input: SessionLanguageSignalScanInput,
): Promise<void> {
	try {
		await stores.writeLanguageSignals(
			stores.executor(),
			input,
			() => new Date(),
		);
	} catch (error) {
		languageSignalLogger.error(
			"Language-signal persistence failed after raw ingest; reconciliation will retry (organization_id={organizationId} session_id={sessionId} error={error})",
			{
				error: String(error),
				organizationId: input.organizationId,
				sessionId: input.sessionId,
			},
		);
	}
}

async function extractAndStoreFacts(
	run: ImportRun,
	{ ingestedAt, revision }: StoredRevision,
): Promise<R2IngestProcessorResult> {
	const { claimedLedger, clickhouse, deps, enabled, prepared, response } = run;
	const {
		contentHash,
		contentShape,
		filteredInput,
		orgId,
		ownership,
		timestamps,
	} = prepared;
	const { context, durableProcessing, input, signal } = run.request;
	if (!enabled.usage && !enabled.skills) {
		logger.warn(
			"Session fact extraction bypassed after raw ingest (organization_id={organizationId} session_id={sessionId})",
			{ organizationId: orgId, sessionId: input.sessionId },
		);
		return storedResult(run);
	}

	let usageGeneration: string | null = null;
	try {
		usageGeneration = enabled.usage
			? claimedLedger
				? await reserveLedgerUsageGeneration(
						claimedLedger,
						{
							expectedRevision: revision,
							organizationId: orgId,
							sessionId: input.sessionId,
							userId: context.user.id,
						},
						durableProcessing?.failpoint,
					)
				: await deps.control.reserveUsageGeneration(
						orgId,
						input.sessionId,
						context.user.id,
						revision,
					)
			: null;
	} catch (error) {
		if (error instanceof UsageExtractionSupersededError) {
			logger.info(
				"Usage extraction converged as superseded before reservation (organization_id={organizationId} session_id={sessionId} revision={revision})",
				{ organizationId: orgId, revision, sessionId: input.sessionId },
			);
			response.usageChecksum = undefined;
			return storedResult(run);
		}
		throw error;
	}
	let usageExtraction: UsageExtractionResult;
	let skillExtraction: SkillExtractionResult | null;
	try {
		const extraction = await timedIngestPhase(
			"server.usage_and_skills_extraction",
			() =>
				deps.workers.extractFacts({
					bytes: contentShape.contentBytes,
					extractSkills: enabled.skills,
					input: {
						organizationId: orgId,
						userId: context.user.id,
						sessionId: input.sessionId,
						source: filteredInput.source,
						content: filteredInput.content,
						subagents: prepared.subagents,
					},
					signal,
					skillSessionDate: timestamps.sessionDate,
					userId: context.user.id,
				}),
		);
		usageExtraction = extraction.usage;
		skillExtraction = extraction.skills;
	} catch (error) {
		if (error instanceof UsageExtractionExecutionError) {
			if (
				enabled.usage &&
				usageGeneration !== null &&
				shouldPersistUsageExtractionFailureReceipt({
					durableProcessing: claimedLedger !== undefined,
					extractionAllowsReceipt: error.shouldPersistReceipt,
				})
			) {
				await deps.stores.writeUsage(clickhouse, {
					contentSha256: contentHash,
					extraction: error.extraction,
					filterVersion: SESSION_INGEST_FILTER_VERSION,
					generation: usageGeneration,
					ingestedAt,
					organizationId: orgId,
					sessionDate: new Date(timestamps.sessionDate),
					sessionId: input.sessionId,
					signal,
					source: filteredInput.source,
					userId: context.user.id,
				});
			}
			logger.error(
				"Usage-event extraction crashed after raw ingest (organization_id={organizationId} session_id={sessionId} error={error})",
				{
					error: String(error.cause),
					organizationId: orgId,
					sessionId: input.sessionId,
				},
			);
			throw usageExtractionFailure(error);
		}
		throw error;
	}
	if (enabled.skills && skillExtraction) {
		await timedIngestPhase("server.skills_write", () =>
			deps.stores.writeSkills(clickhouse, {
				extractedAt: claimedLedger?.rawIngestedAt ?? getNextIngestedAt(),
				extraction: skillExtraction,
				organizationId: orgId,
				rawRevision: revision,
				sessionDate: new Date(timestamps.sessionDate),
				sessionId: input.sessionId,
				userId: context.user.id,
			}),
		);
	}
	if (!enabled.usage || usageGeneration === null) {
		return storedResult(run);
	}
	await timedIngestPhase("server.usage_write", () =>
		deps.stores.writeUsage(clickhouse, {
			contentSha256: contentHash,
			extraction: usageExtraction,
			filterVersion: SESSION_INGEST_FILTER_VERSION,
			generation: usageGeneration,
			ingestedAt,
			organizationId: orgId,
			replaceAbsentEvents:
				input.force_replace === true ||
				shouldReplaceUsageEventsForVersion(ownership),
			sessionDate: new Date(timestamps.sessionDate),
			sessionId: input.sessionId,
			signal,
			source: filteredInput.source,
			userId: context.user.id,
		}),
	);
	if (usageExtraction.status === "incomplete") {
		logger.warn(
			"Usage extraction incomplete after raw ingest (organization_id={organizationId} session_id={sessionId} diagnostics={diagnostics})",
			{
				diagnostics: JSON.stringify(usageExtraction.diagnostics),
				organizationId: orgId,
				sessionId: input.sessionId,
			},
		);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			data: {
				reason: "usage_extraction_incomplete",
				retryAfterMs: 1_000,
			},
			message:
				"Raw session data was stored, but usage telemetry is malformed or contradictory. Retry after the transcript writer finishes.",
		});
	}

	try {
		await deps.control.recordContent(
			orgId,
			input.sessionId,
			contentHash,
			contentShape,
			SESSION_INGEST_FILTER_VERSION,
			new Date(timestamps.sessionDate),
			ingestedAt,
			revision,
			{
				checksum: usageExtraction.receipt.checksum,
				diagnostics: JSON.stringify(usageExtraction.diagnostics),
				eventCount: usageExtraction.receipt.eventCount,
				extractionVersion: usageExtraction.receipt.extractionVersion,
				eventIdentityVersion: usageExtraction.receipt.eventIdentityVersion,
				generation: usageGeneration,
				modelRateCardVersion: usageExtraction.receipt.modelRateCardVersion,
			},
			filteredInput.source === "codex"
				? { deferArrivalNotification: true }
				: undefined,
		);
	} catch (error) {
		if (error instanceof UsageExtractionSupersededError) {
			logger.info(
				"Usage extraction converged as superseded before receipt (organization_id={organizationId} session_id={sessionId} revision={revision})",
				{ organizationId: orgId, revision, sessionId: input.sessionId },
			);
			response.usageChecksum = undefined;
			return storedResult(run);
		}
		throw error;
	}
	await passIngestProcessingBoundary(durableProcessing?.failpoint, {
		store: "postgres",
		target: "usage-receipt",
	});
	if (filteredInput.source === "codex") {
		await deps.control.projectLineage({
			organizationId: orgId,
			sessionId: input.sessionId,
			userId: context.user.id,
		});
	}
	response.usageChecksum = usageExtraction.receipt.checksum;
	return storedResult(run);
}
