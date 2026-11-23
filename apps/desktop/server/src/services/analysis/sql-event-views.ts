import type { TranscriptSource } from "@rudel/api-routes/transcript-records";
import { contentRow } from "../transcript-generations/generations.js";
import {
	RUN_INDEX_FACT_COLUMNS,
	type RunIndexColumnGate,
} from "./run-index-columns.js";
import { componentStringsSql } from "./run-index-components.js";
import {
	CODEX_PROVIDER_ERROR_KIND_SQL,
	RUN_EVENT_RECORDS,
} from "./run-index-sql.js";
import { records } from "./sql.js";
import type { SqlWindow } from "./sql-guard.js";
import { type CommittedRuns, windowSessionsSql } from "./sql-measures.js";
import type { SqlView, SqlViewColumn } from "./sql-views.js";

/**
 * The events view: the API errors, retries, refusals, stop hooks,
 * compactions and notices of each run, one row per event with its record
 * and time, so they can be placed on a run's timeline. The run index keeps
 * them only as counts (`runs.api_errors`, `retry_attempts`, `refusals`,
 * `hook_count`, `compactions`); this view reads the records those counts
 * are taken from with the same predicates (`RUN_EVENT_RECORDS`), from the
 * same transcript generation and runs, so per run its rows add up to them.
 *
 * Every such record is a parser `meta` row (Claude Code `system` records,
 * its API error messages, a failed Codex `task_complete`) or a compaction
 * row: the scan reads only those (`EVENT_RECORDS`, PREWHERE on kind,
 * subtype and is_error) and reads the facts map and the stored head only
 * for them. None of them
 * carries a call id, so of the run index's fork replay filter only
 * `fork_replayed` can drop one (a replayed call always has an id).
 */

/**
 * The records events are read from: compactions, and the meta records with
 * these subtypes (`errorSubtypes` only when they are errors). Every record
 * the parser stores an event fact on is one (`sql-events.test.ts` checks it
 * on the parser's fixtures): a Codex task_complete carries its error's
 * components only when it failed, and the parser marks that row an error.
 * Picking them by these light columns first keeps the facts map and the
 * stored head from being read for the rest.
 */
export const EVENT_RECORD_KINDS = {
	/** Claude Code `system` records. */
	subtypePrefix: "system:",
	subtypes: ["api_error_message", "attachment:thinking_drop"],
	/** Codex turns that ended with an error. */
	errorSubtypes: ["task_complete"],
} as const;
const quoted = (values: readonly string[]) =>
	values.map((value) => `'${value}'`).join(", ");
const EVENT_RECORDS = `kind = 'compaction' OR (kind = 'injected_context' AND subtype = 'safety_recovery' AND agent_id != '')
						OR (kind = 'meta' AND (startsWith(subtype, '${EVENT_RECORD_KINDS.subtypePrefix}')
						OR subtype IN (${quoted(EVENT_RECORD_KINDS.subtypes)})
						OR (subtype IN (${quoted(EVENT_RECORD_KINDS.errorSubtypes)}) AND is_error)))`;

/** The parser facts the view reads, each its own column of the scan. */
const FACT_KEYS = [
	"api_error",
	"api_error_status",
	"api_errors_components",
	"retry_attempt",
	"max_retries",
	"retry_in_ms",
	"refusal_category",
	"original_model",
	"fallback_model",
	"hook_count",
	"hook_runs",
	"hook_errors",
	"prevented_continuation",
	"turn_error",
	"turn_error_kind",
	"compaction_of",
] as const;
type FactKey = (typeof FACT_KEYS)[number];
const fact = (key: string) => `f_${key}`;

const AGENT_NAMES: Readonly<Record<TranscriptSource, string>> = {
	claude_code: "Claude Code",
	codex: "Codex",
	gemini: "Gemini",
};

/** Which agents and parser versions record what a runs column counts, as its gate says. */
function recordedBy(gate: RunIndexColumnGate): string {
	return gate.agents
		.map((agent) => {
			const since = gate.sinceBy?.[agent] ?? gate.since;
			return `${AGENT_NAMES[agent]} from parser ${since}`;
		})
		.join(" and ");
}

const GATES = RUN_INDEX_FACT_COLUMNS;
const RECORDED = `Recorded as the runs columns are: api_error by ${recordedBy(GATES.api_errors)}; retry by ${recordedBy(GATES.retry_attempts)}; refusal by ${recordedBy(GATES.refusals)}; hook_run and hook_error by ${recordedBy(GATES.hook_count)}; turn_error by ${recordedBy(GATES.turn_error)}; compaction by every parser. Elsewhere the event is unknown, not absent: no rows does not mean none happened (the run's unrecorded_facts names the column).`;

