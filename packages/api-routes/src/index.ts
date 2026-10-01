export * from "./billing.js";
export {
	CI_EVENT_LABELS,
	CI_RUN_CONCLUSIONS,
	CiConclusionSchema,
	GITHUB_INACTIVE_FILTER_TOOLTIP,
	GITHUB_RETENTION_TOOLTIP,
	PULL_REQUEST_CI,
	PullRequestCiSchema,
} from "./schemas/github-outcomes.js";
export {
	SESSION_ARRIVALS_PATH,
	type SessionArrival,
	SessionArrivalsInputSchema,
	SessionArrivalsPageSchema,
} from "./session-arrivals.js";

import {
	BillingConfigurationOutputSchema,
	BillingPricingStateInputSchema,
	BillingPricingStateOutputSchema,
	CreateOrganizationBillingPortalOutputSchema,
	CreateOrganizationCheckoutInputSchema,
	CreateOrganizationCheckoutOutputSchema,
	OrganizationBillingInputSchema,
	OrganizationBillingSummaryOutputSchema,
	RequestOrganizationBillingUpgradeOutputSchema,
	SelectOrganizationPlanOutputSchema,
} from "./billing.js";
import { CliUpdateStatusSchema } from "./cli-version.js";
import { repositorySettingsContract } from "./repository-settings.js";
import {
	ReportUploadFailuresInputSchema,
	UploadFailuresPageSchema,
} from "./upload-failure.js";

export { CliConnectionIdSchema } from "./cli-connection.js";
export {
	type RepositorySettings,
	RepositorySettingsSchema,
	type RepositoryUploadReport,
	RepositoryUploadReportSchema,
	RepositoryUploadSettingsSchema,
} from "./repository-settings.js";
export {
	type StoredUploadFailure,
	type UploadFailure,
	UploadFailureSchema,
	UploadFailuresPageSchema,
} from "./upload-failure.js";

import {
	RepositoryDetailSchema,
	RepositoryInputSchema,
	RepositorySummarySchema,
} from "./schemas/repositories.js";

export type { RepositorySummary } from "./schemas/repositories.js";

import { oc } from "@orpc/contract";
import { z } from "zod";

import {
	AdminCostDashboardInputSchema,
	CostDashboardInputSchema,
	CostDashboardSchema,
} from "./schemas/cost-dashboard.js";

export {
	AGENT_RUN_DURATIONS,
	AGENT_RUN_SIGNALS,
	type AgentRunDuration,
	AgentRunDurationSchema,
	type AgentRunSignal,
	AgentRunSignalSchema,
	getAgentRunDuration,
} from "./schemas/agent-runs.js";

export {
	type AdminCostDashboardInput,
	AdminCostDashboardInputSchema,
	type CostBreakdownEntry,
	type CostDashboard,
	type CostDashboardInput,
	CostDashboardInputSchema,
	type CostDashboardRequestedMetric,
	CostDashboardRequestedMetricSchema,
	CostDashboardSchema,
	type CostDimension,
	type DashboardMetric,
	type DashboardMetricData,
	type DashboardSignal,
} from "./schemas/cost-dashboard.js";

import {
	GitHubCreateInstallationOutputSchema,
	GitHubRepositoryEvidenceStatusSchema,
	GitHubSyncCommitInputSchema,
	GitHubSyncCommitOutputSchema,
} from "./github-repository-evidence.js";
import {
	DashboardDrilldownOpenedCaptureInputSchema,
	DashboardFilterChangedCaptureInputSchema,
	DashboardViewedCaptureInputSchema,
	ProductAnalyticsClientSurfaceSchema,
	ProductAnalyticsPlatformOsSchema,
	ProductAnalyticsUploadModeSchema,
} from "./product-analytics.js";
import {
	RepositoryEvidenceCommitInputSchema,
	RepositoryEvidenceCommitOutputSchema,
	RepositoryEvidenceErrors,
	RepositoryEvidenceInitInputSchema,
	RepositoryEvidenceInitOutputSchema,
} from "./repository-evidence.js";
import {
	DateRangeInputSchema,
	DaysInputSchema,
	DeveloperCostBreakdownSchema,
	DeveloperDetailsInputSchema,
	DeveloperDetailsSchema,
	DeveloperErrorSchema,
	DeveloperFeatureUsageSchema,
	DeveloperProjectSchema,
	DeveloperSessionSchema,
	DeveloperSessionsInputSchema,
	DeveloperSummarySchema,
	DeveloperTeamCardSchema,
	DeveloperTimelineSchema,
	DeveloperTrendDataPointSchema,
	DimensionAnalysisDataPointSchema,
	DimensionAnalysisInputSchema,
	ErrorsDashboardSchema,
	ErrorTrendDataPointSchema,
	ErrorTrendsInputSchema,
	HistoricalSkillDetailInputSchema,
	HistoricalSkillDetailSchema,
	HistoricalSkillSummarySchema,
	InsightSchema,
	LearningEntrySchema,
	LearningsFeedStatsSchema,
	LearningsListInputSchema,
	LearningsTrendDataPointSchema,
	LearningsTrendInputSchema,
	ModelTokensTrendDataSchema,
	OverviewKPIsSchema,
	ProjectContributorSchema,
	ProjectCostBreakdownSchema,
	ProjectDetailDataSchema,
	ProjectDetailsInputSchema,
	ProjectErrorSchema,
	ProjectFeatureUsageSchema,
	ProjectInvestmentSchema,
	ProjectTrendDataPointSchema,
	RecurringErrorSchema,
	RecurringErrorsInputSchema,
	RepositoryDailyTrendDataSchema,
	ROIDashboardSchema,
	ROIMetricsSchema,
	ROITrendSchema,
	SessionAnalyticsSummaryComparisonSchema,
	SessionAnalyticsSummarySchema,
	SessionFilterCatalogSchema,
	SessionListInputSchema,
	SessionOverviewAnalyticsSchema,
	SuccessRateSchema,
	TeamSummaryComparisonSchema,
	UsageTrendDataSchema,
	UserDailyTrendDataSchema,
	UserTokenUsageDataSchema,
} from "./schemas/analytics.js";
import { sessionDetailProcedureContracts } from "./session-detail-contract.js";

