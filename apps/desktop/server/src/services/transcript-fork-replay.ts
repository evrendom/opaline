import { codexForkParentIds } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, records } from "./analysis/sql.js";
import {
	contentRow,
	newestGenerations,
	type TranscriptReadScope,
} from "./transcript-generations/generations.js";

/**
 * The committed generation of each parent session `parents` selects, and its
 * main stream's tool calls (`parent_calls`), among the sessions `owner`
 * holds: by default one member's, bound as parameters.
 */
export function forkParentCallsSql(
	parents = "session_id IN {parentSessionIds:Array(String)}",
	owner = "organization_id = {organizationId:String} AND user_id = {userId:String}",
): string {
	return `parent_receipts AS (
		${newestGenerations({ by: ["user_id", "session_id"], and: `AND ${owner} AND ${parents} AND source = 'codex'` })}
	), parent_calls AS (
		SELECT DISTINCT user_id, session_id, call_id FROM ${records()}
		WHERE ${owner}
			AND ${parents} AND source = 'codex'
			AND (user_id, session_id, revision, parser_version) IN (SELECT user_id, session_id, generation.1, generation.2 FROM parent_receipts)
			AND agent_id = '' AND kind = 'tool_call' AND call_id != ''
			AND ${contentRow()}
	)`;
}

export async function readCodexForkParentCalls(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	content: string,
): Promise<Readonly<Record<string, readonly string[]>>> {
	const parentSessionIds = codexForkParentIds(content);
	if (parentSessionIds.length === 0) return {};
	const rows = z
		.array(z.object({ session_id: z.string(), call_id: z.string() }))
		.parse(
			await executor.query({
				query: `WITH ${forkParentCallsSql()} SELECT session_id, call_id FROM parent_calls`,
				query_params: { ...scope, parentSessionIds },
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			}),
		);
	const parents = new Map<string, string[]>();
	for (const row of rows) {
		let calls = parents.get(row.session_id);
		if (calls === undefined) {
			calls = [];
			parents.set(row.session_id, calls);
		}
		calls.push(row.call_id);
	}
	return Object.fromEntries(parents);
}