function column(
	name: string,
	type: string,
	meaning: string,
	traps: readonly string[] = [],
): SqlViewColumn {
	return { name, type, meaning, traps };
}

export const EVENT_COLUMNS: readonly SqlViewColumn[] = [
	column(
		"run_id",
		"String",
		"The run the event belongs to; joins runs.run_id.",
	),
	column("user_id", "String", "The member who uploaded the session.", [
		"Never for ranking people.",
	]),
	column("session_id", "String", "The session."),
	column("agent_id", "String", "The stream; empty for the main transcript."),
	column(
		"turn_idx",
		"UInt32",
		"The run's number within the stream: runs.turn_idx.",
	),
	column("source", "LowCardinality(String)", "claude_code or codex."),
	column("session_date", "DateTime64(3, 'UTC')", "Session date.", [
		"When the session started, not when the event happened: filter at for a time range.",
	]),
	column(
		"record_idx",
		"UInt32",
		"Raw transcript line of the event; read takes it as record, run expands it as r<record_idx>.",
	),
	column("block_idx", "UInt16", "Content block within the line."),
	column("at", "DateTime64(3, 'UTC')", "When the record was written. UTC.", [
		"A retry's at is when the attempt failed; Claude Code waits retry_in_ms before the next. The time between a run's events is the gap in at.",
	]),
	column(
		"event",
		"LowCardinality(String)",
		"api_error (an API error Claude Code wrote as an assistant message, or a Codex turn ended by a provider error), retry (a failed Claude Code API attempt it retries), refusal (a Claude model refusal), hook_run (one hook of a Claude stop hook summary), hook_error (one error a stop hook summary recorded), turn_error (a Codex turn that ended with an error other than a provider error, such as a policy stop), compaction (a compaction record), notice (any other Claude Code system record: informational notices, local command output, dropped thinking).",
		[
			"A retry is not an api_error, as in runs: api_errors counts only the error Claude Code wrote once it stopped retrying.",
		],
	),
	column(
		"subtype",
		"LowCardinality(String)",
		"The record's subtype as the parser stored it: system:api_error, api_error_message, system:stop_hook_summary (:prevented when it stopped the agent), system:model_refusal_fallback, system:informational, task_complete, compact_boundary, compacted.",
	),
	column(
		"status",
		"LowCardinality(String)",
		"HTTP status of an api_error or retry when recorded (429, 529); empty otherwise.",
	),
	column(
		"error",
		"LowCardinality(String)",
		"What failed, as recorded: Claude's error code (rate_limit, unknown), a retry's connection code (ENOTFOUND, StreamSuspended), Codex's codex_error_info (server_overloaded, cyber_policy); empty otherwise.",
		["A retry's connection code is recorded from parser 9; empty before."],
	),
	column(
		"retry_attempt",
		"Nullable(UInt32)",
		"For a retry: which attempt failed, from 1.",
	),
	column(
		"max_retries",
		"Nullable(UInt32)",
		"For a retry: the attempts Claude Code allows.",
	),
	column(
		"retry_in_ms",
		"Nullable(UInt64)",
		"For a retry: milliseconds Claude Code waits before the next attempt.",
	),
	column(
		"hook_command",
		"String",
		"For a hook_run: the hook's command; empty when the summary did not list it.",
	),
	column(
		"hook_ms",
		"Nullable(UInt64)",
		"For a hook_run: the hook's duration in milliseconds; NULL when not listed.",
	),
	column(
		"prevented_continuation",
		"LowCardinality(Nullable(String))",
		"For a stop hook summary's rows: true when its hooks stopped the agent from finishing, false when not; NULL for other events.",
		[
			"The summary's, on each of its hook_run rows: count summaries with uniqExact(session_id, agent_id, record_idx).",
		],
	),
	column(
		"refusal_category",
		"LowCardinality(String)",
		"For a refusal: its category as recorded (cyber); empty otherwise.",
	),
	column(
		"model",
		"LowCardinality(String)",
		"For a refusal: the model that refused (originalModel); empty otherwise.",
	),
	column(
		"fallback_model",
		"LowCardinality(String)",
		"For a refusal: the model Claude Code continued with; empty when it did not fall back.",
	),
	column(
		"text",
		"String",
		"The record's text as stored, its first 1,024 characters (the error, the notice, the hooks' errors and stop reason); for a hook_error, that error.",
		[
			"text_cut says when there is more; run with expand r<record_idx> returns it.",
		],
	),
	column("text_chars", "UInt32", "Characters of the whole text, cut or not."),
	column("text_cut", "UInt8", "1 when text is shorter than the original."),
];

/** One event of a record: what it is, a hook's command and time, and its text. */
const EVENT_TUPLE = "Tuple(String, String, Nullable(UInt64), String)";