export * from "./avatar.js";
export * from "./cli-version.js";
export * from "./device-flow.js";
export * from "./github-repository-evidence.js";
export * from "./model-pricing.js";
export * from "./model-rate-card.js";
export * from "./product-analytics.js";
export { type RepoIdentity, resolveRepoIdentity } from "./repo-identity.js";
export {
	createRepositoryEvidenceInitInputSchema,
	REPOSITORY_EVIDENCE_MAX_AGGREGATE_BYTES,
	REPOSITORY_EVIDENCE_MAX_OBJECT_BYTES,
	REPOSITORY_EVIDENCE_MAX_OBJECTS,
	REPOSITORY_EVIDENCE_PART_SIZE_BYTES,
	REPOSITORY_EVIDENCE_PROTOCOL,
	type RepositoryEvidenceCapture,
	RepositoryEvidenceCaptureSchema,
	RepositoryEvidenceCaptureTimingSchema,
	type RepositoryEvidenceCommitInput,
	RepositoryEvidenceCommitInputSchema,
	type RepositoryEvidenceCommitOutput,
	RepositoryEvidenceCommitOutputSchema,
	RepositoryEvidenceCompletedObjectSchema,
	RepositoryEvidenceCompletedPartSchema,
	type RepositoryEvidenceCoverageArea,
	RepositoryEvidenceCoverageAreaSchema,
	RepositoryEvidenceCoverageItemSchema,
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceInitOutput,
	RepositoryEvidenceInitOutputSchema,
	type RepositoryEvidenceLocalIdentity,
	RepositoryEvidenceLocalIdentitySchema,
	type RepositoryEvidenceObjectDescriptor,
	RepositoryEvidenceObjectDescriptorSchema,
	RepositoryEvidenceObjectIdSchema,
	RepositoryEvidenceObjectKindSchema,
	type RepositoryEvidenceProviderIdentity,
	RepositoryEvidenceProviderIdentitySchema,
	type RepositoryEvidenceRemoteHint,
	RepositoryEvidenceRemoteHintSchema,
	type RepositoryEvidenceRepositoryIdentity,
	RepositoryEvidenceRepositoryIdentitySchema,
	type RepositoryEvidenceSessionIdentity,
	RepositoryEvidenceSessionIdentitySchema,
	RepositoryEvidenceTranscriptWatermarkSchema,
	type RepositoryEvidenceUploadObject,
	RepositoryEvidenceUploadObjectSchema,
	RepositoryEvidenceUploadPartSchema,
} from "./repository-evidence.js";
export * from "./safe-url.js";
export * from "./schemas/analytics.js";
export {
	SESSION_DETAIL_ACTIVITY_DETAIL_CODE_POINT_LIMIT,
	SESSION_DETAIL_ACTIVITY_POINT_LIMIT,
	SESSION_DETAIL_ANCHOR_NOT_FOUND_CODE,
	SESSION_DETAIL_ANCHOR_NOT_FOUND_MESSAGE,
	SESSION_DETAIL_BODY_CHUNK_CODE_UNITS,
	SESSION_DETAIL_BODY_MAX_RAW_BYTES,
	SESSION_DETAIL_CONTEXT_ERROR_LIMIT,
	SESSION_DETAIL_CONTEXT_FILE_LIMIT,
	SESSION_DETAIL_PREVIEW_CODE_POINT_LIMIT,
	SESSION_DETAIL_REVISION_ERRORS,
	SESSION_DETAIL_SIGNAL_OCCURRENCE_LIMIT,
	SESSION_DETAIL_STALE_REVISION_CODE,
	SESSION_DETAIL_STALE_REVISION_MESSAGE,
	SESSION_DETAIL_TURN_PAGE_LIMIT,
	SESSION_DETAIL_WINDOW_ERRORS,
	SESSION_DETAIL_WINDOW_INITIAL_TURNS,
	SESSION_DETAIL_WINDOW_MAX_RAW_BYTES,
	SESSION_DETAIL_WINDOW_MAX_TURN_BYTES,
	SESSION_DETAIL_WINDOW_PAGE_TURNS,
	type SessionDetailAnchorNotFoundData,
	SessionDetailAnchorNotFoundDataSchema,
	type SessionDetailBodyChunk,
	type SessionDetailBodyChunkInput,
	SessionDetailBodyChunkInputSchema,
	SessionDetailBodyChunkSchema,
	type SessionDetailInitial,
	SessionDetailInitialSchema,
	type SessionDetailOverview,
	type SessionDetailOverviewInput,
	SessionDetailOverviewInputSchema,
	SessionDetailOverviewSchema,
	SessionDetailRevisionSchema,
	type SessionDetailSpine,
	type SessionDetailSpineInput,
	SessionDetailSpineInputSchema,
	SessionDetailSpineSchema,
	type SessionDetailSpineTurn,
	SessionDetailSpineTurnSchema,
	type SessionDetailStaleRevisionData,
	SessionDetailStaleRevisionDataSchema,
	type SessionDetailSubagent,
	type SessionDetailSubagentInput,
	SessionDetailSubagentInputSchema,
	SessionDetailSubagentSchema,
	type SessionDetailTraceItem,
	SessionDetailTraceItemSchema,
	type SessionDetailTurn,
	type SessionDetailTurnBody,
	SessionDetailTurnBodySchema,
	SessionDetailTurnIdSchema,
	type SessionDetailTurnInput,
	SessionDetailTurnInputSchema,
	SessionDetailTurnSchema,
	type SessionDetailTurnSummary,
	SessionDetailTurnSummarySchema,
	type SessionDetailWindow,
	SessionDetailWindowCursorSchema,
	type SessionDetailWindowRequest,
	SessionDetailWindowRequestSchema,
	SessionDetailWindowSchema,
	type SessionDetailWindowTurn,
	SessionDetailWindowTurnSchema,
} from "./schemas/session-detail-payload.js";
export { sessionDetailProcedureContracts } from "./session-detail-contract.js";
export * from "./session-lineage/index.js";
export {
	calculateSessionRequestCost,
	type SessionRequestCostEntry,
	type SessionRequestUsageEvent,
	type SessionRequestUsageSummary,
	summarizeSessionRequestUsage,
	sumSessionRequestCosts,
} from "./session-request-pricing.js";
export {
	type AssistantEntry,
	AssistantEntrySchema,
	AssistantMessageSchema,
	addUniqueEditedFiles,
	assignCompactionsBeforeTurns,
	attachCodexCorrelation,
	attachCodexOperationMetadata,
	buildCodexActivityGraph,
	buildConversationTrace,
	type CodexActivity,
	type CodexActivityGraph,
	type CodexCarrier,
	type CodexCorrelationConfidence,
	type CodexLifecycleRecord,
	type CodexNormalizedOperation,
	type CodexOperationMetadata,
	type CodexOrphanOutput,
	type CodexOutputBlock,
	type CodexPatchFile,
	type CodexPatchOperation,
	type CodexPlanStep,
	type CodexToolTranslation,
	type Conversation,
	type ConversationExecutionMode,
	ConversationExecutionModeSchema,
	ConversationSchema,
	classifySimpleShellCommand,
	compactPreview,
	type ExtractedCodexInvocation,
	extractCodexTokenData,
	extractCustomExecInvocation,
	extractCustomExecInvocations,
	extractSessionCompactionMetadata,
	extractSessionTurnMetricBreakdown,
	extractSessionTurnMetrics,
	extractTranscriptUsageMetrics,
	formatClockTime,
	formatTimeDelta,
	getClaudeMutationFiles,
	getCodexOperationMetadata,
	getCodexRawOperationInput,
	getRawToolInput,
	getSessionTurnId,
	getSessionTurnMemberCharacterCount,
	getSessionTurnMemberPreview,
	getSessionTurnMemberText,
	getSessionTurnPreview,
	getSessionTurnTiming,
	getTranscriptToolFileActivities,
	groupTraceIntoTurns,
	isCodexFormat,
	isCodexOperationInput,
	isCodexToolFailure,
	isCodexToolInput,
	isRasterImagePath,
	isSlashCommandMessage,
	type ParsedSlashCommand,
	parseCodexConversations,
	parseCodexPatch,
	parseConversations,
	parseSlashCommand,
	type SessionCompaction,
	type SessionCompactionMetadata,
	type SessionTurn,
	type SessionTurnErrorEvent,
	type SessionTurnMetrics,
	type SessionTurnSkillEvent,
	type SummaryEntry,
	SummaryEntrySchema,
	type SystemEntry,
	SystemEntrySchema,
	stripCodexInjectedBlocks,
	type TextContent,
	TextContentSchema,
	type ThinkingContent,
	ThinkingContentSchema,
	type TokenUsageEvent,
	type ToolResultContent,
	ToolResultContentSchema,
	type ToolResultImageContent,
	ToolResultImageContentSchema,
	type ToolResultStructuredContent,
	ToolResultStructuredContentSchema,
	type ToolResultTextContent,
	ToolResultTextContentSchema,
	type ToolUseContent,
	ToolUseContentSchema,
	type TraceEvent,
	type TraceItem,
	type TraceSkillContent,
	type TraceSystemType,
	type TraceToolResult,
	type TranscriptFileActivity,
	toConversationResultContent,
	toolResultText,
	translateCodexToolCall,
	type UserContent,
	type UserEntry,
	UserEntrySchema,
	UserMessageSchema,
	userContentText,
} from "./session-transcript/index.js";

