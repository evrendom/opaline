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
	extractNativeCodexLineageEvidence,
	INGEST_DIRECT_CONTENT_MAX_BYTES,
	type IngestSessionInput,
	IngestSessionOutputSchema,
	LIVE_SESSIONS_DISABLED_CODE,
	PRODUCT_ANALYTICS_EVENTS,
	R2_INGEST_DISABLED_CODE,
	R2_INGEST_PROTOCOL,
	REDACTION_BUDGET_EXCEEDED_CODE,
	REDACTION_DID_NOT_CONVERGE_CODE,
	SECRET_FILTER_JSON_INTEGRITY_CODE,
	SESSION_OWNERSHIP_CONFLICT_CODE,
	SESSION_UPLOAD_SHRINK_REJECTED_CODE,
} from "@rudel/api-routes";
import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import {
	getRedactionBudgetAnomaly,
	SecretFilterConvergenceError,
	SecretFilterJsonIntegrityError,
} from "@rudel/secret-filter";
import type { UsageExtractionResult } from "@rudel/usage-events";
import {
	createIdempotentClickHouseExecutor,
	getClickhouse,
} from "./clickhouse.js";
import {
	ingestProcessingSqlClient,
	liveSessionSqlClient,
	sqlClient,
} from "./db.js";
import { getFrontendOrigin } from "./frontend-origin.js";
import { adminRouter } from "./handlers/admin/index.js";
import { analysisRouter } from "./handlers/analysis/index.js";
import { analyticsRouter } from "./handlers/analytics/index.js";
import { productAnalyticsRouter } from "./handlers/product-analytics.js";
import { profileRouter } from "./handlers/profile.js";
import { repositorySettingsRouter } from "./handlers/repository-settings.js";
import { teamInviteLinkRouter } from "./handlers/team-invite-link.js";
import { usageDigestRouter } from "./handlers/usage-digest-preferences.js";
import { isVercelRuntime } from "./lib/api-runtime.js";
import { ClickHouseWriteFencedError } from "./lib/clickhouse-write-fence.js";
import {
	isGitHubEvidenceUiEnabled,
	readBooleanEnv,
	readGitHubEvidenceUiForceOrgIds,
} from "./lib/env.js";
import { computeIngestContentHash } from "./lib/ingest-content-hash.js";
import {
	getIngestContentShape,
	type IngestContentShape,
	isComparableIngestShapeVersion,
	isUnexpectedIngestShrink,
	resolvePreviousIngestContentShape,
} from "./lib/ingest-content-shape.js";
import {
	clampIngestAggregateContentMaxBytes,
	enforceMeasuredIngestAggregateSize,
	measureIngestAggregateSize,
} from "./lib/ingest-size.js";
import {
	bucketContentSize,
	captureApiProductAnalyticsEvent,
	hashProjectPath,
} from "./lib/product-analytics.js";
import { readRepositoryEvidenceCapturePauseSeconds } from "./lib/repository-evidence-capture.js";
import {
	type AppContext,
	authMiddleware,
	ingestAuthMiddleware,
	orgMiddleware,
	os,
	settingsMutationMiddleware,
} from "./middleware.js";
import {
	checkHookIngestRateLimit,
	checkManualIngestRateLimit,
	checkOrganizationSessionCountRateLimit,
} from "./rate-limit.js";
import { readResendConfig } from "./resend-config.js";
import {
	type AnalysisUploadEnv,
	createAnalysisUploadEnv,
	linkUploadedSession,
	resolveAnalysisUploadWorkspace,
} from "./services/analysis-log/analysis-uploads.js";
import {
	createOrganizationBillingPortalSession,
	createOrganizationCheckoutSession,
	createOrganizationPlanSelectionSession,
	readBillingPricingState,
	readOrganizationBillingSummary,
} from "./services/billing.service.js";
import {
	assertCanStartOrganizationAgentRun,
	FreeWorkspaceMonthlyAgentRunLimitExceededError,
} from "./services/billing-entitlements.service.js";
import {
	BillingUpgradeRequestForbiddenError,
	BillingUpgradeRequestOwnerError,
	requestOrganizationBillingUpgrade,
} from "./services/billing-upgrade-request.service.js";
import { findUploadedSessionIds } from "./services/cli-session-upload-status.service.js";
import {
	getCliUpdateStatus,
	recordUserCliVersion,
} from "./services/cli-version.service.js";
import { assertNoClickHousePurgeTombstone } from "./services/clickhouse-purge-tombstone.service.js";
import { persistGitObservationsBestEffort } from "./services/git-observation-extraction.service.js";
import {
	createGitHubInstallationUrl,
	type GitHubRepositoryAppConfig,
	readGitHubInstallationStateSecret,
	readGitHubRepositoryAppConfig,
	readGitHubRepositoryAppUserAuthorizationConfig,
} from "./services/github-app.service.js";
import {
	collectAndPersistGitHubCommitEvidence,
	enqueueGitHubEvidenceCollection,
	GitHubEvidenceCapacityError,
} from "./services/github-evidence-persistence.service.js";
import { wakeGitHubEvidenceWorker } from "./services/github-evidence-worker.service.js";
import { readGitHubOutcomesReadiness } from "./services/github-outcomes-readiness.service.js";
import { getGitHubRepositoryConnectionStatus } from "./services/github-repository-binding.service.js";
import { disconnectGitHubRepositoryInstallation } from "./services/github-repository-disconnect.service.js";
import { resolveGitHubRepositoryEvidenceStatus } from "./services/github-repository-evidence-status.service.js";
import {
	shouldAwaitBestEffortLanguageSignals,
	shouldPersistUsageExtractionFailureReceipt,
	shouldStartBestEffortLanguageSignals,
} from "./services/ingest-derived-fact-policy.js";
import {
	filterSessionTextFieldsOffThread,
	IngestFilterQueueAbortedError,
	IngestFilterQueueClosedError,
	IngestFilterQueueFullError,
	IngestFilterQueueTimeoutError,
} from "./services/ingest-filter.service.js";
import type { IngestFilterResult } from "./services/ingest-filter.types.js";
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
import {
	checkIngestRateLimit,
	createPostgresIngestRateLimitEnvironment,
	INGEST_RATE_LIMIT_CONFIG,
	type IngestRateLimitEnvironment,
	readLiveSessionRateLimitConfig,
	resolveIngestRateLimitSubject,
	resolveLiveSessionRateLimitSubject,
} from "./services/ingest-rate-limit.service.js";
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
	appendLiveSession,
	LiveSessionOwnershipConflictError,
	readLiveSessionState,
} from "./services/live-session/live-session-append.service.js";
import {
	isLiveSessionsEnabled,
	isLiveSessionsWorkspaceEnabled,
	LIVE_SESSIONS_PAUSE_SECONDS,
} from "./services/live-session/live-session-config.js";
import {
	createLiveSessionGate,
	LiveSessionBusyError,
	LiveSessionStorageError,
} from "./services/live-session/live-session-gate.js";
import {
	assertStorableText,
	LiveSessionAppendValidationError,
	validateLiveSessionAppend,
} from "./services/live-session/live-session-lines.js";
import { getLiveSessionR2Client } from "./services/live-session/live-session-r2.js";
import {
	getCachedOrgSessionCount,
	hasOrgUploadsInLastDays,
} from "./services/org-session.service.js";
import {
	deleteOrganizationPostgresData,
	OrganizationDeletionForbiddenError,
} from "./services/organization-deletion.service.js";
import {
	commitR2IngestJob,
	R2IngestCommitError,
	type R2IngestProcessorResult,
} from "./services/r2-ingest-commit.service.js";
import { toR2IngestCommitOrpcError } from "./services/r2-ingest-http-error.js";
import {
	isRetryableProcessingError,
	R2_INGEST_DEPENDENCY_UNAVAILABLE,
} from "./services/r2-ingest-processing-error.js";
import {
	createR2MultipartUploadClient,
	type R2IngestConfiguration,
	readR2IngestAvailability,
} from "./services/r2-ingest-storage.service.js";
import { hasRawSessionRow } from "./services/raw-session.service.js";
import {
	commitRepositoryEvidence,
	initRepositoryEvidence,
	RepositoryEvidenceStateError,
} from "./services/repository-evidence.service.js";
import { buildRepositoryEvidenceIndexRow } from "./services/repository-evidence-index.service.js";
import { publishRepositoryEvidenceIndexAfterCommit } from "./services/repository-evidence-index-publication.service.js";
import {
	createPostgresRepositoryBindingLookup,
	RepositoryEvidenceRepositoryBindingError,
	resolveTrustedRepositoryIdentity,
} from "./services/repository-evidence-repository-binding.service.js";
import {
	persistSessionLanguageSignals,
	persistSessionLanguageSignalsBestEffort,
	persistSessionLanguageSignalsWithExecutor,
} from "./services/session-language-signal-persistence.service.js";
import { projectNativeSessionLineage } from "./services/session-native-lineage.service.js";
import {
	claimSessionIngestOwnership,
	recordSessionAgentMetadata,
	recordSessionIngestContent,
	reserveUsageExtractionGeneration,
	SessionAgentMetadataConflictError,
	UsageExtractionSupersededError,
} from "./services/session-ownership.service.js";
import {
	allocateSessionRevision,
	buildSessionRevisionDeduplicationToken,
	buildSessionRevisionOperationId,
} from "./services/session-revision.service.js";
import { readsEverySession } from "./services/session-visibility.js";
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
	isTranscriptRecordsCurrent,
	persistTranscriptRecordsBestEffort,
	readTranscriptRecordsExtractionConfig,
} from "./services/transcript-records-extraction.service.js";
import { indexUploadedSessionBestEffort } from "./services/transcript-search/ingest.js";
import { reportUploadFailures } from "./services/upload-failure.service.js";
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
import { getStripeBillingConfiguration } from "./stripe-client.js";

