import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	readableSessionOwner,
	type SessionReader,
} from "../session-visibility.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";

/**
 * How many sessions of a workspace the reader can analyze over the last
 * `days` days (UTC), as `find` scopes them: every member's sessions, or only
 * the reader's own in a workspace limited to own sessions (admins still count
 * the whole workspace there). A count, never content.
 */
export function buildVisibleSessionCountStatement(
	organizationId: string,
	reader: SessionReader,
	days: number,
): ClickHouseStatement {
	const userId = readableSessionOwner(reader);
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
	reader: SessionReader,
	days: number,
): Promise<number> {
	const [row] = await query(
		executor,
		z.object({ count: z.coerce.number() }),
		buildVisibleSessionCountStatement(organizationId, reader, days),
	);
	return row?.count ?? 0;
}