export const HealthSchema = z.object({
	status: z.literal("ok"),
});

export const UserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	image: z.string().nullable(),
	jobTitle: z.string().nullable().optional(),
	activeOrganizationId: z.string().nullable(),
});

export const CliUserSchema = z.object({
	id: z.string(),
	email: z.string(),
	name: z.string(),
});

export const CliSetupStatusSchema = z.object({
	hasCliLogin: z.boolean(),
	hasUploadedSessions: z.boolean(),
});

export const CLI_SESSION_UPLOAD_STATUS_MAX_IDS = 64;

export const CliSessionUploadStatusInputSchema = z.object({
	organizationId: z.string().min(1).max(200).optional(),
	sessionIds: z
		.array(z.string().min(1).max(200))
		.min(1)
		.max(CLI_SESSION_UPLOAD_STATUS_MAX_IDS)
		.refine((sessionIds) => new Set(sessionIds).size === sessionIds.length, {
			message: "Session IDs must be unique",
		}),
});

export const CliSessionUploadStatusOutputSchema = z.object({
	organizationId: z.string(),
	uploadedSessionIds: z.array(z.string()),
});

export const OrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	logo: z.string().nullable(),
});

export const TeamInviteLinkSchema = z.object({
	expires_at: z.string().datetime(),
	invite_url: z.string().url(),
	organization_id: z.string(),
	organization_name: z.string(),
});

