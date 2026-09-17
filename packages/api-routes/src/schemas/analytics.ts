import { z } from "zod";
import { ESTIMATED_PRICING_MODE } from "../model-pricing.js";
import { StoredUploadFailureSchema } from "../upload-failure.js";
import { SourceSchema } from "./source.js";

// ── Common inputs ──────────────────────────────────────────────────

const MAX_DAYS = 365;
const MAX_LIMIT = 1000;
export const HISTORICAL_SKILL_CONTENT_MAX_BYTES = 256 * 1024;
export const HISTORICAL_SKILL_VERSION_LIMIT = 10;
export const LEARNINGS_FEED_LIMIT = 100;
export const LEARNING_CONTENT_MAX_CODE_UNITS = 5_000;

export const DaysInputSchema = z.object({
	days: z.number().int().positive().max(MAX_DAYS).default(7),
});

export const PaginatedDaysInputSchema = DaysInputSchema.extend({
	limit: z.number().int().positive().max(MAX_LIMIT).default(100),
	offset: z.number().int().nonnegative().default(0),
});

export const LearningsListInputSchema = DaysInputSchema.extend({
	limit: z.number().int().positive().max(LEARNINGS_FEED_LIMIT).default(50),
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

export const UsageTrendDataSchema = z.object({
	date: z.string(),
	sessions: z.number(),
	active_users: z.number(),
	total_hours: z.number(),
	total_tokens: z.number(),
});

export const ModelTokensTrendDataSchema = z.object({
	date: z.string(),
	model: z.string(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	estimated_cost: z.number().nullable().optional(),
});

export const UserTokenUsageDataSchema = z.object({
	user_id: z.string(),
	user_label: z.string(),
	models_used: z.array(z.string()),
	repositories_touched: z.array(z.string()),
	total_commits: z.number(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	cost: z.number().nullable(),
	total_sessions: z.number(),
	total_duration_min: z.number(),
	success_rate: z.number(),
	distinct_skills: z.number(),
	distinct_slash_commands: z.number(),
});

export const UserDailyTrendDataSchema = z.object({
	date: z.string(),
	user_id: z.string(),
	sessions: z.number(),
	total_commits: z.number(),
	total_hours: z.number(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	cost: z.number().optional(),
	avg_success_rate: z.number(),
	distinct_skills: z.number(),
	distinct_slash_commands: z.number(),
	models_used: z.array(z.string()),
	repositories_touched: z.array(z.string()),
});

export const RepositoryDailyTrendDataSchema = z.object({
	date: z.string(),
	repository: z.string(),
	sessions: z.number(),
	total_commits: z.number(),
	total_tokens: z.number().optional(),
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	cost: z.number().optional(),
});

export const InsightSchema = z.object({
	type: z.enum(["trend", "performer", "alert", "info"]),
	severity: z.enum(["positive", "warning", "negative", "info"]),
	message: z.string(),
	link: z.string().optional(),
});

export const TeamSummaryComparisonSchema = z.object({
	current: z.object({
		total_sessions: z.number(),
		active_users: z.number(),
		avg_duration_min: z.number(),
		avg_sessions_per_user: z.number(),
	}),
	previous: z.object({
		total_sessions: z.number(),
		active_users: z.number(),
		avg_duration_min: z.number(),
		avg_sessions_per_user: z.number(),
	}),
	changes: z.object({
		total_sessions: z.number(),
		active_users: z.number(),
		avg_duration_min: z.number(),
		avg_sessions_per_user: z.number(),
	}),
});

export const SuccessRateSchema = z.object({
	current: z.object({
		high_quality_sessions: z.number(),
		total_sessions: z.number(),
		success_rate: z.number(),
	}),
	previous: z.object({
		high_quality_sessions: z.number(),
		total_sessions: z.number(),
		success_rate: z.number(),
	}),
	changes: z.object({
		success_rate: z.number(),
	}),
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
	success_rate: z.number(),
	cost: z.number().nullable(),
	success_rate_trend: z.number(),
	favorite_model: z.string().nullable(),
});

export const DeveloperTeamCardSchema = z.object({
	user_id: z.string(),
	display_name: z.string(),
	archetype: z
		.object({
			key: z.string(),
			name: z.string(),
		})
		.nullable(),
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

export const DeveloperDetailsSchema = DeveloperSummarySchema.extend({
	distinct_projects: z.number(),
	error_count: z.number(),
});

export const DeveloperSessionSchema = z.object({
	session_id: z.string(),
	session_date: z.string(),
	project_path: z.string(),
	git_remote: z.string().optional(),
	package_name: z.string().optional(),
	duration_min: z.number(),
	total_tokens: z.number(),
	has_subagents: z.boolean(),
	has_skills: z.boolean(),
	has_slash_commands: z.boolean(),
	has_errors: z.boolean(),
	likely_success: z.boolean(),
});

export const DeveloperProjectSchema = z.object({
	project_path: z.string(),
	git_remote: z.string().optional(),
	package_name: z.string().optional(),
	sessions: z.number(),
	total_duration_min: z.number(),
	total_tokens: z.number(),
	first_session: z.string(),
	last_session: z.string(),
});

export const DeveloperTimelineSchema = z.object({
	date: z.string(),
	sessions: z.number(),
	total_duration_min: z.number(),
	total_tokens: z.number(),
});

export const DeveloperTrendDataPointSchema = z.object({
	date: z.string(),
	user_id: z.string(),
	sessions: z.number(),
	total_hours: z.number(),
	total_tokens: z.number(),
	avg_success_rate: z.number(),
});

export const DeveloperFeatureUsageSchema = z.object({
	subagents_adoption_rate: z.number(),
	skills_adoption_rate: z.number(),
	slash_commands_adoption_rate: z.number(),
	top_subagents: z.array(z.object({ name: z.string(), count: z.number() })),
	top_skills: z.array(z.object({ name: z.string(), count: z.number() })),
	top_slash_commands: z.array(
		z.object({ name: z.string(), count: z.number() }),
	),
});

export const DeveloperErrorSchema = z.object({
	error_pattern: z.string(),
	occurrences: z.number(),
	last_seen: z.string(),
});

// ── Developer input schemas ────────────────────────────────────────

export const DeveloperDetailsInputSchema = DaysInputSchema.extend({
	userId: z.string().max(MAX_ID_FILTER_LENGTH),
});

export const DeveloperSessionsInputSchema = DaysInputSchema.extend({
	userId: z.string().max(MAX_ID_FILTER_LENGTH),
	projectPath: z.string().max(MAX_PATH_FILTER_LENGTH).optional(),
	outcome: z.enum(["all", "success"]).default("all"),
	limit: z.number().int().positive().max(MAX_LIMIT).default(100),
	offset: z.number().int().nonnegative().default(0),
	sortBy: z.enum(["date", "duration", "tokens"]).default("date"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ── Projects ───────────────────────────────────────────────────────

export const ProjectInvestmentSchema = z.object({
	repository: z.string().nullable(),
	git_remote: z.string().optional(),
	project_path: z.string(),
	sessions: z.number(),
	unique_users: z.number(),
	total_duration_min: z.number(),
	total_tokens: z.number(),
	success_rate: z.number(),
	cost: z.number().nullable(),
	success_rate_trend: z.number(),
	automated_sessions: z.number(),
	manual_sessions: z.number(),
	unclassified_sessions: z.number(),
	last_session_at: z.string(),
});

export const ProjectDetailDataSchema = z.object({
	project_path: z.string(),
	total_sessions: z.number(),
	total_tokens: z.number(),
	contributors_count: z.number(),
	errors_count: z.number(),
	avg_session_duration_min: z.number(),
	success_rate: z.number(),
	total_duration_min: z.number(),
	cost: z.number().nullable(),
});

export const ProjectContributorSchema = z.object({
	user_id: z.string(),
	sessions: z.number(),
	total_duration_min: z.number(),
	total_tokens: z.number(),
	contribution_percentage: z.number(),
});

export const ProjectFeatureUsageSchema = z.object({
	subagents_adoption_rate: z.number(),
	skills_adoption_rate: z.number(),
	slash_commands_adoption_rate: z.number(),
	top_subagents: z.array(z.object({ name: z.string(), count: z.number() })),
	top_skills: z.array(z.object({ name: z.string(), count: z.number() })),
	top_slash_commands: z.array(
		z.object({ name: z.string(), count: z.number() }),
	),
});

export const ProjectErrorSchema = z.object({
	error_pattern: z.string(),
	occurrences: z.number(),
	affected_users: z.number(),
	last_seen: z.string(),
});

export const ProjectTrendDataPointSchema = z.object({
	date: z.string(),
	project_path: z.string(),
	project_name: z.string(),
	sessions: z.number(),
	total_hours: z.number(),
	total_tokens: z.number(),
	avg_success_rate: z.number(),
});

export const ProjectDetailsInputSchema = DaysInputSchema.extend({
	projectPath: z.string().max(MAX_PATH_FILTER_LENGTH),
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

export const SessionAnalyticsSchema = z.object({
	// Present only for a diagnostic row; transcript-derived metrics are unavailable.
	upload_failure: StoredUploadFailureSchema.optional(),
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
	success_score: z.number(),
	total_interactions: z.number(),
	avg_period_sec: z.number(),
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
	linked_subagent_count: z.number().int().nonnegative().optional(),
	linked_subagents: z.array(LinkedSubagentSchema).optional(),
	skills: z.array(z.string()),
	slash_commands: z.array(z.string()),
	has_commit: z.boolean(),
	error_count: z.number().int().nonnegative().optional(),
	model_used: z.string(),
	used_plan_mode: z.boolean(),
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
	avg_response_time_sec: z.number(),
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
		avg_response_time_sec: z.number(),
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
	topUsers: z.array(HistoricalSkillUserAttributionSchema).max(3).default([]),
	repoCount: z.number().int().nonnegative().default(0),
	topRepos: z.array(HistoricalSkillRepoAttributionSchema).max(3).default([]),
});

export const HistoricalSkillSummarySchema = z.object({
	name: z.string(),
	sessionCount: z.number().int().nonnegative(),
	claudeSessionCount: z.number().int().nonnegative(),
	codexSessionCount: z.number().int().nonnegative(),
	contentPreview: z.string().nullable().default(null),
	attribution: HistoricalSkillAttributionSchema.optional(),
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
		.enum(["session_date", "duration_min", "total_tokens", "success_score"])
		.default("session_date"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const VALID_DIMENSIONS = [
	"user_id",
	"project_path",
	"repository",
	"model_used",
	"has_commit",
	"used_plan_mode",
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
	"avg_response_time",
	"median_response_time",
	"avg_tokens",
	"total_tokens",
	"avg_success_score",
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

export const SessionDetailSchema = z.object({
	session_id: z.string(),
	user_id: z.string(),
	session_date: z.string(),
	last_interaction_date: z.string(),
	project_path: z.string(),
	repository: z.string().nullable(),
	content: z.string(),
	subagents: z.record(z.string(), z.string()),
	skills: z.array(z.string()),
	slash_commands: z.array(z.string()),
	git_branch: z.string().nullable(),
	git_sha: z.string().nullable(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	estimated_cost: z.number().nullable().optional(),
	success_score: z.number().optional(),
	duration_min: z.number().optional(),
	model_used: z.string().optional(),
	source: SourceSchema.optional(),
});

export const SessionDetailInputSchema = z.object({
	sessionId: z.string().max(MAX_ID_FILTER_LENGTH),
});

// ── ROI ────────────────────────────────────────────────────────────

export const ROIMetricsSchema = z.object({
	total_cost: z.number().nullable(),
	total_cost_change_pct: z.number().nullable(),
	cost_per_session: z.number().nullable(),
	cost_per_session_change_pct: z.number().nullable(),
	cost_per_commit: z.number().nullable(),
	cost_per_commit_change_pct: z.number().nullable(),
	total_tokens: z.number(),
	input_tokens: z.number(),
	output_tokens: z.number(),
	token_utilization_rate: z.number(),
	total_sessions: z.number(),
	total_commits: z.number(),
	total_hours: z.number(),
	active_developers: z.number(),
	avg_success_score: z.number(),
	commits_per_dollar: z.number().nullable(),
	sessions_per_dollar: z.number().nullable(),
	productivity_improvement_pct: z.number().nullable(),
	estimated_loc_generated: z.number(),
	dev_hours_saved: z.number(),
	dev_hours_saved_change_pct: z.number(),
	dollar_value_saved: z.number().nullable(),
	roi_percentage: z.number().nullable(),
	current_period_start: z.string(),
	current_period_end: z.string(),
	previous_period_start: z.string(),
	previous_period_end: z.string(),
});

export const ROIAssumptionsSchema = z.object({
	pricing_mode: z.literal(ESTIMATED_PRICING_MODE),
	priced_model_entries: z.number().int().positive(),
	unresolved_models_priced: z.literal(false),
	code_percentage: z.number(),
	tokens_per_loc: z.number(),
	loc_per_hour: z.number(),
	developer_hourly_rate: z.number(),
});

export const ROIDashboardTrendPointSchema = z.object({
	bucket_start: z.string(),
	bucket_label: z.string(),
	total_cost: z.number().nullable(),
	dollar_value_saved: z.number().nullable(),
	roi_percentage: z.number().nullable(),
	dev_hours_saved: z.number(),
	commits_per_dollar: z.number().nullable(),
	sessions_per_dollar: z.number().nullable(),
	total_sessions: z.number(),
	total_commits: z.number(),
});

export const ROIDashboardSummarySchema = z.object({
	total_cost: z.number().nullable(),
	total_cost_change_pct: z.number().nullable(),
	dollar_value_saved: z.number().nullable(),
	dollar_value_saved_change_pct: z.number().nullable(),
	roi_percentage: z.number().nullable(),
	roi_percentage_change_pct: z.number().nullable(),
	dev_hours_saved: z.number(),
	dev_hours_saved_change_pct: z.number(),
	commits_per_dollar: z.number().nullable(),
	sessions_per_dollar: z.number().nullable(),
	total_sessions: z.number(),
	total_commits: z.number(),
	active_developers: z.number(),
	avg_success_score: z.number(),
});

export const ROIDashboardSchema = z.object({
	start_date: z.string(),
	end_date: z.string(),
	comparison_start_date: z.string(),
	comparison_end_date: z.string(),
	summary: ROIDashboardSummarySchema,
	assumptions: ROIAssumptionsSchema,
	trend_interval: z.enum(["day", "week", "month"]),
	trend: z.array(ROIDashboardTrendPointSchema),
	developer_breakdown: z.array(z.lazy(() => DeveloperCostBreakdownSchema)),
	project_breakdown: z.array(z.lazy(() => ProjectCostBreakdownSchema)),
});

export const ROITrendSchema = z.object({
	week_start: z.string(),
	total_cost: z.number().nullable(),
	total_sessions: z.number(),
	total_commits: z.number(),
	active_developers: z.number(),
	avg_success_score: z.number(),
	total_tokens: z.number(),
	output_tokens: z.number(),
	productivity_score: z.number().nullable(),
});

export const DeveloperCostBreakdownSchema = z.object({
	user_id: z.string(),
	sessions: z.number(),
	total_tokens: z.number(),
	cost: z.number().nullable(),
	cost_percentage: z.number().nullable(),
	avg_success_score: z.number(),
});

export const ProjectCostBreakdownSchema = z.object({
	project_path: z.string(),
	sessions: z.number(),
	total_tokens: z.number(),
	cost: z.number().nullable(),
	cost_percentage: z.number().nullable(),
	avg_success_score: z.number(),
});

// ── Errors ─────────────────────────────────────────────────────────

export const RecurringErrorSchema = z.object({
	error_pattern: z.string(),
	occurrences: z.number(),
	affected_sessions: z.number(),
	affected_users: z.number(),
	last_seen: z.string(),
	severity: z.enum(["high", "medium", "low"]),
	repositories: z.array(z.string()),
});

export const ErrorsDashboardSummarySchema = z.object({
	total_errors: z.number(),
	distinct_patterns: z.number(),
	high_severity_patterns: z.number(),
	max_affected_users: z.number(),
	top_error_pattern: z.string(),
});

export const ErrorsDashboardSchema = z.object({
	start_date: z.string(),
	end_date: z.string(),
	summary: ErrorsDashboardSummarySchema,
	recurring: z.array(RecurringErrorSchema),
});

export const ErrorTrendDataPointSchema = z.object({
	date: z.string(),
	dimension: z.string(),
	avg_errors_per_interaction: z.number(),
	avg_errors_per_session: z.number(),
	error_types: z.array(z.string()),
	error_type_occurrences: z.array(z.number()),
	total_errors: z.number(),
});

export const ErrorTrendsInputSchema = DateRangeInputSchema.extend({
	splitBy: z.enum(["project_path", "user_id", "model"]).default("project_path"),
});

export const RecurringErrorsInputSchema = DaysInputSchema.extend({
	minOccurrences: z.number().int().positive().default(2),
	limit: z.number().int().positive().max(MAX_LIMIT).default(20),
});

// ── Learnings ──────────────────────────────────────────────────────

export const LearningEntrySchema = z.object({
	session_id: z.string(),
	user_id: z.string(),
	created_at: z.string(),
	type: z.string(),
	content: z.string().max(LEARNING_CONTENT_MAX_CODE_UNITS),
	scope: z.string(),
	tags: z.array(z.string()),
	project_path: z.string(),
	repository: z.string().nullable(),
});

export const LearningsFeedStatsSchema = z.object({
	total_learnings: z.number(),
	unique_users: z.number(),
	unique_projects: z.number(),
	learnings_by_day: z.array(
		z.object({
			date: z.string(),
			count: z.number(),
		}),
	),
});

export const LearningsTrendDataPointSchema = z.record(
	z.string(),
	z.union([z.string(), z.number()]),
);

export const LearningsTrendInputSchema = DaysInputSchema.extend({
	splitBy: z.enum(["user_id", "repository"]),
});

// ── Type exports ───────────────────────────────────────────────────

export type OverviewKPIs = z.infer<typeof OverviewKPIsSchema>;
export type UsageTrendData = z.infer<typeof UsageTrendDataSchema>;
export type ModelTokensTrendData = z.infer<typeof ModelTokensTrendDataSchema>;
export type UserTokenUsageData = z.infer<typeof UserTokenUsageDataSchema>;
export type UserDailyTrendData = z.infer<typeof UserDailyTrendDataSchema>;
export type RepositoryDailyTrendData = z.infer<
	typeof RepositoryDailyTrendDataSchema
>;
export type Insight = z.infer<typeof InsightSchema>;
export type DeveloperSummary = z.infer<typeof DeveloperSummarySchema>;
export type DeveloperTeamCard = z.infer<typeof DeveloperTeamCardSchema>;
export type DeveloperDetails = z.infer<typeof DeveloperDetailsSchema>;
export type DeveloperSession = z.infer<typeof DeveloperSessionSchema>;
export type DeveloperProject = z.infer<typeof DeveloperProjectSchema>;
export type DeveloperTrendDataPoint = z.infer<
	typeof DeveloperTrendDataPointSchema
>;
export type ProjectInvestment = z.infer<typeof ProjectInvestmentSchema>;
export type ProjectDetailData = z.infer<typeof ProjectDetailDataSchema>;
export type ProjectContributor = z.infer<typeof ProjectContributorSchema>;
export type ProjectTrendDataPoint = z.infer<typeof ProjectTrendDataPointSchema>;
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
export type ROIDashboard = z.infer<typeof ROIDashboardSchema>;
export type ROIMetrics = z.infer<typeof ROIMetricsSchema>;
export type ROITrend = z.infer<typeof ROITrendSchema>;
export type DeveloperCostBreakdown = z.infer<
	typeof DeveloperCostBreakdownSchema
>;
export type ProjectCostBreakdown = z.infer<typeof ProjectCostBreakdownSchema>;
export type ErrorsDashboardSummary = z.infer<
	typeof ErrorsDashboardSummarySchema
>;
export type ErrorsDashboard = z.infer<typeof ErrorsDashboardSchema>;
export type RecurringError = z.infer<typeof RecurringErrorSchema>;
export type ErrorTrendDataPoint = z.infer<typeof ErrorTrendDataPointSchema>;
export type LearningEntry = z.infer<typeof LearningEntrySchema>;
export type LearningsFeedStats = z.infer<typeof LearningsFeedStatsSchema>;
export type TeamSummaryComparison = z.infer<typeof TeamSummaryComparisonSchema>;
export type SuccessRate = z.infer<typeof SuccessRateSchema>;
export type DeveloperTimeline = z.infer<typeof DeveloperTimelineSchema>;
export type DeveloperFeatureUsage = z.infer<typeof DeveloperFeatureUsageSchema>;
export type DeveloperError = z.infer<typeof DeveloperErrorSchema>;
export type ProjectFeatureUsage = z.infer<typeof ProjectFeatureUsageSchema>;
export type ProjectError = z.infer<typeof ProjectErrorSchema>;
export type SessionAnalyticsSummary = z.infer<
	typeof SessionAnalyticsSummarySchema
>;
export type SessionAnalyticsSummaryComparison = z.infer<
	typeof SessionAnalyticsSummaryComparisonSchema
>;
export type LearningsTrendDataPoint = z.infer<
	typeof LearningsTrendDataPointSchema
>;
export type DimensionAnalysisInput = z.infer<
	typeof DimensionAnalysisInputSchema
>;