/**
 * The events of one record (the scan's columns), as tuples of
 * `EVENT_TUPLE`: an event per predicate the record meets, a hook_run per
 * hook its summary counted (the listed hooks first, in order) and a
 * hook_error per error it recorded. A Claude Code system record with none
 * is a notice; a Codex task_complete with none is no event. Gives the
 * scan's `record_events` and, one row each, `event`.
 */
function eventsOfRecordSql(): string {
	const f = (key: FactKey) => fact(key);
	const kind = "provider_error_kind";
	const one = (event: string, condition: string, text = "head") =>
		`if(${condition}, [CAST(tuple('${event}', '', NULL, ${text}), '${EVENT_TUPLE}')], [])`;
	const hookList = `JSONExtractArrayRaw(${f("hook_runs")})`;
	const errorText =
		"if(JSONType(entry) = 'String', JSONExtractString(entry), entry)";
	const events = `arrayConcat(
						${one("api_error", RUN_EVENT_RECORDS.isApiError(f, kind))},
						${one("retry", RUN_EVENT_RECORDS.isRetry(f))},
						${one("refusal", RUN_EVENT_RECORDS.isRefusal(f))},
						arrayMap(i -> CAST(tuple('hook_run', JSONExtractString(${hookList}[i], 'command'),
							JSONExtract(${hookList}[i], 'durationMs', 'Nullable(UInt64)'), head), '${EVENT_TUPLE}'),
							range(1, toUInt32(least(${RUN_EVENT_RECORDS.hooks(f)}, 10000)) + 1)),
						arrayMap(entry -> CAST(tuple('hook_error', '', NULL, ${errorText}), '${EVENT_TUPLE}'),
							JSONExtractArrayRaw(${f("hook_errors")})),
						${one("turn_error", `source = 'codex' AND subtype = 'task_complete' AND ${kind} = '' AND ${f("turn_error")} != ''`)},
						${one("compaction", RUN_EVENT_RECORDS.isCompaction(f))})`;
	return `${events} AS record_events,
					arrayJoin(if(empty(record_events) AND source IN ('claude_code', 'gemini') AND kind = 'meta',
						[CAST(tuple('notice', '', NULL, head), '${EVENT_TUPLE}')], record_events)) AS event`;
}

/**
 * One row per event of the committed runs (`EVENT_COLUMNS`). `window` is
 * the at range the agent's query keeps, when the gateway can tell
 * (`sql-guard.ts`): only sessions with an event record in it are read
 * (`windowSessionsSql`), so a short window over a long history stays
 * small. Every event's row has its record's time, so the rows the query
 * keeps are the same.
 */