export const TeamInviteAcceptResultSchema = z.object({
	organization_id: z.string(),
	organization_name: z.string(),
	status: z.enum(["already_member", "joined"]),
});

export const SessionTagSchema = z.enum([
	"research",
	"new_feature",
	"bug_fix",
	"refactoring",
	"documentation",
	"tests",
	"other",
]);

export type { Source } from "./schemas/source.js";
export { SourceSchema } from "./schemas/source.js";

import { SourceSchema } from "./schemas/source.js";

export const INGEST_AGGREGATE_CONTENT_MAX_BYTES = 128 * 1024 * 1024;
export const INGEST_MAX_SUBAGENT_COUNT = 512;
export const INGEST_LIMIT_REASONS = {
	requestLimit: "request_limit",
	byteLimit: "byte_limit",
	sessionLimit: "session_limit",
	transcriptTooLarge: "transcript_too_large",
} as const;
export type IngestLimitReason =
	(typeof INGEST_LIMIT_REASONS)[keyof typeof INGEST_LIMIT_REASONS];

const INGEST_CONTENT_MAX_CODE_UNITS = 160 * 1024 * 1024;

export const SubagentFileSchema = z.object({
	agentId: z.string().max(200),
	content: z.string().max(INGEST_CONTENT_MAX_CODE_UNITS),
});

export const IngestSessionInputSchema = z.object({
	source: SourceSchema.default("claude_code"),
	sessionId: z.string().max(200),
	projectPath: z
		.string()
		.max(200)
		.transform((p) => p.replace(/\\/g, "/")),
	gitRemote: z.string().max(200).optional(),
	packageName: z.string().max(200).optional(),
	packageType: z.string().max(200).optional(),
	gitBranch: z.string().max(200).optional(),
	gitSha: z.string().max(200).optional(),
	tag: SessionTagSchema.optional(),
	content: z.string().max(INGEST_CONTENT_MAX_CODE_UNITS),
	subagents: z
		.array(SubagentFileSchema)
		.max(INGEST_MAX_SUBAGENT_COUNT)
		.refine(
			(subagents) =>
				new Set(subagents.map((subagent) => subagent.agentId)).size ===
				subagents.length,
			{ message: "Subagent agentId values must be unique" },
		)
		.optional(),
	organizationId: z.string().max(200).optional(),
	operationId: z.string().uuid().optional(),
	client_surface: ProductAnalyticsClientSurfaceSchema.optional(),
	upload_mode: ProductAnalyticsUploadModeSchema.optional(),
	cli_version: z.string().max(200).optional(),
	platform_os: ProductAnalyticsPlatformOsSchema.optional(),
	filter_version: z.number().int().min(0).max(65_535).optional(),
	force_replace: z.boolean().optional(),
});

export const R2_INGEST_PROTOCOL = "r2_multipart_v1" as const;
export const IngestUpgradeHintSchema = z.object({
	protocol: z.literal(R2_INGEST_PROTOCOL),
});

export const IngestSessionOutputSchema = z.object({
	success: z.literal(true),
	sessionId: z.string(),
	upgradeHint: IngestUpgradeHintSchema.optional(),
	redacted: z.record(z.string(), z.number().int().nonnegative()).default({}),
	redactedBytes: z.number().int().nonnegative().optional(),
	usageChecksum: z
		.string()
		.regex(/^[a-f0-9]{64}$/u)
		.optional(),
});

export const R2_INGEST_PART_SIZE_BYTES = 8 * 1024 * 1024;
export const R2_INGEST_UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const R2_INGEST_DISABLED_CODE = "R2_INGEST_DISABLED";
export const R2_INGEST_DISABLED_MESSAGE =
	"Direct-to-R2 ingest is not configured on this API host.";

