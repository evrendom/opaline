import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";

/**
 * How many sessions of a workspace the caller can analyze over the last
 * `days` days (UTC), as `find` scopes them: a workspace admin counts the
 * whole workspace, anyone else only their own sessions (`userId`). A count,
 * never content.
 */
export function buildVisibleSessionCountStatement(
	organizationId: string,
	userId: string | null,
	days: number,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT uniqExact(session_id) AS count
			FROM ${getSafeClickHouseTable("rudel.session_analytics")}
			WHERE organization_id = {organizationId:String}
				AND toDate(session_date, 'UTC') >= today() - {days:UInt32}
				${userId === null ? "" : "AND user_id = {userId:String}"}`,
		query_params: {
			organizationId,
			days,
			...(userId === null ? {} : { userId }),
		},
	};
}

export async function countVisibleSessions(
	executor: ClickHouseExecutor,
	organizationId: string,
	userId: string | null,
	days: number,
): Promise<number> {
	const [row] = await query(
		executor,
		z.object({ count: z.coerce.number() }),
		buildVisibleSessionCountStatement(organizationId, userId, days),
	);
	return row?.count ?? 0;
}
