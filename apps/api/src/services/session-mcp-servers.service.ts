import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";

const RowSchema = z.object({
	session_id: z.string(),
	server: z.string(),
	at: z.coerce.number(),
});

export async function sessionMcpServers(
	env: { executor: ClickHouseExecutor },
	scope: { workspaceId: string; member: string | null },
	sessionIds: readonly string[],
): Promise<Record<string, { server: string; at: number }[]>> {
	const rows = await query(env.executor, RowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, mcp_server AS server,
				toUnixTimestamp64Milli(min(ts)) AS at
			FROM ${getSafeClickHouseTable("rudel.transcript_records")}
			WHERE organization_id = {workspaceId:String}
				${scope.member === null ? "" : "AND user_id = {member:String}"}
				AND session_id IN {sessionIds:Array(String)}
				AND kind = 'tool_call' AND mcp_server != ''
			GROUP BY session_id, mcp_server
			ORDER BY session_id, at`,
		query_params: {
			workspaceId: scope.workspaceId,
			member: scope.member ?? "",
			sessionIds: [...sessionIds],
		},
	});
	const servers: Record<string, { server: string; at: number }[]> = {};
	for (const row of rows) {
		const list = servers[row.session_id] ?? [];
		list.push({ server: row.server, at: row.at });
		servers[row.session_id] = list;
	}
	return servers;
}
