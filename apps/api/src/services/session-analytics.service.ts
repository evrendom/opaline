import {
	type DimensionAnalysisInput,
	resolveRepoIdentity,
	type SessionAnalyticsSummary as SessionAnalyticsSummaryBase,
	type SessionListFilters,
	type SessionOverviewAnalytics,
	type Source,
} from "@rudel/api-routes";
import {
	addOptionalStringEqFilter,
	buildDateFilter,
	buildInclusiveDateRangeFilter,
	queryClickhouse,
} from "../clickhouse.js";
import { shouldUsePersistentSkillAnalytics } from "../lib/env.js";
import { getRepositorySqlFilter } from "./repository-filter.service.js";
import { buildSessionFamilyCostCte } from "./session-family-cost.service.js";
import { buildSessionHasSubagentsSql } from "./session-lineage-analytics.service.js";
import {
	appendSessionListSqlFilters,
	getSessionListRepositoryKey,
} from "./session-list-filters.js";
import { buildActiveSkillUsesCte } from "./skill-extraction-ingest.service.js";
import { getUsageAnalyticsQueryContext } from "./usage-event-analytics.service.js";

export interface SessionAnalyticsRaw {
	source: Source;
	session_id: string;
	user_id: string;
	session_date: string;
	project_path: string;
	organization_id: string;
	git_remote: string;
	package_name: string;

	// Interaction timing metrics
	total_interactions: number;
	avg_period_sec: number;
	median_period_sec: number;
	quick_responses: number;
	normal_responses: number;
	long_pauses: number;
	actual_duration_min: number;

	// Duration metrics
	last_interaction_date: string;

	// Token metrics
	total_tokens: number;
	input_tokens: number;
	output_tokens: number;
	estimated_cost: number | null;
	cost_is_complete: number;
	cost_uses_default_region: number;

	// Git activity
	git_sha: string;
	git_branch: string;
	has_commit: number;

	// Feature arrays
	subagent_types: string[];
	subagent_count: number;
	native_subagents?: Array<readonly [string, string]>;
	native_child_sessions?: Array<readonly [string, string]>;
	native_parent_session_id?: string;
	is_top_level_session?: number;
	linked_subagent_count?: number;
	linked_subagents?: Array<
		readonly [
			string,
			"claude" | "codex",
			"claude" | "openai",
			string,
			"id_echo" | "prompt_echo" | "attested_temporal",
		]
	>;
	skills: string[];
	slash_commands: string[];

	// Success metrics
	success_score: number;

	// Effectiveness correlation factors
	error_count: number;
	model_used: string;
	used_plan_mode: number;

	// Persisted language-signal counts
	member_swears: number;
	member_apologies: number;
	member_positive: number;
	model_swears: number;
	model_apologies: number;
	model_positive: number;
	member_swear_matches: string[];
	member_apology_matches: string[];
	member_positive_matches: string[];
	model_swear_matches: string[];
	model_apology_matches: string[];
	model_positive_matches: string[];
}

const PERSISTED_SIGNAL_FIELDS = [
	"member_swears",
	"member_apologies",
	"member_positive",
	"model_swears",
	"model_apologies",
	"model_positive",
	"member_swear_matches",
	"member_apology_matches",
	"member_positive_matches",
	"model_swear_matches",
	"model_apology_matches",
	"model_positive_matches",
] as const;
type PersistedSessionLanguageSignals = Pick<
	SessionAnalyticsRaw,
	(typeof PERSISTED_SIGNAL_FIELDS)[number]
>;
export interface SessionAnalyticsListRow
	extends Omit<SessionAnalyticsRaw, keyof PersistedSessionLanguageSignals> {
	signal_session_date: string;
}
const SIGNAL_LOOKUP_BATCH_SIZE = 64;
const SIGNAL_LOOKUP_CONCURRENCY = 4;
const SIGNAL_LOOKUP_PARAMETER_BUDGET = 6_000;

const EMPTY_SESSION_LANGUAGE_SIGNALS: PersistedSessionLanguageSignals = {
	member_swears: 0,
	member_apologies: 0,
	member_positive: 0,
	model_swears: 0,
	model_apologies: 0,
	model_positive: 0,
	member_swear_matches: [],
	member_apology_matches: [],
	member_positive_matches: [],
	model_swear_matches: [],
	model_apology_matches: [],
	model_positive_matches: [],
};

