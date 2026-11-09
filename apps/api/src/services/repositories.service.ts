import type { RepositoryNavigationItem } from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";
import {
	aggregateRepositories,
	type RepositoryAggregateRow,
} from "./repository-aggregation.js";
import { REPOSITORY_QUERY_SETTINGS } from "./repository-filter.service.js";
import { getUsageAnalyticsQueryContext } from "./usage-event-analytics.service.js";

export async function listRepositories(orgId: string) {
	const usage = await getUsageAnalyticsQueryContext(orgId);
	const rows = await queryClickhouse<RepositoryAggregateRow>({
		clickhouse_settings: REPOSITORY_QUERY_SETTINGS,
		query: `WITH ${usage.cteDefinitions}
   SELECT sa.git_remote, sa.package_name, sa.project_path, sa.user_id,
    count() AS session_count, sum(sa.total_tokens) AS total_tokens,
    sum(ifNull(sa.estimated_cost, 0)) AS estimated_cost,
    countIf(NOT sa.cost_is_complete) AS incomplete_costs,
    formatDateTime(max(sa.last_interaction_date), '%Y-%m-%dT%H:%i:%SZ') AS last_active_at,
    sum(if(signals.scan_version >= 5, arraySum(mapValues(signals.model_apology_counts)), signals.model_apologies)) AS model_apologies,
    sum(if(signals.scan_version >= 5, arraySum(mapValues(signals.member_negative_counts)), signals.member_negative)) AS user_negative,
    sum(if(signals.scan_version >= 5, arraySum(mapValues(signals.member_positive_counts)), signals.member_positive)) AS user_positive,
    countIf(signals.scan_version < 5) AS incomplete_signals
   FROM ${usage.sessionsRelation} AS sa
   LEFT ANY JOIN (
    SELECT organization_id, user_id, source, session_id, session_date, scan_version,
     model_apologies, member_negative, member_positive,
     model_apology_counts, member_negative_counts, member_positive_counts
    FROM rudel.session_language_signals FINAL
    WHERE organization_id = {orgId:String}
   ) AS signals
    ON sa.organization_id = signals.organization_id AND sa.user_id = signals.user_id
     AND sa.source = signals.source AND sa.session_id = signals.session_id
     AND sa.session_date = signals.session_date
   WHERE sa.organization_id = {orgId:String}
   GROUP BY sa.git_remote, sa.package_name, sa.project_path, sa.user_id
   LIMIT 10001`,
		query_params: { orgId },
	});
	return aggregateRepositories(rows);
}

export async function listRepositoryNavigation(
	orgId: string,
): Promise<RepositoryNavigationItem[]> {
	const rows = await queryClickhouse<
		Pick<
			RepositoryAggregateRow,
			| "git_remote"
			| "package_name"
			| "project_path"
			| "user_id"
			| "session_count"
			| "last_active_at"
		>
	>({
		clickhouse_settings: {
			...REPOSITORY_QUERY_SETTINGS,
			log_comment: "analytics.repositories.navigation",
		},
		query: `SELECT git_remote, package_name, project_path, user_id,
				count() AS session_count,
				formatDateTime(max(last_interaction_date), '%Y-%m-%dT%H:%i:%SZ') AS last_active_at
			FROM rudel.session_analytics FINAL
			WHERE organization_id = {orgId:String}
			GROUP BY git_remote, package_name, project_path, user_id
			LIMIT 10001`,
		query_params: { orgId },
	});
	return aggregateRepositories(
		rows.map((row) => ({
			...row,
			estimated_cost: 0,
			incomplete_costs: 0,
			incomplete_signals: 0,
			model_apologies: 0,
			total_tokens: 0,
			user_negative: 0,
			user_positive: 0,
		})),
	).map(({ identity, sessionCount, lastActiveAt }) => ({
		identity,
		lastActiveAt,
		sessionCount,
	}));
}