const logger = getLogger(["rudel", "api", "router"]);
const GITHUB_NOT_CONFIGURED_MESSAGE =
	"GitHub connection is not configured for this Opaline deployment.";
const GITHUB_CONFIGURATION_INVALID_MESSAGE =
	"GitHub connection is unavailable because its server configuration is invalid.";
let ingestRateLimitEnvironment =
	createPostgresIngestRateLimitEnvironment(sqlClient);

type GitHubSetupAvailability =
	| {
			readonly config: GitHubRepositoryAppConfig;
			readonly configurationError: null;
			readonly stateSecret: string;
	  }
	| {
			readonly config: null;
			readonly configurationError: string;
			readonly stateSecret: null;
	  };

function readGitHubSetupAvailability(): GitHubSetupAvailability {
	try {
		const config = readGitHubRepositoryAppConfig();
		const userAuthorizationConfig =
			readGitHubRepositoryAppUserAuthorizationConfig();
		if (!config || !userAuthorizationConfig) {
			return {
				config: null,
				configurationError: GITHUB_NOT_CONFIGURED_MESSAGE,
				stateSecret: null,
			};
		}
		return {
			config,
			configurationError: null,
			stateSecret: readGitHubInstallationStateSecret(),
		};
	} catch {
		return {
			config: null,
			configurationError: GITHUB_CONFIGURATION_INVALID_MESSAGE,
			stateSecret: null,
		};
	}
}

export function setIngestRateLimitEnvironmentForTests(
	environment: IngestRateLimitEnvironment,
): void {
	if (process.env.NODE_ENV !== "test") {
		throw new Error(
			"The ingest rate-limit environment can only change in tests",
		);
	}
	ingestRateLimitEnvironment = environment;
}

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

