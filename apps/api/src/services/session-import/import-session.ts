import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import {
	getAdapter,
	getMissingTranscriptTimestampMessage,
	InvalidTranscriptTimestampError,
	type SessionTimestamps,
} from "@rudel/agent-adapters";
import {
	extractNativeCodexLineageEvidence,
	type IngestSessionInput,
	IngestSessionOutputSchema,
	PRODUCT_ANALYTICS_EVENTS,
	R2_INGEST_PROTOCOL,
} from "@rudel/api-routes";
import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import {
	getRedactionBudgetAnomaly,
	SecretFilterConvergenceError,
	SecretFilterJsonIntegrityError,
} from "@rudel/secret-filter";
import type { UsageExtractionResult } from "@rudel/usage-events";
import { createIdempotentClickHouseExecutor } from "../../clickhouse.js";
import { ingestProcessingSqlClient } from "../../db.js";
import { readBooleanEnv } from "../../lib/env.js";
import { computeIngestContentHash } from "../../lib/ingest-content-hash.js";
import {
	getIngestContentShape,
	type IngestContentShape,
	isComparableIngestShapeVersion,
	isUnexpectedIngestShrink,
	resolvePreviousIngestContentShape,
} from "../../lib/ingest-content-shape.js";
import {
	clampIngestAggregateContentMaxBytes,
	enforceMeasuredIngestAggregateSize,
	measureIngestAggregateSize,
} from "../../lib/ingest-size.js";
import {
	bucketContentSize,
	hashProjectPath,
} from "../../lib/product-analytics.js";
import type { AppContext } from "../../middleware.js";
import {
	checkHookIngestRateLimit,
	checkManualIngestRateLimit,
} from "../../rate-limit.js";
import {
	type AnalysisUploadEnv,
	createAnalysisUploadEnv,
	linkUploadedSession,
} from "../analysis-log/analysis-uploads.js";
import { FreeWorkspaceMonthlyAgentRunLimitExceededError } from "../billing-entitlements.service.js";
import { getActiveOrganizationId } from "../cli-workspace.service.js";
import {
	shouldAwaitBestEffortLanguageSignals,
	shouldPersistUsageExtractionFailureReceipt,
	shouldStartBestEffortLanguageSignals,
} from "../ingest-derived-fact-policy.js";
import {
	IngestFilterQueueAbortedError,
	IngestFilterQueueClosedError,
	IngestFilterQueueFullError,
	IngestFilterQueueTimeoutError,
} from "../ingest-filter.service.js";
import type { IngestFilterResult } from "../ingest-filter.types.js";
import {
	recordIngestPhase,
	timedIngestPhase,
} from "../ingest-phase-timings.js";
import {
	type IngestProcessingFailpoint,
	passIngestProcessingBoundary,
} from "../ingest-processing-boundary.js";
import {
	type ClaimedIngestProcessingLedger,
	IngestProcessingCapacityError,
	ingestProcessingSemaphore,
	readIngestProcessingTargetReceipt,
	recordIngestProcessingTargetReceipt,
	reserveLedgerUsageGeneration,
	withIngestProcessingLedger,
} from "../ingest-processing-ledger.service.js";
import {
	checkIngestRateLimit,
	INGEST_RATE_LIMIT_CONFIG,
	resolveIngestRateLimitSubject,
} from "../ingest-rate-limit.service.js";
import { ingestRateLimitEnvironment } from "../ingest-rate-limit-environment.js";
import { getNextIngestedAt } from "../ingest-timestamp.service.js";
import {
	assertIngestTimestampWindow,
	IngestTimestampWindowError,
} from "../ingest-timestamp-window.service.js";
import {
	IngestFilterWorkerOperationalError,
	SessionLanguageSignalScannerOperationalError,
} from "../ingest-worker-operational.error.js";
import type { R2IngestProcessorResult } from "../r2-ingest-commit.service.js";
import { readR2IngestAvailability } from "../r2-ingest-storage.service.js";
import {
	type claimSessionIngestOwnership,
	SessionAgentMetadataConflictError,
	UsageExtractionSupersededError,
} from "../session-ownership.service.js";
import {
	buildSessionRevisionDeduplicationToken,
	buildSessionRevisionOperationId,
} from "../session-revision.service.js";
import {
	hashSkillSourceContent,
	SKILL_PARSER_VERSION,
} from "../skill-extraction.js";
import type { SkillExtractionResult } from "../skill-extraction.types.js";
import { hasMatchingSkillExtractionReceipt } from "../skill-extraction-ingest.service.js";
import { readTranscriptRecordsExtractionConfig } from "../transcript-records-extraction.service.js";
import {
	hasMatchingUsageExtractionReceipt,
	shouldReplaceUsageEventsForVersion,
} from "../usage-event-ingest.service.js";
import {
	UsageExtractionExecutionError,
	UsageExtractionQueueAbortedError,
	UsageExtractionQueueClosedError,
	UsageExtractionQueueFullError,
	UsageExtractionQueueTimeoutError,
} from "../usage-extraction.service.js";
import {
	productionDependencies,
	type SessionImportDependencies,
} from "./dependencies.js";

