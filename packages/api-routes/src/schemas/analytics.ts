import { z } from "zod";
import { LiveSessionSummarySchema } from "../live-session-view.js";
import { StoredUploadFailureSchema } from "../upload-failure.js";
import { SourceSchema } from "./source.js";

// ── Common inputs ──────────────────────────────────────────────────

const MAX_DAYS = 365;
const MAX_LIMIT = 1000;
export const HISTORICAL_SKILL_CONTENT_MAX_BYTES = 256 * 1024;
export const HISTORICAL_SKILL_VERSION_LIMIT = 10;

export const DaysInputSchema = z.object({
	days: z.number().int().positive().max(MAX_DAYS).default(7),
});

export const PaginatedDaysInputSchema = DaysInputSchema.extend({
	limit: z.number().int().positive().max(MAX_LIMIT).default(100),
	offset: z.number().int().nonnegative().default(0),
});

export const DateRangeInputSchema = z.object({
	startDate: z.string().date(),
	endDate: z.string().date(),
});

const MAX_ID_FILTER_LENGTH = 512;
const MAX_PATH_FILTER_LENGTH = 4096;

// ── Overview ───────────────────────────────────────────────────────

export const OverviewKPIsSchema = z.object({
	distinct_users: z.number(),
	distinct_sessions: z.number(),
	distinct_projects: z.number(),
	distinct_subagents: z.number(),
	distinct_skills: z.number(),
	distinct_slash_commands: z.number(),
	total_sessions: z.number(),
});