export interface SessionAnalyticsSummary extends SessionAnalyticsSummaryBase {
	total_interactions: number;
	avg_interactions_per_session: number;
	median_response_time_sec: number;
	quick_response_rate: number;
	long_pause_rate: number;
}

export function mapSessionAnalyticsRow(
	row: SessionAnalyticsRaw,
): SessionOverviewAnalytics {
	const repositoryIdentity = resolveRepoIdentity({
		gitRemote: row.git_remote || null,
		packageName: row.package_name || null,
		projectPath: row.project_path,
	});

	return {
		source: row.source,
		session_id: row.session_id,
		user_id: row.user_id,
		session_date: row.session_date,
		project_path: row.project_path,
		repository: repositoryIdentity.repoLabel,
		repository_identity: repositoryIdentity,
		worktree: repositoryIdentity.worktree,
		git_remote: row.git_remote || undefined,
		git_branch: row.git_branch || null,
		duration_min: row.actual_duration_min,
		total_tokens: row.total_tokens,
		input_tokens: row.input_tokens,
		output_tokens: row.output_tokens,
		estimated_cost: row.cost_is_complete > 0 ? row.estimated_cost : null,
		cost_uses_default_region: row.cost_uses_default_region > 0,
		success_score: row.success_score,
		total_interactions: row.total_interactions,
		avg_period_sec: row.avg_period_sec,
		subagent_types: row.subagent_types,
		subagent_count: row.subagent_count,
		native_subagents: (row.native_subagents ?? []).map(
			([subagent_id, model]) => ({
				subagent_id,
				model: model || null,
			}),
		),
		native_child_sessions: (row.native_child_sessions ?? []).map(
			([session_id, model]) => ({ model, session_id }),
		),
		linked_subagent_count: row.linked_subagent_count ?? 0,
		linked_subagents: (row.linked_subagents ?? []).map(
			([session_id, source, provider, model, confidence]) => ({
				confidence,
				model,
				provider,
				session_id,
				source,
			}),
		),
		skills: row.skills,
		slash_commands: row.slash_commands,
		has_commit: row.has_commit > 0,
		error_count: row.error_count,
		model_used: row.model_used,
		used_plan_mode: row.used_plan_mode > 0,
		member_swears: row.member_swears,
		member_apologies: row.member_apologies,
		member_positive: row.member_positive,
		model_swears: row.model_swears,
		model_apologies: row.model_apologies,
		model_positive: row.model_positive,
		member_swear_matches: row.member_swear_matches,
		member_apology_matches: row.member_apology_matches,
		member_positive_matches: row.member_positive_matches,
		model_swear_matches: row.model_swear_matches,
		model_apology_matches: row.model_apology_matches,
		model_positive_matches: row.model_positive_matches,
	};
}

/**
 * Get session analytics from the materialized view
 */