const logger = getLogger(["rudel", "api", "router"]);

function getSessionUploadCompletedPayload(
	input: IngestSessionInput,
	organizationId: string,
	userId: string,
) {
	if (!input.client_surface) {
		return null;
	}
	if (!input.upload_mode) {
		return null;
	}
	if (!input.cli_version) {
		return null;
	}
	if (!input.platform_os) {
		return null;
	}

	return {
		organization_id: organizationId,
		user_id: userId,
		client_surface: input.client_surface,
		upload_mode: input.upload_mode,
		agent_source: input.source,
		cli_version: input.cli_version,
		platform_os: input.platform_os,
		project_id_hash: hashProjectPath(input.projectPath),
		session_tag: input.tag,
		content_size_bucket: bucketContentSize(input.content.length),
	};
}

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

export interface SessionImportRequest {
	readonly aggregateContentMaxBytes?: number;
	readonly allowQuiescedIngest?: boolean;
	/** Where `input.analysisId` links are recorded; the configured log by default. */
	readonly analysisUploads?: AnalysisUploadEnv;
	readonly awaitBestEffortLanguageSignals?: boolean;
	readonly awaitLanguageSignals: boolean;
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
	{
		aggregateContentMaxBytes,
		allowQuiescedIngest = false,
		analysisUploads,
		awaitBestEffortLanguageSignals = false,
		awaitLanguageSignals,
		context,
		durableProcessing,
		enforceRateLimits,
		errorFactories,
		input,
		signal,
	}: SessionImportRequest,
	overrides: Partial<SessionImportDependencies> = {},
): Promise<R2IngestProcessorResult> {
	const deps: SessionImportDependencies = {
		...productionDependencies,
		...overrides,
	};
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
	const filteredText = await deps
		.filterText({
			bytes: aggregateBytes,
			fields: {
				content: input.content,
				subagents: input.subagents,
			},
			signal,
			userId: context.user.id,
		})
		.catch((error: unknown) => {
			if (error instanceof SecretFilterConvergenceError) {
				throw errorFactories.redactionDidNotConverge(error.maxPasses);
			}
			if (error instanceof SecretFilterJsonIntegrityError) {
				throw errorFactories.secretFilterJsonIntegrity();
			}
			if (error instanceof IngestFilterQueueFullError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: {
						reason: "ingest_filter_queue_full",
						limit: error.limit,
						retryAfterMs: error.retryAfterMs,
					},
					message: error.message,
				});
			}
			if (error instanceof IngestFilterQueueClosedError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: {
						reason: "ingest_filter_queue_closed",
						retryAfterMs: error.retryAfterMs,
					},
					message: error.message,
				});
			}
			if (error instanceof IngestFilterQueueTimeoutError) {
				throw new ORPCError("GATEWAY_TIMEOUT", {
					data: {
						reason: "ingest_filter_queue_timeout",
						retryAfterMs: error.retryAfterMs,
					},
					message: error.message,
				});
			}
			if (error instanceof IngestFilterQueueAbortedError) {
				throw new ORPCError("CLIENT_CLOSED_REQUEST", {
					message: error.message,
				});
			}
			if (error instanceof IngestFilterWorkerOperationalError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: {
						reason: "ingest_filter_worker_failed",
						retryAfterMs: error.retryAfterMs,
					},
					message: "Transcript filtering temporarily failed. Retry shortly.",
				});
			}
			throw error;
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

	const activeOrgId = getActiveOrganizationId(context.session);

	if (enforceRateLimits) {
		if (input.upload_mode === "manual" || input.upload_mode === "retry") {
			checkManualIngestRateLimit(context.user.id, input.sessionId);
		} else {
			checkHookIngestRateLimit(context.user.id, input.sessionId);
		}
	}

	const orgId = await deps.resolveOrganizationId(
		input.organizationId ?? activeOrgId,
		context.user.id,
	);

	const ownership = await deps
		.claimOwnership(orgId, input.sessionId, context.user.id)
		.catch(rethrowAgentRunLimitAsForbidden);
	if (!ownership.owned) {
		throw errorFactories.sessionOwnershipConflict();
	}
	const contentShape = getIngestContentShape(filteredInput);
	const previousContentShape = resolvePreviousIngestContentShape(ownership);
	if (
		!input.force_replace &&
		previousContentShape !== null &&
		isUnexpectedIngestShrink(previousContentShape, contentShape, {
			// Only byte sizes are re-baselined across a filter version bump;
			// lost assistant records or subagent streams are always refused.
			compareBytes: isComparableIngestShapeVersion(
				ownership.lastFilterVersion,
				SESSION_INGEST_FILTER_VERSION,
			),
			compareTotalsOnly: ownership.lastContentShape === null,
		})
	) {
		logger.warn(
			"Refusing smaller session re-upload (organization_id={organizationId} session_id={sessionId} previous_content_bytes={previousContentBytes} current_content_bytes={currentContentBytes} previous_assistant_lines={previousAssistantLineCount} current_assistant_lines={currentAssistantLineCount})",
			{
				currentAssistantLineCount: contentShape.assistantLineCount,
				currentContentBytes: contentShape.contentBytes,
				organizationId: orgId,
				previousAssistantLineCount: previousContentShape.assistantLineCount,
				previousContentBytes: previousContentShape.contentBytes,
				sessionId: input.sessionId,
			},
		);
		throw errorFactories.sessionUploadShrinkRejected({
			currentAssistantLineCount: contentShape.assistantLineCount,
			currentContentBytes: contentShape.contentBytes,
			previousAssistantLineCount: previousContentShape.assistantLineCount,
			previousContentBytes: previousContentShape.contentBytes,
		});
	}
	const nativeLineage = extractNativeCodexLineageEvidence({
		content: filteredInput.content,
		sessionDate: timestamps.sessionDate,
		sessionId: input.sessionId,
		source: filteredInput.source,
	});
	try {
		await deps.recordAgentMetadata(orgId, input.sessionId, context.user.id, {
			nativeParentSessionId: nativeLineage?.parentSessionId,
			nativeSubagentModel: nativeLineage?.model,
			nativeSubagentPath: nativeLineage?.agentPath,
			source: filteredInput.source,
		});
	} catch (error) {
		if (error instanceof SessionAgentMetadataConflictError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
	if (filteredInput.source === "codex") {
		// This runs before both idempotency exits so retries repair lineage even
		// when the raw transcript and usage receipt are already complete. The
		// durable arrival marker makes the wake-up below a one-time recovery.
		await deps.projectLineage({
			notifyPendingArrival: true,
			organizationId: orgId,
			sessionId: input.sessionId,
			userId: context.user.id,
		});
	}

	// Hash the exact bytes and filter version stored by the server. This makes
	// an old unfiltered CLI upload and a current pre-filtered CLI upload
	// converge after server filtering instead of creating duplicate rows.
	const contentHash = computeIngestContentHash(filteredInput);
	const processed = await processPreparedIngestSession({
		awaitBestEffortLanguageSignals,
		awaitLanguageSignals,
		context,
		deps,
		durableProcessing,
		input,
		prepared: {
			adapter,
			contentHash,
			contentShape,
			filteredInput,
			filteredText,
			orgId,
			ownership,
			timestamps,
		},
		signal,
	});
	if (!input.analysisId) return processed;
	// After the upload is stored, so every path (direct, R2 commit and its
	// recovery, identical re-uploads) records the link; the echo tells the CLI.
	const linked = await linkUploadedSession(
		{
			analysisId: input.analysisId,
			organizationId: orgId,
			sessionId: input.sessionId,
			source: filteredInput.source,
			uploadedAt: new Date().toISOString(),
			userId: context.user.id,
		},
		analysisUploads ?? createAnalysisUploadEnv(),
	);
	return linked
		? {
				...processed,
				result: { ...processed.result, analysisId: input.analysisId },
			}
		: processed;
}

interface PreparedIngestSession {
	readonly adapter: ReturnType<typeof getAdapter>;
	readonly contentHash: string;
	readonly contentShape: IngestContentShape;
	readonly filteredInput: IngestSessionInput;
	readonly filteredText: IngestFilterResult;
	readonly orgId: string;
	readonly ownership: Extract<
		Awaited<ReturnType<typeof claimSessionIngestOwnership>>,
		{ owned: true }
	>;
	readonly timestamps: SessionTimestamps;
}

async function processPreparedIngestSession({
	awaitBestEffortLanguageSignals,
	awaitLanguageSignals,
	claimedLedger,
	context,
	deps,
	durableProcessing,
	input,
	prepared,
	signal,
}: {
	awaitBestEffortLanguageSignals: boolean;
	awaitLanguageSignals: boolean;
	claimedLedger?: ClaimedIngestProcessingLedger;
	context: {
		apiKeyId: string | null;
		session: AppContext["session"];
		user: { id: string };
	};
	durableProcessing?: {
		failpoint: IngestProcessingFailpoint | undefined;
		operationId: string;
	};
	deps: SessionImportDependencies;
	input: IngestSessionInput;
	prepared: PreparedIngestSession;
	signal?: AbortSignal;
}): Promise<R2IngestProcessorResult> {
	const {
		adapter,
		contentHash,
		contentShape,
		filteredInput,
		filteredText,
		orgId,
		ownership,
		timestamps,
	} = prepared;
	const assertWritable = () =>
		deps.assertWritable({ organizationId: orgId, userId: context.user.id });
	const queueRunIndex = () =>
		deps.enqueueRunIndex({
			organizationId: orgId,
			userId: context.user.id,
			source: filteredInput.source,
			sessionId: input.sessionId,
		});
	if (durableProcessing && !claimedLedger) {
		try {
			const ledgerResult = await withIngestProcessingLedger(
				{
					filteredContentSha256: contentHash,
					filterVersion: SESSION_INGEST_FILTER_VERSION,
					organizationId: orgId,
					sessionId: input.sessionId,
				},
				parseStoredIngestProcessorResult,
				(ledger) =>
					processPreparedIngestSession({
						awaitBestEffortLanguageSignals,
						awaitLanguageSignals,
						claimedLedger: ledger,
						context,
						deps,
						durableProcessing,
						input,
						prepared,
						signal: signal
							? AbortSignal.any([signal, ledger.signal])
							: ledger.signal,
					}),
				{
					database: ingestProcessingSqlClient,
					failpoint: durableProcessing.failpoint,
					now: getNextIngestedAt,
					randomUUID: () => crypto.randomUUID(),
					semaphore: ingestProcessingSemaphore,
					signal,
				},
			);
			if (ledgerResult.status === "already_processing") {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: { reason: "ingest_already_processing", retryAfterMs: 1_000 },
					message: "An identical transcript is already being processed",
				});
			}
			return ledgerResult.result;
		} catch (error) {
			if (error instanceof IngestProcessingCapacityError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: {
						reason: error.code.toLowerCase(),
						retryAfterMs: 1_000,
					},
					message: error.message,
				});
			}
			throw error;
		}
	}
	const clickhouse = claimedLedger
		? createIdempotentClickHouseExecutor(
				deps.clickhouse(),
				{
					id: claimedLedger.id,
					readReceipt: (target) =>
						readIngestProcessingTargetReceipt(claimedLedger, target),
					recordReceipt: (target, expectedRowCount) =>
						recordIngestProcessingTargetReceipt(claimedLedger, {
							expectedRowCount,
							target,
						}),
					recovering: claimedLedger.recovering,
				},
				(table) =>
					passIngestProcessingBoundary(durableProcessing?.failpoint, {
						store: "clickhouse",
						target: table,
					}),
			)
		: deps.clickhouse();
	const usageExtractionEnabled = readBooleanEnv(
		"USAGE_EVENT_EXTRACTION_ENABLED",
		true,
	);
	const skillExtractionEnabled = readBooleanEnv(
		"SKILL_EXTRACTION_ENABLED",
		true,
	);
	const transcriptRecordsConfig = readTranscriptRecordsExtractionConfig();
	const subagents: Record<string, string> = {};
	for (const subagent of filteredInput.subagents ?? []) {
		subagents[subagent.agentId] = subagent.content;
	}
	const response = {
		success: true as const,
		sessionId: input.sessionId,
		...(readR2IngestAvailability().enabled
			? { upgradeHint: { protocol: R2_INGEST_PROTOCOL } }
			: {}),
		redacted: filteredText.counts,
		redactedBytes: filteredText.redactedBytes,
		usageChecksum: hasMatchingUsageExtractionReceipt(ownership, contentHash)
			? (ownership.lastUsageChecksum ?? undefined)
			: undefined,
	};

	// This is a best-effort cost optimization, not a cross-instance
	// security control. Concurrent identical requests can both reach the
	// ClickHouse insert before either records its successful hash.
	if (
		ownership.lastContentSha256 === contentHash &&
		hasMatchingUsageExtractionReceipt(ownership, contentHash) &&
		(await deps.hasRawRow({
			organizationId: orgId,
			sessionDate: ownership.lastSessionDate,
			sessionId: input.sessionId,
			table: adapter.rawTableName,
			userId: context.user.id,
		}))
	) {
		const skillReceiptMatches =
			!skillExtractionEnabled ||
			hasMatchingSkillExtractionReceipt(
				await deps.readSkillReceipt(clickhouse, {
					agent: filteredInput.source === "claude_code" ? "claude" : "codex",
					organizationId: orgId,
					sessionId: input.sessionId,
					userId: context.user.id,
				}),
				{
					parserVersion: SKILL_PARSER_VERSION,
					sourceContentSha256: hashSkillSourceContent(
						filteredInput.content,
						subagents,
					),
				},
			);
		const transcriptRecordsCurrent = await deps.recordsCurrent(
			deps.clickhouse(),
			{
				config: transcriptRecordsConfig,
				content: filteredInput.content,
				organizationId: orgId,
				sessionId: input.sessionId,
				subagents,
				userId: context.user.id,
			},
		);
		if (!skillReceiptMatches || !transcriptRecordsCurrent) {
			logger.info(
				"Reprocessing duplicate session with a missing or stale derived-data receipt (organization_id={organizationId} session_id={sessionId} skills_current={skillsCurrent} transcript_records_current={transcriptRecordsCurrent})",
				{
					organizationId: orgId,
					sessionId: input.sessionId,
					skillsCurrent: skillReceiptMatches,
					transcriptRecordsCurrent,
				},
			);
		} else {
			// Records are current, but their git observations may have been
			// skipped (no admission slot) or failed; extraction is a no-op when its
			// receipt is current and is best-effort, never failing the upload.
			if (transcriptRecordsConfig.enabled) {
				const derived = {
					assertWritable,
					onWritten: async () => {},
					organizationId: orgId,
					sessionId: input.sessionId,
					signal,
					source: filteredInput.source,
					userId: context.user.id,
				};
				if (
					(await deps.persistGitObservations(deps.clickhouse(), derived)) ===
					"written"
				)
					await queueRunIndex();
				// Goes on where an earlier pass stopped (time, chunk cap or quota).
				await deps.indexSearch(deps.clickhouse(), derived);
			}
			logger.info(
				"Skipping duplicate session ingest (organization_id={organizationId} session_id={sessionId})",
				{ organizationId: orgId, sessionId: input.sessionId },
			);
			return { contentSha256: contentHash, result: response };
		}
	}

	const revisionIdentity = {
		allowReceiptPromotion:
			input.force_replace === true &&
			input.operationId === undefined &&
			durableProcessing === undefined,
		contentSha256: contentHash,
		operationId: buildSessionRevisionOperationId(
			filteredInput.source,
			durableProcessing?.operationId,
			input.operationId,
		),
		organizationId: orgId,
		sessionId: input.sessionId,
		userId: context.user.id,
	};
	const revision = await deps.allocateRevision(revisionIdentity);
	const ingestedAt = claimedLedger?.rawIngestedAt ?? getNextIngestedAt();
	await timedIngestPhase("server.raw_insert", () =>
		adapter.ingest(
			{
				insert: ({ table, values }) =>
					clickhouse.insert({
						deduplicationToken: buildSessionRevisionDeduplicationToken(
							revisionIdentity,
							revision,
							table,
						),
						table,
						values,
					}),
			},
			filteredInput,
			{
				ingestedAt,
				organizationId: orgId,
				revision,
				timestamps,
				userId: context.user.id,
			},
		),
	);
	await deps.recordContent(
		orgId,
		input.sessionId,
		contentHash,
		contentShape,
		SESSION_INGEST_FILTER_VERSION,
		new Date(timestamps.sessionDate),
		ingestedAt,
		revision,
	);
	await passIngestProcessingBoundary(durableProcessing?.failpoint, {
		store: "postgres",
		target: "raw-receipt",
	});
	// Feeds the web app's CLI update notice; direct and R2 uploads both pass here.
	await deps.recordCliVersion(context.user.id, input.cli_version);
	const languageSignalInput = {
		content: filteredInput.content,
		organizationId: orgId,
		rawIngestedAt: ingestedAt,
		rawRevision: revision,
		sessionDate: timestamps.sessionDate,
		sessionId: input.sessionId,
		source: filteredInput.source,
		userId: context.user.id,
	};
	if (awaitLanguageSignals) {
		try {
			if (claimedLedger) {
				await deps.persistLanguageSignalsWith(languageSignalInput, clickhouse);
			} else {
				await deps.persistLanguageSignals(languageSignalInput);
			}
		} catch (error) {
			if (error instanceof SessionLanguageSignalScannerOperationalError) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: {
						reason: "language_signal_scanner_failed",
						retryAfterMs: error.retryAfterMs,
					},
					message:
						"Language-signal scanning temporarily failed. Retry shortly.",
				});
			}
			throw error;
		}
	} else if (
		shouldStartBestEffortLanguageSignals({
			awaitLanguageSignals,
			durableProcessing: durableProcessing !== undefined,
		})
	) {
		void timedIngestPhase("server.language_signals", () =>
			deps.persistLanguageSignalsBestEffort(languageSignalInput),
		);
	}

	// Derived data must never endanger the upload or the required extraction
	// below: the job never rejects, runs in its own worker under its own limits,
	// and is only awaited (in `finally`) so the response sees its receipt.
	const transcriptRecordsJob = deps
		.persistRecords(deps.clickhouse(), {
			assertWritable,
			config: transcriptRecordsConfig,
			content: filteredInput.content,
			onWritten: async () => {},
			organizationId: orgId,
			revision,
			sessionDate: timestamps.sessionDate,
			sessionId: input.sessionId,
			signal,
			source: filteredInput.source,
			subagents,
			userId: context.user.id,
		})
		.then(async (records) => {
			if (records === "written") await queueRunIndex();
			return records;
		});

	try {
		if (!usageExtractionEnabled && !skillExtractionEnabled) {
			logger.warn(
				"Session fact extraction bypassed after raw ingest (organization_id={organizationId} session_id={sessionId})",
				{ organizationId: orgId, sessionId: input.sessionId },
			);
			return { contentSha256: contentHash, result: response };
		}

		let usageGeneration: string | null = null;
		try {
			usageGeneration = usageExtractionEnabled
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
					: await deps.reserveUsageGeneration(
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
				return { contentSha256: contentHash, result: response };
			}
			throw error;
		}
		let usageExtraction: UsageExtractionResult;
		let skillExtraction: SkillExtractionResult | null;
		try {
			const extraction = await timedIngestPhase(
				"server.usage_and_skills_extraction",
				() =>
					deps.extractSessionFacts({
						bytes: contentShape.contentBytes,
						extractSkills: skillExtractionEnabled,
						input: {
							organizationId: orgId,
							userId: context.user.id,
							sessionId: input.sessionId,
							source: filteredInput.source,
							content: filteredInput.content,
							subagents,
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
					usageExtractionEnabled &&
					usageGeneration !== null &&
					shouldPersistUsageExtractionFailureReceipt({
						durableProcessing: claimedLedger !== undefined,
						extractionAllowsReceipt: error.shouldPersistReceipt,
					})
				) {
					await deps.writeUsage(clickhouse, {
						assertWritable,
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
				if (error instanceof UsageExtractionQueueFullError) {
					throw new ORPCError("SERVICE_UNAVAILABLE", {
						data: {
							limit: error.limit,
							reason: "usage_extraction_queue_full",
							retryAfterMs: error.retryAfterMs,
						},
						message: error.message,
					});
				}
				if (error instanceof UsageExtractionQueueClosedError) {
					throw new ORPCError("SERVICE_UNAVAILABLE", {
						data: {
							reason: "usage_extraction_queue_closed",
							retryAfterMs: error.retryAfterMs,
						},
						message: error.message,
					});
				}
				if (error instanceof UsageExtractionQueueTimeoutError) {
					throw new ORPCError("GATEWAY_TIMEOUT", {
						data: {
							reason: "usage_extraction_timeout",
							retryAfterMs: error.retryAfterMs,
						},
						message: error.message,
					});
				}
				if (error instanceof UsageExtractionQueueAbortedError) {
					throw new ORPCError("CLIENT_CLOSED_REQUEST", {
						data: {
							reason: "usage_extraction_aborted",
							retryAfterMs: error.retryAfterMs,
						},
						message: error.message,
					});
				}
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					data: { reason: "usage_extraction_execution_failed" },
					message:
						"Raw session data was stored, but usage extraction failed. Retry the upload.",
				});
			}
			throw error;
		}
		if (skillExtractionEnabled && skillExtraction) {
			await timedIngestPhase("server.skills_write", () =>
				deps.writeSkills(clickhouse, {
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
		if (!usageExtractionEnabled || usageGeneration === null) {
			return { contentSha256: contentHash, result: response };
		}
		await timedIngestPhase("server.usage_write", () =>
			deps.writeUsage(clickhouse, {
				assertWritable,
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
			await deps.recordContent(
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
				return { contentSha256: contentHash, result: response };
			}
			throw error;
		}
		await passIngestProcessingBoundary(durableProcessing?.failpoint, {
			store: "postgres",
			target: "usage-receipt",
		});
		if (filteredInput.source === "codex") {
			await deps.projectLineage({
				notifyPendingArrival: true,
				organizationId: orgId,
				sessionId: input.sessionId,
				userId: context.user.id,
			});
		}
		response.usageChecksum = usageExtraction.receipt.checksum;

		const uploadCompletedPayload = getSessionUploadCompletedPayload(
			filteredInput,
			orgId,
			context.user.id,
		);

		if (!uploadCompletedPayload) {
			return { contentSha256: contentHash, result: response };
		}

		await deps.captureEvent({
			distinctId: context.user.id,
			eventId: claimedLedger?.id,
			event: PRODUCT_ANALYTICS_EVENTS.SESSION_UPLOAD_COMPLETED,
			payload: uploadCompletedPayload,
		});

		return { contentSha256: contentHash, result: response };
	} finally {
		// Search indexing runs after the records extraction slot is released,
		// for uploads only; it is bounded and never fails the upload.
		if ((await transcriptRecordsJob) === "written")
			await timedIngestPhase("server.search_index", () =>
				deps.indexSearch(deps.clickhouse(), {
					assertWritable,
					organizationId: orgId,
					sessionId: input.sessionId,
					signal,
					source: filteredInput.source,
					userId: context.user.id,
				}),
			);
		if (
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals,
				awaitLanguageSignals,
				durableProcessing: durableProcessing !== undefined,
			})
		) {
			await timedIngestPhase("server.language_signals", () =>
				deps.persistLanguageSignalsBestEffort(languageSignalInput),
			);
		}
	}
}

function parseStoredIngestProcessorResult(
	value: unknown,
): R2IngestProcessorResult {
	if (
		typeof value !== "object" ||
		value === null ||
		!("contentSha256" in value) ||
		typeof value.contentSha256 !== "string" ||
		!/^[a-f0-9]{64}$/u.test(value.contentSha256) ||
		!("result" in value)
	) {
		throw new Error("Completed ingest processing ledger has an invalid result");
	}
	return {
		contentSha256: value.contentSha256,
		result: IngestSessionOutputSchema.parse(value.result),
	};
}
