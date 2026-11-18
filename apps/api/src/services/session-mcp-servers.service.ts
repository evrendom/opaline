import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";

const RowSchema = z.object({
	session_id: z.string(),
	servers: z.array(z.string()),
});

export async function sessionMcpServers(
	env: { executor: ClickHouseExecutor },
	scope: { workspaceId: string; member: string | null },
	sessionIds: readonly string[],
): Promise<Record<string, string[]>> {
	const rows = await query(env.executor, RowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, arraySort(groupUniqArray(mcp_server)) AS servers
			FROM ${getSafeClickHouseTable("rudel.transcript_records")}
			WHERE organization_id = {workspaceId:String}
				${scope.member === null ? "" : "AND user_id = {member:String}"}
				AND session_id IN {sessionIds:Array(String)}
				AND kind = 'tool_call' AND mcp_server != ''
			GROUP BY session_id`,
		query_params: {
			workspaceId: scope.workspaceId,
			member: scope.member ?? "",
			sessionIds: [...sessionIds],
		},
	});
	return Object.fromEntries(rows.map((row) => [row.session_id, row.servers]));
}
