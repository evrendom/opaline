import { SESSION_LINEAGE_DERIVATION_VERSION } from "@rudel/api-routes";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { shouldReadSessionLineage } from "../../lib/env.js";
import { NATIVE_PARENT_EDGE_SQL } from "../session-lineage-analytics.service.js";
import { records } from "./sql.js";
import type { CommittedRuns } from "./sql-measures.js";
import type { SqlView, SqlViewColumn } from "./sql-views.js";

/**
 * The session_links view: which session continues which, one row per link,
 * so a task that spans sessions can be followed and a fix credited across
 * them. Two stores record links, and the view reads both:
 *
 * - The Codex `session_meta` record that opens each thread names the thread
 *   that spawned it (`parent_thread_id`, `thread_spawn.parent_thread_id`) and
 *   the thread whose history it copied (`forked_from_id`), with where its own
 *   work starts in that copy (`subagent_history_start_ordinal`). The parser
 *   stores them as `parent_session_components` and `fork_point_components`
 *   (parser 9). Only a thread's first `session_meta` is its own: a fork copies
 *   its parent's records, and their meta, after it.
 * - `rudel.session_lineage` (the lineage worker): native Codex parents, and
 *   one agent's session started by the other (Claude Code running
 *   `codex exec`, Codex running `claude`), matched by the prompt the child
 *   echoed or by time. A delegation is read only where the server reads
 *   matched links (`SESSION_LINEAGE_CONSUMERS_ENABLED`), as the dashboard's
 *   session families do.
 *
 * Resuming or continuing a session is not a link: Claude Code and Codex
 * append a resumed conversation to the same session (checked on prod: in two
 * weeks of the admin workspace's Claude sessions no conversation record
 * carries another session's id and no record uuid is in two sessions), so its
 * runs are already one session's.
 */

/** Paths of `parent_session_components` that name the thread a Codex thread was spawned by. */
export const PARENT_THREAD_PATHS = [
	"session_meta/.parent_thread_id",
	"session_meta/.source.subagent.thread_spawn.parent_thread_id",
];
export const FORKED_FROM_PATH = "session_meta/.forked_from_id";
export const FORK_ORDINAL_PATH = "session_meta/.subagent_history_start_ordinal";
/** session_lineage confidences of a matched delegation; `ambiguous` matched no parent. */
const DELEGATION_CONFIDENCES = ["id_echo", "prompt_echo", "attested_temporal"];

/** A thread's own Codex session_meta records: in its main stream, never the receipt. */
const SESSION_META = `source = 'codex' AND kind = 'meta' AND subtype = 'session_meta' AND agent_id = '' AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}`;

const quoted = (values: readonly string[]) =>
	values.map((value) => `'${value}'`).join(", ");

function column(
	name: string,
	type: string,
	meaning: string,
	traps: readonly string[] = [],
): SqlViewColumn {
	return { name, type, meaning, traps };
}

export const SESSION_LINK_COLUMNS: readonly SqlViewColumn[] = [
	column("user_id", "String", "The member whose sessions these are.", [
		"Never for ranking people.",
	]),
	column(
		"from_session_id",
		"String",
		"The earlier session: the thread that spawned or was forked into to_session_id, or the session that started it through the other agent; joins runs.session_id.",
	),
	column("from_source", "LowCardinality(String)", "claude_code or codex."),
	column(
		"to_session_id",
		"String",
		"The session that continues from_session_id; joins runs.session_id.",
	),
	column("to_source", "LowCardinality(String)", "claude_code or codex."),
	column(
		"kind",
		"LowCardinality(String)",
		"parent_thread (a Codex subagent thread and the thread that spawned it), fork (a Codex thread that copied another's history and is not its subagent), delegation (one agent's session started by the other: Claude Code running codex exec, Codex running claude).",
		[
			"No resume or continue kind: a resumed or continued session keeps its session_id, so its runs are already one session's.",
		],
	),
	column(
		"copies_history",
		"UInt8",
		"1 when to_session_id starts with a copy of from_session_id's conversation (Codex forked_from_id): its first runs repeat the parent's and the run index leaves the copy out.",
	),
	column(
		"fork_ordinal",
		"Nullable(UInt32)",
		"For a copied history: the history item where the child's own work starts (Codex subagent_history_start_ordinal); NULL otherwise.",
	),
	column(
		"basis",
		"Array(LowCardinality(String))",
		"What recorded the link, every source that did: session_meta.parent_thread_id and session_meta.forked_from_id (the child's own Codex transcript, parser 9 on), session_lineage.native_parent_id (the lineage worker read the same Codex parent id), session_lineage.id_echo, session_lineage.prompt_echo, session_lineage.attested_temporal (a delegation matched by the id or prompt the child echoed, or by a unique match in time).",
		[
			"session_meta and native_parent_id are recorded ids; id_echo, prompt_echo and attested_temporal are matches, so a delegation can be wrong where two children started alike.",
		],
	),
	column(
		"carrier",
		"LowCardinality(String)",
		"How the lineage worker saw the child start: codex_native_subagent, claude_bash (Claude Code ran codex in Bash), codex_custom_exec (Codex ran claude); empty when only the transcript recorded it.",
	),
	column(
		"outcome",
		"LowCardinality(String)",
		"For a delegation: successful when the child session has an assistant reply, failed when it has none; unknown or empty otherwise.",
	),
	column(
		"from_call_id",
		"String",
		"For a delegation: the call of from_session_id that started the child; joins calls.call_id. Empty otherwise.",
	),
	column(
		"at",
		"DateTime64(3, 'UTC')",
		"When to_session_id started: its first record. UTC.",
	),
];

