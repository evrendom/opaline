import {
	REPOSITORY_FILE_ACTIVITY_LIMIT,
	type RepositoryFileActivity,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import { type RepoRange, repoScopeOf } from "./repository-setup.service.js";
import type { SessionRunCiScope } from "./run-ci/session-run-ci.js";

export async function repositoryFileActivity(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string,
	range?: RepoRange,
): Promise<RepositoryFileActivity> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { paths: [], truncated: false };
	const call = "(t.user_id, t.session_id, t.agent_id, t.call_id)";
	const records = getSafeClickHouseTable("rudel.transcript_records");
	const scoped = `organization_id = {workspaceId:String}
				AND (user_id, session_id) IN (SELECT user_id, session_id FROM repo_sessions)`;
	const rows = await query(env.executor, ActivityRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte},
			native_writes AS (
				SELECT user_id, session_id, agent_id, call_id FROM ${records}
				WHERE ${scoped} AND kind = 'file_change' AND file_op = 'write'
					AND source = 'claude_code' AND subtype = 'native' AND call_id != ''
			),
			created AS (
				SELECT DISTINCT user_id, session_id, agent_id, call_id FROM ${records}
				WHERE ${scoped} AND kind = 'tool_result' AND NOT is_error
					AND (user_id, session_id, agent_id, call_id) IN (SELECT * FROM native_writes)
					AND startsWith(head, 'File created successfully at:')
			)
			SELECT if(startsWith(t.file_path, concat(s.project_path, '/')),
					substring(t.file_path, length(s.project_path) + 2),
					t.file_path) AS path,
				uniqExactIf(${call}, t.file_op = 'read') AS reads,
				uniqExactIf(${call}, t.file_op != 'read') AS changes,
				uniqExact((t.user_id, t.session_id)) AS sessions,
				argMinIf(
					${call} IN (SELECT * FROM created)
						OR (t.source = 'codex' AND t.subtype IN ('patch', 'nested') AND t.file_op = 'write'),
					t.ts,
					t.kind = 'file_change' AND t.file_op IN ('write', 'edit', 'delete')
				) AS added,
				toUnixTimestamp64Milli(max(t.ts)) AS last_ms
			FROM ${records} AS t
			INNER JOIN repo_sessions AS s
				ON s.user_id = t.user_id AND s.session_id = t.session_id
			WHERE t.organization_id = {workspaceId:String}
				AND (t.user_id, t.session_id) IN (SELECT user_id, session_id FROM repo_sessions)
				AND t.file_op != '' AND t.file_path != ''
			GROUP BY path
			ORDER BY sessions DESC, changes DESC, path
			LIMIT ${REPOSITORY_FILE_ACTIVITY_LIMIT + 1}`,
		query_params: repo.params,
	});
	return {
		paths: rows.slice(0, REPOSITORY_FILE_ACTIVITY_LIMIT).map((row) => ({
			path: row.path,
			reads: row.reads,
			changes: row.changes,
			sessions: row.sessions,
			added: row.added,
			lastAt: new Date(row.last_ms).toISOString(),
		})),
		truncated: rows.length > REPOSITORY_FILE_ACTIVITY_LIMIT,
	};
}

const ActivityRowSchema = z.object({
	path: z.string(),
	reads: z.coerce.number(),
	changes: z.coerce.number(),
	sessions: z.coerce.number(),
	added: z.coerce.number().transform((value) => value === 1),
	last_ms: z.coerce.number(),
});
