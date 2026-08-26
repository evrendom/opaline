import { getLogger } from "@logtape/logtape";
import { ORPCError, type Router } from "@orpc/server";
import {
	getAdapter,
	getMissingTranscriptTimestampMessage,
	InvalidTranscriptTimestampError,
	type SessionTimestamps,
} from "@rudel/agent-adapters";
import {
	type contract,
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	type IngestSessionInput,
	IngestSessionOutputSchema,
	PRODUCT_ANALYTICS_EVENTS,
	R2_INGEST_DISABLED_CODE,
	R2_INGEST_PROTOCOL,
	REDACTION_BUDGET_EXCEEDED_CODE,
	REDACTION_DID_NOT_CONVERGE_CODE,
	SECRET_FILTER_JSON_INTEGRITY_CODE,
	SESSION_OWNERSHIP_CONFLICT_CODE,
	SESSION_UPLOAD_SHRINK_REJECTED_CODE,
} from "@rudel/api-routes";
import {
	FILTER_VERSION,
	getRedactionBudgetAnomaly,
	SecretFilterConvergenceError,
	SecretFilterJsonIntegrityError,
} from "@rudel/secret-filter";
import type { UsageExtractionResult } from "@rudel/usage-events";
import {
	createIdempotentClickHouseExecutor,
	getClickhouse,
} from "./clickhouse.js";
import { ingestProcessingSqlClient, sqlClient } from "./db.js";
import { adminRouter } from "./handlers/admin/index.js";
import { analyticsRouter } from "./handlers/analytics/index.js";
import { chatwootRouter } from "./handlers/chatwoot.js";
import { productAnalyticsRouter } from "./handlers/product-analytics.js";
import { profileRouter } from "./handlers/profile.js";
import { teamInviteLinkRouter } from "./handlers/team-invite-link.js";
import { wrappedDecimalClaimRouter } from "./handlers/wrapped-decimal-claim.js";
import { wrappedResumeRouter } from "./handlers/wrapped-resume.js";
import { wrappedShareRouter } from "./handlers/wrapped-share.js";
import { isVercelRuntime } from "./lib/api-runtime.js";
import { readBooleanEnv } from "./lib/env.js";
import { computeIngestContentHash } from "./lib/ingest-content-hash.js";
import {
	getIngestContentShape,
	isUnexpectedIngestShrink,
	resolvePreviousIngestContentShape,
} from "./lib/ingest-content-shape.js";
import { enforceIngestAggregateSize } from "./lib/ingest-size.js";
import {
	bucketContentSize,
	captureApiProductAnalyticsEvent,
	hashProjectPath,
} from "./lib/product-analytics.js";
import {
	type AppContext,
	authMiddleware,
	ingestAuthMiddleware,
	os,
	settingsMutationMiddleware,
} from "./middleware.js";
import {
	checkHookIngestRateLimit,
	checkIngestByteRateLimit,
	checkIngestRequestRateLimit,
	checkManualIngestRateLimit,
	checkOrganizationSessionCountRateLimit,
} from "./rate-limit.js";
import {
	enqueueClickHousePurge,
	wakeClickHousePurgeWorker,
} from "./services/clickhouse-purge.service.js";
import {
	filterSessionTextFieldsOffThread,
	IngestFilterQueueAbortedError,
	IngestFilterQueueClosedError,
	IngestFilterQueueFullError,
	IngestFilterQueueTimeoutError,
} from "./services/ingest-filter.service.js";
import {
	getR2IngestJobStatus,
	initR2IngestJob,
} from "./services/ingest-job.service.js";
import {
	type IngestProcessingFailpoint,
	passIngestProcessingBoundary,
} from "./services/ingest-processing-boundary.js";
import {
	type ClaimedIngestProcessingLedger,
	IngestProcessingCapacityError,
	ingestProcessingSemaphore,
	readIngestProcessingTargetReceipt,
	recordIngestProcessingTargetReceipt,
	reserveLedgerUsageGeneration,
	withIngestProcessingLedger,
} from "./services/ingest-processing-ledger.service.js";
import { getNextIngestedAt } from "./services/ingest-timestamp.service.js";
import {
	assertIngestTimestampWindow,
	IngestTimestampWindowError,
} from "./services/ingest-timestamp-window.service.js";
import {
	IngestFilterWorkerOperationalError,
	SessionLanguageSignalScannerOperationalError,
} from "./services/ingest-worker-operational.error.js";
import {
	getCachedOrgSessionCount,
	hasOrgUploadsInLastDays,
} from "./services/org-session.service.js";
import {
	commitR2IngestJob,
	R2IngestCommitError,
	type R2IngestProcessorResult,
} from "./services/r2-ingest-commit.service.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "./services/r2-ingest-storage.service.js";
import { hasRawSessionRow } from "./services/raw-session.service.js";
import {
	persistSessionLanguageSignals,
	persistSessionLanguageSignalsBestEffort,
	persistSessionLanguageSignalsWithExecutor,
} from "./services/session-language-signal-persistence.service.js";
import {
	claimSessionIngestOwnership,
	recordSessionIngestContent,
	reserveUsageExtractionGeneration,
	UsageExtractionSupersededError,
} from "./services/session-ownership.service.js";
import {
	allocateSessionRevision,
	buildSessionRevisionDeduplicationToken,
	buildSessionRevisionOperationId,
} from "./services/session-revision.service.js";
import {
	hashSkillSourceContent,
	SKILL_PARSER_VERSION,
} from "./services/skill-extraction.js";
import type { SkillExtractionResult } from "./services/skill-extraction.types.js";
import {
	hasMatchingSkillExtractionReceipt,
	readSkillExtractionReceipt,
	writeSkillExtraction,
} from "./services/skill-extraction-ingest.service.js";
import {
	hasMatchingUsageExtractionReceipt,
	shouldReplaceUsageEventsForVersion,
	writeUsageExtraction,
} from "./services/usage-event-ingest.service.js";
import {
	extractSessionFactsOffThread,
	UsageExtractionExecutionError,
	UsageExtractionQueueAbortedError,
	UsageExtractionQueueClosedError,
	UsageExtractionQueueFullError,
	UsageExtractionQueueTimeoutError,
} from "./services/usage-extraction.service.js";

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