async function getSessionAnalyticsBaseRows(
	orgId: string,
	params: {
		filters?: SessionListFilters;
		skill_name?: string;
		days?: number;
		start_date?: string;
		end_date?: string;
		user_id?: string;
		project_path?: string;
		repository?: string;
		repo_key?: string;
		source?: string;
		limit?: number;
		offset?: number;
		sort_by?: "date" | "duration" | "interactions";
		sort_order?: "asc" | "desc";
	} = {},
): Promise<SessionAnalyticsListRow[]> {
	const {
		filters: overviewFilters,
		skill_name,
		days = 30,
		start_date,
		end_date,
		user_id,
		project_path,
		repository,
		repo_key,
		source,
		limit = 50,
		offset = 0,
		sort_by = "date",
		sort_order = "desc",
	} = params;

	const d = Number(days);
	const query_params: Record<string, unknown> = {
		days: d,
		limit: Number(limit),
		offset: Number(offset),
		orgId,
	};
	// An explicit window wins over the rolling `days` lookback so a range that
	// does not end today returns that window rather than the last N days.
	const hasAbsoluteRange = Boolean(start_date && end_date);

	if (hasAbsoluteRange) {
		query_params.startDate = start_date;
		query_params.endDate = end_date;
	}

	const dateFilter = hasAbsoluteRange
		? buildInclusiveDateRangeFilter("startDate", "endDate", "sa.session_date")
		: buildDateFilter("days", "sa.session_date");
	const filters: string[] = [];
	const useSkillReceipts =
		Boolean(skill_name) && shouldUsePersistentSkillAnalytics(orgId);
	if (skill_name) {
		query_params.skillName = skill_name;
		query_params.organizationId = orgId;
		filters.push(
			useSkillReceipts
				? `(sa.user_id, sa.source, sa.session_id) IN (
				SELECT user_id, if(agent = 'claude', 'claude_code', 'codex'), session_id
				FROM active_skill_uses
			)`
				: "has(sa.skills, {skillName:String})",
		);
	}
	addOptionalStringEqFilter(
		filters,
		query_params,
		"sa.user_id",
		"userId",
		user_id,
	);
	addOptionalStringEqFilter(
		filters,
		query_params,
		"project_path",
		"projectPath",
		project_path,
	);
	if (repo_key) {
		const repoFilter = await getRepositorySqlFilter(orgId, repo_key);
		filters.push(repoFilter.sql);
		Object.assign(query_params, repoFilter.params);
	}
	if (repository) {
		filters.push(
			"(git_remote = {repository:String} OR package_name = {repository:String} OR project_path = {repository:String})",
		);
		query_params.repository = repository;
	}
	addOptionalStringEqFilter(
		filters,
		query_params,
		"sa.source",
		"source",
		source,
	);

	if (overviewFilters)
		appendSessionListSqlFilters(overviewFilters, filters, query_params);
	const filterRepositories =
		(overviewFilters?.excluded.repository.length ?? 0) > 0;

	const sortColumn =
		sort_by === "duration"
			? "actual_duration_min"
			: sort_by === "interactions"
				? "total_interactions"
				: "sa.session_date";
	const sortDirection = sort_order === "asc" ? "ASC" : "DESC";
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		sourceParam: source ? "source" : undefined,
		userIdParam: user_id ? "userId" : undefined,
	});
	const estimatedCostSql = "sa.estimated_cost";

	const query = `
		WITH RECURSIVE ${usage.cteDefinitions},
		${buildSessionFamilyCostCte({
			inputRelation: usage.sessionsRelation,
			outputRelation: "session_list_costs",
			rootFilterSql: `sa.is_top_level_session = 1 AND ${dateFilter}`,
			rootRelation: undefined,
		})}
		${useSkillReceipts ? `, ${buildActiveSkillUsesCte({ filterSkillName: true })}` : ""}
	    SELECT
	      sa.source AS source,
	      sa.session_id AS session_id,
	      sa.user_id AS user_id,
      formatDateTime(sa.session_date, '%Y-%m-%dT%H:%i:%SZ') as session_date,
      toString(sa.session_date) AS signal_session_date,
      project_path,
      sa.organization_id AS organization_id,
      git_remote,
      package_name,
      total_interactions,
      avg_period_sec,
      median_period_sec,
      quick_responses,
      normal_responses,
      long_pauses,
      actual_duration_min,
      formatDateTime(sa.last_interaction_date, '%Y-%m-%dT%H:%i:%SZ') as last_interaction_date,
      total_tokens,
      input_tokens,
      output_tokens,
	  ${estimatedCostSql} AS estimated_cost,
	  sa.cost_is_complete AS cost_is_complete,
	  sa.cost_uses_default_region AS cost_uses_default_region,
      git_sha,
      git_branch,
	      has_commit,
	      subagent_types,
	      subagent_count,
	      native_subagents,
	      native_child_sessions,
	      linked_subagent_count,
	      linked_subagents,
	      skills,
      slash_commands,
      success_score,
      error_count,
      model_used,
	      used_plan_mode
	    FROM session_list_costs AS sa
    WHERE ${dateFilter}
      AND sa.organization_id = {orgId:String}
	  AND sa.is_top_level_session = 1
      ${filters.length > 0 ? `AND ${filters.join("\n      AND ")}` : ""}
    ORDER BY ${sortColumn} ${sortDirection}, sa.source ASC, sa.session_id ASC
    ${filterRepositories ? "" : "LIMIT {limit:UInt32} OFFSET {offset:UInt32}"}
  `;

	const rows = await queryClickhouse<SessionAnalyticsListRow>({
		clickhouse_settings: { join_use_nulls: 0 },
		query,
		query_params,
	});

	const excludedRepositories = new Set(overviewFilters?.excluded.repository);
	return overviewFilters && filterRepositories
		? rows
				.filter(
					(row) => !excludedRepositories.has(getSessionListRepositoryKey(row)),
				)
				.slice(offset, offset + limit)
		: rows;
}

