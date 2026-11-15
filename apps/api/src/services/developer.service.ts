import type {
	DeveloperSummary as DeveloperSummaryBase,
	DeveloperTeamCard as DeveloperTeamCardBase,
} from "@rudel/api-routes";
import { buildDateFilter, queryClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	buildSessionDateWindow,
	buildUsageCostSubtotalSql,
	getUsageAnalyticsQueryContext,
} from "./usage-event-analytics.service.js";

export interface DeveloperSummary extends DeveloperSummaryBase {
	username?: string;
}

export type DeveloperTeamCard = DeveloperTeamCardBase;

interface FavoriteModelRow {
	user_id: string;
	favorite_model: string;
}

async function getFavoriteModelByUser(orgId: string, days: number) {
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		window: buildSessionDateWindow(buildDateFilter("days", "sa.session_date")),
	});
	const rows = await queryClickhouse<FavoriteModelRow>({
		clickhouse_settings: usage.clickhouseSettings,
		query: `
	WITH ${usage.cteDefinitions}
    SELECT
      user_id,
      favorite_model
    FROM (
      SELECT
        user_id,
        model_used as favorite_model,
        COUNT(*) as session_count,
        SUM(ifNull(input_tokens, 0) + ifNull(output_tokens, 0)) as total_tokens
      FROM ${usage.sessionsRelation}
      WHERE ${buildDateFilter("days")}
        AND organization_id = {orgId:String}
        AND model_used != ''
        AND model_used != 'unknown'
      GROUP BY user_id, favorite_model
      ORDER BY user_id ASC, session_count DESC, total_tokens DESC, favorite_model ASC
    )
    LIMIT 1 BY user_id
  `,
		query_params: {
			days: Number(days),
			orgId,
		},
	});

	return new Map(rows.map((row) => [row.user_id, row.favorite_model] as const));
}

/**
 * Get list of all developers with summary stats
 */
export async function getDeveloperList(
	orgId: string,
	days = 30,
): Promise<DeveloperSummary[]> {
	const d = Number(days);
	const query_params = {
		currentDays: d,
		orgId,
	};
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		window: buildSessionDateWindow(
			buildDateFilter("currentDays", "sa.session_date"),
		),
	});

	const query = `
	WITH ${usage.cteDefinitions},
	current_period AS (
      SELECT
        user_id,
        COUNT(*) as total_sessions,
        COUNT(DISTINCT toDate(session_date)) as active_days,
        SUM(ifNull(input_tokens, 0)) as input_tokens_sum,
        SUM(ifNull(output_tokens, 0)) as output_tokens_sum,
        SUM(ifNull(input_tokens, 0) + ifNull(output_tokens, 0)) as total_tokens,
        round(SUM(actual_duration_min), 2) as total_duration_min,
        round(AVG(actual_duration_min), 2) as avg_session_duration_min,
		formatDateTime(max(session_date), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') as last_active_date,
		${buildUsageCostSubtotalSql("estimated_cost", 4)} as total_cost
      FROM ${usage.sessionsRelation}
      WHERE ${buildDateFilter("currentDays")}
        AND organization_id = {orgId:String}
      GROUP BY user_id
    )
    SELECT
      c.user_id,
      c.total_sessions,
      c.active_days,
      c.total_tokens,
      c.input_tokens_sum as input_tokens,
      c.output_tokens_sum as output_tokens,
      c.total_duration_min,
      c.avg_session_duration_min,
      c.last_active_date,
      c.total_cost as cost
    FROM current_period c
    ORDER BY c.total_sessions DESC
  `;

	const [summaryRows, favoriteModelByUser] = await Promise.all([
		queryClickhouse<Omit<DeveloperSummary, "favorite_model" | "username">>({
			clickhouse_settings: usage.clickhouseSettings,
			query,
			query_params,
		}),
		getFavoriteModelByUser(orgId, d),
	]);

	return summaryRows.map((row) => ({
		...row,
		favorite_model: favoriteModelByUser.get(row.user_id) ?? null,
	}));
}

/**
 * Get fixed-window team card data for active developers
 */