/**
 * Every link of the caller's readable sessions (`SESSION_LINK_COLUMNS`), both
 * ends readable. A session is readable once the run index holds it for the
 * caller (`runs.owner`); the Codex transcript facts are read from the
 * generation its runs were built from. `lineage` scopes session_lineage as
 * `runs.owner` scopes the run index; `delegations` reads matched delegations.
 */
export function sessionLinksSql(
	runs: CommittedRuns,
	lineageOwner: string,
	delegations: boolean,
): string {
	const readable = "session_links_readable";
	const value = "JSONExtractString(component, 'value')";
	const valuesAt = (paths: string) =>
		`arrayDistinct(arrayFilter(id -> id != '', arrayMap(component -> ${value},
						arrayFilter(component -> JSONExtractString(component, 'path') IN (${paths}), components))))`;
	const lineage = getSafeClickHouseTable("rudel.session_lineage");
	const lineageRule = delegations
		? `(${NATIVE_PARENT_EDGE_SQL}) OR confidence IN (${quoted(DELEGATION_CONFIDENCES)})`
		: NATIVE_PARENT_EDGE_SQL;
	return `WITH ${readable} AS (
				SELECT user_id, session_id, max((revision, parser_version, index_version, build_revision)) AS committed
				FROM ${runs.table}
				WHERE ${runs.owner} AND row_kind = 'receipt'
				GROUP BY user_id, session_id
			)
			SELECT user_id, from_session_id, toLowCardinality(any(from_source)) AS from_source,
				to_session_id, toLowCardinality(any(to_source)) AS to_source,
				toLowCardinality(multiIf(has(groupArray(link), 'delegation'), 'delegation',
					has(groupArray(link), 'parent_thread'), 'parent_thread', 'fork')) AS kind,
				max(copies) AS copies_history, max(ordinal) AS fork_ordinal,
				CAST(arraySort(groupUniqArrayArray(bases)) AS Array(LowCardinality(String))) AS basis,
				toLowCardinality(max(link_carrier)) AS carrier, toLowCardinality(max(link_outcome)) AS outcome,
				max(call_id) AS from_call_id, min(link_at) AS at
			FROM (
				SELECT user_id, edge.1 AS from_session_id, 'codex' AS from_source, session_id AS to_session_id, 'codex' AS to_source,
					edge.2 AS link, edge.3 AS copies, if(edge.3 = 1, fork_ordinal, NULL) AS ordinal, edge.4 AS bases,
					'' AS link_carrier, '' AS link_outcome, '' AS call_id, opened_at AS link_at
				FROM (
					SELECT user_id, session_id, first.1 AS opened_at, JSONExtractArrayRaw(first.2) AS components,
						${valuesAt(quoted(PARENT_THREAD_PATHS))} AS parents,
						${valuesAt(`'${FORKED_FROM_PATH}'`)} AS forks,
						arrayFirst(component -> JSONExtractString(component, 'path') = '${FORK_ORDINAL_PATH}',
							JSONExtractArrayRaw(first.3)) AS fork_point,
						JSONExtract(fork_point, 'value', 'Nullable(UInt32)') AS fork_ordinal
					FROM (
						SELECT user_id, session_id,
							argMin(tuple(ts, facts['parent_session_components'], facts['fork_point_components']), record_idx) AS first
						FROM ${records()}
						PREWHERE ${SESSION_META}
						WHERE ${runs.owner} AND (user_id, session_id, revision, parser_version) IN (
							SELECT user_id, session_id, committed.1, committed.2 FROM ${readable})
						GROUP BY user_id, session_id
					)
				)
				ARRAY JOIN arrayConcat(
					arrayMap(parent -> tuple(parent, 'parent_thread', toUInt8(has(forks, parent)),
						if(has(forks, parent), ['session_meta.parent_thread_id', 'session_meta.forked_from_id'], ['session_meta.parent_thread_id'])), parents),
					arrayMap(fork -> tuple(fork, 'fork', toUInt8(1), ['session_meta.forked_from_id']),
						arrayFilter(fork -> NOT has(parents, fork), forks))) AS edge
				UNION ALL
				SELECT user_id, parent_session_id AS from_session_id, parent_source AS from_source,
					child_session_id AS to_session_id, child_source AS to_source,
					if(confidence = 'native_parent_id', 'parent_thread', 'delegation') AS link, toUInt8(0) AS copies,
					CAST(NULL AS Nullable(UInt32)) AS ordinal, [concat('session_lineage.', confidence)] AS bases,
					toString(carrier) AS link_carrier, if(confidence = 'native_parent_id', '', toString(outcome)) AS link_outcome,
					if(confidence = 'native_parent_id', '', anchor_tool_use_id) AS call_id, child_start_ts AS link_at
				FROM (
					SELECT user_id, child_source, child_session_id,
						argMax(parent_source, replacement_version) AS parent_source,
						argMax(parent_session_id, replacement_version) AS parent_session_id,
						argMax(carrier, replacement_version) AS carrier,
						argMax(confidence, replacement_version) AS confidence,
						argMax(outcome, replacement_version) AS outcome,
						argMax(countable, replacement_version) AS countable,
						argMax(anchor_tool_use_id, replacement_version) AS anchor_tool_use_id,
						argMax(child_start_ts, replacement_version) AS child_start_ts
					FROM ${lineage}
					WHERE ${lineageOwner} AND derivation_version = ${SESSION_LINEAGE_DERIVATION_VERSION}
					GROUP BY user_id, child_source, child_session_id
				)
				WHERE parent_session_id != '' AND (${lineageRule})
			)
			WHERE (user_id, from_session_id) IN (SELECT user_id, session_id FROM ${readable})
				AND (user_id, to_session_id) IN (SELECT user_id, session_id FROM ${readable})
				AND from_session_id != to_session_id
			GROUP BY user_id, from_session_id, to_session_id`;
}