const cliUpdateStatus = os.cli.updateStatus
	.use(authMiddleware)
	.handler(({ context }) => getCliUpdateStatus(sqlClient, context.user.id));

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
			capabilities: {
				analysisLinkedUploads: true as const,
				transcriptSlimming: true as const,
				repositoryEvidenceImages: true as const,
				...(isLiveSessionsEnabled() ? { liveSessions: true as const } : {}),
			},
		};
	});

const cliSetupStatus = os.cli.setupStatus
	.use(ingestAuthMiddleware)
	.handler(async ({ context }) => {
		const [status] = await sqlClient<
			Array<{ has_cli_login: boolean; has_uploaded_sessions: boolean }>
		>`
			SELECT EXISTS (
				SELECT 1
				FROM apikey
				WHERE reference_id = ${context.user.id}
					AND name = 'rudel-cli-ingest'
					AND enabled = true
					AND (expires_at IS NULL OR expires_at > NOW())
			) AS has_cli_login,
            EXISTS (
                SELECT 1 FROM session_ownership
                WHERE user_id = ${context.user.id}
                  AND last_ingested_at IS NOT NULL
            ) AS has_uploaded_sessions
		`;

		return {
			hasCliLogin: status?.has_cli_login === true,
			hasUploadedSessions: status?.has_uploaded_sessions === true,
		};
	});

const sessionAccess = os.sessionAccess
	.use(orgMiddleware)
	.handler(({ context }) => ({
		readsEverySession: readsEverySession(context.sessionReader),
	}));

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
		message: "Choose an organization with --org or opaline set-org",
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

