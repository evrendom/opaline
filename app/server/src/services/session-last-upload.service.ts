import type { LastSessionUpload } from "@rudel/api-routes";
import { buildDateFilter, queryClickhouse } from "../clickhouse.js";
import { createAnalyticsRequestGate } from "./analytics-request-gate.js";
import {
	buildScalarWindowSql,
	buildSessionAnalyticsWindowSql,
	getUsageAnalyticsQueryContext,
	type UsageAnalyticsWindow,
} from "./usage-event-analytics.service.js";

/** The period the bar looks back over, as the sessions list read it did. */
const LAST_UPLOAD_DAYS = 365;
/**
 * The newest top-level sessions read first. A session counts once its usage
 * is complete, which the newest one nearly always is.
 */
const LAST_UPLOAD_CANDIDATES = 20;
const LAST_UPLOAD_REUSE_SECONDS = 30;
const lastUploadRequests = createAnalyticsRequestGate({
	perScope: 1,
	total: 4,
	reuseMs: LAST_UPLOAD_REUSE_SECONDS * 1000,
	maxEntries: 256,
});
export const LAST_UPLOAD_QUERY_CACHE_SETTINGS = {
	use_query_cache: 1,
	query_cache_ttl: LAST_UPLOAD_REUSE_SECONDS,
	query_cache_nondeterministic_function_handling: "save",
} as const;
const PERIOD_FILTER = buildDateFilter("days", "sa.session_date");
const SESSION_ORDER = "sa.session_date DESC, sa.source ASC, sa.session_id ASC";
// A native Codex child is not top-level (`buildLineageEnrichedMetadataCte`).
const TOP_LEVEL_FILTER = `(sa.organization_id, sa.user_id, sa.source, sa.session_id) NOT IN (
					SELECT organization_id, user_id, child_source, child_session_id
					FROM session_native_parents
					WHERE parent_session_id != ''
				)`;

/**
 * The session the "Last session uploaded" bar links to: the first row of the
 * sessions list over the last 365 days, newest first, read for its newest
 * top-level sessions only instead of pricing the organization's history. Only
 * when none of those has complete usage does it read the whole period.
 */
export function getLastSessionUpload(
	organizationId: string,
): Promise<LastSessionUpload | null> {
	return lastUploadRequests.run(organizationId, organizationId, () =>
		readLastSessionUpload(organizationId),
	);
}

async function readLastSessionUpload(
	organizationId: string,
): Promise<LastSessionUpload | null> {
	const newest = await readLastUpload(organizationId, {
		includeNativeDescendants: false,
		sessionsSql:
			buildScalarWindowSql(`${buildSessionAnalyticsWindowSql(`${PERIOD_FILTER} AND ${TOP_LEVEL_FILTER}`)}
				ORDER BY ${SESSION_ORDER}
				LIMIT ${LAST_UPLOAD_CANDIDATES}`),
	});
	if (newest) return newest;
	return (
		(await readLastUpload(organizationId, {
			includeNativeDescendants: false,
			sessionsSql: buildScalarWindowSql(
				buildSessionAnalyticsWindowSql(PERIOD_FILTER),
			),
		})) ?? null
	);
}

async function readLastUpload(
	organizationId: string,
	window: UsageAnalyticsWindow,
): Promise<LastSessionUpload | undefined> {
	const usage = await getUsageAnalyticsQueryContext(organizationId, {
		window,
	});
	const [row] = await queryClickhouse<LastSessionUpload>({
		clickhouse_settings: {
			...usage.clickhouseSettings,
			...LAST_UPLOAD_QUERY_CACHE_SETTINGS,
			join_use_nulls: 0,
			log_comment: "analytics.sessions.lastUpload",
		},
		query: `
		WITH ${usage.cteDefinitions}
		SELECT
			sa.session_id AS session_id,
			formatDateTime(sa.session_date, '%Y-%m-%dT%H:%i:%SZ') AS session_date,
			sa.actual_duration_min AS duration_min
		FROM ${usage.sessionsRelation} AS sa
		WHERE ${PERIOD_FILTER}
			AND sa.organization_id = {orgId:String}
			AND sa.is_top_level_session = 1
		ORDER BY ${SESSION_ORDER}
		LIMIT 1`,
		query_params: { days: LAST_UPLOAD_DAYS, orgId: organizationId },
	});
	return row;
}
