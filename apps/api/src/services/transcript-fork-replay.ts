import {
	codexForkParentIds,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, records } from "./analysis/sql.js";
import type { TranscriptReadScope } from "./transcript-records-queries.js";

export function forkParentCallsSql(
	parentIds = "{parentSessionIds:Array(String)}",
): string {
	return `parent_receipts AS (
		SELECT session_id, argMax(tuple(revision, parser_version), tuple(revision, parser_version)) AS generation
		FROM ${records()}
		WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
			AND session_id IN ${parentIds} AND source = 'codex'
			AND agent_id = '' AND record_idx = ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX} AND block_idx = 0
		GROUP BY session_id
	), parent_calls AS (
		SELECT DISTINCT session_id, call_id FROM ${records()}
		WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
			AND session_id IN ${parentIds} AND source = 'codex'
			AND (session_id, revision, parser_version) IN (SELECT session_id, generation.1, generation.2 FROM parent_receipts)
			AND agent_id = '' AND kind = 'tool_call' AND call_id != ''
			AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}
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