function rethrowAgentRunLimitAsForbidden(error: unknown): never {
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

export async function processIngestSession({
	aggregateContentMaxBytes,
	allowQuiescedIngest = false,
	analysisUploads,
	awaitBestEffortLanguageSignals = false,
	awaitLanguageSignals,
	context,
	durableProcessing,
	enforceRateLimits,
	errorFactories,
	extractSessionFacts = extractSessionFactsOffThread,
	input,
	signal,
}: {
	aggregateContentMaxBytes?: number;
	allowQuiescedIngest?: boolean;
	/** Where `input.analysisId` links are recorded; the configured log by default. */
	analysisUploads?: AnalysisUploadEnv;
	awaitBestEffortLanguageSignals?: boolean;
	awaitLanguageSignals: boolean;
	context: {
		apiKeyId: string | null;
		session: AppContext["session"];
		user: { id: string };
	};
	durableProcessing?: {
		failpoint: IngestProcessingFailpoint | undefined;
		operationId: string;
	};
	enforceRateLimits: boolean;
	errorFactories: IngestErrorFactories;
	extractSessionFacts?: typeof extractSessionFactsOffThread;
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
	const effectiveAggregateContentMaxBytes = clampIngestAggregateContentMaxBytes(
		aggregateContentMaxBytes,
	);
	const aggregateBytes = measureIngestAggregateSize(input);
	if (enforceRateLimits) {
		await checkIngestRateLimit(
			resolveIngestRateLimitSubject(context.user.id),
			aggregateBytes > effectiveAggregateContentMaxBytes ? 0 : aggregateBytes,
			INGEST_RATE_LIMIT_CONFIG,
			ingestRateLimitEnvironment,
		);
	}
	enforceMeasuredIngestAggregateSize(
		aggregateBytes,
		effectiveAggregateContentMaxBytes,
	);
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

	const orgId = await resolveIngestOrganizationId(
		input.organizationId ?? activeOrgId,
		context.user.id,
	);

	const ownership = await claimSessionIngestOwnership(
		orgId,
		input.sessionId,
		context.user.id,
	).catch(rethrowAgentRunLimitAsForbidden);
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
		await recordSessionAgentMetadata(orgId, input.sessionId, context.user.id, {
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
		await projectNativeSessionLineage({
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
		durableProcessing,
		extractSessionFacts,
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

/** An upload naming an analysis goes to that analysis's workspace. */
async function resolveUploadOrganizationId(
	analysisId: string | undefined,
	requestedOrganizationId: string | null,
	userId: string,
): Promise<string | null> {
	return analysisId
		? resolveAnalysisUploadWorkspace(
				analysisId,
				userId,
				createAnalysisUploadEnv(),
			)
		: requestedOrganizationId;
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
	durableProcessing,
	extractSessionFacts,
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
	extractSessionFacts: typeof extractSessionFactsOffThread;
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
						durableProcessing,
						extractSessionFacts,
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
					sourceContentSha256: hashSkillSourceContent(
						filteredInput.content,
						subagents,
					),
				},
			);
		const transcriptRecordsCurrent = await isTranscriptRecordsCurrent(
			getClickhouse(),
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
					assertWritable: () =>
						assertNoClickHousePurgeTombstone(
							{ organizationId: orgId, userId: context.user.id },
							{ database: sqlClient },
						),
					organizationId: orgId,
					sessionId: input.sessionId,
					signal,
					source: filteredInput.source,
					userId: context.user.id,
				};
				await persistGitObservationsBestEffort(getClickhouse(), derived);
				// Goes on where an earlier pass stopped (time, chunk cap or quota).
				await indexUploadedSessionBestEffort(getClickhouse(), derived);
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
	await recordUserCliVersion(sqlClient, context.user.id, input.cli_version);
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
	} else if (
		shouldStartBestEffortLanguageSignals({
			awaitLanguageSignals,
			durableProcessing: durableProcessing !== undefined,
		})
	) {
		void persistSessionLanguageSignalsBestEffort(languageSignalInput);
	}

	// Derived data must never endanger the upload or the required extraction
	// below: the job never rejects, runs in its own worker under its own limits,
	// and is only awaited (in `finally`) so the response sees its receipt.
	const transcriptRecordsJob = persistTranscriptRecordsBestEffort(
		getClickhouse(),
		{
			assertWritable: () =>
				assertNoClickHousePurgeTombstone(
					{
						organizationId: orgId,
						userId: context.user.id,
					},
					{ database: sqlClient },
				),
			config: transcriptRecordsConfig,
			content: filteredInput.content,
			organizationId: orgId,
			revision,
			sessionDate: timestamps.sessionDate,
			sessionId: input.sessionId,
			signal,
			source: filteredInput.source,
			subagents,
			userId: context.user.id,
		},
	);

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
					: await reserveUsageExtractionGeneration(
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
			const extraction = await extractSessionFacts({
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
					shouldPersistUsageExtractionFailureReceipt({
						durableProcessing: claimedLedger !== undefined,
						extractionAllowsReceipt: error.shouldPersistReceipt,
					})
				) {
					await writeUsageExtraction(clickhouse, {
						contentSha256: contentHash,
						extraction: error.extraction,
						filterVersion: SESSION_INGEST_FILTER_VERSION,
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
			filterVersion: SESSION_INGEST_FILTER_VERSION,
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

		try {
			await recordSessionIngestContent(
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
			await projectNativeSessionLineage({
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

		await captureApiProductAnalyticsEvent({
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
			await indexUploadedSessionBestEffort(getClickhouse(), {
				assertWritable: () =>
					assertNoClickHousePurgeTombstone(
						{ organizationId: orgId, userId: context.user.id },
						{ database: sqlClient },
					),
				organizationId: orgId,
				sessionId: input.sessionId,
				signal,
				source: filteredInput.source,
				userId: context.user.id,
			});
		if (
			shouldAwaitBestEffortLanguageSignals({
				awaitBestEffortLanguageSignals,
				awaitLanguageSignals,
				durableProcessing: durableProcessing !== undefined,
			})
		) {
			await persistSessionLanguageSignalsBestEffort(languageSignalInput);
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

const cliReportUploadFailures = os.cli.reportUploadFailures
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context }) => {
		const organizationId = await resolveIngestOrganizationId(
			input.organizationId,
			context.user.id,
		);
		await reportUploadFailures(organizationId, context.user.id, input.failures);
		return { success: true };
	});

const cliSessionUploadStatus = os.cli.sessionUploadStatus
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context }) => {
		const organizationId = await resolveIngestOrganizationId(
			input.organizationId ?? getActiveOrganizationId(context.session),
			context.user.id,
		);
		const uploadedSessionIds = await findUploadedSessionIds(
			organizationId,
			context.user.id,
			input.sessionIds,
		);

		return { organizationId, uploadedSessionIds };
	});

const ingestSessionHandler = os.ingestSession
	.use(ingestAuthMiddleware)
	.handler(async ({ input: requested, context, errors, signal }) => {
		const analysisOrganizationId = await resolveUploadOrganizationId(
			requested.analysisId,
			null,
			context.user.id,
		);
		const input = analysisOrganizationId
			? { ...requested, organizationId: analysisOrganizationId }
			: requested;
		const processed = await processIngestSession({
			// Sessions above the direct size upload only through R2.
			aggregateContentMaxBytes: INGEST_DIRECT_CONTENT_MAX_BYTES,
			allowQuiescedIngest: context.ingestOperatorAuthorized,
			awaitLanguageSignals: isVercelRuntime(),
			context: {
				apiKeyId: context.apiKeyId,
				session: context.session,
				user: context.user,
			},
			enforceRateLimits: true,
			errorFactories: createIngestErrorFactories(errors),
			input,
			signal,
		});
		return processed.result;
	});

const repositoryEvidenceInit = os.repositoryEvidence.init
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, errors }) => {
		if (!context.apiKeyId) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "An ingest API key is required",
			});
		}
		const pauseSeconds = readRepositoryEvidenceCapturePauseSeconds();
		if (pauseSeconds !== undefined)
			throw errors.EVIDENCE_CAPTURE_DISABLED({ data: { pauseSeconds } });
		const availability = readR2IngestAvailability();
		if (!availability.enabled) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { missingVariables: [...availability.missingVariables] },
				message: "Repository evidence storage is unavailable.",
			});
		}
		const organizationId = await resolveIngestOrganizationId(
			input.organizationId,
			context.user.id,
		);
		try {
			const r2 = createR2MultipartUploadClient(availability.configuration);
			const repository = await resolveTrustedRepositoryIdentity({
				lookup: createPostgresRepositoryBindingLookup(sqlClient),
				organizationId,
				repository: input.repository,
			});
			return await initRepositoryEvidence({
				database: sqlClient,
				input: { ...input, repository },
				now: () => new Date(),
				organizationId,
				r2,
				randomUUID: () => crypto.randomUUID(),
				userId: context.user.id,
			});
		} catch (error) {
			throw toRepositoryEvidenceOrpcError(error);
		}
	});

type LiveSessionAccess =
	| { readonly scope: "global" | "workspace"; readonly status: "disabled" }
	| {
			readonly organizationId: string;
			readonly r2: R2IngestConfiguration;
			readonly status: "ready";
	  };

/**
 * The gate both live session procedures pass: an ingest API key, the kill
 * switch and ingest quiescence, R2, the user's own live session budget (never
 * the ingest budget), workspace membership and the workspace list. Unlike
 * ingest it never claims session ownership or counts an agent run.
 */
async function resolveLiveSessionAccess(
	input: { readonly organizationId: string },
	context: {
		readonly apiKeyId: string | null;
		readonly ingestOperatorAuthorized: boolean;
		readonly user: { readonly id: string };
	},
	chargeBytes: number,
): Promise<LiveSessionAccess> {
	if (!context.apiKeyId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "An ingest API key is required",
		});
	}
	if (
		!isLiveSessionsEnabled() ||
		(readBooleanEnv("SESSION_INGEST_QUIESCED", false) &&
			!context.ingestOperatorAuthorized)
	) {
		return { scope: "global", status: "disabled" };
	}
	const availability = readR2IngestAvailability();
	if (!availability.enabled) return { scope: "global", status: "disabled" };
	await checkIngestRateLimit(
		resolveLiveSessionRateLimitSubject(context.user.id),
		chargeBytes,
		readLiveSessionRateLimitConfig(),
		ingestRateLimitEnvironment,
	);
	const organizationId = await resolveIngestOrganizationId(
		input.organizationId,
		context.user.id,
	);
	if (!isLiveSessionsWorkspaceEnabled(organizationId)) {
		return { scope: "workspace", status: "disabled" };
	}
	return {
		organizationId,
		r2: availability.configuration,
		status: "ready",
	};
}