const health = os.health.handler(() => {
	return {
		status: "ok" as const,
	};
});

const me = os.me.use(authMiddleware).handler(({ context }) => {
	return {
		id: context.user.id,
		email: context.user.email,
		name: context.user.name,
		image: context.user.image ?? null,
		activeOrganizationId:
			((context.session as Record<string, unknown>).activeOrganizationId as
				| string
				| null) ?? null,
	};
});

const cliAuthStatus = os.cli.authStatus
	.use(ingestAuthMiddleware)
	.handler(({ context }) => {
		return {
			id: context.user.id,
			email: context.user.email,
			name: context.user.name,
		};
	});

const cliSetupStatus = os.cli.setupStatus
	.use(authMiddleware)
	.handler(async ({ context }) => {
		const [status] = await sqlClient<Array<{ has_cli_login: boolean }>>`
			SELECT EXISTS (
				SELECT 1
				FROM apikey
				WHERE reference_id = ${context.user.id}
					AND name = 'rudel-cli-ingest'
					AND enabled = true
					AND (expires_at IS NULL OR expires_at > NOW())
			) AS has_cli_login
		`;

		return {
			hasCliLogin: status?.has_cli_login === true,
		};
	});

const listMyOrganizations = os.listMyOrganizations
	.use(authMiddleware)
	.handler(async ({ context }) => {
		const memberships = await sqlClient<
			Array<{
				id: string;
				logo: string | null;
				name: string;
				slug: string;
			}>
		>`
			SELECT
				o.id,
				o.name,
				o.slug,
				o.logo
			FROM member m
			INNER JOIN organization o
				ON m.organization_id = o.id
			WHERE m.user_id = ${context.user.id}
		`;

		return memberships.map((m) => ({
			id: m.id,
			name: m.name,
			slug: m.slug,
			logo: m.logo ?? null,
		}));
	});