export async function getSessionAnalytics(
	orgId: string,
	params: Parameters<typeof getSessionAnalyticsBaseRows>[1] = {},
): Promise<SessionOverviewAnalytics[]> {
	const raw = await getSessionAnalyticsBaseRows(orgId, params);

	// Query parameters travel in the ClickHouse HTTP URL. Split large pages so
	// metadata lookups stay below proxy URL limits, with bounded concurrency.
	// Send each exact identity once instead of repeating the IDs in a second
	// parameter. A normal 50-session page fits in one metadata request while
	// long IDs still respect the same proxy-safe byte budget. These queries
	// only read signal metadata, never session transcripts.
	const signalKey = (
		row: Pick<
			SessionAnalyticsListRow,
			"source" | "session_id" | "signal_session_date"
		>,
	) => [row.source, row.session_id, row.signal_session_date].join("\u0000");
	// JSON escaping plus URL encoding conservatively sizes ClickHouse string
	// parameters; ClickHouse also escapes single quotes, so account for those.
	const parameterSize = (value: string) =>
		new URLSearchParams({ value: JSON.stringify(value) }).toString().length +
		value.split("'").length * 3;
	const batches: SessionAnalyticsListRow[][] = [];
	let batch: SessionAnalyticsListRow[] = [];
	let batchSize = 0;
	for (const row of raw) {
		const rowSize = parameterSize(signalKey(row));
		if (
			batch.length > 0 &&
			(batch.length >= SIGNAL_LOOKUP_BATCH_SIZE ||
				batchSize + rowSize > SIGNAL_LOOKUP_PARAMETER_BUDGET)
		) {
			batches.push(batch);
			batch = [];
			batchSize = 0;
		}
		batch.push(row);
		batchSize += rowSize;
	}
	if (batch.length > 0) batches.push(batch);
	type SignalRow = PersistedSessionLanguageSignals &
		Pick<
			SessionAnalyticsListRow,
			"source" | "session_id" | "user_id" | "signal_session_date"
		>;
	const signalRows: SignalRow[] = [];
	for (
		let offset = 0;
		offset < batches.length;
		offset += SIGNAL_LOOKUP_CONCURRENCY
	) {
		const results = await Promise.all(
			batches.slice(offset, offset + SIGNAL_LOOKUP_CONCURRENCY).map((batch) => {
				const dates = batch.map((row) => row.signal_session_date).sort();
				return queryClickhouse<SignalRow>({
					query: `
			SELECT source, session_id, user_id,
				toString(session_date) AS signal_session_date,
				${PERSISTED_SIGNAL_FIELDS.join(", ")}
			FROM rudel.session_language_signals FINAL
			PREWHERE organization_id = {orgId:String}
				AND session_date >= toDateTime64({signalFrom:String}, 3, 'UTC')
				AND session_date <= toDateTime64({signalTo:String}, 3, 'UTC')
			WHERE concat(source, '\\0', session_id, '\\0', toString(session_date)) IN ({signalKeys:Array(String)})
			LIMIT {signalLimit:UInt32}
		`,
					query_params: {
						orgId,
						signalFrom: dates[0],
						signalTo: dates.at(-1),
						signalKeys: batch.map(signalKey),
						signalLimit: batch.length,
					},
				});
			}),
		);
		signalRows.push(...results.flat());
	}
	const signalsByKey = new Map(signalRows.map((row) => [signalKey(row), row]));

	return raw.map((baseRow) => {
		const storedSignals = signalsByKey.get(signalKey(baseRow));
		const signals =
			storedSignals?.user_id === baseRow.user_id
				? storedSignals
				: EMPTY_SESSION_LANGUAGE_SIGNALS;
		return mapSessionAnalyticsRow({ ...baseRow, ...signals });
	});
}

/**
 * Get summary statistics from session analytics
 */