export async function getDeveloperTeamCards(
	orgId: string,
	days = 7,
): Promise<DeveloperTeamCard[]> {
	const d = Number(days);
	const query_params = {
		days: d,
		orgId,
	};
	const usage = await getUsageAnalyticsQueryContext(orgId, {
		window: buildSessionDateWindow(buildDateFilter("days", "sa.session_date")),
	});

	const summaryQuery = `
	WITH ${usage.cteDefinitions}
    SELECT
      user_id,
      COUNT(*) as total_sessions,
      COUNT(DISTINCT toDate(session_date)) as active_days,
      SUM(ifNull(input_tokens, 0)) as total_input_tokens,
      SUM(ifNull(output_tokens, 0)) as total_output_tokens,
      SUM(ifNull(input_tokens, 0) + ifNull(output_tokens, 0)) as total_tokens,
	  ${buildUsageCostSubtotalSql("estimated_cost", 4)} as cost,
	  formatDateTime(max(session_date), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') as last_active_date
    FROM ${usage.sessionsRelation}
    WHERE ${buildDateFilter("days")}
      AND organization_id = {orgId:String}
    GROUP BY user_id
    ORDER BY total_tokens DESC, user_id ASC
  `;

	const topSkillsQuery = `
    SELECT
      user_id,
      skill as name,
      COUNT(*) as count
    FROM rudel.session_analytics FINAL
    ARRAY JOIN skills as skill
    WHERE ${buildDateFilter("days")}
      AND organization_id = {orgId:String}
      AND skill != ''
    GROUP BY user_id, skill
    ORDER BY user_id ASC, count DESC, name ASC
    LIMIT 3 BY user_id
  `;

	interface SummaryRow {
		user_id: string;
		total_sessions: number;
		active_days: number;
		total_input_tokens: number;
		total_output_tokens: number;
		total_tokens: number;
		cost: number | null;
		last_active_date: string;
	}

	interface SkillRow {
		user_id: string;
		name: string;
		count: number;
	}

	const [summaryRows, favoriteModelByUser, skillRows] = await Promise.all([
		queryClickhouse<SummaryRow>({
			clickhouse_settings: usage.clickhouseSettings,
			query: summaryQuery,
			query_params,
		}),
		getFavoriteModelByUser(orgId, d),
		queryClickhouse<SkillRow>({
			query: topSkillsQuery,
			query_params,
		}),
	]);

	if (summaryRows.length === 0) {
		return [];
	}

	const skillsByUser = new Map<
		string,
		Array<{ name: string; count: number }>
	>();
	for (const row of skillRows) {
		const current = skillsByUser.get(row.user_id) ?? [];
		current.push({
			name: row.name,
			count: Number(row.count) || 0,
		});
		skillsByUser.set(row.user_id, current);
	}

	const userIds = summaryRows.map((row) => row.user_id);
	const users = await sqlClient.unsafe<
		Array<{
			id: string;
			name: string | null;
		}>
	>(
		`
			SELECT id, name
			FROM "user"
			WHERE id = ANY($1::text[])
		`,
		[userIds],
	);
	const displayNameByUserId = new Map(
		users
			.map((entry) => [entry.id, entry.name?.trim() ?? ""] as const)
			.filter((entry) => entry[1].length > 0),
	);

	return summaryRows.flatMap((row) => {
		const displayName = displayNameByUserId.get(row.user_id);
		if (!displayName) {
			return [];
		}

		return [
			{
				user_id: row.user_id,
				display_name: displayName,
				cost: row.cost === null ? null : Number(row.cost),
				input_tokens: Number(row.total_input_tokens) || 0,
				output_tokens: Number(row.total_output_tokens) || 0,
				total_tokens: Number(row.total_tokens) || 0,
				total_sessions: Number(row.total_sessions) || 0,
				active_days: Number(row.active_days) || 0,
				last_active_date: row.last_active_date,
				favorite_model: favoriteModelByUser.get(row.user_id) ?? null,
				top_skills: skillsByUser.get(row.user_id) ?? [],
			},
		];
	});
}