async function resolveIngestOrganizationId(
	requestedOrganizationId: string | null,
	userId: string,
): Promise<string> {
	if (requestedOrganizationId) {
		const membership = await sqlClient<Array<{ id: string }>>`
			SELECT id
			FROM member
			WHERE organization_id = ${requestedOrganizationId}
				AND user_id = ${userId}
			LIMIT 1
		`;

		if (membership.length === 0) {
			throw new ORPCError("FORBIDDEN", {
				message: "Not a member of the specified organization",
			});
		}
		return requestedOrganizationId;
	}

	// Two rows are enough to distinguish a sole membership from an ambiguous choice.
	// Prefer the personal workspace when it exists; creation time makes the fallback deterministic.
	const memberships = await sqlClient<Array<{ organization_id: string }>>`
		SELECT m.organization_id
		FROM member m
		INNER JOIN organization o
			ON o.id = m.organization_id
		WHERE m.user_id = ${userId}
		GROUP BY m.organization_id
		ORDER BY (m.organization_id = ${userId}) DESC, MIN(m.created_at) ASC
		LIMIT 2
	`;
	const personalWorkspace = memberships.find(
		(membership) => membership.organization_id === userId,
	);
	if (personalWorkspace) {
		return personalWorkspace.organization_id;
	}
	if (memberships.length === 1 && memberships[0]) {
		return memberships[0].organization_id;
	}
	if (memberships.length === 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: "No organization is available for this upload",
		});
	}

	throw new ORPCError("BAD_REQUEST", {
		message: "Choose an organization with --org or rudel set-org",
	});
}