export async function getSessionAnalyticsSummary(
	orgId: string,
	params: {
		days?: number;
		user_id?: string;
		project_path?: string;
	} = {},
): Promise<SessionAnalyticsSummary> {
	const { days = 30, user_id, project_path } = params;
	const d = Number(days);
	const query_params: Record<string, unknown> = {
		days: d,
		orgId,
	};
	const filters: string[] = [];
	addOptionalStringEqFilter(
		filters,
		query_params,
		"sa.user_id",
		"userId",
		user_id,
	);
	addOptionalStringEqFilter(
		filters,
		query_params,
		"sa.project_path",
		"projectPath",
		project_path,
	);
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		userIdParam: user_id ? "userId" : undefined,
	});

	const query = `
	    WITH ${usage.cteDefinitions},
	    totals AS (
      SELECT
		countIf(sa.is_top_level_session = 1) as cnt_sessions,
		SUM(sa.total_interactions) as sum_interactions,
		SUM(sa.quick_responses) as sum_quick_responses,
		SUM(sa.long_pauses) as sum_long_pauses,
		ifNull(avgIf(sa.actual_duration_min, sa.is_top_level_session = 1), 0) as avg_duration,
		ifNull(avgIf(sa.total_interactions, sa.is_top_level_session = 1), 0) as avg_interactions,
		ifNull(avgIf(sa.avg_period_sec, sa.is_top_level_session = 1), 0) as avg_response,
		ifNull(avgIf(sa.median_period_sec, sa.is_top_level_session = 1), 0) as med_response,
	        countIf(sa.is_top_level_session = 1 AND ${buildSessionHasSubagentsSql("sa")}) as cnt_subagents,
		countIf(sa.is_top_level_session = 1 AND length(sa.skills) > 0) as cnt_skills,
		countIf(sa.is_top_level_session = 1 AND length(sa.slash_commands) > 0) as cnt_slash
	      FROM ${usage.sessionsRelation} AS sa
	  WHERE ${buildDateFilter("days", "sa.session_date")}
		AND sa.organization_id = {orgId:String}
        ${filters.length > 0 ? `AND ${filters.join("\n        AND ")}` : ""}
    )
    SELECT
      cnt_sessions as total_sessions,
      sum_interactions as total_interactions,
      ifNull(round(avg_duration, 2), 0) as avg_session_duration_min,
      ifNull(round(avg_interactions, 2), 0) as avg_interactions_per_session,
      ifNull(round(avg_response, 2), 0) as avg_response_time_sec,
      ifNull(round(med_response, 2), 0) as median_response_time_sec,
      round(sum_quick_responses * 100.0 / if(sum_interactions > 0, sum_interactions, 1), 2) as quick_response_rate,
      round(sum_long_pauses * 100.0 / if(sum_interactions > 0, sum_interactions, 1), 2) as long_pause_rate,
      round(cnt_subagents * 100.0 / if(cnt_sessions > 0, cnt_sessions, 1), 2) as subagents_adoption_rate,
      round(cnt_skills * 100.0 / if(cnt_sessions > 0, cnt_sessions, 1), 2) as skills_adoption_rate,
      round(cnt_slash * 100.0 / if(cnt_sessions > 0, cnt_sessions, 1), 2) as slash_commands_adoption_rate
    FROM totals
  `;

	const results = await queryClickhouse<SessionAnalyticsSummary>({
		query,
		query_params,
	});

	const defaults: SessionAnalyticsSummary = {
		total_sessions: 0,
		total_interactions: 0,
		avg_session_duration_min: 0,
		avg_interactions_per_session: 0,
		avg_response_time_sec: 0,
		median_response_time_sec: 0,
		quick_response_rate: 0,
		long_pause_rate: 0,
		subagents_adoption_rate: 0,
		skills_adoption_rate: 0,
		slash_commands_adoption_rate: 0,
	};

	if (results.length === 0) {
		return defaults;
	}

	// Coalesce nulls from ClickHouse (AVG on 0 rows returns null despite ifNull)
	const row = results[0] as Record<string, unknown> | undefined;
	if (!row) return defaults;
	return Object.fromEntries(
		Object.entries(defaults).map(([key, def]) => [key, row[key] ?? def]),
	) as SessionAnalyticsSummary;
}

export type SessionSummaryComparisonPeriod = SessionAnalyticsSummaryBase;

/**
 * Get session analytics summary with period-over-period comparison
 */