export const R2IngestJobIdSchema = z.string().uuid();
export const R2IngestJobStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);
const R2IngestObjectBaseSchema = z.object({
	byteLength: z
		.number()
		.int()
		.positive()
		.max(INGEST_AGGREGATE_CONTENT_MAX_BYTES),
	sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const R2IngestObjectInputSchema = z.discriminatedUnion("kind", [
	R2IngestObjectBaseSchema.extend({ kind: z.literal("main") }),
	R2IngestObjectBaseSchema.extend({
		agentId: z.string().trim().min(1).max(200),
		kind: z.literal("subagent"),
	}),
]);
export const R2IngestMetadataSchema = IngestSessionInputSchema.omit({
	content: true,
	subagents: true,
});
export const R2IngestInitInputSchema = R2IngestMetadataSchema.extend({
	objects: z
		.array(R2IngestObjectInputSchema)
		.min(1)
		.max(INGEST_MAX_SUBAGENT_COUNT + 1),
}).superRefine((input, context) => {
	if (input.objects.filter((object) => object.kind === "main").length !== 1) {
		context.addIssue({
			code: "custom",
			message: "Exactly one main transcript object is required",
			path: ["objects"],
		});
	}

	const agentIds = input.objects.flatMap((object) =>
		object.kind === "subagent" ? [object.agentId] : [],
	);
	if (new Set(agentIds).size !== agentIds.length) {
		context.addIssue({
			code: "custom",
			message: "Subagent agentId values must be unique",
			path: ["objects"],
		});
	}

	const aggregateBytes = input.objects.reduce(
		(total, object) => total + object.byteLength,
		0,
	);
	if (aggregateBytes > INGEST_AGGREGATE_CONTENT_MAX_BYTES) {
		context.addIssue({
			code: "too_big",
			inclusive: true,
			maximum: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
			message: `Aggregate transcript content exceeds ${INGEST_AGGREGATE_CONTENT_MAX_BYTES} bytes`,
			path: ["objects"],
			type: "array",
		});
	}
});
export const R2IngestUploadPartSchema = z.object({
	byteLength: z.number().int().positive(),
	headers: z.object({ "Content-Length": z.string().regex(/^[1-9][0-9]*$/u) }),
	partNumber: z.number().int().min(1).max(10_000),
	uploadUrl: z.string().url(),
});
const R2IngestUploadObjectBaseSchema = z.object({
	byteLength: z.number().int().positive(),
	objectKey: z.string().min(1),
	parts: z.array(R2IngestUploadPartSchema).min(1).max(10_000),
	sha256: z.string().regex(/^[a-f0-9]{64}$/u),
	uploadId: z.string().min(1),
});
export const R2IngestUploadObjectSchema = z.discriminatedUnion("kind", [
	R2IngestUploadObjectBaseSchema.extend({ kind: z.literal("main") }),
	R2IngestUploadObjectBaseSchema.extend({
		agentId: z.string().min(1).max(200),
		kind: z.literal("subagent"),
	}),
]);
export const R2IngestInitOutputSchema = z.object({
	expiresAt: z.string().datetime(),
	jobId: R2IngestJobIdSchema,
	objects: z.array(R2IngestUploadObjectSchema).min(1),
	partSizeBytes: z.literal(R2_INGEST_PART_SIZE_BYTES),
	protocol: z.literal(R2_INGEST_PROTOCOL),
});
export const R2IngestStatusInputSchema = z.object({
	jobId: R2IngestJobIdSchema,
});
export const R2IngestStatusOutputSchema = z.object({
	attempts: z.number().int().nonnegative(),
	availableAt: z.string().datetime(),
	error: z.object({ code: z.string(), message: z.string() }).nullable(),
	jobId: R2IngestJobIdSchema,
	leaseExpiresAt: z.string().datetime().nullable(),
	protocol: z.literal(R2_INGEST_PROTOCOL),
	result: IngestSessionOutputSchema.nullable(),
	status: R2IngestJobStatusSchema,
	updatedAt: z.string().datetime(),
});

export const R2IngestCompletedPartSchema = z.object({
	etag: z.string().trim().min(1).max(512),
	partNumber: z.number().int().min(1).max(10_000),
});
export const R2IngestCompletedObjectSchema = z.object({
	objectKey: z.string().trim().min(1).max(1_024),
	parts: z.array(R2IngestCompletedPartSchema).min(1).max(10_000),
	uploadId: z.string().trim().min(1).max(1_024),
});
export const R2IngestCommitInputSchema = z
	.object({
		jobId: R2IngestJobIdSchema,
		objects: z
			.array(R2IngestCompletedObjectSchema)
			.min(1)
			.max(INGEST_MAX_SUBAGENT_COUNT + 1),
	})
	.superRefine((input, context) => {
		if (
			new Set(input.objects.map((object) => object.objectKey)).size !==
			input.objects.length
		) {
			context.addIssue({
				code: "custom",
				message: "Completed object keys must be unique",
				path: ["objects"],
			});
		}
		for (const [objectIndex, object] of input.objects.entries()) {
			if (
				new Set(object.parts.map((part) => part.partNumber)).size !==
				object.parts.length
			) {
				context.addIssue({
					code: "custom",
					message: "Completed part numbers must be unique per object",
					path: ["objects", objectIndex, "parts"],
				});
			}
		}
	});
export const R2IngestCommitOutputSchema = z.object({
	jobId: R2IngestJobIdSchema,
	protocol: z.literal(R2_INGEST_PROTOCOL),
	result: IngestSessionOutputSchema,
	status: z.literal("completed"),
});

export type IngestSessionOutput = z.infer<typeof IngestSessionOutputSchema>;
export type R2IngestCommitInput = z.infer<typeof R2IngestCommitInputSchema>;
export type R2IngestCommitOutput = z.infer<typeof R2IngestCommitOutputSchema>;
export type R2IngestInitInput = z.infer<typeof R2IngestInitInputSchema>;
export type R2IngestInitOutput = z.infer<typeof R2IngestInitOutputSchema>;
export type R2IngestMetadata = z.infer<typeof R2IngestMetadataSchema>;
export type R2IngestObjectInput = z.infer<typeof R2IngestObjectInputSchema>;
export type R2IngestStatusOutput = z.infer<typeof R2IngestStatusOutputSchema>;
export type R2IngestUploadObject = z.infer<typeof R2IngestUploadObjectSchema>;

export const REDACTION_BUDGET_EXCEEDED_CODE = "REDACTION_BUDGET_EXCEEDED";
export const REDACTION_BUDGET_EXCEEDED_MESSAGE =
	"Known-pattern redaction exceeded the transcript safety budget.";
export const REDACTION_DID_NOT_CONVERGE_CODE = "REDACTION_DID_NOT_CONVERGE";
export const REDACTION_DID_NOT_CONVERGE_MESSAGE =
	"Known-pattern redaction did not converge within the safety limit.";
export const SECRET_FILTER_JSON_INTEGRITY_CODE = "SECRET_FILTER_JSON_INTEGRITY";
export const SECRET_FILTER_JSON_INTEGRITY_MESSAGE =
	"Secret filtering could not preserve transcript JSON integrity.";
export const SESSION_OWNERSHIP_CONFLICT_CODE = "SESSION_OWNERSHIP_CONFLICT";
export const SESSION_OWNERSHIP_CONFLICT_MESSAGE =
	"This session belongs to another organization member and cannot be replaced.";
export const SESSION_UPLOAD_SHRINK_REJECTED_CODE =
	"SESSION_UPLOAD_SHRINK_REJECTED";
export const SESSION_UPLOAD_SHRINK_REJECTED_MESSAGE =
	"This upload is smaller than the stored session and was refused to protect existing data. Inspect the transcript, then use `opaline upload --force-replace` only if the replacement is intentional. If your CLI does not recognize the flag, upgrade opaline first.";

export type IngestSessionInput = z.infer<typeof IngestSessionInputSchema>;

export const AdminUserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	image: z.string().nullable(),
	createdAt: z.string(),
	organizationCount: z.number(),
});