function getActiveOrganizationId(session: unknown): string | null {
	if (typeof session !== "object" || session === null) {
		return null;
	}
	if (!("activeOrganizationId" in session)) {
		return null;
	}
	return typeof session.activeOrganizationId === "string"
		? session.activeOrganizationId
		: null;
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

interface IngestContractErrors {
	[REDACTION_BUDGET_EXCEEDED_CODE]: (input: {
		data: {
			inputBytes: number;
			redactedBytes: number;
			ruleIds: string[];
		};
	}) => unknown;
	[REDACTION_DID_NOT_CONVERGE_CODE]: (input: {
		data: { maxPasses: number };
	}) => unknown;
	[SECRET_FILTER_JSON_INTEGRITY_CODE]: () => unknown;
	[SESSION_OWNERSHIP_CONFLICT_CODE]: () => unknown;
	[SESSION_UPLOAD_SHRINK_REJECTED_CODE]: (input: {
		data: {
			currentAssistantLineCount: number;
			currentContentBytes: number;
			previousAssistantLineCount: number;
			previousContentBytes: number;
		};
	}) => unknown;
}

function createIngestErrorFactories(
	errors: IngestContractErrors,
): IngestErrorFactories {
	return {
		redactionBudgetExceeded: (data) =>
			errors[REDACTION_BUDGET_EXCEEDED_CODE]({ data }),
		redactionDidNotConverge: (maxPasses) =>
			errors[REDACTION_DID_NOT_CONVERGE_CODE]({ data: { maxPasses } }),
		secretFilterJsonIntegrity: () =>
			errors[SECRET_FILTER_JSON_INTEGRITY_CODE](),
		sessionOwnershipConflict: () => errors[SESSION_OWNERSHIP_CONFLICT_CODE](),
		sessionUploadShrinkRejected: (data) =>
			errors[SESSION_UPLOAD_SHRINK_REJECTED_CODE]({ data }),
	};
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

export async function processIngestSession({
	allowQuiescedIngest = false,
	awaitLanguageSignals,
	claimedLedger,
	context,
	durableProcessing,
	enforceRateLimits,
	errorFactories,
	input,
	signal,
}: {
	allowQuiescedIngest?: boolean;
	awaitLanguageSignals: boolean;
	claimedLedger?: ClaimedIngestProcessingLedger;
	context: {
		session: AppContext["session"];
		user: { id: string };
	};
	durableProcessing?: {
		failpoint: IngestProcessingFailpoint | undefined;
		operationId: string;
	};
	enforceRateLimits: boolean;
	errorFactories: IngestErrorFactories;
	input: IngestSessionInput;
	signal?: AbortSignal;
}): Promise<R2IngestProcessorResult> {
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
	if (enforceRateLimits) checkIngestRequestRateLimit(context.user.id);
	const aggregateBytes = enforceIngestAggregateSize(
		input,
		INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	);
	if (enforceRateLimits) {
		checkIngestByteRateLimit(context.user.id, aggregateBytes);
	}
	const filteredText = await filterSessionTextFieldsOffThread({
		bytes: aggregateBytes,
		fields: {
			content: input.content,
			subagents: input.subagents,
		},
		signal,
		userId: context.user.id,
	}).catch((error: unknown) => {
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
	const redactionBudgetAnomaly = getRedactionBudgetAnomaly(
		filteredText.redactedBytes,
		aggregateBytes,
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
		filter_version: FILTER_VERSION,
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

	const orgId = await resolveIngestOrganizationId(
		input.organizationId ?? activeOrgId,
		context.user.id,
	);

	const ownership = await claimSessionIngestOwnership(
		orgId,
		input.sessionId,
		context.user.id,
	);
	if (!ownership.owned) {
		throw errorFactories.sessionOwnershipConflict();
	}
	const contentShape = getIngestContentShape(filteredInput);
	const previousContentShape = resolvePreviousIngestContentShape(ownership);
	if (
		!input.force_replace &&
		(ownership.lastFilterVersion === null ||
			ownership.lastFilterVersion === FILTER_VERSION) &&
		previousContentShape !== null &&
		isUnexpectedIngestShrink(previousContentShape, contentShape, {
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

	// Hash the exact bytes and filter version stored by the server. This makes
	// an old unfiltered CLI upload and a current pre-filtered CLI upload
	// converge after server filtering instead of creating duplicate rows.
	const contentHash = computeIngestContentHash(filteredInput);
	if (durableProcessing && !claimedLedger) {
		try {
			const ledgerResult = await withIngestProcessingLedger(
				{
					filteredContentSha256: contentHash,
					filterVersion: FILTER_VERSION,
					organizationId: orgId,
					sessionId: input.sessionId,
				},
				parseStoredIngestProcessorResult,
				(ledger) =>
					processIngestSession({
						allowQuiescedIngest,
						awaitLanguageSignals,
						claimedLedger: ledger,
						context,
						durableProcessing,
						enforceRateLimits,
						errorFactories,
						input,
						signal,
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
				getClickhouse(),
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
		: getClickhouse();
	const usageExtractionEnabled = readBooleanEnv(
		"USAGE_EVENT_EXTRACTION_ENABLED",
		true,
	);
	const skillExtractionEnabled = readBooleanEnv(
		"SKILL_EXTRACTION_ENABLED",
		true,
	);
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
		(await hasRawSessionRow({
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
				await readSkillExtractionReceipt(clickhouse, {
					agent: filteredInput.source === "claude_code" ? "claude" : "codex",
					organizationId: orgId,
					sessionId: input.sessionId,
					userId: context.user.id,
				}),
				{
					parserVersion: SKILL_PARSER_VERSION,
					sourceContentSha256: hashSkillSourceContent(filteredInput.content),
				},
			);
		if (!skillReceiptMatches) {
			logger.info(
				"Reprocessing duplicate session with a missing or stale skill receipt (organization_id={organizationId} session_id={sessionId})",
				{ organizationId: orgId, sessionId: input.sessionId },
			);
		} else {
			logger.info(
				"Skipping duplicate session ingest (organization_id={organizationId} session_id={sessionId})",
				{ organizationId: orgId, sessionId: input.sessionId },
			);
			return { contentSha256: contentHash, result: response };
		}
	}

	const revisionIdentity = {
		contentSha256: contentHash,
		operationId: buildSessionRevisionOperationId(
			filteredInput.source,
			durableProcessing?.operationId,
		),
		organizationId: orgId,
		sessionId: input.sessionId,
		userId: context.user.id,
	};
	const revision = await allocateSessionRevision(revisionIdentity);
	const ingestedAt = claimedLedger?.rawIngestedAt ?? getNextIngestedAt();
	await adapter.ingest(
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
	);
	await recordSessionIngestContent(
		orgId,
		input.sessionId,
		contentHash,
		contentShape,
		FILTER_VERSION,
		new Date(timestamps.sessionDate),
		ingestedAt,
		revision,
	);
	await passIngestProcessingBoundary(durableProcessing?.failpoint, {
		store: "postgres",
		target: "raw-receipt",
	});
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
				await persistSessionLanguageSignalsWithExecutor(
					languageSignalInput,
					clickhouse,
				);
			} else {
				await persistSessionLanguageSignals(languageSignalInput);
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
	} else {
		void persistSessionLanguageSignalsBestEffort(languageSignalInput);
	}

	if (!usageExtractionEnabled && !skillExtractionEnabled) {
		logger.warn(
			"Session fact extraction bypassed after raw ingest (organization_id={organizationId} session_id={sessionId})",
			{ organizationId: orgId, sessionId: input.sessionId },
		);
		return { contentSha256: contentHash, result: response };
	}

	const usageGeneration = usageExtractionEnabled
		? claimedLedger
			? await reserveLedgerUsageGeneration(
					claimedLedger,
					{
						organizationId: orgId,
						sessionId: input.sessionId,
						userId: context.user.id,
					},
					durableProcessing?.failpoint,
				)
			: await reserveUsageExtractionGeneration(
					orgId,
					input.sessionId,
					context.user.id,
				)
		: null;
	const subagents: Record<string, string> = {};
	for (const subagent of filteredInput.subagents ?? []) {
		subagents[subagent.agentId] = subagent.content;
	}
	let usageExtraction: UsageExtractionResult;
	let skillExtraction: SkillExtractionResult | null;
	try {
		const extraction = await extractSessionFactsOffThread({
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
		});
		usageExtraction = extraction.usage;
		skillExtraction = extraction.skills;
	} catch (error) {
		if (error instanceof UsageExtractionExecutionError) {
			if (
				usageExtractionEnabled &&
				usageGeneration !== null &&
				error.shouldPersistReceipt
			) {
				await writeUsageExtraction(clickhouse, {
					contentSha256: contentHash,
					extraction: error.extraction,
					filterVersion: FILTER_VERSION,
					generation: usageGeneration,
					ingestedAt,
					organizationId: orgId,
					sessionDate: new Date(timestamps.sessionDate),
					sessionId: input.sessionId,
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
		await writeSkillExtraction(clickhouse, {
			extractedAt: claimedLedger?.rawIngestedAt ?? getNextIngestedAt(),
			extraction: skillExtraction,
			organizationId: orgId,
			rawRevision: revision,
			sessionDate: new Date(timestamps.sessionDate),
			sessionId: input.sessionId,
			userId: context.user.id,
		});
	}
	if (!usageExtractionEnabled || usageGeneration === null) {
		return { contentSha256: contentHash, result: response };
	}
	await writeUsageExtraction(clickhouse, {
		contentSha256: contentHash,
		extraction: usageExtraction,
		filterVersion: FILTER_VERSION,
		generation: usageGeneration,
		ingestedAt,
		organizationId: orgId,
		replaceAbsentEvents:
			input.force_replace === true ||
			shouldReplaceUsageEventsForVersion(ownership),
		sessionDate: new Date(timestamps.sessionDate),
		sessionId: input.sessionId,
		source: filteredInput.source,
		userId: context.user.id,
	});
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

	await recordSessionIngestContent(
		orgId,
		input.sessionId,
		contentHash,
		contentShape,
		FILTER_VERSION,
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
	).catch((error: unknown) => {
		if (error instanceof UsageExtractionSupersededError) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "usage_extraction_superseded" },
				message: error.message,
			});
		}
		throw error;
	});
	await passIngestProcessingBoundary(durableProcessing?.failpoint, {
		store: "postgres",
		target: "usage-receipt",
	});
	response.usageChecksum = usageExtraction.receipt.checksum;

	const uploadCompletedPayload = getSessionUploadCompletedPayload(
		filteredInput,
		orgId,
		context.user.id,
	);

	if (!uploadCompletedPayload) {
		return { contentSha256: contentHash, result: response };
	}

	await captureApiProductAnalyticsEvent({
		distinctId: context.user.id,
		eventId: claimedLedger?.id,
		event: PRODUCT_ANALYTICS_EVENTS.SESSION_UPLOAD_COMPLETED,
		payload: uploadCompletedPayload,
	});

	return { contentSha256: contentHash, result: response };
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

const ingestSessionHandler = os.ingestSession
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, errors, signal }) => {
		const processed = await processIngestSession({
			allowQuiescedIngest: context.ingestOperatorAuthorized,
			awaitLanguageSignals: isVercelRuntime(),
			context,
			enforceRateLimits: true,
			errorFactories: createIngestErrorFactories(errors),
			input,
			signal,
		});
		return processed.result;
	});

const r2IngestInit = os.ingest.init
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, errors }) => {
		if (!context.apiKeyId) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "An ingest API key is required",
			});
		}
		if (
			readBooleanEnv("SESSION_INGEST_QUIESCED", false) &&
			!context.ingestOperatorAuthorized
		) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "session_ingest_quiesced" },
				message:
					"Session uploads are temporarily paused for an analytics rebuild. Retry shortly.",
			});
		}

		const availability = readR2IngestAvailability();
		if (!availability.enabled) {
			throw errors[R2_INGEST_DISABLED_CODE]({
				data: { missingVariables: [...availability.missingVariables] },
			});
		}

		checkIngestRequestRateLimit(context.user.id);
		const aggregateBytes = input.objects.reduce(
			(total, object) => total + object.byteLength,
			0,
		);
		checkIngestByteRateLimit(context.user.id, aggregateBytes);
		if (input.upload_mode === "manual" || input.upload_mode === "retry") {
			checkManualIngestRateLimit(context.user.id, input.sessionId);
		} else {
			checkHookIngestRateLimit(context.user.id, input.sessionId);
		}

		const activeOrganizationId = getActiveOrganizationId(context.session);
		const organizationId = await resolveIngestOrganizationId(
			input.organizationId ?? activeOrganizationId,
			context.user.id,
		);

		try {
			return await initR2IngestJob({
				database: sqlClient,
				input,
				now: () => new Date(),
				organizationId,
				r2: createR2MultipartUploadClient(availability.configuration),
				randomUUID: () => crypto.randomUUID(),
				userId: context.user.id,
			});
		} catch (error) {
			logger.error(
				"R2 ingest initialization failed (user_id={userId} session_id={sessionId} error={error})",
				{
					error: error instanceof Error ? error.name : "unknown",
					sessionId: input.sessionId,
					userId: context.user.id,
				},
			);
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "r2_ingest_initialization_failed" },
				message:
					"Could not initialize direct upload. Retry or use direct ingest.",
			});
		}
	});