export async function getSessionAnalyticsSummaryComparison(
	orgId: string,
	params: {
		days?: number;
		user_id?: string;
		project_path?: string;
	} = {},
) {
	const { days = 7, user_id, project_path } = params;
	const d = Number(days);
	const previousDays = d * 2;
	const baseParams: Record<string, unknown> = {
		currentDays: d,
		previousDays,
		orgId,
	};
	const filters: string[] = [];
	addOptionalStringEqFilter(
		filters,
		baseParams,
		"sa.user_id",
		"userId",
		user_id,
	);
	addOptionalStringEqFilter(
		filters,
		baseParams,
		"sa.project_path",
		"projectPath",
		project_path,
	);
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		userIdParam: user_id ? "userId" : undefined,
	});

	const summarySQL = (dateCondition: string) => `
	    WITH ${usage.cteDefinitions},
	    totals AS (
      SELECT
		countIf(sa.is_top_level_session = 1) as cnt_sessions,
		ifNull(avgIf(sa.actual_duration_min, sa.is_top_level_session = 1), 0) as avg_duration,
		ifNull(avgIf(sa.avg_period_sec, sa.is_top_level_session = 1), 0) as avg_response,
	        countIf(sa.is_top_level_session = 1 AND ${buildSessionHasSubagentsSql("sa")}) as cnt_subagents,
		countIf(sa.is_top_level_session = 1 AND length(sa.skills) > 0) as cnt_skills,
		countIf(sa.is_top_level_session = 1 AND length(sa.slash_commands) > 0) as cnt_slash
	      FROM ${usage.sessionsRelation} AS sa
      WHERE ${dateCondition}
		AND sa.organization_id = {orgId:String}
        ${filters.length > 0 ? `AND ${filters.join("\n        AND ")}` : ""}
    )
    SELECT
      cnt_sessions as total_sessions,
      ifNull(round(avg_duration, 2), 0) as avg_session_duration_min,
      ifNull(round(avg_response, 2), 0) as avg_response_time_sec,
      round(cnt_subagents * 100.0 / if(cnt_sessions > 0, cnt_sessions, 1), 2) as subagents_adoption_rate,
      round(cnt_skills * 100.0 / if(cnt_sessions > 0, cnt_sessions, 1), 2) as skills_adoption_rate,
      round(cnt_slash * 100.0 / if(cnt_sessions > 0, cnt_sessions, 1), 2) as slash_commands_adoption_rate
    FROM totals
  `;

	const currentQuery = summarySQL(
		buildDateFilter("currentDays", "sa.session_date"),
	);
	const previousQuery = summarySQL(
		"sa.session_date >= now64(3) - toIntervalDay({previousDays:UInt32}) AND sa.session_date < now64(3) - toIntervalDay({currentDays:UInt32})",
	);

	const [currentData, previousData] = await Promise.all([
		queryClickhouse<SessionSummaryComparisonPeriod>({
			query: currentQuery,
			query_params: baseParams,
		}),
		queryClickhouse<SessionSummaryComparisonPeriod>({
			query: previousQuery,
			query_params: baseParams,
		}),
	]);

	const defaultPeriod: SessionSummaryComparisonPeriod = {
		total_sessions: 0,
		avg_session_duration_min: 0,
		avg_response_time_sec: 0,
		subagents_adoption_rate: 0,
		skills_adoption_rate: 0,
		slash_commands_adoption_rate: 0,
	};

	// Coalesce nulls from ClickHouse (AVG on 0 rows returns null despite ifNull)
	const coalesce = (
		row: SessionSummaryComparisonPeriod | undefined,
	): SessionSummaryComparisonPeriod => {
		if (!row) return { ...defaultPeriod };
		return Object.fromEntries(
			Object.entries(defaultPeriod).map(([key, def]) => [
				key,
				(row as unknown as Record<string, unknown>)[key] ?? def,
			]),
		) as SessionSummaryComparisonPeriod;
	};
	const current = coalesce(currentData[0]);
	const previous = coalesce(previousData[0]);

	const calculateChange = (curr: number, prev: number) => {
		if (!prev || prev === 0) return 0;
		return ((curr - prev) / prev) * 100;
	};

	const changes = {
		total_sessions: calculateChange(
			current.total_sessions || 0,
			previous.total_sessions || 0,
		),
		avg_session_duration_min: calculateChange(
			current.avg_session_duration_min || 0,
			previous.avg_session_duration_min || 0,
		),
		avg_response_time_sec: calculateChange(
			current.avg_response_time_sec || 0,
			previous.avg_response_time_sec || 0,
		),
	};

	return { current, previous, changes };
}