export const UpdateProfileInputSchema = z.object({
	name: z.string().trim().min(1).max(100),
	image: z.string().nullable(),
	jobTitle: z.string().trim().max(100).nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

const ProductAnalyticsCaptureResultSchema = z.object({
	success: z.literal(true),
});

const IngestSessionErrors = {
	[REDACTION_BUDGET_EXCEEDED_CODE]: {
		status: 422,
		message: REDACTION_BUDGET_EXCEEDED_MESSAGE,
		data: z.object({
			inputBytes: z.number().int().nonnegative(),
			redactedBytes: z.number().int().nonnegative(),
			ruleIds: z.array(z.string()),
		}),
	},
	[REDACTION_DID_NOT_CONVERGE_CODE]: {
		status: 422,
		message: REDACTION_DID_NOT_CONVERGE_MESSAGE,
		data: z.object({ maxPasses: z.number().int().positive() }),
	},
	[SECRET_FILTER_JSON_INTEGRITY_CODE]: {
		status: 422,
		message: SECRET_FILTER_JSON_INTEGRITY_MESSAGE,
	},
	[SESSION_OWNERSHIP_CONFLICT_CODE]: {
		status: 409,
		message: SESSION_OWNERSHIP_CONFLICT_MESSAGE,
	},
	[SESSION_UPLOAD_SHRINK_REJECTED_CODE]: {
		status: 409,
		message: SESSION_UPLOAD_SHRINK_REJECTED_MESSAGE,
		data: z.object({
			currentAssistantLineCount: z.number().int().nonnegative(),
			currentContentBytes: z.number().int().nonnegative(),
			previousAssistantLineCount: z.number().int().nonnegative(),
			previousContentBytes: z.number().int().nonnegative(),
		}),
	},
} as const;

export const contract = {
	billing: {
		configuration: oc.output(BillingConfigurationOutputSchema),
		current: oc.output(OrganizationBillingSummaryOutputSchema),
		pricing: oc
			.input(BillingPricingStateInputSchema)
			.output(BillingPricingStateOutputSchema),
		summary: oc
			.input(OrganizationBillingInputSchema)
			.output(OrganizationBillingSummaryOutputSchema),
		createCheckout: oc
			.input(CreateOrganizationCheckoutInputSchema)
			.output(CreateOrganizationCheckoutOutputSchema),
		createPortal: oc
			.input(OrganizationBillingInputSchema)
			.output(CreateOrganizationBillingPortalOutputSchema),
		selectPlan: oc
			.input(CreateOrganizationCheckoutInputSchema)
			.output(SelectOrganizationPlanOutputSchema),
		requestUpgrade: oc
			.input(CreateOrganizationCheckoutInputSchema)
			.output(RequestOrganizationBillingUpgradeOutputSchema),
	},
	githubRepositoryEvidence: {
		status: oc.output(GitHubRepositoryEvidenceStatusSchema),
		createInstallation: oc.output(GitHubCreateInstallationOutputSchema),
		syncCommit: oc
			.input(GitHubSyncCommitInputSchema)
			.output(GitHubSyncCommitOutputSchema),
	},
	repositoryEvidence: {
		init: oc
			.errors(RepositoryEvidenceErrors)
			.input(RepositoryEvidenceInitInputSchema)
			.output(RepositoryEvidenceInitOutputSchema),
		commit: oc
			.errors(RepositoryEvidenceErrors)
			.input(RepositoryEvidenceCommitInputSchema)
			.output(RepositoryEvidenceCommitOutputSchema),
	},
	repositorySettings: repositorySettingsContract,
	health: oc.output(HealthSchema),
	me: oc.output(UserSchema),
	profile: {
		updateMine: oc.input(UpdateProfileInputSchema).output(UserSchema),
		deleteMine: oc.output(z.object({ success: z.literal(true) })),
	},
	cli: {
		reportUploadFailures: oc
			.input(ReportUploadFailuresInputSchema)
			.output(z.object({ success: z.literal(true) })),
		authStatus: oc.output(CliUserSchema),
		revokeToken: oc.output(z.object({ success: z.literal(true) })),
		setupStatus: oc.output(CliSetupStatusSchema),
		updateStatus: oc.output(CliUpdateStatusSchema),
		sessionUploadStatus: oc
			.input(CliSessionUploadStatusInputSchema)
			.output(CliSessionUploadStatusOutputSchema),
	},
	listMyOrganizations: oc.output(z.array(OrganizationSchema)),
	ingestSession: oc
		.input(IngestSessionInputSchema)
		.output(IngestSessionOutputSchema)
		.errors(IngestSessionErrors),
	ingest: {
		init: oc
			.input(R2IngestInitInputSchema)
			.output(R2IngestInitOutputSchema)
			.errors({
				[R2_INGEST_DISABLED_CODE]: {
					status: 503,
					message: R2_INGEST_DISABLED_MESSAGE,
					data: z.object({
						missingVariables: z.array(z.string()).min(1),
					}),
				},
			}),
		commit: oc
			.input(R2IngestCommitInputSchema)
			.output(R2IngestCommitOutputSchema)
			.errors(IngestSessionErrors),
		status: oc
			.input(R2IngestStatusInputSchema)
			.output(R2IngestStatusOutputSchema),
	},
	getOrganizationSessionCount: oc
		.input(
			z.object({ organizationId: z.string(), userId: z.string().optional() }),
		)
		.output(z.object({ count: z.number() })),
	deleteOrganization: oc
		.input(z.object({ organizationId: z.string() }))
		.output(z.object({ success: z.literal(true) })),
	teamInviteLink: {
		create: oc
			.input(z.object({ organizationId: z.string() }))
			.output(TeamInviteLinkSchema),
		revoke: oc
			.input(z.object({ organizationId: z.string() }))
			.output(z.object({ success: z.literal(true) })),
		accept: oc
			.input(z.object({ token: z.string().min(1) }))
			.output(TeamInviteAcceptResultSchema),
	},
	admin: {
		listUsers: oc
			.input(
				z.object({
					search: z.string().optional(),
					limit: z.number().min(1).max(100).default(50),
					offset: z.number().min(0).default(0),
				}),
			)
			.output(
				z.object({
					users: z.array(AdminUserSchema),
					total: z.number(),
				}),
			),
		deleteUser: oc
			.input(z.object({ userId: z.string() }))
			.output(z.object({ success: z.literal(true) })),
		dashboard: oc
			.input(AdminCostDashboardInputSchema)
			.output(CostDashboardSchema),
	},
	productAnalytics: {
		dashboardViewed: oc
			.input(DashboardViewedCaptureInputSchema)
			.output(ProductAnalyticsCaptureResultSchema),
		dashboardFilterChanged: oc
			.input(DashboardFilterChangedCaptureInputSchema)
			.output(ProductAnalyticsCaptureResultSchema),
		dashboardDrilldownOpened: oc
			.input(DashboardDrilldownOpenedCaptureInputSchema)
			.output(ProductAnalyticsCaptureResultSchema),
	},
	analytics: {
		overview: {
			costs: oc.input(CostDashboardInputSchema).output(CostDashboardSchema),
			kpis: oc.input(DateRangeInputSchema).output(OverviewKPIsSchema),
			usageTrend: oc
				.input(DateRangeInputSchema)
				.output(z.array(UsageTrendDataSchema)),
			modelTokensTrend: oc
				.input(DateRangeInputSchema)
				.output(z.array(ModelTokensTrendDataSchema)),
			usersTokenUsage: oc
				.input(DateRangeInputSchema)
				.output(z.array(UserTokenUsageDataSchema)),
			usersDailyTrend: oc
				.input(DateRangeInputSchema)
				.output(z.array(UserDailyTrendDataSchema)),
			repositoriesDailyTrend: oc
				.input(DateRangeInputSchema)
				.output(z.array(RepositoryDailyTrendDataSchema)),
			insights: oc.input(DateRangeInputSchema).output(z.array(InsightSchema)),
			teamSummaryComparison: oc
				.input(DateRangeInputSchema)
				.output(TeamSummaryComparisonSchema),
			successRate: oc.input(DateRangeInputSchema).output(SuccessRateSchema),
		},
		developers: {
			list: oc.input(DaysInputSchema).output(z.array(DeveloperSummarySchema)),
			teamCards: oc
				.input(DaysInputSchema)
				.output(z.array(DeveloperTeamCardSchema)),
			details: oc
				.input(DeveloperDetailsInputSchema)
				.output(DeveloperDetailsSchema),
			sessions: oc
				.input(DeveloperSessionsInputSchema)
				.output(z.array(DeveloperSessionSchema)),
			projects: oc
				.input(DeveloperDetailsInputSchema)
				.output(z.array(DeveloperProjectSchema)),
			timeline: oc
				.input(DeveloperDetailsInputSchema)
				.output(z.array(DeveloperTimelineSchema)),
			features: oc
				.input(DeveloperDetailsInputSchema)
				.output(DeveloperFeatureUsageSchema),
			errors: oc
				.input(DeveloperDetailsInputSchema)
				.output(z.array(DeveloperErrorSchema)),
			trends: oc
				.input(DaysInputSchema)
				.output(z.array(DeveloperTrendDataPointSchema)),
		},
		projects: {
			investment: oc
				.input(DaysInputSchema)
				.output(z.array(ProjectInvestmentSchema)),
			trends: oc
				.input(DaysInputSchema)
				.output(z.array(ProjectTrendDataPointSchema)),
			details: oc
				.input(ProjectDetailsInputSchema)
				.output(ProjectDetailDataSchema),
			contributors: oc
				.input(ProjectDetailsInputSchema)
				.output(z.array(ProjectContributorSchema)),
			features: oc
				.input(ProjectDetailsInputSchema)
				.output(ProjectFeatureUsageSchema),
			errors: oc
				.input(ProjectDetailsInputSchema)
				.output(z.array(ProjectErrorSchema)),
		},
		sessions: {
			uploadFailures: oc
				.input(
					z.object({
						offset: z.number().int().nonnegative().default(0),
						limit: z.number().int().min(1).max(50).default(20),
						sessionId: z.string().min(1).max(200).optional(),
						startDate: z.string().date().optional(),
						endDate: z.string().date().optional(),
					}),
				)
				.output(UploadFailuresPageSchema),
			detailBodyChunk: sessionDetailProcedureContracts.detailBodyChunk,
			detailOverview: sessionDetailProcedureContracts.detailOverview,
			detailRelationships: sessionDetailProcedureContracts.detailRelationships,
			detailInitial: sessionDetailProcedureContracts.detailInitial,
			detailSpine: sessionDetailProcedureContracts.detailSpine,
			detailSubagent: sessionDetailProcedureContracts.detailSubagent,
			detailTurn: sessionDetailProcedureContracts.detailTurn,
			detailWindow: sessionDetailProcedureContracts.detailWindow,
			filterCatalog: oc
				.input(SessionListInputSchema)
				.output(SessionFilterCatalogSchema),
			list: oc
				.input(SessionListInputSchema)
				.output(z.array(SessionOverviewAnalyticsSchema)),
			summary: oc.input(DaysInputSchema).output(SessionAnalyticsSummarySchema),
			summaryComparison: oc
				.input(DaysInputSchema)
				.output(SessionAnalyticsSummaryComparisonSchema),
			dimensionAnalysis: oc
				.input(DimensionAnalysisInputSchema)
				.output(z.array(DimensionAnalysisDataPointSchema)),
		},
		repositories: {
			list: oc.output(z.array(RepositorySummarySchema)),
			detail: oc.input(RepositoryInputSchema).output(RepositoryDetailSchema),
		},
		skills: {
			list: oc.output(z.array(HistoricalSkillSummarySchema)),
			detail: oc
				.input(HistoricalSkillDetailInputSchema)
				.output(HistoricalSkillDetailSchema),
		},
		roi: {
			dashboard: oc.input(DateRangeInputSchema).output(ROIDashboardSchema),
			metrics: oc.input(DaysInputSchema).output(ROIMetricsSchema),
			trends: oc.input(DaysInputSchema).output(z.array(ROITrendSchema)),
			breakdownDevelopers: oc
				.input(DaysInputSchema)
				.output(z.array(DeveloperCostBreakdownSchema)),
			breakdownProjects: oc
				.input(DaysInputSchema)
				.output(z.array(ProjectCostBreakdownSchema)),
		},
		errors: {
			dashboard: oc.input(DateRangeInputSchema).output(ErrorsDashboardSchema),
			topRecurring: oc
				.input(RecurringErrorsInputSchema)
				.output(z.array(RecurringErrorSchema)),
			trends: oc
				.input(ErrorTrendsInputSchema)
				.output(z.array(ErrorTrendDataPointSchema)),
		},
		learnings: {
			list: oc
				.input(LearningsListInputSchema)
				.output(z.array(LearningEntrySchema)),
			stats: oc.input(DaysInputSchema).output(LearningsFeedStatsSchema),
			users: oc.output(z.array(z.string())),
			projects: oc.output(z.array(z.string())),
			trend: oc
				.input(LearningsTrendInputSchema)
				.output(z.array(LearningsTrendDataPointSchema)),
		},
	},
};
export {
	CLI_CONNECTION_CODE_TTL_MS,
	CLI_CONNECTION_PATH,
	CLI_CONNECTION_TTL_MS,
	CliConnectionAuthorizeSchema,
	CliConnectionCreateResponseSchema,
	CliConnectionRedeemSchema,
	CliConnectionSecretSchema,
	type CliConnectionSnapshot,
	CliConnectionSnapshotSchema,
	type CliConnectionUpdate,
	CliConnectionUpdateSchema,
	isCliConnectionTerminal,
} from "./cli-connection.js";

export {
	deriveTranscriptToolActivity,
	type TranscriptToolActivity,
	TranscriptToolActivitySchema,
} from "./session-transcript/transcript-tool-activity.js";
export { readTranscriptToolOutputText } from "./session-transcript/transcript-tool-output.js";
