import type { RepositoryOverview } from "@rudel/api-routes";
import {
	buildInclusiveDateTimeRangeFilter,
	queryClickhouse,
} from "../clickhouse.js";
import {
	getRepositorySqlFilter,
	REPOSITORY_QUERY_SETTINGS,
} from "./repository-filter.service.js";
import {
	EMPTY_REPOSITORY_OVERVIEW,
	type RepositoryOverviewRow,
	shapeRepositoryOverview,
} from "./repository-overview.js";
import { buildSessionFamilyCostCte } from "./session-family-cost.service.js";
import {
	buildSessionAnalyticsWindowSql,
	getUsageAnalyticsQueryContext,
} from "./usage-event-analytics.service.js";

/**
 * One repository over an inclusive UTC date range, scoped exactly as the
 * session list's `repoKey` + `startDate`/`endDate` filter (top-level sessions
 * only, by `toDate(session_date)`, with native subagent costs rolled into
 * their parent), so `stats.sessionCount` equals the rows that list returns.
 * Day, day x model, model, member and overall aggregates come from one
 * GROUPING SETS query. Costs sum priced sessions only; any unpriced session
 * nulls a total and flags its day.
 */
export async function getRepositoryOverview(
	orgId: string,
	input: { repoKey: string; startDate: string; endDate: string },
): Promise<RepositoryOverview> {
	const repoFilter = await getRepositorySqlFilter(orgId, input.repoKey);
	if (repoFilter.params.repositoryFingerprints.length === 0)
		return EMPTY_REPOSITORY_OVERVIEW;
	const windowFilter = `${buildInclusiveDateTimeRangeFilter("startDate", "endDate", "sa.session_date")}
	  AND ${repoFilter.sql}`;
	// Price only this repository's sessions in the range and their native
	// descendants, not the organization's whole history.
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		window: {
			includeNativeDescendants: true,
			sessionsSql: buildSessionAnalyticsWindowSql(windowFilter),
		},
	});
	const sessionFilter = `sa.organization_id = {orgId:String}
	  AND sa.is_top_level_session = 1
	  AND ${windowFilter}`;
	const rows = await queryClickhouse<RepositoryOverviewRow>({
		clickhouse_settings: {
			...REPOSITORY_QUERY_SETTINGS,
			log_comment: "analytics.repositories.overview",
		},
		query: `WITH RECURSIVE ${usage.cteDefinitions},
   ${buildSessionFamilyCostCte({
			inputRelation: usage.sessionsRelation,
			outputRelation: "repository_overview_costs",
			rootFilterSql: sessionFilter,
			rootRelation: usage.metadataRelation,
		})}
   SELECT
    multiIf(grouping(day) = 0 AND grouping(model) = 0, 'day_model',
     grouping(day) = 0, 'day', grouping(model) = 0, 'model',
     grouping(member) = 0, 'member', 'total') AS grouping_kind,
    day, model, member,
    count() AS session_count,
    countIf(session_errors > 0) AS errored_session_count,
    sum(session_errors) AS error_count,
    sum(session_turns) AS turn_count,
    sum(session_tokens) AS total_tokens,
    sum(session_cost) AS estimated_cost,
    countIf(session_cost_complete = 0) AS incomplete_costs,
    uniqExact(member) AS user_count,
    quantilesExact(0.5, 0.95)(session_duration) AS duration_quantiles,
    if(countIf(session_cost_complete = 1 AND session_cost > 0) = 0, CAST([] AS Array(Float64)),
     quantilesExactIf(0.2, 0.4, 0.6, 0.8)(session_cost, session_cost_complete = 1 AND session_cost > 0)
    ) AS cost_session_quantiles,
    if(countIf(session_duration > 0) = 0, CAST([] AS Array(Float64)),
     quantilesExactIf(0.2, 0.4, 0.6, 0.8)(session_duration, session_duration > 0)
    ) AS duration_session_quantiles,
    sum(session_user_negative) AS user_negative,
    sum(session_user_positive) AS user_positive,
    sum(session_model_apologies) AS model_apologies
   FROM (
    SELECT toString(toDate(sa.session_date)) AS day,
     sa.model_used AS model,
     sa.user_id AS member,
     sa.error_count AS session_errors,
     sa.total_interactions AS session_turns,
     sa.total_tokens AS session_tokens,
     if(sa.cost_is_complete = 1, ifNull(sa.estimated_cost, 0), 0) AS session_cost,
     sa.cost_is_complete AS session_cost_complete,
     toFloat64(sa.actual_duration_min) AS session_duration,
     if(signals.scan_version >= 5, arraySum(mapValues(signals.member_negative_counts)), signals.member_negative) AS session_user_negative,
     if(signals.scan_version >= 5, arraySum(mapValues(signals.member_positive_counts)), signals.member_positive) AS session_user_positive,
     if(signals.scan_version >= 5, arraySum(mapValues(signals.model_apology_counts)), signals.model_apologies) AS session_model_apologies
    FROM repository_overview_costs AS sa
    LEFT ANY JOIN (
     SELECT organization_id, user_id, source, session_id, session_date, scan_version,
      model_apologies, member_negative, member_positive,
      model_apology_counts, member_negative_counts, member_positive_counts
     FROM rudel.session_language_signals FINAL
     WHERE organization_id = {orgId:String}
      AND session_date >= toDateTime64({startDate:String}, 3, 'UTC')
      AND session_date < toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 1 DAY
    ) AS signals
     ON sa.organization_id = signals.organization_id AND sa.user_id = signals.user_id
      AND sa.source = signals.source AND sa.session_id = signals.session_id
      AND sa.session_date = signals.session_date
    WHERE ${sessionFilter}
   )
   GROUP BY GROUPING SETS ((day), (day, model), (model), (member), ())`,
		query_params: {
			orgId,
			startDate: input.startDate,
			endDate: input.endDate,
			...repoFilter.params,
		},
	});
	return shapeRepositoryOverview(rows);
}