/**
 * Get interaction timing distribution
 */
export async function getInteractionTimingDistribution(
	orgId: string,
	params: {
		days?: number;
		user_id?: string;
		project_path?: string;
	} = {},
): Promise<Array<{ bucket: string; count: number; percentage: number }>> {
	const { days = 30, user_id, project_path } = params;
	const d = Number(days);
	const query_params: Record<string, unknown> = {
		days: d,
		orgId,
	};
	const filters: string[] = [];
	addOptionalStringEqFilter(
		filters,
		query_params,
		"user_id",
		"userId",
		user_id,
	);
	addOptionalStringEqFilter(
		filters,
		query_params,
		"project_path",
		"projectPath",
		project_path,
	);
	const filterSql =
		filters.length > 0 ? `AND ${filters.join("\n        AND ")}` : "";
	const repeatedFilterSql =
		filters.length > 0 ? `AND ${filters.join("\n      AND ")}` : "";

	const query = `
    WITH total AS (
      SELECT SUM(total_interactions) as total_count
      FROM rudel.session_analytics FINAL
      WHERE ${buildDateFilter("days")}
        AND organization_id = {orgId:String}
        ${filterSql}
    )
    SELECT
      'Instant (< 5s)' as bucket,
      SUM(quick_responses) as count,
      round(SUM(quick_responses) * 100.0 / (SELECT total_count FROM total), 2) as percentage
    FROM rudel.session_analytics FINAL
    WHERE ${buildDateFilter("days")}
      AND organization_id = {orgId:String}
      ${repeatedFilterSql}

    UNION ALL

    SELECT
      'Normal (5-60s)' as bucket,
      SUM(normal_responses) as count,
      round(SUM(normal_responses) * 100.0 / (SELECT total_count FROM total), 2) as percentage
    FROM rudel.session_analytics FINAL
    WHERE ${buildDateFilter("days")}
      AND organization_id = {orgId:String}
      ${repeatedFilterSql}

    UNION ALL

    SELECT
      'Long Pause (> 5m)' as bucket,
      SUM(long_pauses) as count,
      round(SUM(long_pauses) * 100.0 / (SELECT total_count FROM total), 2) as percentage
    FROM rudel.session_analytics FINAL
    WHERE ${buildDateFilter("days")}
      AND organization_id = {orgId:String}
      ${repeatedFilterSql}

    ORDER BY count DESC
  `;

	return queryClickhouse<{ bucket: string; count: number; percentage: number }>(
		{
			query,
			query_params,
		},
	);
}

/**
 * Get flexible dimension analysis with optional split-by for stacked charts
 */

// Map metric to SQL expression
const METRIC_EXPRESSIONS: Record<DimensionAnalysisInput["metric"], string> = {
	session_count: "COUNT(*)",
	avg_duration: "round(AVG(actual_duration_min), 2)",
	total_duration: "round(SUM(actual_duration_min) / 60, 2)",
	avg_interactions: "round(AVG(total_interactions), 2)",
	total_interactions: "SUM(total_interactions)",
	avg_response_time: "round(AVG(avg_period_sec), 2)",
	median_response_time: "round(AVG(median_period_sec), 2)",
	avg_tokens: "round(AVG(total_tokens), 0)",
	total_tokens: "SUM(total_tokens)",
	avg_success_score: "round(AVG(success_score), 2)",
	avg_errors: "round(AVG(error_count), 2)",
	total_errors: "SUM(error_count)",
};

const SESSION_SCOPED_DIMENSION_METRICS = new Set<
	DimensionAnalysisInput["metric"]
>([
	"session_count",
	"avg_duration",
	"avg_interactions",
	"avg_response_time",
	"median_response_time",
	"avg_tokens",
	"avg_success_score",
	"avg_errors",
]);

const DIMENSION_EXPRESSIONS: Record<
	DimensionAnalysisInput["dimension"],
	string