// Live appends' transactions: below the live pool's 5 connections, so
// `state` and the ownership reads always find one, and failing fast (the
// CLI backs off on 503) instead of queueing without limit.
const liveSessionAppendGate = createLiveSessionGate({
	maxActive: 4,
	maxWaitMs: 5_000,
});

/** Validation errors are bad requests; busy pools and R2 failures retryable 503s. */
function toLiveSessionOrpcError(error: unknown): unknown {
	if (error instanceof LiveSessionAppendValidationError) {
		return new ORPCError("BAD_REQUEST", { message: error.message });
	}
	if (
		error instanceof LiveSessionBusyError ||
		error instanceof LiveSessionStorageError ||
		isPostgresLockTimeout(error)
	) {
		return new ORPCError("SERVICE_UNAVAILABLE", {
			data: { reason: "live_session_unavailable", retryAfterMs: 1_000 },
			message: "Live session updates are busy. Retry shortly.",
		});
	}
	return error;
}

function isPostgresLockTimeout(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "55P03"
	);
}

const liveSessionState = os.liveSession.state
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, errors }) => {
		try {
			assertStorableText(input);
		} catch (error) {
			throw toLiveSessionOrpcError(error);
		}
		const access = await resolveLiveSessionAccess(input, context, 0);
		if (access.status === "disabled") {
			throw errors[LIVE_SESSIONS_DISABLED_CODE]({
				data: {
					pauseSeconds: LIVE_SESSIONS_PAUSE_SECONDS,
					scope: access.scope,
				},
			});
		}
		try {
			return await readLiveSessionState(
				{
					organizationId: access.organizationId,
					sessionId: input.sessionId,
					source: input.source,
					userId: context.user.id,
				},
				{ database: liveSessionSqlClient },
			);
		} catch (error) {
			if (error instanceof LiveSessionOwnershipConflictError) {
				throw errors[SESSION_OWNERSHIP_CONFLICT_CODE]();
			}
			throw toLiveSessionOrpcError(error);
		}
	});

const liveSessionAppend = os.liveSession.append
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, errors, signal }) => {
		let chargeBytes: number;
		try {
			chargeBytes = validateLiveSessionAppend(input).chargeBytes;
		} catch (error) {
			throw toLiveSessionOrpcError(error);
		}
		const access = await resolveLiveSessionAccess(input, context, chargeBytes);
		if (access.status === "disabled") {
			throw errors[LIVE_SESSIONS_DISABLED_CODE]({
				data: {
					pauseSeconds: LIVE_SESSIONS_PAUSE_SECONDS,
					scope: access.scope,
				},
			});
		}
		try {
			return await appendLiveSession(
				{
					organizationId: access.organizationId,
					sessionId: input.sessionId,
					source: input.source,
					userId: context.user.id,
				},
				input,
				{
					database: liveSessionSqlClient,
					gate: liveSessionAppendGate,
					now: () => new Date(),
					r2: getLiveSessionR2Client(access.r2),
					signal,
				},
			);
		} catch (error) {
			if (error instanceof LiveSessionOwnershipConflictError) {
				throw errors[SESSION_OWNERSHIP_CONFLICT_CODE]();
			}
			throw toLiveSessionOrpcError(error);
		}
	});

const githubRepositoryEvidenceStatus = os.githubRepositoryEvidence.status
	.use(orgMiddleware)
	.handler(({ context }) =>
		resolveGitHubRepositoryEvidenceStatus({
			uiEnabled:
				isGitHubEvidenceUiEnabled() ||
				readGitHubEvidenceUiForceOrgIds().includes(context.organizationId),
			isOrgAdmin: context.isOrgAdmin,
			readSetup: () => {
				const availability = readGitHubSetupAvailability();
				return availability.config
					? { configured: true }
					: {
							configured: false,
							configurationError: availability.configurationError,
						};
			},
			loadConnection: () =>
				getGitHubRepositoryConnectionStatus({
					database: sqlClient,
					organizationId: context.organizationId,
				}),
			loadDashboard: async () =>
				(await readGitHubOutcomesReadiness(sqlClient, context.organizationId))
					?.firstReadyAt
					? "visible"
					: "syncing",
		}),
	);

const githubRepositoryEvidenceCreateInstallation =
	os.githubRepositoryEvidence.createInstallation
		.use(orgMiddleware)
		.handler(async ({ context, input }) => {
			if (!context.isOrgAdmin) {
				throw new ORPCError("FORBIDDEN", {
					message: "Workspace administrator access is required.",
				});
			}
			const availability = readGitHubSetupAvailability();
			if (!availability.config) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: availability.configurationError,
				});
			}
			const organizations = await sqlClient.unsafe<Array<{ slug: string }>>(
				"SELECT slug FROM organization WHERE id = $1 LIMIT 1",
				[context.organizationId],
			);
			const organization = organizations[0];
			if (!organization) throw new ORPCError("NOT_FOUND");
			return {
				url: createGitHubInstallationUrl({
					returnTo: input?.returnTo,
					config: availability.config,
					organizationId: context.organizationId,
					stateSecret: availability.stateSecret,
					userId: context.user.id,
					workspaceSlug: organization.slug,
				}),
			};
		});

