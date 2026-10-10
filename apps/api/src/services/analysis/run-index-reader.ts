import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import type { TranscriptReadScope } from "../transcript-records-queries.js";
import { ANALYSIS_QUERY_SETTINGS } from "./sql.js";

/**
 * Every read of `rudel.run_index` goes through here (docs/l1-literal-schema.md,
 * "Scale"). One rule makes a read correct:
 *
 * - Pinned to the committed snapshot. Each build writes an immutable snapshot
 *   (its runs, then its receipt); a session's committed snapshot is the
 *   receipt with the newest (revision, parser_version, index_version,
 *   build_revision), and only that build's rows are read. A build in flight,
 *   or one that crashed before its receipt, is never seen.
 *
 * Nothing expires: runs and their free text are kept until a deletion request
 * (docs/l1-retention.md), so no column is read as NULL because of its age.
 */

/** 64-bit columns, read as decimal strings like the generated row type. */
const UINT64_COLUMNS = [
	"revision",
	"build_revision",
	"raw_chars",
	"context_input_tokens_at_start",
	"compact_pre_tokens",
	"uncached_input_tokens",
	"cache_read_input_tokens",
	"cache_write_5m_input_tokens",
	"cache_write_1h_input_tokens",
	"output_tokens",
	"reasoning_output_tokens",
] as const;

/**
 * Rows of the sessions' committed snapshots (`kind` narrows to runs or the
 * receipt), in session, stream and start order, typed like the generated
 * row: 64-bit integers as strings.
 */
export function buildCommittedRunIndexStatement(
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
	kind?: "run" | "receipt",
): ClickHouseStatement {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = `organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id IN {sessionIds:Array(String)}`;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT * EXCEPT (${UINT64_COLUMNS.join(", ")}),
				${UINT64_COLUMNS.map((column) => `toString(${column}) AS ${column}`).join(", ")}
			FROM (
				SELECT * FROM ${table} FINAL
				WHERE ${owner}${kind === undefined ? "" : " AND row_kind = {kind:String}"}
					AND (session_id, revision, parser_version, index_version, build_revision) IN (
						SELECT session_id, committed.1, committed.2, committed.3, committed.4 FROM (
							SELECT session_id, max((revision, parser_version, index_version, build_revision)) AS committed
							FROM ${table}
							WHERE ${owner} AND row_kind = 'receipt'
							GROUP BY session_id
						)
					)
			)
			ORDER BY session_id, agent_id, start_record`,
		query_params: {
			...scope,
			sessionIds: [...sessionIds],
			...(kind === undefined ? {} : { kind }),
		},
	};
}

/** Rows of the sessions' committed snapshots; see `buildCommittedRunIndexStatement`. */
export function readCommittedRunIndex(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
	kind?: "run" | "receipt",
): Promise<RudelRunIndexRow[]> {
	return executor.query<RudelRunIndexRow>(
		buildCommittedRunIndexStatement(scope, sessionIds, kind),
	);
}