> = {
	user_id: "user_id",
	project_path: "arrayElement(splitByChar('/', project_path), -1)",
	repository:
		"if(git_remote != '', git_remote, if(package_name != '', package_name, project_path))",
	model_used: "model_used",
	has_commit: "has_commit",
	used_plan_mode: "used_plan_mode",
	used_skills: "if(length(skills) > 0, 1, 0)",
	used_slash_commands: "if(length(slash_commands) > 0, 1, 0)",
	used_subagents: `if(${buildSessionHasSubagentsSql("sa")}, 1, 0)`,
};

export async function getSessionDimensionAnalysis(
	orgId: string,
	params: {
		days?: number;
		dimension: DimensionAnalysisInput["dimension"];
		metric: DimensionAnalysisInput["metric"];
		split_by?: DimensionAnalysisInput["dimension"];
		limit?: number;
		user_id?: string;
		project_path?: string;
	},
) {
	const {
		days = 7,
		dimension,
		metric,
		split_by,
		limit = 10,
		user_id,
		project_path,
	} = params;
	const d = Number(days);
	const query_params: Record<string, unknown> = {
		days: d,
		limit: Number(limit),
		orgId,
	};

	const metricExpression = METRIC_EXPRESSIONS[metric];
	const dimensionExpression = DIMENSION_EXPRESSIONS[dimension];
	const splitByExpression = split_by ? DIMENSION_EXPRESSIONS[split_by] : null;
	const topLevelMetricFilter = SESSION_SCOPED_DIMENSION_METRICS.has(metric)
		? "AND sa.is_top_level_session = 1"
		: "";

	const filters: string[] = [];
	addOptionalStringEqFilter(
		filters,
		query_params,
		"sa.user_id",
		"userId",
		user_id,
	);
	addOptionalStringEqFilter(
		filters,
		query_params,
		"sa.project_path",
		"projectPath",
		project_path,
	);

	let query: string;
	const usage = await getUsageAnalyticsQueryContext(
		orgId,
		user_id ? { userIdParam: "userId" } : {},
	);

	if (split_by) {
		query = `
	  WITH ${usage.cteDefinitions}
      SELECT
        ${dimensionExpression} as dimension_value,
        ${splitByExpression} as split_value,
        ${metricExpression} as metric_value
      FROM ${usage.sessionsRelation} AS sa
      WHERE ${buildDateFilter("days")}
        AND sa.organization_id = {orgId:String}
		${topLevelMetricFilter}
        ${filters.length > 0 ? `AND ${filters.join("\n        AND ")}` : ""}
      GROUP BY dimension_value, split_value
      ORDER BY metric_value DESC
    `;
	} else {
		query = `
	  WITH ${usage.cteDefinitions}
      SELECT
        ${dimensionExpression} as dimension_value,
        ${metricExpression} as metric_value
      FROM ${usage.sessionsRelation} AS sa
      WHERE ${buildDateFilter("days")}
        AND sa.organization_id = {orgId:String}
		${topLevelMetricFilter}
        ${filters.length > 0 ? `AND ${filters.join("\n        AND ")}` : ""}
      GROUP BY dimension_value
      ORDER BY metric_value DESC
      LIMIT {limit:UInt32}
    `;
	}

	interface DimensionRow {
		dimension_value: string;
		split_value?: string;
		metric_value: number;
	}

	const results = await queryClickhouse<DimensionRow>({
		query,
		query_params,
	});

	if (split_by) {
		const grouped = new Map<string, Record<string, number>>();
		const totalMetric = new Map<string, number>();

		for (const row of results) {
			const dimVal = String(row.dimension_value);
			const splitVal = String(row.split_value);
			const metricVal = Number(row.metric_value);

			if (!grouped.has(dimVal)) {
				grouped.set(dimVal, {});
				totalMetric.set(dimVal, 0);
			}

			const group = grouped.get(dimVal);
			if (group) group[splitVal] = metricVal;
			totalMetric.set(dimVal, (totalMetric.get(dimVal) || 0) + metricVal);
		}

		const finalData = Array.from(grouped.entries())
			.map(([dimension_value, split_values]) => ({
				dimension_value,
				split_values,
				_total: totalMetric.get(dimension_value) || 0,
			}))
			.sort((a, b) => b._total - a._total)
			.slice(0, Number(limit))
			.map(({ dimension_value, split_values }) => ({
				dimension_value,
				split_values,
			}));

		return finalData;
	}

	return results.map((row) => ({
		dimension_value: String(row.dimension_value),
		metric_value: Number(row.metric_value),
	}));
}