const SCOPE_TRAP =
	"Only links whose two sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.";

/** The session_links view; `committedRuns` scopes it as the runs view is scoped. */
export function sessionLinksView(
	committedRuns: (memberOnly: boolean) => CommittedRuns,
	lineageOwner: (memberOnly: boolean) => string,
): SqlView {
	return {
		name: "session_links",
		grain:
			"One row per link between two sessions: the earlier session (from_session_id), the one that continues it (to_session_id), what kind of link it is and what recorded it; joins runs on from_session_id or to_session_id.",
		traps: [
			"Each link is one row however many stores recorded it (basis lists them), so count rows directly.",
			"Links go one step: a chain of threads is several rows; walk it by joining to_session_id to the next row's from_session_id.",
			"A Codex subagent thread is its own session and its parent_thread row is how to find it; a Claude Code subagent is a stream of its parent's session (runs.agent_id), never a link.",
			"Codex records parent and fork ids from parser 9, so older Codex sessions have links only where the lineage worker found them; a delegation is a match, not a recorded id (basis says which). No row does not mean no link.",
			"Both sessions must be indexed: a link to a session that was not uploaded (its repository is not enabled) or not indexed yet is left out.",
			SCOPE_TRAP,
			"Times are UTC.",
		],
		columns: SESSION_LINK_COLUMNS,
		recent: { column: "at", rows: "linked sessions started" },
		sql(memberOnly) {
			return sessionLinksSql(
				committedRuns(memberOnly),
				lineageOwner(memberOnly),
				shouldReadSessionLineage(),
			);
		},
	};
}