const githubRepositoryEvidenceDisconnect =
	os.githubRepositoryEvidence.disconnect
		.use(orgMiddleware)
		.handler(async ({ context, errors, input }) => {
			if (!context.isOrgAdmin) {
				throw new ORPCError("FORBIDDEN", {
					message: "Workspace administrator access is required.",
				});
			}
			if (input.organizationId !== context.organizationId)
				throw errors.WORKSPACE_CHANGED();
			const result = await disconnectGitHubRepositoryInstallation({
				database: sqlClient,
				organizationId: context.organizationId,
				readConfig: readGitHubRepositoryAppConfig,
			});
			if (result === "github-failed") throw errors.GITHUB_UNINSTALL_FAILED();
			return { disconnected: result === "disconnected" };
		});

const githubRepositoryEvidenceSyncCommit =
	os.githubRepositoryEvidence.syncCommit
		.use(orgMiddleware)
		.handler(async ({ context, input, signal }) => {
			const config = readGitHubRepositoryAppConfig();
			if (!config) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: "GitHub repository evidence is not configured.",
				});
			}
			const availability = readR2IngestAvailability();
			if (!availability.enabled) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: "Repository evidence storage is unavailable.",
				});
			}
			try {
				return await collectAndPersistGitHubCommitEvidence({
					commitSha: input.commitSha,
					config,
					contextId: input.contextId,
					refresh: input.refresh,
					database: sqlClient,
					initiatedByUserId: context.user.id,
					organizationId: context.organizationId,
					repositoryId: input.repositoryId,
					r2: createR2MultipartUploadClient(availability.configuration),
					sessionId: input.sessionId,
					signal,
				});
			} catch (error) {
				if (
					error instanceof Error &&
					error.message === "GitHub repository binding was not found."
				) {
					throw new ORPCError("NOT_FOUND", { message: error.message });
				}
				if (
					error instanceof Error &&
					error.message === "GitHub evidence collection is already in progress."
				) {
					throw new ORPCError("CONFLICT", { message: error.message });
				}
				if (error instanceof GitHubEvidenceCapacityError) {
					throw new ORPCError("TOO_MANY_REQUESTS", { message: error.message });
				}
				throw error;
			}
		});

const repositoryEvidenceCommit = os.repositoryEvidence.commit
	.use(ingestAuthMiddleware)
	.handler(async ({ input, context, signal, errors }) => {
		if (!context.apiKeyId) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "An ingest API key is required",
			});
		}
		const pauseSeconds = readRepositoryEvidenceCapturePauseSeconds();
		if (pauseSeconds !== undefined)
			throw errors.EVIDENCE_CAPTURE_DISABLED({ data: { pauseSeconds } });
		const availability = readR2IngestAvailability();
		if (!availability.enabled) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { missingVariables: [...availability.missingVariables] },
				message: "Repository evidence storage is unavailable.",
			});
		}
		const organizationId = await resolveIngestOrganizationId(
			input.organizationId,
			context.user.id,
		);
		try {
			const r2 = createR2MultipartUploadClient(availability.configuration);
			const indexedAt = new Date();
			const committed = await commitRepositoryEvidence({
				database: sqlClient,
				input,
				now: () => new Date(),
				organizationId,
				prepareIndex: (evidence) =>
					buildRepositoryEvidenceIndexRow(
						evidence.input,
						evidence.manifest,
						indexedAt,
						context.user.id,
					),
				r2,
				randomUUID: () => crypto.randomUUID(),
				signal,
				userId: context.user.id,
			});
			// Final fence before the external ClickHouse publication; the purge
			// job's second pass removes anything that slips past this check.
			await assertNoClickHousePurgeTombstone(
				{ organizationId, userId: context.user.id },
				{ database: sqlClient },
			);
			await publishRepositoryEvidenceIndexAfterCommit({
				clickhouse: getClickhouse(),
				database: sqlClient,
				organizationId,
				contextId: committed.output.contextId,
			});
			const provider = committed.evidence.input.repository.provider;
			const commitSha = committed.evidence.input.capture.headGitCommit;
			const githubConfig = readGitHubRepositoryAppConfig();
			if (
				provider?.provider === "github" &&
				commitSha &&
				githubConfig &&
				(committed.evidence.input.capture.timing.lifecycle === "checkpoint" ||
					committed.evidence.input.capture.timing.lifecycle === "end")
			) {
				try {
					// Durably enqueue and acknowledge; the bounded worker performs the
					// provider calls so GitHub latency never delays the CLI.
					signal?.throwIfAborted();
					const enqueued = await enqueueGitHubEvidenceCollection({
						commitSha,
						contextId: committed.evidence.input.capture.contextId,
						database: sqlClient,
						initiatedByUserId: context.user.id,
						organizationId,
						repositoryId: provider.repositoryId,
						sessionId: committed.evidence.input.session.sessionId,
						sessionSource: committed.evidence.input.session.source,
						sessionUserId: context.user.id,
					});
					if (enqueued.status === "queued") wakeGitHubEvidenceWorker();
				} catch (error) {
					logger.error(
						"GitHub evidence collection could not be queued after repository evidence commit (organization_id={organizationId} repository_id={repositoryId} commit_sha={commitSha} error={error})",
						{
							commitSha,
							error: String(error),
							organizationId,
							repositoryId: provider.repositoryId,
						},
					);
				}
			}
			return committed.output;
		} catch (error) {
			throw toRepositoryEvidenceOrpcError(error);
		}
	});