export const UserDailyTrendDataSchema = z.object({
	date: z.string(),
	user_id: z.string(),
	sessions: z.number(),
	total_hours: z.number(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	cost: z.number().optional(),
	distinct_skills: z.number(),
	distinct_slash_commands: z.number(),
	models_used: z.array(z.string()),
	repositories_touched: z.array(z.string()),
});

// ── Developers ─────────────────────────────────────────────────────

export const DeveloperSummarySchema = z.object({
	user_id: z.string(),
	total_sessions: z.number(),
	active_days: z.number(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	total_duration_min: z.number(),
	avg_session_duration_min: z.number(),
	last_active_date: z.string(),
	cost: z.number().nullable(),
	favorite_model: z.string().nullable(),
});

export const DeveloperTeamCardSchema = z.object({
	user_id: z.string(),
	display_name: z.string(),
	cost: z.number().nullable(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	total_tokens: z.number(),
	total_sessions: z.number(),
	active_days: z.number(),
	last_active_date: z.string(),
	favorite_model: z.string().nullable(),
	top_skills: z.array(z.object({ name: z.string(), count: z.number() })),
});

// ── Sessions ───────────────────────────────────────────────────────

export const RepoIdentitySchema = z.object({
	repoKey: z.string(),
	repoLabel: z.string(),
	repoName: z.string().nullable(),
	source: z.enum(["worktree", "remote", "package", "unresolved"]),
	worktree: z.string().nullable(),
});

export const LinkedSubagentSchema = z.object({
	session_id: z.string(),
	source: z.enum(["claude", "codex"]),
	provider: z.enum(["claude", "openai"]),
	model: z.string(),
	confidence: z.enum(["id_echo", "prompt_echo", "attested_temporal"]),
});

export const NativeChildSessionSchema = z.object({
	model: z.string(),
	session_id: z.string(),
});

export const SessionAnalyticsSchema = z.object({
	// Present only for a diagnostic row; transcript-derived metrics are unavailable.
	upload_failure: StoredUploadFailureSchema.optional(),
	// Present only for a row the web app builds from a session running right
	// now, before its upload; transcript-derived metrics are unavailable.
	live_session: LiveSessionSummarySchema.optional(),
	session_id: z.string(),
	user_id: z.string(),
	session_date: z.string(),
	project_path: z.string(),
	repository: z.string().nullable(),
	repository_identity: RepoIdentitySchema.optional(),
	worktree: z.string().nullable().optional(),
	git_remote: z.string().optional(),
	git_branch: z.string().nullable().optional(),
	duration_min: z.number(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	estimated_cost: z.number().nullable().optional(),
	cost_uses_default_region: z.boolean().optional(),
	total_interactions: z.number(),
	subagent_types: z.array(z.string()),
	subagent_count: z.number().int().nonnegative().optional(),
	native_subagents: z
		.array(
			z.object({
				subagent_id: z.string(),
				model: z.string().nullable(),
			}),
		)
		.optional(),
	native_child_sessions: z.array(NativeChildSessionSchema).optional(),
	linked_subagent_count: z.number().int().nonnegative().optional(),
	linked_subagents: z.array(LinkedSubagentSchema).optional(),
	skills: z.array(z.string()),
	slash_commands: z.array(z.string()),
	error_count: z.number().int().nonnegative().optional(),
	model_used: z.string(),
	source: SourceSchema.optional(),
	member_swears: z.number().int().nonnegative().default(0),
	member_apologies: z.number().int().nonnegative().default(0),
	member_positive: z.number().int().nonnegative().default(0),
	model_swears: z.number().int().nonnegative().default(0),
	model_apologies: z.number().int().nonnegative().default(0),
	model_positive: z.number().int().nonnegative().default(0),
	member_swear_matches: z.array(z.string()).optional(),
	member_apology_matches: z.array(z.string()).optional(),
	member_positive_matches: z.array(z.string()).optional(),
	model_swear_matches: z.array(z.string()).optional(),
	model_apology_matches: z.array(z.string()).optional(),
	model_positive_matches: z.array(z.string()).optional(),
});

// New list writers and release checks require complete enrichment. Readers also
// accept the base schema during rolling deployments; absent metadata stays
// absent instead of becoming convincing zeroes or empty word lists.
export const SessionOverviewAnalyticsSchema = SessionAnalyticsSchema.extend({
	repository_identity:
		SessionAnalyticsSchema.shape.repository_identity.unwrap(),
	error_count: SessionAnalyticsSchema.shape.error_count.unwrap(),
	subagent_count: SessionAnalyticsSchema.shape.subagent_count.unwrap(),
	native_subagents: SessionAnalyticsSchema.shape.native_subagents.unwrap(),
	member_swear_matches:
		SessionAnalyticsSchema.shape.member_swear_matches.unwrap(),
	member_apology_matches:
		SessionAnalyticsSchema.shape.member_apology_matches.unwrap(),
	member_positive_matches:
		SessionAnalyticsSchema.shape.member_positive_matches.unwrap(),
	model_swear_matches:
		SessionAnalyticsSchema.shape.model_swear_matches.unwrap(),
	model_apology_matches:
		SessionAnalyticsSchema.shape.model_apology_matches.unwrap(),
	model_positive_matches:
		SessionAnalyticsSchema.shape.model_positive_matches.unwrap(),
});
export type SessionOverviewAnalytics = z.infer<
	typeof SessionOverviewAnalyticsSchema
>;

export const SessionAnalyticsSummarySchema = z.object({
	total_sessions: z.number(),
	avg_session_duration_min: z.number(),
	subagents_adoption_rate: z.number(),
	skills_adoption_rate: z.number(),
	slash_commands_adoption_rate: z.number(),
});

export const SessionAnalyticsSummaryComparisonSchema = z.object({
	current: SessionAnalyticsSummarySchema,
	previous: SessionAnalyticsSummarySchema,
	changes: z.object({
		total_sessions: z.number(),
		avg_session_duration_min: z.number(),
	}),
});

export const HistoricalSkillAgentSchema = z.enum(["claude", "codex"]);

const HistoricalSkillUserAttributionSchema = z.object({
	userId: z.string(),
	sessionCount: z.number().int().nonnegative(),
});

const HistoricalSkillRepoAttributionSchema = z.object({
	repoKey: z.string(),
	repoLabel: z.string(),
	sessionCount: z.number().int().nonnegative(),
});

const HistoricalSkillAttributionSchema = z.object({
	userCount: z.number().int().nonnegative().default(0),
	topUsers: z.array(HistoricalSkillUserAttributionSchema).max(6).default([]),
	repoCount: z.number().int().nonnegative().default(0),
	topRepos: z.array(HistoricalSkillRepoAttributionSchema).max(6).default([]),
});

export const HistoricalSkillSummarySchema = z.object({
	name: z.string(),
	sessionCount: z.number().int().nonnegative(),
	claudeSessionCount: z.number().int().nonnegative(),
	codexSessionCount: z.number().int().nonnegative(),
	contentPreview: z.string().nullable().default(null),
	attribution: HistoricalSkillAttributionSchema.optional(),
	/** Distinct contents used; absent where only the legacy reader answers. */
	versionCount: z.number().int().nonnegative().optional(),
});

export const HistoricalSkillVersionSchema = z.object({
	sourceAgent: HistoricalSkillAgentSchema,
	contentSha256: z.string().length(64),
	// The server also enforces this as an exact UTF-8 byte ceiling.
	content: z.string().max(HISTORICAL_SKILL_CONTENT_MAX_BYTES),
	sessionCount: z.number().int().positive(),
	firstUsedAt: z.string(),
	lastUsedAt: z.string(),
});

export const HistoricalSkillDetailSchema = z.object({
	name: z.string(),
	sessionCount: z.number().int().nonnegative(),
	claudeSessionCount: z.number().int().nonnegative(),
	codexSessionCount: z.number().int().nonnegative(),
	sourceAgents: z.array(HistoricalSkillAgentSchema),
	versions: z
		.array(HistoricalSkillVersionSchema)
		.max(HISTORICAL_SKILL_VERSION_LIMIT),
	unavailableSessionCount: z.number().int().nonnegative(),
});

export const HistoricalSkillDetailInputSchema = z.object({
	name: z.string().min(1).max(MAX_ID_FILTER_LENGTH),
});

const SessionFilterRangeSchema = z.object({
	minimum: z.number().finite().nullable(),
	maximum: z.number().finite().nullable(),
});
export const SessionListFiltersSchema = z.object({
	excluded: z.object({
		model: z.array(z.string().max(MAX_ID_FILTER_LENGTH)).max(10000),
		repository: z.array(z.string().max(MAX_PATH_FILTER_LENGTH)).max(10000),
		skills: z.array(z.string().max(MAX_PATH_FILTER_LENGTH)).max(10000),
		user: z.array(z.string().max(MAX_ID_FILTER_LENGTH)).max(10000),
	}),
	ranges: z.object({
		cost: SessionFilterRangeSchema,
		duration: SessionFilterRangeSchema,
		errors: SessionFilterRangeSchema,
		input: SessionFilterRangeSchema,
		output: SessionFilterRangeSchema,
		subagents: SessionFilterRangeSchema,
	}),
});
export type SessionListFilters = z.infer<typeof SessionListFiltersSchema>;
const SessionFilterBoundsSchema = z.object({
	minimum: z.number(),
	maximum: z.number(),
	step: z.number(),
});
export const SessionFilterCatalogSchema = z.object({
	repositories: z.array(RepoIdentitySchema),
	models: z.array(z.string()),
	skills: z.array(z.string()),
	users: z.array(z.string()),
	ranges: z.object({
		cost: SessionFilterBoundsSchema,
		duration: SessionFilterBoundsSchema,
		errors: SessionFilterBoundsSchema,
		input: SessionFilterBoundsSchema,
		output: SessionFilterBoundsSchema,
		subagents: SessionFilterBoundsSchema,
	}),
	sessionCount: z.number().int().nonnegative(),
});
export type SessionFilterCatalog = z.infer<typeof SessionFilterCatalogSchema>;

/**
 * The filter catalog's range: its options depend only on the date range, so
 * it takes no paging, sorting or filters (`getSessionFilterCatalog`).
 */
export const SessionFilterCatalogInputSchema = DaysInputSchema.extend({
	startDate: z.string().date().optional(),
	endDate: z.string().date().optional(),
});

export const SessionListInputSchema = DaysInputSchema.extend({
	repoKey: z.string().min(1).max(4096).optional(),
	filters: SessionListFiltersSchema.optional(),
	skillName: z.string().min(1).max(MAX_ID_FILTER_LENGTH).optional(),
	// When both are supplied they replace the rolling `days` lookback, so a
	// range that does not end today (e.g. a past month) returns that window
	// instead of the last N days.
	startDate: z.string().date().optional(),
	endDate: z.string().date().optional(),
	userId: z.string().max(MAX_ID_FILTER_LENGTH).optional(),
	projectPath: z.string().max(MAX_PATH_FILTER_LENGTH).optional(),
	repository: z.string().max(MAX_PATH_FILTER_LENGTH).optional(),
	source: SourceSchema.optional(),
	limit: z.number().int().positive().max(MAX_LIMIT).default(100),
	offset: z.number().int().nonnegative().default(0),
	sortBy: z
		.enum(["session_date", "duration_min", "total_tokens"])
		.default("session_date"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const VALID_DIMENSIONS = [
	"user_id",
	"project_path",
	"repository",
	"model_used",
	"used_skills",
	"used_slash_commands",
	"used_subagents",
] as const;

const VALID_METRICS = [
	"session_count",
	"avg_duration",
	"total_duration",
	// Retained for older deployed clients that still send interaction metrics.
	"avg_interactions",
	"total_interactions",
	"avg_tokens",
	"total_tokens",
	"avg_errors",
	"total_errors",
] as const;

export const DimensionAnalysisInputSchema = DaysInputSchema.extend({
	dimension: z.enum(VALID_DIMENSIONS),
	metric: z.enum(VALID_METRICS),
	splitBy: z.enum(VALID_DIMENSIONS).optional(),
	limit: z.number().int().positive().max(MAX_LIMIT).default(20),
	userId: z.string().max(MAX_ID_FILTER_LENGTH).optional(),
	projectPath: z.string().max(MAX_PATH_FILTER_LENGTH).optional(),
});

export const DimensionAnalysisDataPointSchema = z.object({
	dimension_value: z.string(),
	metric_value: z.number().optional(),
	split_values: z.record(z.string(), z.number()).optional(),
});

// ── Type exports ───────────────────────────────────────────────────

export type OverviewKPIs = z.infer<typeof OverviewKPIsSchema>;
export type UserDailyTrendData = z.infer<typeof UserDailyTrendDataSchema>;
export type DeveloperSummary = z.infer<typeof DeveloperSummarySchema>;
export type DeveloperTeamCard = z.infer<typeof DeveloperTeamCardSchema>;
export type RepoIdentity = z.infer<typeof RepoIdentitySchema>;
type ParsedSessionAnalytics = z.infer<typeof SessionAnalyticsSchema>;
type SessionLanguageSignalCountKey = `${string}_${
	| "swears"
	| "apologies"
	| "positive"}`;
type SessionLanguageSignalMatchKey = `${"member" | "model"}_${
	| "swear"
	| "apology"
	| "positive"}_matches`;

// Historical clients can omit persisted matches. Counts keep their established
// defaults; missing matches remain unavailable. Patterned indexes preserve the
// existing count-reader contract without inventing matched words.
export type SessionAnalytics = Omit<
	ParsedSessionAnalytics,
	SessionLanguageSignalCountKey | SessionLanguageSignalMatchKey
> & {
	readonly [key: SessionLanguageSignalCountKey]: number;
} & Partial<Readonly<Record<SessionLanguageSignalMatchKey, string[]>>>;
export type SessionListInput = z.input<typeof SessionListInputSchema>;
export type HistoricalSkillSummary = z.infer<
	typeof HistoricalSkillSummarySchema
>;
export type HistoricalSkillAgent = z.infer<typeof HistoricalSkillAgentSchema>;
export type HistoricalSkillVersion = z.infer<
	typeof HistoricalSkillVersionSchema
>;
export type HistoricalSkillDetail = z.infer<typeof HistoricalSkillDetailSchema>;
export type DimensionAnalysisDataPoint = z.infer<
	typeof DimensionAnalysisDataPointSchema
>;
export type SessionAnalyticsSummary = z.infer<
	typeof SessionAnalyticsSummarySchema
>;
export type SessionAnalyticsSummaryComparison = z.infer<
	typeof SessionAnalyticsSummaryComparisonSchema
>;
export type DimensionAnalysisInput = z.infer<
	typeof DimensionAnalysisInputSchema
>;