const r2IngestCommit = os.ingest.commit
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, errors, signal }) => {
		if (!context.apiKeyId) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "An ingest API key is required",
			});
		}
		const availability = readR2IngestAvailability();
		if (!availability.enabled) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "r2_ingest_disabled" },
				message: "Direct-to-R2 ingest is not configured on this API host.",
			});
		}

		try {
			return await commitR2IngestJob({
				input,
				process: (sessionInput, identity, processingSignal) =>
					processIngestSession({
						allowQuiescedIngest: context.ingestOperatorAuthorized,
						awaitLanguageSignals: true,
						context: {
							session: null,
							user: { ...context.user, id: identity.userId },
						},
						enforceRateLimits: false,
						errorFactories: createIngestErrorFactories(errors),
						input: sessionInput,
						durableProcessing: {
							failpoint: undefined,
							operationId: identity.operationId,
						},
						signal: processingSignal,
					}),
				r2: createR2MultipartUploadClient(availability.configuration),
				signal,
				userId: context.user.id,
			});
		} catch (error) {
			if (error instanceof ORPCError) throw error;
			if (error instanceof R2IngestCommitError) {
				if (error.code === "R2_INGEST_JOB_NOT_FOUND") {
					throw new ORPCError("NOT_FOUND", { message: error.message });
				}
				if (
					error.code === "R2_INGEST_JOB_BUSY" ||
					error.code === "R2_INGEST_JOB_RETRY_LATER" ||
					error.code === "R2_INGEST_LEASE_LOST"
				) {
					throw new ORPCError("SERVICE_UNAVAILABLE", {
						data: { reason: error.code, retryAfterMs: 1_000 },
						message: error.message,
					});
				}
				if (error.code === "R2_INGEST_JOB_FAILED") {
					throw new ORPCError("CONFLICT", { message: error.message });
				}
				throw new ORPCError("BAD_REQUEST", {
					data: { reason: error.code },
					message: error.message,
				});
			}
			logger.error(
				"R2 ingest commit failed (user_id={userId} job_id={jobId} error={error})",
				{
					error: error instanceof Error ? error.name : "unknown",
					jobId: input.jobId,
					userId: context.user.id,
				},
			);
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "r2_ingest_processing_failed" },
				message: "Could not process the uploaded transcript. Retry shortly.",
			});
		}
	});

