import type { RunRef } from "@rudel/api-routes";
import type { ClickHouseStatement } from "../../clickhouse.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	GENUINE_PROMPT_SQL,
	pinnedFilter,
	pinnedParams,
	records,
	toolErrorSql,
} from "./sql.js";

/*
 * Only the failed-results listing returns one row per record, so only it needs
 * `FINAL` (with an explicit PREWHERE, as in scan-queries.ts); a maximum, a NOT
 * IN set and a first row are the same with or without duplicate copies.
 */

export interface RunAddress {
	scope: TranscriptReadScope;
	generation: SessionGeneration;
	ref: RunRef;
}

/** Record index of the run's last file change whose call did not fail (0 when none). */
export function buildLastEditStatement(run: RunAddress): ClickHouseStatement {
	return runStatement(
		run,
		`SELECT max(record_idx) AS last_edit FROM ${records()}
		WHERE ${runFilter()} AND kind = 'file_change' AND file_op IN ('write', 'edit', 'delete')
			AND (call_id = '' OR (session_id, agent_id, call_id) NOT IN (
				SELECT session_id, agent_id, call_id FROM ${records()}
				WHERE ${pinnedFilter()} AND ${toolErrorSql()} AND call_id != ''))`,
	);
}

/** The run's failed tool results with head and tail, so the error line can be chosen from both. */
export function buildFailedResultsStatement(
	run: RunAddress,
	limit: number,
): ClickHouseStatement {
	return runStatement(
		run,
		`SELECT record_idx, tool_name, head, tail FROM ${records()} FINAL
		PREWHERE ${toolErrorSql()}
		WHERE ${runFilter()}
		ORDER BY record_idx, block_idx LIMIT {limit:UInt32}`,
		{ limit },
	);
}

/** Head of the genuine prompt that opens the run. */
export function buildPromptHeadStatement(
	run: RunAddress,
	chars: number,
): ClickHouseStatement {
	return runStatement(
		run,
		`SELECT substringUTF8(head, 1, {chars:UInt32}) AS text FROM ${records()}
		WHERE ${runFilter()} AND ${GENUINE_PROMPT_SQL}
		ORDER BY record_idx, block_idx LIMIT 1`,
		{ chars },
	);
}

/** Record index of the run's last assistant message. */
export function buildLastAssistantRecordStatement(
	run: RunAddress,
): ClickHouseStatement {
	return runStatement(
		run,
		`SELECT record_idx FROM ${records()}
		WHERE ${runFilter()} AND kind = 'assistant_text'
		ORDER BY record_idx DESC LIMIT 1`,
	);
}

function runFilter(): string {
	return `${pinnedFilter()} AND agent_id = {agentId:String} AND turn_idx = {turn:UInt32}`;
}

function runStatement(
	run: RunAddress,
	query: string,
	params: Record<string, unknown> = {},
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query,
		query_params: {
			...pinnedParams(run.scope, [run.generation]),
			agentId: run.ref.agentId,
			turn: run.ref.turn,
			...params,
		},
	};
}
