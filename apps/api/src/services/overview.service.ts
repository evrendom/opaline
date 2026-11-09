import type { OverviewKPIs, UserDailyTrendData } from "@rudel/api-routes";
import { buildAbsoluteDateFilter, queryClickhouse } from "../clickhouse.js";
import {
	buildSessionDateWindow,
	getUsageAnalyticsQueryContext,
} from "./usage-event-analytics.service.js";

/**
 * Get overview KPI counts: distinct users, sessions, projects, subagents, skills, slash commands
 */
export async function getOverviewKPIs(
	orgId: string,
	startDate: string,
	endDate: string,
): Promise<OverviewKPIs> {
	const dateFilter = buildAbsoluteDateFilter("startDate", "endDate");
	const query_params = {
		startDate,
		endDate,
		orgId,
	};

	// One date-filtered scan computes all six KPIs together; one extra scan
	// preserves the lifetime org session count (no date filter, can't merge).
	// Folding the four ARRAY JOIN scans into the main scan also guarantees the
	// six date-filtered KPIs are read from a single MergeTree-FINAL snapshot.
	const [consolidatedResult, totalResult] = await Promise.all([
		queryClickhouse<{
			distinct_users: number;
			distinct_sessions: number;
			distinct_projects: number;
			distinct_subagents: number;
			distinct_skills: number;
			distinct_slash_commands: number;
		}>({
			query: `
        SELECT
          uniq(user_id) as distinct_users,
          count() as distinct_sessions,
          uniq(if(git_remote != '', git_remote, if(package_name != '', package_name, project_path))) as distinct_projects,
          length(arrayFilter(x -> x != '', arrayDistinct(arrayFlatten(groupArray(subagent_types))))) as distinct_subagents,
          length(arrayFilter(x -> x != '', arrayDistinct(arrayFlatten(groupArray(skills))))) as distinct_skills,
          length(arrayFilter(x -> x != '', arrayDistinct(arrayFlatten(groupArray(slash_commands))))) as distinct_slash_commands
        FROM rudel.session_analytics FINAL
        WHERE ${dateFilter}
          AND organization_id = {orgId:String}
      `,
			query_params,
		}),
		queryClickhouse<{ count: number }>({
			query: `
        SELECT count() as count
        FROM rudel.session_analytics FINAL
        WHERE organization_id = {orgId:String}
      `,
			query_params,
		}),
	]);

	const row = consolidatedResult[0];
	if (!row) {
		return {
			distinct_users: 0,
			distinct_sessions: 0,
			distinct_projects: 0,
			distinct_subagents: 0,
			distinct_skills: 0,
			distinct_slash_commands: 0,
			total_sessions: 0,
		};
	}
	return {
		distinct_users: Number(row.distinct_users),
		distinct_sessions: Number(row.distinct_sessions),
		distinct_projects: Number(row.distinct_projects),
		distinct_subagents: Number(row.distinct_subagents),
		distinct_skills: Number(row.distinct_skills),
		distinct_slash_commands: Number(row.distinct_slash_commands),
		total_sessions: Number(totalResult[0]?.count ?? 0),
	};
}

export async function getUsersDailyTrend(
	orgId: string,
	startDate: string,
	endDate: string,
): Promise<UserDailyTrendData[]> {
	const dateFilter = buildAbsoluteDateFilter("startDate", "endDate");
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		window: buildSessionDateWindow(
			buildAbsoluteDateFilter("startDate", "endDate", "sa.session_date"),
		),
	});

	return queryClickhouse<UserDailyTrendData>({
		query: `
	WITH ${usage.cteDefinitions}
    SELECT
      toString(toDate(session_date)) as date,
      user_id,
      count() as sessions,
      round(sum(actual_duration_min) / 60, 2) as total_hours,
      sum(ifNull(total_tokens, 0)) as total_tokens,
      sum(ifNull(input_tokens, 0)) as input_tokens,
      sum(ifNull(output_tokens, 0)) as output_tokens,
      length(arrayDistinct(arrayFilter(x -> x != '', arrayFlatten(groupArray(skills))))) as distinct_skills,
      length(arrayDistinct(arrayFilter(x -> x != '', arrayFlatten(groupArray(slash_commands))))) as distinct_slash_commands,
      arrayFilter(
        x -> x != '',
        arrayDistinct(groupArray(if(model_used != '' AND model_used != 'unknown', model_used, '')))
      ) as models_used,
      arraySort(
        arrayDistinct(
          arrayFilter(
            x -> x != '',
            groupArray(
              if(
                git_remote != '',
                replaceRegexpOne(arrayElement(splitByChar('/', git_remote), -1), '\\\\.git$', ''),
                if(
                  package_name != '',
                  package_name,
                  arrayElement(splitByChar('/', replaceAll(project_path, '\\\\', '/')), -1)
                )
              )
            )
          )
        )
      ) as repositories_touched
    FROM ${usage.sessionsRelation} AS sa
    WHERE ${dateFilter}
      AND sa.organization_id = {orgId:String}
      AND user_id != ''
    GROUP BY date, user_id
    ORDER BY date ASC, user_id ASC
  `,
		query_params: {
			startDate,
			endDate,
			orgId,
		},
	});
}