const r2IngestStatus = os.ingest.status
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context }) => {
		if (!context.apiKeyId) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "An ingest API key is required",
			});
		}

		const status = await getR2IngestJobStatus(input.jobId, context.user.id);
		if (!status) {
			throw new ORPCError("NOT_FOUND", {
				message: "Ingest job not found",
			});
		}
		return status;
	});

const revokeCliToken = os.cli.revokeToken
	.use(ingestAuthMiddleware)
	.handler(async ({ context }) => {
		if (!context.apiKeyId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "No API key in current authentication context",
			});
		}

		await sqlClient`
			UPDATE apikey
			SET enabled = false, updated_at = NOW()
			WHERE id = ${context.apiKeyId}
				AND reference_id = ${context.user.id}
		`;

		return { success: true as const };
	});

const getOrganizationSessionCount = os.getOrganizationSessionCount
	.use(authMiddleware)
	.handler(async ({ input, context }) => {
		if (input.userId && input.userId !== context.user.id) {
			throw new ORPCError("FORBIDDEN", {
				message: "Cannot read another user's raw session count",
			});
		}

		checkOrganizationSessionCountRateLimit(
			context.user.id,
			input.organizationId,
		);

		const membership = await sqlClient<Array<{ id: string }>>`
			SELECT id
			FROM member
			WHERE organization_id = ${input.organizationId}
				AND user_id = ${context.user.id}
			LIMIT 1
		`;

		if (membership.length === 0) {
			throw new ORPCError("FORBIDDEN", {
				message: "Not a member of this organization",
			});
		}

		const count = await getCachedOrgSessionCount(
			input.organizationId,
			input.userId,
		);
		return { count };
	});