export function eventsSql(runs: CommittedRuns, window: SqlWindow = {}): string {
	const windowed = windowSessionsSql(runs.owner, `(${EVENT_RECORDS})`, window);
	const inWindow = windowed?.sessions ?? "";
	const f = (key: FactKey) => fact(key);
	const generation = `(user_id, session_id, revision, parser_version) IN (
						SELECT user_id, session_id, committed.1, committed.2 FROM (
							SELECT user_id, session_id, max((revision, parser_version, index_version, build_revision)) AS committed
							FROM ${runs.table} WHERE ${runs.owner} AND row_kind = 'receipt'
							GROUP BY user_id, session_id))`;
	// A Claude retry records its HTTP status only among its error's
	// components (parser 9); an API error message and Codex as runs read them.
	const retryStatuses = `arrayFilter(status -> match(status, '^[1-5][0-9]{2}$'), arrayMap(component ->
						if(JSONType(component, 'value') = 'String', JSONExtractString(component, 'value'), JSONExtractRaw(component, 'value')),
						arrayFilter(component -> endsWith(JSONExtractString(component, 'path'), '.error.status'), JSONExtractArrayRaw(${f("api_errors_components")}))))`;
	const statuses = `if(source IN ('claude_code', 'gemini') AND ${f("api_error_status")} = '', ${retryStatuses},
						${RUN_EVENT_RECORDS.apiErrorStatuses(f, "provider_error_kind")})`;
	const error = `multiIf(source = 'codex', if(provider_error_kind != '', provider_error_kind, ${f("turn_error_kind")}),
						${f("api_error")} != '', ${f("api_error")},
						arrayElement(${componentStringsSql(f("api_errors_components"), "[.]error[.]connection[.]code$")}, 1))`;
	return `${windowed ? `WITH ${windowed.with}\n\t\t\t` : ""}SELECT r.run_id AS run_id, e.user_id AS user_id, e.session_id AS session_id,
				e.agent_id AS agent_id, e.turn_idx AS turn_idx, e.source AS source, e.session_date AS session_date,
				e.record_idx AS record_idx, e.block_idx AS block_idx, e.ts AS at,
				toLowCardinality(e.event.1) AS event, e.subtype AS subtype,
				toLowCardinality(if(e.event.1 IN ('api_error', 'retry'), e.status, '')) AS status,
				toLowCardinality(if(e.event.1 IN ('api_error', 'retry', 'turn_error'), e.error, '')) AS error,
				e.retry_attempt AS retry_attempt, e.max_retries AS max_retries, e.retry_in_ms AS retry_in_ms,
				e.event.2 AS hook_command, e.event.3 AS hook_ms,
				CAST(if(startsWith(e.subtype, 'system:stop_hook_summary'), nullIf(e.${f("prevented_continuation")}, ''), NULL)
					AS LowCardinality(Nullable(String))) AS prevented_continuation,
				toLowCardinality(e.${f("refusal_category")}) AS refusal_category,
				toLowCardinality(e.${f("original_model")}) AS model, toLowCardinality(e.${f("fallback_model")}) AS fallback_model,
				e.event.4 AS text,
				toUInt32(if(e.event.1 = 'hook_error', lengthUTF8(e.event.4), e.text_chars)) AS text_chars,
				toUInt8(lengthUTF8(e.event.4) < if(e.event.1 = 'hook_error', lengthUTF8(e.event.4), e.text_chars)) AS text_cut
			FROM (
				SELECT *, ${eventsOfRecordSql()},
					${statuses}[1] AS status,
					${error} AS error,
					toUInt32OrNull(${f("retry_attempt")}) AS retry_attempt,
					toUInt32OrNull(${f("max_retries")}) AS max_retries,
					toUInt64OrNull(${f("retry_in_ms")}) AS retry_in_ms
				FROM (
					SELECT user_id, session_id, revision, parser_version, agent_id, turn_idx, source, session_date,
						record_idx, block_idx, ts, kind, subtype, head, text_chars,
						${CODEX_PROVIDER_ERROR_KIND_SQL} AS provider_error_kind,
						${FACT_KEYS.map((key) => `facts['${key}'] AS ${fact(key)}`).join(", ")}
					FROM ${records()} FINAL
					PREWHERE ${EVENT_RECORDS}
					WHERE ${runs.owner} AND ${generation}${inWindow}
						AND ${contentRow()} AND turn_idx >= 1
						AND facts['fork_replayed'] != 'true'
				)
			) AS e
			INNER JOIN (
				SELECT user_id, session_id, revision, parser_version, agent_id, turn_idx, run_id
				FROM ${runs.table} FINAL
				WHERE ${runs.owner} AND row_kind = 'run' AND ${runs.committed}${inWindow}
			) AS r ON r.user_id = e.user_id AND r.session_id = e.session_id
				AND r.revision = e.revision AND r.parser_version = e.parser_version
				AND r.agent_id = e.agent_id AND r.turn_idx = e.turn_idx`;
}

const SCOPE_TRAP =
	"Only sessions you may read in this workspace (every member's, unless the workspace keeps members to their own). The server adds the workspace; never filter by it.";

/** The events view; `committedRuns` scopes it as the runs view is scoped. */
export function eventsView(
	committedRuns: (memberOnly: boolean) => CommittedRuns,
): SqlView {
	return {
		name: "events",
		grain:
			"One row per API error, retry, refusal, stop hook, compaction or notice of a run, with its record and time, from the transcript generation each session's runs were built from; joins runs by run_id.",
		traps: [
			"Each event is one row: older transcript generations, repeated copies and what a forked Codex session copied from its parent are already left out, so count rows directly.",
			"Per run they add up to runs: countIf(event = 'api_error') = api_errors, countIf(event = 'retry') = retry_attempts, countIf(event = 'refusal') = refusals, countIf(event = 'hook_run') = hook_count, countIf(event = 'compaction') = compactions, and countIf(event = 'hook_error') is the entries of hook_errors.",
			"A stop hook summary is one hook_run row per hook it counted (hookCount): hook_command and hook_ms come from the hooks it listed, and are empty and NULL for a hook it did not list. A summary that counted no hooks has no hook_run row.",
			RECORDED,
			SCOPE_TRAP,
			"Only the sessions runs holds, in the transcript generation runs was built from: a session is here once the worker indexed it (minutes after upload). Records before a stream's first prompt belong to no run and are left out.",
			"Keep the time range as at >= … (and at < …) in the WHERE of the query that reads events, joined to the rest with AND: the server then reads only the sessions with events in it. Without it, or behind OR, every session's events are read.",
			"Times are UTC.",
		],
		columns: EVENT_COLUMNS,
		recent: { column: "at", rows: "events recorded" },
		windowColumn: "at",
		sql(memberOnly, window) {
			return eventsSql(committedRuns(memberOnly), window);
		},
	};
}