function toRepositoryEvidenceOrpcError(error: unknown): Error {
	if (error instanceof RepositoryEvidenceRepositoryBindingError) {
		return new ORPCError("BAD_REQUEST", { message: error.message });
	}
	if (error instanceof ClickHouseWriteFencedError) {
		return new ORPCError("CONFLICT", { message: error.message });
	}
	if (error instanceof FreeWorkspaceMonthlyAgentRunLimitExceededError) {
		return new ORPCError("FORBIDDEN", { message: error.message });
	}
	if (!(error instanceof RepositoryEvidenceStateError)) {
		return error instanceof Error ? error : new Error(String(error));
	}
	switch (error.code) {
		case "EVIDENCE_NOT_FOUND":
			return new ORPCError("NOT_FOUND", { message: error.message });
		case "EVIDENCE_EXPIRED":
		case "EVIDENCE_OBJECT_MISMATCH":
		case "EVIDENCE_ORGANIZATION_MISMATCH":
		case "EVIDENCE_SESSION_CONFLICT":
		case "EVIDENCE_UPLOAD_CONFLICT":
			return new ORPCError("CONFLICT", { message: error.message });
	}
}

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

		const aggregateBytes = input.objects.reduce(
			(total, object) => total + object.byteLength,
			0,
		);
		await checkIngestRateLimit(
			resolveIngestRateLimitSubject(context.user.id),
			aggregateBytes,
			INGEST_RATE_LIMIT_CONFIG,
			ingestRateLimitEnvironment,
		);
		if (input.upload_mode === "manual" || input.upload_mode === "retry") {
			checkManualIngestRateLimit(context.user.id, input.sessionId);
		} else {
			checkHookIngestRateLimit(context.user.id, input.sessionId);
		}

		const activeOrganizationId = getActiveOrganizationId(context.session);
		const organizationId = await resolveIngestOrganizationId(
			await resolveUploadOrganizationId(
				input.analysisId,
				input.organizationId ?? activeOrganizationId,
				context.user.id,
			),
			context.user.id,
		);
		await assertCanStartOrganizationAgentRun(
			organizationId,
			input.sessionId,
		).catch(rethrowAgentRunLimitAsForbidden);

		try {
			return await initR2IngestJob({
				database: sqlClient,
				input: input.analysisId ? { ...input, organizationId } : input,
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
		const sessionIngestQuiesced = readBooleanEnv(
			"SESSION_INGEST_QUIESCED",
			false,
		);
		if (sessionIngestQuiesced && !context.ingestOperatorAuthorized) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "session_ingest_quiesced" },
				message:
					"Session uploads are temporarily paused for an analytics rebuild. Retry shortly.",
			});
		}
		const availability = readR2IngestAvailability();
		if (!availability.enabled) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "r2_ingest_disabled" },
				message: "Direct-to-R2 ingest is not configured on this API host.",
			});
		}

		// Init reserves both quotas. Commit retries reuse that durable job and must
		// not charge the same upload again.
		try {
			return await commitR2IngestJob({
				input,
				process: (sessionInput, identity, processingSignal) =>
					processIngestSession({
						allowQuiescedIngest: context.ingestOperatorAuthorized,
						awaitBestEffortLanguageSignals: isVercelRuntime(),
						// Signals are derived and durably repairable. Vercel awaits their
						// best-effort scan after the required facts; Fly leaves them to its
						// resident reconciler. Scanner failure never fails this upload.
						awaitLanguageSignals: false,
						context: {
							apiKeyId: context.apiKeyId,
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
				sessionIngestQuiesced,
				signal,
				userId: context.user.id,
			});
		} catch (error) {
			if (isRetryableProcessingError(error)) {
				const status = await getR2IngestJobStatus(input.jobId, context.user.id);
				if (
					status?.status === "pending" &&
					status.error?.code === R2_INGEST_DEPENDENCY_UNAVAILABLE
				) {
					throw toR2IngestCommitOrpcError(
						new R2IngestCommitError(
							"R2_INGEST_JOB_RETRY_LATER",
							"Ingest job is waiting for dependency recovery and will be retried",
							true,
						),
					);
				}
			}
			if (error instanceof ORPCError) throw error;
			if (error instanceof R2IngestCommitError) {
				throw toR2IngestCommitOrpcError(error);
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

			await deleteOrganizationPostgresData({
				organizationId: orgId,
				userId,
			});

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
			if (error instanceof OrganizationDeletionForbiddenError) {
				logger.info(
					"Rejected organization deletion because the user is not its owner (user_id={userId} organization_id={organizationId})",
					{ organizationId: orgId, userId },
				);
				throw new ORPCError("FORBIDDEN", { message: error.message });
			}
			if (error instanceof ORPCError) throw error;
			logger.error(
				"Organization deletion failed (user_id={userId} organization_id={organizationId} error={error})",
				{ error: String(error), organizationId: orgId, userId },
			);
			throw error;
		}
	});

const getBillingConfiguration = os.billing.configuration
	.use(authMiddleware)
	.handler(() => getStripeBillingConfiguration());

const getCurrentBillingSummary = os.billing.current
	.use(authMiddleware)
	.handler(async ({ context }) => {
		const activeOrganizationId = getActiveOrganizationId(context.session);
		const [membership] = await sqlClient<Array<{ organization_id: string }>>`
			SELECT organization_id
			FROM member
			WHERE user_id = ${context.user.id}
			ORDER BY (organization_id = ${activeOrganizationId ?? ""}) DESC,
				created_at ASC, organization_id ASC
			LIMIT 1
		`;
		return membership
			? readOrganizationBillingSummary(membership.organization_id)
			: { hasBillingAccount: false as const };
	});

const getBillingPricingState = os.billing.pricing
	.use(authMiddleware)
	.handler(async ({ input, context }) => {
		const pricingState = await readBillingPricingState({
			preferredOrganizationId: getActiveOrganizationId(context.session),
			userId: context.user.id,
			workspaceSlug: input.workspaceSlug,
		});
		if (input.workspaceSlug && !pricingState.hasWorkspace) {
			throw new ORPCError("FORBIDDEN", {
				message: "The requested workspace is not available to this user",
			});
		}
		return pricingState;
	});

const getBillingSummary = os.billing.summary
	.use(authMiddleware)
	.handler(async ({ input, context }) => {
		await requireOwnedBillingOrganization(
			input.organizationId,
			context.user.id,
		);
		return readOrganizationBillingSummary(input.organizationId);
	});

const createBillingCheckout = os.billing.createCheckout
	.use(authMiddleware)
	.use(settingsMutationMiddleware)
	.handler(async ({ input, context }) => {
		const organization = await requireOwnedBillingOrganization(
			input.organizationId,
			context.user.id,
		);

		const workspaceSettingsUrl = new URL(
			`/${encodeURIComponent(organization.slug)}/settings/workspace`,
			getFrontendOrigin(),
		);

		return createOrganizationCheckoutSession({
			billingPeriod: input.billingPeriod,
			cancelUrl: workspaceSettingsUrl.toString(),
			organizationId: input.organizationId,
			plan: input.plan,
			successUrl: workspaceSettingsUrl.toString(),
			userEmail: context.user.email,
			userId: context.user.id,
		});
	});

const createBillingPortal = os.billing.createPortal
	.use(authMiddleware)
	.use(settingsMutationMiddleware)
	.handler(async ({ input, context }) => {
		const organization = await requireOwnedBillingOrganization(
			input.organizationId,
			context.user.id,
		);
		const returnUrl = new URL(
			`/${encodeURIComponent(organization.slug)}/settings/workspace`,
			getFrontendOrigin(),
		);
		return createOrganizationBillingPortalSession({
			organizationId: input.organizationId,
			returnUrl: returnUrl.toString(),
		});
	});

const selectBillingPlan = os.billing.selectPlan
	.use(authMiddleware)
	.use(settingsMutationMiddleware)
	.handler(async ({ input, context }) => {
		const organization = await requireOwnedBillingOrganization(
			input.organizationId,
			context.user.id,
		);
		const workspaceSettingsUrl = new URL(
			`/${encodeURIComponent(organization.slug)}/settings/workspace`,
			getFrontendOrigin(),
		);
		return createOrganizationPlanSelectionSession({
			billingPeriod: input.billingPeriod,
			cancelUrl: workspaceSettingsUrl.toString(),
			organizationId: input.organizationId,
			plan: input.plan,
			successUrl: workspaceSettingsUrl.toString(),
			userEmail: context.user.email,
			userId: context.user.id,
		});
	});

const requestBillingUpgrade = os.billing.requestUpgrade
	.use(authMiddleware)
	.use(settingsMutationMiddleware)
	.handler(async ({ input, context }) => {
		try {
			await requestOrganizationBillingUpgrade(
				{
					billingPeriod: input.billingPeriod,
					organizationId: input.organizationId,
					plan: input.plan,
					requesterUserId: context.user.id,
				},
				{
					frontendOrigin: getFrontendOrigin(),
					resend: readResendConfig(),
				},
			);
			return { notified: true as const };
		} catch (error) {
			if (error instanceof BillingUpgradeRequestForbiddenError) {
				throw new ORPCError("FORBIDDEN", { message: error.message });
			}
			if (error instanceof BillingUpgradeRequestOwnerError) {
				throw new ORPCError("CONFLICT", { message: error.message });
			}
			throw error;
		}
	});

async function requireOwnedBillingOrganization(
	organizationId: string,
	userId: string,
): Promise<{ slug: string }> {
	const [organization] = await sqlClient<Array<{ role: string; slug: string }>>`
		SELECT m.role, o.slug
		FROM member m
		INNER JOIN organization o ON o.id = m.organization_id
		WHERE m.organization_id = ${organizationId}
			AND m.user_id = ${userId}
		LIMIT 1
	`;
	if (!organization || organization.role !== "owner") {
		throw new ORPCError("FORBIDDEN", {
			message: "Only the organization owner can manage billing",
		});
	}
	return { slug: organization.slug };
}

export const router: Router<typeof contract, AppContext> = os.router({
	billing: {
		configuration: getBillingConfiguration,
		current: getCurrentBillingSummary,
		pricing: getBillingPricingState,
		summary: getBillingSummary,
		createCheckout: createBillingCheckout,
		createPortal: createBillingPortal,
		selectPlan: selectBillingPlan,
		requestUpgrade: requestBillingUpgrade,
	},
	githubRepositoryEvidence: {
		disconnect: githubRepositoryEvidenceDisconnect,
		createInstallation: githubRepositoryEvidenceCreateInstallation,
		status: githubRepositoryEvidenceStatus,
		syncCommit: githubRepositoryEvidenceSyncCommit,
	},
	repositorySettings: repositorySettingsRouter,
	usageDigest: usageDigestRouter,
	repositoryEvidence: {
		commit: repositoryEvidenceCommit,
		init: repositoryEvidenceInit,
	},
	liveSession: {
		append: liveSessionAppend,
		state: liveSessionState,
	},
	health,
	me,
	profile: profileRouter,
	cli: {
		authStatus: cliAuthStatus,
		revokeToken: revokeCliToken,
		setupStatus: cliSetupStatus,
		updateStatus: cliUpdateStatus,
		sessionUploadStatus: cliSessionUploadStatus,
		reportUploadFailures: cliReportUploadFailures,
	},
	listMyOrganizations,
	sessionAccess,
	ingestSession: ingestSessionHandler,
	ingest: {
		commit: r2IngestCommit,
		init: r2IngestInit,
		status: r2IngestStatus,
	},
	getOrganizationSessionCount,
	deleteOrganization,
	teamInviteLink: teamInviteLinkRouter,
	admin: adminRouter,
	productAnalytics: productAnalyticsRouter,
	analytics: analyticsRouter,
	analysis: analysisRouter,
});