const deleteOrganization = os.deleteOrganization
	.use(authMiddleware)
	.use(settingsMutationMiddleware)
	.handler(async ({ input, context }) => {
		const orgId = input.organizationId;
		const userId = context.user.id;
		logger.info(
			"Deleting organization (user_id={userId} organization_id={organizationId})",
			{ organizationId: orgId, userId },
		);

		try {
			// These analytics pre-reads must stay before the transaction because the
			// post-commit ClickHouse purge destroys the source rows they inspect.
			const [targetOrganization] = await sqlClient<
				Array<{ ageDays: number; id: string }>
			>`
				SELECT
					id,
					GREATEST(
						0,
						FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)
					)::int AS "ageDays"
				FROM organization
				WHERE id = ${orgId}
				LIMIT 1
			`;
			const [memberCountResult] = await sqlClient<Array<{ count: number }>>`
				SELECT COUNT(*)::int AS count
				FROM member
				WHERE organization_id = ${orgId}
			`;
			const memberCount = memberCountResult?.count ?? 0;
			let hadUploadsLast30d = false;
			try {
				hadUploadsLast30d = await hasOrgUploadsInLastDays(orgId, 30);
			} catch (analyticsError) {
				logger.error(
					"Failed to inspect uploads before organization deletion (organization_id={organizationId} error={error})",
					{
						error: String(analyticsError),
						organizationId: orgId,
					},
				);
			}

			await sqlClient.begin(async (transaction) => {
				await transaction.unsafe(
					`
						SELECT id
						FROM "user"
						WHERE id = $1
						FOR UPDATE
					`,
					[userId],
				);

				const [membershipSummary] = await transaction.unsafe<
					Array<{ count: number }>
				>(
					`
						SELECT COUNT(*)::int AS count
						FROM member
						WHERE user_id = $1
					`,
					[userId],
				);
				const membershipCount = membershipSummary?.count ?? 0;

				if (membershipCount <= 1) {
					logger.info(
						"Rejected organization deletion because it is the user's only organization (user_id={userId} organization_id={organizationId} membership_count={membershipCount})",
						{
							membershipCount,
							organizationId: orgId,
							userId,
						},
					);
					throw new ORPCError("BAD_REQUEST", {
						message: "Cannot delete your only organization",
					});
				}

				const ownership = await transaction.unsafe<Array<{ id: string }>>(
					`
						SELECT id
						FROM member
						WHERE organization_id = $1
							AND user_id = $2
							AND role = 'owner'
						LIMIT 1
					`,
					[orgId, userId],
				);

				if (ownership.length === 0) {
					logger.info(
						"Rejected organization deletion because the user is not its owner (user_id={userId} organization_id={organizationId})",
						{ organizationId: orgId, userId },
					);
					throw new ORPCError("FORBIDDEN", {
						message: "Only the organization owner can delete it",
					});
				}

				await enqueueClickHousePurge(
					{ targetId: orgId, targetType: "organization" },
					transaction,
				);
				await transaction.unsafe("DELETE FROM organization WHERE id = $1", [
					orgId,
				]);
				await transaction.unsafe(
					`
						UPDATE session
						SET active_organization_id = NULL
						WHERE active_organization_id = $1
					`,
					[orgId],
				);
			});
			await wakeClickHousePurgeWorker();

			await captureApiProductAnalyticsEvent({
				distinctId: userId,
				event: PRODUCT_ANALYTICS_EVENTS.ORGANIZATION_DELETED,
				payload: {
					organization_id: orgId,
					deleter_user_id: userId,
					organization_age_days: targetOrganization?.ageDays ?? 0,
					organization_member_count: memberCount,
					had_uploads_last_30d: hadUploadsLast30d,
				},
			});

			logger.info(
				"Organization deletion committed; ClickHouse purge queued (user_id={userId} organization_id={organizationId})",
				{ organizationId: orgId, userId },
			);
			return { success: true as const };
		} catch (error) {
			if (error instanceof ORPCError) throw error;
			logger.error(
				"Organization deletion failed (user_id={userId} organization_id={organizationId} error={error})",
				{ error: String(error), organizationId: orgId, userId },
			);
			throw error;
		}
	});

export const router: Router<typeof contract, AppContext> = os.router({
	health,
	me,
	profile: profileRouter,
	cli: {
		authStatus: cliAuthStatus,
		revokeToken: revokeCliToken,
		setupStatus: cliSetupStatus,
	},
	chatwoot: chatwootRouter,
	listMyOrganizations,
	ingestSession: ingestSessionHandler,
	ingest: {
		commit: r2IngestCommit,
		init: r2IngestInit,
		status: r2IngestStatus,
	},
	getOrganizationSessionCount,
	deleteOrganization,
	teamInviteLink: teamInviteLinkRouter,
	wrappedDecimalClaim: wrappedDecimalClaimRouter,
	wrappedResume: wrappedResumeRouter,
	wrappedShare: wrappedShareRouter,
	admin: adminRouter,
	productAnalytics: productAnalyticsRouter,
	analytics: analyticsRouter,
});
