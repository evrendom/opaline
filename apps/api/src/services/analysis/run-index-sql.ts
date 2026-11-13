import { createHash } from "node:crypto";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import {
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { MODEL_RATE_CARD_VERSION } from "../pricing.service.js";
import { forkParentCallsSql } from "../transcript-fork-replay.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";
import { buildPricedUsageEventsCte } from "../usage-event-analytics.service.js";
import { type ForkReplayRules, runDirectoryRules } from "./run-directories.js";
import { RUN_INDEX_FACT_COLUMNS } from "./run-index-columns.js";
import {
	CODEX_COMMIT_LINE,
	CODEX_GH_PR_CALL,
	CODEX_GIT_COMMIT_CALL,
	CODEX_GIT_DRY_RUN,
	CODEX_GIT_PUSH_CALL,
	CODEX_PUSH_NEW_BRANCH_LINE,
	CODEX_PUSH_RANGE_LINE,
	componentStringsSql,
	httpStatusesSql,
	providerErrorKindSql,
	RUN_INDEX_PR_URL_PATTERN,
	skillNamesSql,
} from "./run-index-components.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	GENUINE_PROMPT_SQL,
	pinnedFilter,
	pinnedParams,
	records,
	toolErrorSql,
} from "./sql.js";
import {
	nativeEditToolSql,
	toolActivitySql,
	toolGroupSql,
} from "./tool-groups.js";

/**
 * The statements that turn a committed transcript-records generation into
 * runs (docs/l1-literal-schema.md, `runs`). `find` aggregates runs at query
 * time with the same CTEs the run index build stores, so the two cannot
 * drift: a run's start, span, calls, failures and priced usage are one
 * definition.
 */

/**
 * Version of the run index rules; a new version is a new run index
 * generation. 4: run messages and their measures (OPL-387). 5: each build
 * also writes its requests (`rudel.run_requests`, OPL-389). 6: and each
 * run's received setup (`rudel.run_setup`, OPL-391). 7: a run and its
 * requests end at their last activity record (RUN_ACTIVITY_SQL), not a
 * compaction or context a local command added after the answer. 8: a Codex
 * run's directory from its turn and workdir. 9: each build is followed by
 * the session's context snapshot (`rudel.session_context_snapshots`).
 * 11: a Codex turn's settings hold for every run it spans; a Codex script
 * whose commands ran is counted as those commands; Codex commits, pushes, PR
 * actions, spawned agents and interrupted turns are recorded.
 */
export const RUN_INDEX_VERSION = 11;

export const CALL_FACTS_SINCE_INDEX_VERSION = 10;

/**
 * A run's own activity: the prompt, the model's responses and the calls they
 * made, their results and file changes — what its end, minutes and active
 * minutes are measured over (it starts at its first record of any kind). Not metadata, and not compaction or
 * injected context: within a run those sit between activity records, but a
 * local command run between two runs (`/compact` the next morning, before
 * the next prompt) is filed under the run before it with the context it
 * injects, and would stretch a run answered in five minutes over the night.
 */
export const RUN_ACTIVITY_SQL =
	"kind NOT IN ('meta', 'injected_context', 'compaction')";

/** Literal string or count read back from ClickHouse; `''` and 0 mean none recorded. */
const text = z.string();
const count = z.coerce.number();
const strings = z.array(z.string());

/** Facts need only a prefix of each text: a command's first word, the prompt head, an error's last line. */
const FACT_TEXT_CHARS = 240;
/**
 * A gap between two records of a run longer than this counts as this much
 * active time: waiting for an approval or a stalled stream is not work, while a
 * long-running command still counts in part.
 */
export const ACTIVE_GAP_CAP_MS = 5 * 60_000;

/** Records an agent writes in response to a prompt (Codex lifecycle attribution). */
const RESPONSE_KINDS =
	"('assistant_text', 'reasoning', 'tool_call', 'tool_result', 'file_change')";
/**
 * Codex turn lifecycle rows. Codex writes `task_started` and `turn_context`
 * before the turn's prompt, so they carry the previous run's `turn_idx`;
 * their facts are attributed by `turn_id` instead (`codex-lifecycle.ts`).
 */
const CODEX_LIFECYCLE_SUBTYPES =
	"('turn_context', 'task_started', 'task_complete', 'turn_aborted')";

/** Fact keys the literal run facts read from each record (`f_<key>` in `work_records`). */
const RECORD_FACT_KEYS = [
	"turn_origin",
	"prompt_source",
	"origin_kind",
	"trigger_turn",
	"permission_mode",
	"auto_mode_bash_first",
	"auto_mode_bash_first_steer",
	"auto_mode_bypass",
	"auto_mode_steer_only",
	"auto_mode_consent_flow",
	"model",
	"effort",
	"per_turn_effort",
	"compact_trigger",
	"compact_pre_tokens",
	"compaction_of",
	"aborted",
	"stop_reason",
	"hook_stop_reason",
	"prevented_continuation",
	"hook_count",
	"hook_errors",
	"hook_runs",
	"api_error",
	"api_error_status",
	"retry_attempt",
	"refusal_category",
	"fallback_model",
	"goal",
	"git.push.branch",
	"git.commit.sha",
	"git.pr.url",
	"pr_url",
	"facts_truncated",
	"facts_clipped",
	"background_launch",
	"skill",
	"skill_components",
	"abort_reason_components",
	"api_errors_components",
] as const;

/** Fact keys of the Codex lifecycle rows. */
const LIFECYCLE_FACT_KEYS = [
	"approval_policy",
	"approvals_reviewer",
	"sandbox_policy",
	"sandbox_network_access",
	"permission_profile",
	"collaboration_mode",
	"model",
	"effort",
	"context_window",
	"time_to_first_token_ms",
	"turn_error",
	"turn_error_kind",
	"aborted",
	"abort_reason",
] as const;

/** Keys of a Claude cost-state record kept on the receipt. */
const COST_STATE_KEYS = [
	"cost_usd",
	"lines_added",
	"lines_removed",
	"tool_duration_ms",
	"api_duration_ms",
	"api_duration_without_retries_ms",
	"has_unknown_model_cost",
] as const;

const factColumn = (key: string) => `f_${key.replaceAll(".", "_")}`;

/** A Codex turn's provider error (parser 9), named as the run index counts it; '' for anything else. */
export const CODEX_PROVIDER_ERROR_KIND_SQL = `if(source = 'codex' AND parser_version >= 9, ${providerErrorKindSql("facts['api_errors_components']")}, '')`;

/** The parser facts the run index's event predicates read. */
type RunEventFact = (
	key:
		| "api_error"
		| "api_error_status"
		| "api_errors_components"
		| "retry_attempt"
		| "refusal_category"
		| "hook_count"
		| "compaction_of",
) => string;

/**
 * The records the run index counts as a run's API errors, retries, refusals,
 * stop hooks and compactions, each over one record: `fact` reads a parser
 * fact of the record and `providerErrorKind` is the record's
 * `CODEX_PROVIDER_ERROR_KIND_SQL`. The events view reads the same, so its
 * rows add up to the runs columns.
 */
export const RUN_EVENT_RECORDS = {
	/** The API error the record carries: Codex's provider error kind, else Claude's `api_error`. */
	apiError: (fact: RunEventFact, providerErrorKind: string) =>
		`if(source = 'codex', ${providerErrorKind}, ${fact("api_error")})`,
	/** The HTTP statuses of the record's API error. */
	apiErrorStatuses: (fact: RunEventFact, providerErrorKind: string) =>
		`if(source = 'codex', if(${providerErrorKind} != '', ${httpStatusesSql(fact("api_errors_components"))}, []), if(${fact("api_error_status")} != '', [${fact("api_error_status")}], []))`,
	/** `api_errors` counts the records where this holds. */
	isApiError: (fact: RunEventFact, providerErrorKind: string) =>
		`${RUN_EVENT_RECORDS.apiError(fact, providerErrorKind)} != '' OR notEmpty(${RUN_EVENT_RECORDS.apiErrorStatuses(fact, providerErrorKind)})`,
	/** `retry_attempts` counts the records where this holds. */
	isRetry: (fact: RunEventFact) => `${fact("retry_attempt")} != ''`,
	/**
	 * `refusals` counts the records where this holds. A Claude Code subagent
	 * stream writes no model_refusal record, only the safety classifier's
	 * notice; the main stream writes both.
	 */
	isRefusal: (fact: RunEventFact, agentId = "agent_id") =>
		`(${fact("refusal_category")} != '' OR (${agentId} != '' AND kind = 'injected_context' AND subtype = 'safety_recovery'))`,
	/** `hook_count` sums this over the run's records. */
	hooks: (fact: RunEventFact) => `toUInt64OrZero(${fact("hook_count")})`,
	isCompaction: (fact: RunEventFact) =>
		`kind = 'compaction' AND ${fact("compaction_of")} = ''`,
} as const;

/** The first value of `expression` in record order among rows where it is set. */
const first = (expression: string, condition = `${expression} != ''`) =>
	`argMinIf(${expression}, tuple(record_idx, block_idx), ${condition})`;
const sortedSet = (expression: string) =>
	`arraySort(groupUniqArrayIf(${expression}, ${expression} != ''))`;

/**
 * A field of the permission decision a Claude Code tool result records
 * (`permissionDecision` decision, source or reasonType); '' when none.
 */
const permissionField = (field: string) =>
	`if(source = 'claude_code' AND kind = 'tool_result', arrayElement(${componentStringsSql("facts['permission_decision_components']", `^user[.]permissionDecision[.]${field}$`)}, 1), '')`;

/** The used_percent of each rate-limit window a Codex token count reports (primary, secondary). */
const RATE_LIMIT_USED = `if(source = 'codex' AND kind = 'meta' AND subtype = 'token_count',
	arrayMap(component -> JSONExtractFloat(component, 'value'), arrayFilter(component ->
		match(JSONExtractString(component, 'path'), '^event_msg/token_count[.]rate_limits[.](primary|secondary)[.]used_percent$')
		AND JSONType(component, 'value') IN ('Int64', 'UInt64', 'Double'), JSONExtractArrayRaw(facts['rate_limits_components']))),
	CAST([], 'Array(Float64)'))`;

/** A Claude Code request its quota refused (`quotaLimits.status` rejected). */
const QUOTA_REJECTED = `source = 'claude_code' AND has(${componentStringsSql("facts['rate_limits_components']", "^assistant[.]quotaLimits[.]status$")}, 'rejected')`;

/** Who accepted a call at a permission prompt or by a rule they saved there. */
const USER_DECIDED =
	"permission_source IN ('user_temporary', 'user_permanent')";

/**
 * A failed call's record: an error or non-zero exit on its result, or on the
 * Codex completion row (parser 9) that carries the call's outcome.
 */
const sqlRegex = (pattern: string) =>
	`'${pattern.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

const WHOLE_LINES_SQL =
	"concat(text, if(text_chars > lengthUTF8(text), '', char(10)))";

const CODEX_RAN_RESULT_SQL =
	"source = 'codex' AND kind = 'tool_result' AND subtype != 'running' AND (exit_code IS NOT NULL OR NOT is_error)";

const SCRIPT_RAN_NESTED_SQL =
	"(w.call_id != '' AND c.ran_nested AND NOT (c.failed AND NOT c.nested_failed))";

export function runToolErrorSql(): string {
	return `(${toolErrorSql()} OR (source = 'codex' AND parser_version >= 9 AND kind = 'meta' AND call_id != ''
		AND (subtype IN ('exec_command_end', 'patch_apply_end') OR startsWith(subtype, 'item_completed:'))
		AND (is_error OR ifNull(exit_code, 0) != 0)))`;
}

/**
 * A string field of a JSON object, also when the stored text is cut: a
 * capped record keeps a prefix that may no longer parse, and the field is
 * then read by its literal key.
 */
function jsonStringField(column: string, field: string): string {
	return `if(isValidJSON(${column}), JSONExtractString(${column}, '${field}'),
		extract(${column}, '"${field}"[[:space:]]*:[[:space:]]*"([^"]+)"'))`;
}

/**
 * Every CTE reference is a separate scan in ClickHouse, so each wide column
 * is read in one scan: `work_records` reads the prompts' and calls' `head`,
 * and `calls` reads the prefixes of the results' `head` and `tail` that say
 * whether a call found nothing. `work_records` is the only scan that needs
 * `FINAL`: its counts and sums would double on a retried insert that has not
 * merged yet. The other scans (per-call groups, failures and outcomes, run
 * boundaries, Codex line streams) aggregate with functions a duplicate row
 * cannot change (min, max, argMin, uniqExact, any), so they read without
 * `FINAL`, which lets their filters move to PREWHERE.
 *
 * With `literal`, `work_records` also reads the run facts the parser stores
 * (typed fact columns and named `facts` keys, never the whole map) and
 * `run_facts` aggregates them under `l_` names; `find` leaves them out.
 */
export function runFactsCtes(options: { literal?: boolean } = {}): string {
	const callGroup = `coalesce(nullIf(c.call_group, ''), ${toolGroupSql("w.tool_name", "head")})`;
	const literal = options.literal === true;
	const headKinds = literal
		? "kind IN ('tool_call', 'user_prompt') OR (kind = 'injected_context' AND subtype = 'slash_command')"
		: "kind IN ('tool_call', 'user_prompt')";
	const literalColumns = literal
		? `,
				agent_version, entrypoint, denial_kind, mcp_server, attribution_skill, git_operation,
				timed_out_after_ms, ifNull(interrupted, false) AS interrupted_call,
				${CODEX_PROVIDER_ERROR_KIND_SQL} AS provider_error_kind,
				if(source = 'codex' AND kind = 'tool_result', extractAll(text, '${RUN_INDEX_PR_URL_PATTERN.replaceAll("\\", "\\\\")}'), []) AS result_pr_urls,
				if(${CODEX_RAN_RESULT_SQL}, arrayMap(sha -> lower(sha), extractAll(text, ${sqlRegex(CODEX_COMMIT_LINE)})), []) AS result_commit_shas,
				if(${CODEX_RAN_RESULT_SQL}, arrayConcat(extractAll(${WHOLE_LINES_SQL}, ${sqlRegex(CODEX_PUSH_RANGE_LINE)}),
					extractAll(${WHOLE_LINES_SQL}, ${sqlRegex(CODEX_PUSH_NEW_BRANCH_LINE)})), []) AS result_push_branches,
				toUInt8(source = 'codex' AND kind = 'tool_result' AND subtype != 'running' AND NOT is_error) AS clean_result,
				toUInt8(source = 'codex' AND kind = 'meta' AND subtype IN ${CODEX_LIFECYCLE_SUBTYPES}) AS lifecycle,
				${permissionField("decision")} AS permission_decision, ${permissionField("source")} AS permission_source,
				${permissionField("reasonType")} AS permission_reason,
				${RATE_LIMIT_USED} AS rate_limit_used, toUInt8(${QUOTA_REJECTED}) AS quota_rejected,
				${RECORD_FACT_KEYS.map((key) => `facts['${key}'] AS ${factColumn(key)}`).join(", ")}`
		: "";
	const literalFacts = literal
		? `,
				${literalRunFacts()}`
		: "";
	// A native edit tool's own request row, never a path inferred from shell text.
	const nativeEditSql = `kind = 'file_change' AND file_op IN ('write', 'edit', 'delete') AND file_path != ''
		AND subtype IN ('native', 'patch', 'nested') AND ${nativeEditToolSql("tool_name")}`;
	// A file an inline script names as the one it writes (parser 12): an edit
	// request like a native one, so its call failing or being refused is a
	// failed or refused edit. Its success proves no change, so it is not an edit.
	const scriptEditSql = `kind = 'file_change' AND subtype = 'shell_script' AND file_op IN ('write', 'edit') AND file_path != ''`;
	const editRequestSql = `((${nativeEditSql}) OR (${scriptEditSql}))`;
	return `${forkReplayCtes()},
		calls AS (
			SELECT session_id, agent_id, call_id,
				argMinIf(${toolGroupSql("tool_name", `substringUTF8(head, 1, ${FACT_TEXT_CHARS})`)}, tuple(record_idx, block_idx), kind = 'tool_call') AS call_group,
				max(${runToolErrorSql()}) AS failed,
				max(mapContains(facts, 'parsed_cmd_types')) AS has_parsed_cmd,
				groupUniqArrayArray(JSONExtract(facts['parsed_cmd_types'], 'Array(String)')) AS parsed_types,
				max(denial_kind != '' AND denial_kind != 'interrupted') AS refused,
				max(denial_kind IN ('cancelled', 'interrupted') OR ifNull(interrupted, false)) AS stopped,
				max(kind = 'tool_result') AS has_result,
				max(source = 'codex' AND kind = 'tool_call' AND match(head, ${sqlRegex(CODEX_GIT_COMMIT_CALL)})) AS git_commit_call,
				max(source = 'codex' AND kind = 'tool_call' AND match(head, ${sqlRegex(CODEX_GIT_PUSH_CALL)})
					AND NOT match(head, ${sqlRegex(CODEX_GIT_DRY_RUN)})) AS git_push_call,
				max(source = 'codex' AND kind = 'tool_call' AND match(head, ${sqlRegex(CODEX_GH_PR_CALL)})) AS gh_pr_call,
				${foundNothingSql()}
			FROM ${records()}
			WHERE ${pinnedFilter()} AND kind IN ('tool_call', 'tool_result', 'meta') AND call_id != '' AND ${FORK_REPLAY_FILTER}
			GROUP BY session_id, agent_id, call_id
		),
		scripts AS (
			SELECT n.session_id AS script_session, n.agent_id AS script_agent, n.parent AS script_call,
				max(nc.failed) AS nested_failed
			FROM (
				SELECT session_id, agent_id, call_id, facts['script_call_id'] AS parent
				FROM ${records()}
				WHERE ${pinnedFilter()} AND source = 'codex' AND kind = 'tool_call' AND subtype = 'nested'
					AND facts['script_call_id'] != '' AND ${FORK_REPLAY_FILTER}
			) AS n
			LEFT ANY JOIN calls nc ON n.session_id = nc.session_id AND n.agent_id = nc.agent_id AND n.call_id = nc.call_id
			GROUP BY n.session_id, n.agent_id, n.parent
		),
		call_outcomes AS (
			SELECT c.*, s.script_call != '' AS ran_nested, s.nested_failed AS nested_failed
			FROM calls c
			LEFT ANY JOIN scripts s ON c.session_id = s.script_session AND c.agent_id = s.script_agent AND c.call_id = s.script_call
		),
		work_records AS (
			SELECT session_id, agent_id, record_idx, block_idx, turn_idx, ts, kind, subtype,
				tool_name, call_id, file_path, file_op, is_error, exit_code, text_chars, parser_version, source,
				facts['applied_changes'] AS applied_changes,
				if(${headKinds}, substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '') AS head${literalColumns}
			FROM ${records()} FINAL WHERE ${pinnedFilter()} AND turn_idx >= 1 AND ${FORK_REPLAY_FILTER}
		),
		run_facts AS (
			SELECT w.session_id AS session_id, w.agent_id AS agent_id, w.turn_idx AS turn_idx,
				min(record_idx) AS first_record,
				toUnixTimestamp64Milli(argMin(ts, tuple(record_idx, block_idx))) AS started_ms,
				greatest(0, toUnixTimestamp64Milli(argMaxIf(ts, tuple(record_idx, block_idx), ${RUN_ACTIVITY_SQL})) - started_ms) / 60000 AS minutes,
				arraySum(arrayMap(gap -> least(gap, ${ACTIVE_GAP_CAP_MS}), arrayDifference(arraySort(
					groupArrayIf(toUnixTimestamp64Milli(ts), ${RUN_ACTIVITY_SQL}))))) / 60000 AS active_minutes,
				sum(text_chars) AS raw_chars,
				countIf(${GENUINE_PROMPT_SQL}) AS genuine_prompt,
				substringUTF8(argMinIf(head, tuple(record_idx, block_idx), ${GENUINE_PROMPT_SQL}), 1, 160) AS prompt_head,
				if(max(parser_version) >= 9,
					length(arrayDistinct(arrayConcat(
						arrayFlatten(groupArray(arrayMap(change -> JSONExtractString(change, 'path'), JSONExtractArrayRaw(applied_changes)))),
						groupArrayIf(file_path, ${nativeEditSql}
							AND w.call_id != '' AND c.has_result AND NOT c.failed AND NOT c.refused AND NOT c.stopped)))),
					uniqExactIf(file_path, kind = 'file_change' AND file_op IN ('write', 'edit', 'delete') AND file_path != '' AND (w.call_id = '' OR NOT c.failed))) AS edits,
				uniqExactIf(w.call_id, ${editRequestSql} AND w.call_id != '' AND NOT c.stopped AND c.failed AND NOT c.refused) AS failed_edits,
				uniqExactIf(w.call_id, ${editRequestSql} AND w.call_id != '' AND c.refused) AS refused_edits,
				countIf(kind = 'tool_call' AND NOT ${SCRIPT_RAN_NESTED_SQL}) AS tool_calls,
				uniqExactIf(if(w.call_id != '', w.call_id, concat(toString(record_idx), ':', toString(block_idx))), ${runToolErrorSql()} AND NOT ${SCRIPT_RAN_NESTED_SQL}) AS failed_calls,
				countIf(kind = 'tool_call' AND ${toolActivitySql("read", callGroup)}) AS read_calls,
				countIf(kind = 'tool_call' AND ${toolActivitySql("search", callGroup)}) AS search_calls,
				countIf(kind = 'tool_call' AND (
					((${toolActivitySql("read", callGroup)} OR ${toolActivitySql("search", callGroup)}) AND c.said_nothing_found)
					OR (${toolActivitySql("search", callGroup)} AND c.printed_nothing AND NOT c.silenced))) AS not_found,
				any(w.source) AS run_source, any(w.parser_version) AS run_parser_version${literalFacts}
			FROM work_records w
			LEFT ANY JOIN call_outcomes c ON w.session_id = c.session_id AND w.agent_id = c.agent_id AND w.call_id = c.call_id
			GROUP BY w.session_id, w.agent_id, w.turn_idx
		),
		${boundedRunsCte(FORK_REPLAY_FILTER)}`;
}

/** Failure text that says the target of a read or search was not there. */
const NOT_FOUND_TEXT =
	"(?i)not found|no such file|ENOENT|does not exist|No files found|No matches found";
/**
 * A command that silences or redirects its standard output (`grep -q`,
 * `> file`, `find -delete`), so printing nothing says nothing about what it
 * found. Redirecting standard error (`2>/dev/null`, `2>&1`) does not.
 */
const SILENCED_COMMAND =
	"(^|\\s)(-q|--quiet|--silent|-delete|-exec|-execdir)(\\s|$)|(^|[^0-9&>])>|(^|\\s)1>|&>";

/**
 * What a call's results record about finding nothing (docs/l1-literal-schema.md,
 * `runs.not_found`), per call so a call with several result rows counts once:
 *
 * - `said_nothing_found`: Claude Code's own zero-result text (Grep and Glob
 *   write `No files found` or `No matches found`), a zero counter of the
 *   search's mode (numFiles, numMatches or numLines), its reading of an exit
 *   code (`returnCodeInterpretation` `No matches found`), output that starts
 *   with the shell's `no matches found:` for a file pattern (zsh, so the
 *   search never ran), or a failure whose text (its start, or the end of
 *   its output, where errors are written last) says the target was not there;
 * - `printed_nothing`: a finished command with no output at all (Claude Code
 *   `(Bash completed with no output)` or a bare `Exit code N`, an empty Codex
 *   output, or a Codex process that exited with `Original token count: 0`),
 *   unless the command silences or redirects its output.
 *
 * The second says nothing found only for searches; `run_facts` applies it by
 * tool group. An exit code alone does not: grep and rg exit 1 for no match,
 * but find and ls exit 1 for errors, and a compound command exits with its
 * last part's status.
 */
function foundNothingSql(): string {
	const zeroCounter = `multiIf(facts['search_mode'] = 'content', facts['search_result_lines'],
		facts['search_mode'] = 'count', facts['search_matches'], facts['files_found']) = '0'`;
	return `max(kind IN ('tool_result', 'meta') AND (
					facts['return_code_interpretation'] = 'No matches found' OR ${zeroCounter}
					OR (kind = 'tool_result' AND match(substringUTF8(head, 1, 64), '^(No files found|No matches found|[a-z()]+:[0-9]+: no matches found: )'))
					OR (${toolErrorSql()} AND match(concat(substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '\\n', substringUTF8(tail, -${FACT_TEXT_CHARS})), '${NOT_FOUND_TEXT}')))) AS said_nothing_found,
				max(kind = 'tool_result' AND subtype != 'running' AND (text_chars = 0
					OR (source = 'claude_code' AND (startsWith(head, '(Bash completed with no output)') OR match(substringUTF8(head, 1, 32), '^Exit code [0-9]+$')))
					OR (source = 'codex' AND match(substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '\\nProcess exited with code [0-9]+\\nOriginal token count: 0\\n')))) AS printed_nothing,
				maxIf(match(substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '${SILENCED_COMMAND.replaceAll("\\", "\\\\")}'), kind = 'tool_call') AS silenced`;
}

const REPLAYED_CALLS = "opaline_replayed_calls";

export const FORK_REPLAY_FILTER = `facts['fork_replayed'] != 'true' AND (session_id, agent_id, call_id) NOT IN ${REPLAYED_CALLS}`;

/**
 * The calls a forked Codex stream replays from its parent (`replayed_calls`):
 * the parent's main-stream calls, for each stream whose first session_meta
 * names the parent it was forked from. The child records are those
 * `children` selects (one pinned generation by default, or the committed
 * generations a SQL view reads) and the parents are among the sessions
 * `owner` holds (one member's by default).
 */
export function forkReplayCtes(
	children = pinnedFilter(),
	owner?: string,
): string {
	return `fork_links AS (
			${forkLinksSql(children)}
		),
		${forkParentCallsSql("(user_id, session_id) IN (SELECT user_id, parent_session_id FROM fork_links)", owner)},
		replayed_calls AS (
			SELECT f.user_id AS user_id, f.session_id AS session_id, f.agent_id AS agent_id, p.call_id AS call_id
			FROM fork_links f INNER JOIN parent_calls p ON f.user_id = p.user_id AND f.parent_session_id = p.session_id
		),
		(SELECT groupUniqArray((session_id, agent_id, call_id)) FROM replayed_calls) AS ${REPLAYED_CALLS}`;
}

export function forkReplayOnceCtes(children: string, owner?: string): string {
	const links = "opaline_fork_links";
	const link = `(SELECT arrayJoin(${links}) AS l)`;
	return `(SELECT groupUniqArray((user_id, session_id, agent_id, parent_session_id)) FROM (
			${forkLinksSql(children)}
		)) AS ${links},
		${forkParentCallsSql(`(user_id, session_id) IN (SELECT l.1, l.4 FROM ${link})`, owner)},
		replayed_calls AS (
			SELECT f.l.1 AS user_id, f.l.2 AS session_id, f.l.3 AS agent_id, p.call_id AS call_id
			FROM ${link} AS f INNER JOIN parent_calls p ON f.l.1 = p.user_id AND f.l.4 = p.session_id
		)`;
}

function forkLinksSql(children: string): string {
	return `SELECT DISTINCT user_id, session_id, agent_id, JSONExtractString(component, 'value') AS parent_session_id
			FROM ${records()} ARRAY JOIN JSONExtractArrayRaw(facts['parent_session_components']) AS component
			WHERE ${children} AND source = 'codex' AND parser_version >= 9
				AND (user_id, session_id, agent_id, record_idx) IN (
					SELECT user_id, session_id, agent_id, min(record_idx)
					FROM ${records()} WHERE ${children} AND source = 'codex' AND parser_version >= 9
						AND kind = 'meta' AND subtype = 'session_meta'
					GROUP BY user_id, session_id, agent_id)
				AND JSONExtractString(component, 'path') = 'session_meta/.forked_from_id'
				AND parent_session_id != '' AND parent_session_id != session_id`;
}

/**
 * Each run's line range in its stream, [first_record, boundary): the next
 * run's start, or one past the run's last record.
 */
export function boundedRunsCte(
	replayFilter = "facts['fork_replayed'] != 'true'",
): string {
	return `bounded_runs AS (
			SELECT session_id, agent_id, turn_idx, first_record,
				leadInFrame(first_record, 1, toUInt32(last_record + 1)) OVER (
					PARTITION BY session_id, agent_id ORDER BY first_record
					ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS boundary
			FROM (
				SELECT session_id, agent_id, turn_idx, min(record_idx) AS first_record, max(record_idx) AS last_record
				FROM ${records()} WHERE ${pinnedFilter()} AND turn_idx >= 1 AND ${replayFilter}
				GROUP BY session_id, agent_id, turn_idx
			)
		)`;
}

/**
 * The run facts the parser stores (parser 6 to 8), aggregated per run from
 * its own records; nothing carries over from an earlier run. Codex
 * lifecycle rows (`lifecycle = 1`) are left out here and attributed by
 * `turn_id` in `codex-lifecycle.ts`. Values are copied: the first or last
 * recorded value, every value as a sorted set, or a count of the records
 * that carry one.
 */
function literalRunFacts(): string {
	const f = factColumn;
	const callKey =
		"if(w.call_id != '', w.call_id, concat(toString(record_idx), ':', toString(block_idx)))";
	const skillInput = `if(kind = 'tool_call' AND tool_name = 'Skill', ${jsonStringField("head", "skill")}, '')`;
	const codexSkills = `if(source = 'codex' AND parser_version >= 9, ${skillNamesSql(f("skill_components"))}, [])`;
	const apiError = RUN_EVENT_RECORDS.apiError(f, "provider_error_kind");
	const apiStatuses = RUN_EVENT_RECORDS.apiErrorStatuses(
		f,
		"provider_error_kind",
	);
	const slashCommand =
		"if(kind = 'injected_context' AND subtype = 'slash_command', trimBoth(extract(head, '<command-name>/?([^<]*)</command-name>')), '')";
	const jsonEntries = (column: string) =>
		`arrayFlatten(arrayMap(entry -> JSONExtractArrayRaw(entry.2), arraySort(groupArrayIf(tuple(tuple(record_idx, block_idx), ${column}), ${column} != ''))))`;
	return [
		`uniqExact(record_idx) AS l_record_count`,
		`toUnixTimestamp64Milli(if(countIf(${RUN_ACTIVITY_SQL}) = 0, argMin(ts, tuple(record_idx, block_idx)), argMaxIf(ts, tuple(record_idx, block_idx), ${RUN_ACTIVITY_SQL}))) AS l_ended_ms`,
		`${first("agent_version")} AS l_agent_version`,
		`${first("entrypoint")} AS l_entrypoint`,
		// The run's starting prompt says where it came from, set or not.
		`${first("CAST(subtype, 'String')", "kind = 'user_prompt'")} AS l_prompt_subtype`,
		`${first(f("turn_origin"), "kind = 'user_prompt'")} AS l_turn_origin`,
		`${first(f("prompt_source"), "kind = 'user_prompt'")} AS l_prompt_source`,
		`${first(f("origin_kind"), "kind = 'user_prompt'")} AS l_origin_kind`,
		`${first(f("trigger_turn"))} AS l_trigger_turn`,
		`${first(f("permission_mode"))} AS l_permission_mode`,
		`${sortedSet(f("permission_mode"))} AS l_permission_modes`,
		...[
			"auto_mode_bash_first",
			"auto_mode_bash_first_steer",
			"auto_mode_bypass",
			"auto_mode_steer_only",
			"auto_mode_consent_flow",
			"per_turn_effort",
			"compact_trigger",
			"compact_pre_tokens",
			"hook_stop_reason",
			"fallback_model",
		].map((key) => `${first(f(key))} AS l_${key}`),
		`${first(f("model"), `${f("model")} NOT IN ('', '<synthetic>') AND lifecycle = 0`)} AS l_model`,
		`arraySort(groupUniqArrayIf(${f("model")}, ${f("model")} NOT IN ('', '<synthetic>') AND lifecycle = 0)) AS l_models`,
		`${first(f("effort"), `${f("effort")} != '' AND lifecycle = 0`)} AS l_effort`,
		`arraySort(groupUniqArrayIf(${f("effort")}, ${f("effort")} != '' AND lifecycle = 0)) AS l_efforts`,
		`${first(`arrayElement(${componentStringsSql(f("abort_reason_components"), ".*")}, 1)`)} AS l_abort_reason`,
		`${first(apiError)} AS l_api_error`,
		`uniqExactIf(${callKey}, kind = 'tool_result' AND denial_kind != '' AND denial_kind != 'interrupted') AS l_denied_calls`,
		`uniqExactIf(${callKey}, kind = 'tool_result' AND interrupted_call) AS l_interrupted_calls`,
		// Claude Code moves a call its timeout stopped to the background: a
		// subagent stream has only that hand-off text (no timedOutAfterMs).
		`uniqExactIf(${callKey}, kind = 'tool_result' AND (timed_out_after_ms IS NOT NULL OR ${f("background_launch")} = 'timeout')) AS l_timed_out_calls`,
		// Who accepted each call's permission, and the calls a person decided
		// at a prompt: a user decision with no reasonType (a saved rule's has
		// rule), or a rejection there (Claude Code writes no decision for it).
		`uniqExactIf(${callKey}, permission_decision = 'accept' AND ${USER_DECIDED}) AS l_approvals_by_user`,
		`uniqExactIf(${callKey}, permission_decision = 'accept' AND permission_source = 'hook') AS l_approvals_by_hook`,
		`uniqExactIf(${callKey}, permission_decision = 'accept' AND permission_source = 'config') AS l_approvals_by_config`,
		`uniqExactIf(${callKey}, (${USER_DECIDED} AND permission_reason = '') OR (kind = 'tool_result' AND denial_kind = 'user-rejected')) AS l_permission_prompts`,
		`toUInt8(countIf(kind = 'tool_result' AND denial_kind = '') > 0 AND countIf(permission_decision != '') = 0) AS l_permissions_unrecorded`,
		`uniqExactIf(${callKey}, mcp_server != '') AS l_mcp_calls`,
		`${sortedSet("mcp_server")} AS l_mcp_servers`,

		`arraySort(arrayDistinct(arrayConcat(groupUniqArrayIf(CAST(attribution_skill, 'String'), attribution_skill != ''),
					groupUniqArrayIf(${skillInput}, ${skillInput} != ''),
					groupUniqArrayIf(${f("skill")}, ${f("skill")} != ''),
					arrayFlatten(groupArray(${codexSkills}))))) AS l_skills`,
		`arraySort(groupUniqArrayIf(${slashCommand}, ${slashCommand} != '')) AS l_slash_commands`,
		`countIf(${RUN_EVENT_RECORDS.isCompaction(f)}) AS l_compactions`,
		`countIf(${f("aborted")} = 'true' AND lifecycle = 0) AS l_aborted_true`,
		`countIf(${f("aborted")} = 'false' AND lifecycle = 0) AS l_aborted_false`,
		`countIf(subtype = 'interrupt' AND kind IN ('meta', 'injected_context')) AS l_interrupt_markers`,
		`argMaxIf(${f("stop_reason")}, tuple(record_idx, block_idx), ${f("stop_reason")} != '') AS l_stop_reason`,
		`countIf(${f("prevented_continuation")} = 'true') AS l_prevented_true`,
		`countIf(${f("prevented_continuation")} = 'false') AS l_prevented_false`,
		`countIf(${f("hook_count")} != '') AS l_hook_summaries`,
		`sum(${RUN_EVENT_RECORDS.hooks(f)}) AS l_hook_count`,
		`${jsonEntries(f("hook_errors"))} AS l_hook_errors`,
		`${jsonEntries(f("hook_runs"))} AS l_hook_runs`,
		`uniqExactIf(record_idx, ${RUN_EVENT_RECORDS.isApiError(f, "provider_error_kind")}) AS l_api_errors`,
		`arraySort(arrayDistinct(arrayFlatten(groupArray(${apiStatuses})))) AS l_api_error_statuses`,
		`uniqExactIf(record_idx, ${RUN_EVENT_RECORDS.isRetry(f)}) AS l_retry_attempts`,
		`if(countIf(notEmpty(rate_limit_used)) = 0, NULL, maxIf(arrayMax(rate_limit_used), notEmpty(rate_limit_used))) AS l_rate_limit_max_used_percent`,
		`toUInt8(max(${f("api_error")} = 'rate_limit' OR quota_rejected = 1 OR provider_error_kind = 'usage_limit_exceeded')) AS l_rate_limited`,
		`uniqExactIf(record_idx, ${RUN_EVENT_RECORDS.isRefusal(f, "w.agent_id")}) AS l_refusals`,
		`argMaxIf(${f("goal")}, tuple(record_idx, block_idx), ${f("goal")} != '') AS l_goal`,
		`arraySort(arrayDistinct(arrayConcat(
					CAST(arrayFlatten(groupArrayIf(git_operation, notEmpty(git_operation))), 'Array(String)'),
					if(countIf(c.git_commit_call AND notEmpty(result_commit_shas)) > 0, ['commit'], []),
					if(countIf(c.git_push_call AND notEmpty(result_push_branches)) > 0, ['push'], []),
					if(countIf(c.gh_pr_call AND clean_result = 1) > 0, ['pr'], [])))) AS l_git_operations`,
		`arraySort(arrayDistinct(arrayConcat(${sortedSet(f("git.push.branch"))},
					arrayFlatten(groupArrayIf(result_push_branches, c.git_push_call))))) AS l_pushed_branches`,
		`arraySort(arrayDistinct(arrayConcat(${sortedSet(f("git.commit.sha"))},
					arrayFlatten(groupArrayIf(result_commit_shas, c.git_commit_call))))) AS l_commit_shas`,
		`arraySort(arrayDistinct(arrayConcat(groupUniqArrayIf(${f("git.pr.url")}, ${f("git.pr.url")} != ''),
					groupUniqArrayIf(${f("pr_url")}, ${f("pr_url")} != ''), arrayFlatten(groupArray(result_pr_urls))))) AS l_pr_urls`,
		`countIf(${f("facts_truncated")} = 'true' OR ${f("facts_clipped")} != '') AS l_facts_truncated`,
	].join(",\n\t\t\t\t");
}

const CODEX_AGENT_TYPES_SQL = componentStringsSql(
	"facts['subagent_type_components']",
	"[.]arguments[.]agent_type$",
);

/**
 * Per run, the stream's Codex `thread_source` (from its `session_meta`) and
 * the requested types of Claude Task/Agent and Codex spawn_agent calls.
 * Claude inputs are read from stored text; Codex reads only the named
 * agent_type component, never its requested model or reasoning effort, and a
 * spawn that names none is its built-in "default" agent.
 */
function runContextCtes(): string {
	return `codex_streams AS (
			SELECT session_id, agent_id,
				argMinIf(facts['thread_source'], record_idx, facts['thread_source'] != '') AS stream_thread_source
			FROM ${records()}
			WHERE ${pinnedFilter()} AND source = 'codex' AND kind = 'meta' AND subtype = 'session_meta'
			GROUP BY session_id, agent_id
		),
		run_delegations AS (
			SELECT session_id, agent_id, turn_idx, arraySort(groupUniqArrayIf(subagent_type, subagent_type != '')) AS subagent_types
			FROM (
				SELECT session_id, agent_id, turn_idx, arrayJoin(if(source = 'codex' AND parser_version >= 9,
					if(kind = 'tool_call' AND tool_name = 'spawn_agent' AND empty(${CODEX_AGENT_TYPES_SQL}),
						['default'], ${CODEX_AGENT_TYPES_SQL}),
					[${jsonStringField("text", "subagent_type")}])) AS subagent_type
				FROM ${records()}
				WHERE ${pinnedFilter()} AND turn_idx >= 1 AND ${FORK_REPLAY_FILTER}
					AND (kind = 'tool_call' AND tool_name IN ('Task', 'Agent')
						OR source = 'codex' AND parser_version >= 9 AND facts['subagent_type_components'] != ''
						OR source = 'codex' AND parser_version >= 9 AND kind = 'tool_call' AND tool_name = 'spawn_agent')
			)
			GROUP BY session_id, agent_id, turn_idx
		)`;
}

/** A Codex turn lifecycle row with the facts it carries (`codex-lifecycle.ts` attributes it to a run). */
export const CodexLifecycleRowSchema = z.object({
	agent_id: text,
	record_idx: count,
	block_idx: count,
	turn_idx: count,
	subtype: text,
	turn_id: text,
	task_duration_ms: z.number().nullable(),
	approval_policy: text,
	approvals_reviewer: text,
	sandbox_policy: text,
	sandbox_network_access: text,
	permission_profile: text,
	collaboration_mode: text,
	model: text,
	effort: text,
	context_window: text,
	time_to_first_token_ms: text,
	turn_error: text,
	turn_error_kind: text,
	aborted: text,
	abort_reason: text,
} satisfies Record<string, z.ZodType> &
	Record<(typeof LIFECYCLE_FACT_KEYS)[number], z.ZodType>);
export type CodexLifecycleRow = z.infer<typeof CodexLifecycleRowSchema>;

/**
 * The Codex turn lifecycle rows of one generation (few per turn), in record
 * order. A retried insert repeats identical rows; grouping keeps one.
 */
export function buildCodexLifecycleStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT agent_id, record_idx, block_idx, turn_idx, subtype,
				any(facts['turn_id']) AS turn_id, any(duration_ms) AS task_duration_ms,
				${LIFECYCLE_FACT_KEYS.map((key) =>
					key === "permission_profile"
						? "any(if(parser_version >= 9, facts['permission_profile_id'], facts['permission_profile'])) AS permission_profile"
						: `any(facts['${key}']) AS ${key}`,
				).join(", ")}
			FROM ${records()}
			WHERE ${pinnedFilter()} AND source = 'codex' AND kind = 'meta' AND subtype IN ${CODEX_LIFECYCLE_SUBTYPES}
				AND facts['fork_replayed'] != 'true'
			GROUP BY agent_id, record_idx, block_idx, turn_idx, subtype
			ORDER BY agent_id, record_idx, block_idx`,
		query_params: pinnedParams(scope, [generation]),
	};
}

/** Where each turn of a Codex stream starts, and its last response record (0 when none). */
export const CodexTurnMarkSchema = z.object({
	agent_id: text,
	turn_idx: count,
	turn_start: count,
	last_response: count,
});
export type CodexTurnMark = z.infer<typeof CodexTurnMarkSchema>;

export function buildCodexTurnMarksStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT agent_id, turn_idx, min(record_idx) AS turn_start,
				maxIf(record_idx, kind IN ${RESPONSE_KINDS}) AS last_response
			FROM ${records()}
			WHERE ${pinnedFilter()} AND source = 'codex' AND facts['fork_replayed'] != 'true'
			GROUP BY agent_id, turn_idx
			ORDER BY agent_id, turn_idx`,
		query_params: pinnedParams(scope, [generation]),
	};
}

/** The model a usage event is attributed to: resolved, else as recorded. */
export const USAGE_MODEL_SQL =
	"if(e.resolved_model != '', e.resolved_model, e.raw_model)";

/**
 * Sum of the priced costs, or NULL when none of them is priced: unpriced usage
 * never reads as a zero cost.
 */
function pricedSubtotalSql(costExpression: string): string {
	return `if(countIf(${costExpression} IS NOT NULL) = 0, NULL, round(sum(ifNull(${costExpression}, 0)), 12))`;
}

const AMBIGUOUS_FLAGS =
	"['subagent_id_collides_with_main', 'agent_identity_conflict', 'sidechain_agent_id_missing']";
const TOKEN_KINDS = [
	"uncached_input_tokens",
	"cache_read_input_tokens",
	"cache_write_5m_input_tokens",
	"cache_write_1h_input_tokens",
	"output_tokens",
	"reasoning_output_tokens",
] as const;

/**
 * Usage events of the pinned sessions, priced, with the stream each one
 * belongs to. Only unambiguous events are `verified`: Codex events resolve
 * their stream from the pinned record at that line and must find exactly
 * one. Claude Code repeats one response on a line per content block, so most
 * events have duplicate observations; those stay verified when all
 * observations came from one transcript, i.e. their `lineage_id` (a hash of
 * the transcripts observed) is also the lineage of an unduplicated event. A
 * response seen in several transcripts, or carrying an identity flag, has a
 * stored line that may belong to another stream. Unverified cost is reported
 * per session, never guessed onto a run.
 *
 * With `generation`, every usage read is bound to one usage extraction of
 * one session stream (`{usageGeneration:UInt64}`, `{source:String}`): the
 * run index prices a complete, consistent set of events, never a mix of two
 * extractions. `find` reads every active event.
 */
export function usageEventCtes(options: { generation?: boolean } = {}): string {
	const generation = options.generation
		? " AND event_version = {usageGeneration:UInt64}"
		: "";
	const source = options.generation ? " AND e.source = {source:String}" : "";
	return `${buildPricedUsageEventsCte(`e.organization_id = {organizationId:String} AND e.user_id = {userId:String}${source} AND e.session_id IN {sessionIds:Array(String)}${generation.replace("event_version", "e.event_version")}`)},
		claude_single_lineages AS (
			SELECT DISTINCT session_id, lineage_id FROM ${getSafeClickHouseTable("rudel.usage_events")} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id IN {sessionIds:Array(String)}
				AND source = 'claude_code' AND record_kind = 'event' AND is_deleted = 0 AND duplicate_observation_count = 0${generation}
		),
		codex_line_streams AS (
			SELECT session_id, record_idx, any(agent_id) AS stream, uniqExact(agent_id) AS streams
			FROM ${records()} WHERE ${pinnedFilter()} AND source = 'codex'
			GROUP BY session_id, record_idx
		),
		resolved_usage AS (
			SELECT e.*, if(e.source = 'codex', l.stream, if(e.agent_id = 'main', '', e.agent_id)) AS stream,
				toUInt8(e.agent_id != '' AND NOT hasAny(e.quality_flags, ${AMBIGUOUS_FLAGS})
					AND if(e.source = 'codex', l.streams = 1,
						e.duplicate_observation_count = 0 OR (e.session_id, e.lineage_id) IN (SELECT session_id, lineage_id FROM claude_single_lineages))) AS verified
			FROM analysis_priced_events e
			LEFT ANY JOIN codex_line_streams l ON e.session_id = l.session_id AND e.first_observed_line = l.record_idx
		)`;
}

/** Per model of a group of usage events `e`: counts, priced cost, tokens and the first and latest event. */
function modelUsageColumns(): string {
	return `${USAGE_MODEL_SQL} AS usage_model,
				count() AS model_observations, countIf(e.estimated_cost IS NULL) AS model_unpriced,
				${pricedSubtotalSql("e.estimated_cost")} AS model_cost,
				${TOKEN_KINDS.map((kind) => `sum(e.${kind}) AS model_${kind}`).join(", ")},
				min(tuple(e.first_observed_line, e.event_version, e.event_id, e.context_input_tokens)) AS first_seen,
				max(tuple(e.first_observed_line, e.event_version, e.event_id)) AS last_seen`;
}

/** Totals over the per-model rows of `modelUsageColumns`. */
function usageTotalColumns(): string {
	return `sum(model_observations) AS observations, sum(model_unpriced) AS unpriced,
				${pricedSubtotalSql("model_cost")} AS cost,
				argMax(usage_model, last_seen) AS model,
				arrayReverseSort(pair -> ifNull(pair.2, -1), groupArray(tuple(usage_model, model_cost, model_unpriced))) AS model_costs,
				${TOKEN_KINDS.map((kind) => `sum(model_${kind}) AS ${kind}`).join(", ")},
				tupleElement(min(first_seen), 4) AS context_input_tokens_at_start`;
}

/** A verified usage event on a line of the run's range [first_record, boundary) of its stream. */
const RUN_USAGE_JOIN = `bounded_runs r INNER JOIN resolved_usage e ON r.session_id = e.session_id AND r.agent_id = e.stream
			WHERE e.verified = 1 AND e.first_observed_line >= r.first_record AND e.first_observed_line < r.boundary`;

/**
 * A usage event prices a run when it is verified and its line falls in the
 * run's range; every other event of the session (unverified, or verified on
 * a line no run covers, such as before the first prompt) is `unassigned_usage`,
 * reported per session and never guessed onto a run. Together they are every
 * event, each exactly once.
 */
export function runUsageCtes(): string {
	return `run_model_costs AS (
			SELECT r.session_id AS session_id, r.agent_id AS agent_id, r.turn_idx AS turn_idx, ${modelUsageColumns()}
			FROM ${RUN_USAGE_JOIN}
			GROUP BY r.session_id, r.agent_id, r.turn_idx, usage_model
		),
		assigned_usage AS (
			SELECT DISTINCT e.session_id AS session_id, e.source AS source, e.event_id AS event_id
			FROM ${RUN_USAGE_JOIN}
		),
		unassigned_usage AS (
			SELECT * FROM resolved_usage
			WHERE (session_id, source, event_id) NOT IN (SELECT session_id, source, event_id FROM assigned_usage)
		),
		run_costs AS (
			SELECT session_id, agent_id, turn_idx, ${usageTotalColumns()}
			FROM run_model_costs
			GROUP BY session_id, agent_id, turn_idx
		)`;
}

const ModelCostsSchema = z.array(
	z.tuple([z.string(), z.number().nullable(), z.coerce.number()]),
);
/** UInt64 sums, selected as decimal strings (the API reads 64-bit integers as JSON numbers); NULL without usage. */
const tokens = z.string().nullable();
const usageShape = {
	usage_observations: count,
	usage_unpriced: count,
	usage_model: text,
	cost_usd: z.number().nullable(),
	model_costs: ModelCostsSchema,
	uncached_input_tokens: tokens,
	cache_read_input_tokens: tokens,
	cache_write_5m_input_tokens: tokens,
	cache_write_1h_input_tokens: tokens,
	output_tokens: tokens,
	reasoning_output_tokens: tokens,
	context_input_tokens_at_start: tokens,
} satisfies Record<string, z.ZodType>;

/**
 * A transcript generation with the usage extraction (`event_version` of its
 * receipt) its costs are bound to; '0' binds none, so no usage is read.
 */
export interface UsageBoundGeneration extends SessionGeneration {
	readonly usageGeneration: string;
	readonly source: string;
}

/** One run of a generation with its stored facts, before gating (`run-index-columns.ts`). */
export const RunIndexFactsRowSchema = z.object({
	session_id: text,
	agent_id: text,
	turn_idx: count,
	start_record: count,
	end_record: count,
	started_ms: z.coerce.number(),
	ended_ms: z.coerce.number(),
	minutes: z.coerce.number(),
	active_minutes: z.coerce.number(),
	record_count: count,
	raw_chars: z.coerce.string(),
	genuine_prompts: count,
	prompt_head: text,
	edits: count,
	failed_edits: count,
	refused_edits: count,
	tool_calls: count,
	failed_calls: count,
	reads: count,
	searches: count,
	not_found: count,
	l_agent_version: text,
	l_entrypoint: text,
	l_prompt_subtype: text,
	l_turn_origin: text,
	l_prompt_source: text,
	l_origin_kind: text,
	l_trigger_turn: text,
	l_permission_mode: text,
	l_permission_modes: strings,
	l_auto_mode_bash_first: text,
	l_auto_mode_bash_first_steer: text,
	l_auto_mode_bypass: text,
	l_auto_mode_steer_only: text,
	l_auto_mode_consent_flow: text,
	l_per_turn_effort: text,
	l_compact_trigger: text,
	l_compact_pre_tokens: text,
	l_hook_stop_reason: text,
	l_api_error: text,
	l_abort_reason: text,
	l_fallback_model: text,
	l_model: text,
	l_models: strings,
	l_effort: text,
	l_efforts: strings,
	l_denied_calls: count,
	l_interrupted_calls: count,
	l_timed_out_calls: count,
	l_approvals_by_user: count,
	l_approvals_by_hook: count,
	l_approvals_by_config: count,
	l_permission_prompts: count,
	l_permissions_unrecorded: count,
	l_mcp_calls: count,
	l_mcp_servers: strings,
	l_skills: strings,
	l_slash_commands: strings,
	l_compactions: count,
	l_aborted_true: count,
	l_aborted_false: count,
	l_interrupt_markers: count,
	l_stop_reason: text,
	l_prevented_true: count,
	l_prevented_false: count,
	l_hook_summaries: count,
	l_hook_count: count,
	l_hook_errors: strings,
	l_hook_runs: strings,
	l_api_errors: count,
	l_api_error_statuses: strings,
	l_retry_attempts: count,
	l_rate_limit_max_used_percent: z.number().nullable(),
	l_rate_limited: count,
	l_refusals: count,
	l_goal: text,
	l_git_operations: strings,
	l_pushed_branches: strings,
	l_commit_shas: strings,
	l_pr_urls: strings,
	l_facts_truncated: count,
	thread_source: text,
	subagent_types: strings,
	...usageShape,
});
export type RunIndexFactsRow = z.infer<typeof RunIndexFactsRowSchema>;

const LITERAL_COLUMNS = Object.keys(RunIndexFactsRowSchema.shape).filter(
	(column) => column.startsWith("l_"),
);

/**
 * Every run of one committed generation with its literal facts and priced
 * usage, in stream and start order: one statement for the whole session.
 */
export function buildRunIndexStatement(
	scope: TranscriptReadScope,
	generation: UsageBoundGeneration,
): ClickHouseStatement {
	const usage = (column: string, alias = column) =>
		`if(c.observations = 0, NULL, c.${column}) AS ${alias}`;
	const tokenCount = (column: string) =>
		`if(c.observations = 0, NULL, toString(c.${column})) AS ${column}`;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${runFactsCtes({ literal: true })},
			${runContextCtes()},
			${usageEventCtes({ generation: true })},
			${runUsageCtes()}
			SELECT r.session_id AS session_id, r.agent_id AS agent_id, r.turn_idx AS turn_idx,
				r.first_record AS start_record, b.boundary AS end_record,
				r.started_ms AS started_ms, r.l_ended_ms AS ended_ms, r.minutes AS minutes,
				r.active_minutes AS active_minutes, r.l_record_count AS record_count, r.raw_chars AS raw_chars,
				r.genuine_prompt AS genuine_prompts, r.prompt_head AS prompt_head, r.edits AS edits,
				r.failed_edits AS failed_edits, r.refused_edits AS refused_edits,
				r.tool_calls AS tool_calls, r.failed_calls AS failed_calls, r.read_calls AS reads,
				r.search_calls AS searches, r.not_found AS not_found,
				${LITERAL_COLUMNS.map((column) => `r.${column} AS ${column}`).join(", ")},
				st.stream_thread_source AS thread_source, d.subagent_types AS subagent_types,
				c.observations AS usage_observations, c.unpriced AS usage_unpriced, c.model AS usage_model,
				${usage("cost", "cost_usd")}, c.model_costs AS model_costs,
				${TOKEN_KINDS.map((kind) => tokenCount(kind)).join(", ")},
				${tokenCount("context_input_tokens_at_start")}
			FROM run_facts r
			LEFT ANY JOIN bounded_runs b ON r.session_id = b.session_id AND r.agent_id = b.agent_id AND r.turn_idx = b.turn_idx
			LEFT ANY JOIN codex_streams st ON r.session_id = st.session_id AND r.agent_id = st.agent_id
			LEFT ANY JOIN run_delegations d ON r.session_id = d.session_id AND r.agent_id = d.agent_id AND r.turn_idx = d.turn_idx
			LEFT ANY JOIN run_costs c ON r.session_id = c.session_id AND r.agent_id = c.agent_id AND r.turn_idx = c.turn_idx
			ORDER BY agent_id, start_record`,
		query_params: {
			...pinnedParams(scope, [generation]),
			usageGeneration: generation.usageGeneration,
			source: generation.source,
		},
	};
}

/**
 * The session's usage no run claims, as on the receipt, and the totals of
 * every event of the bound usage extraction: runs plus unattributed must
 * add up to them (`total_` columns), or the build is not published.
 */
export const UnattributedUsageRowSchema = z.object({
	...usageShape,
	total_observations: count,
	total_unpriced: count,
	total_cost_usd: z.number().nullable(),
	...Object.fromEntries(TOKEN_KINDS.map((kind) => [`total_${kind}`, text])),
} as typeof usageShape & {
	total_observations: typeof count;
	total_unpriced: typeof count;
	total_cost_usd: z.ZodNullable<z.ZodNumber>;
} & Record<`total_${(typeof TOKEN_KINDS)[number]}`, typeof text>);
export type UnattributedUsageRow = z.infer<typeof UnattributedUsageRowSchema>;

export function buildUnattributedUsageStatement(
	scope: TranscriptReadScope,
	generation: UsageBoundGeneration,
): ClickHouseStatement {
	const usage = (column: string, alias = column) =>
		`if(u.observations = 0, NULL, u.${column}) AS ${alias}`;
	const tokenCount = (column: string) =>
		`if(u.observations = 0, NULL, toString(u.${column})) AS ${column}`;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${forkReplayCtes()}, ${boundedRunsCte(FORK_REPLAY_FILTER)},
			${usageEventCtes({ generation: true })},
			${runUsageCtes()},
			unattributed_models AS (
				SELECT ${modelUsageColumns()}
				FROM unassigned_usage e
				GROUP BY usage_model
			),
			unattributed AS (SELECT ${usageTotalColumns()} FROM unattributed_models),
			whole_models AS (
				SELECT ${modelUsageColumns()}
				FROM resolved_usage e
				GROUP BY usage_model
			),
			whole AS (SELECT ${usageTotalColumns()} FROM whole_models)
			SELECT u.observations AS usage_observations, u.unpriced AS usage_unpriced, u.model AS usage_model,
				${usage("cost", "cost_usd")}, u.model_costs AS model_costs,
				${TOKEN_KINDS.map((kind) => tokenCount(kind)).join(", ")},
				${tokenCount("context_input_tokens_at_start")},
				t.observations AS total_observations, t.unpriced AS total_unpriced, t.cost AS total_cost_usd,
				${TOKEN_KINDS.map((kind) => `toString(t.${kind}) AS total_${kind}`).join(", ")}
			FROM unattributed u CROSS JOIN whole t`,
		query_params: {
			...pinnedParams(scope, [generation]),
			usageGeneration: generation.usageGeneration,
			source: generation.source,
		},
	};
}

/** Characters of a request's last assistant text kept with it. */
export const REQUEST_TEXT_HEAD_CHARS = 160;
/** Records a model writes in a response; any other non-meta record is input to the next one. */
const RESPONSE_RECORD_KINDS = "('assistant_text', 'reasoning', 'tool_call')";

const PLACED_USAGE = "opaline_placed_usage";
const PLACED_USAGE_COLUMNS = [
	"session_id",
	"stream",
	"line",
	"verified",
	"estimated_cost",
	"resolved_model",
	"raw_model",
	"first_observed_line",
	"event_version",
	"event_id",
	...TOKEN_KINDS,
] as const;

/**
 * The requests of each run (docs/l1-literal-schema.md, "Scale"): one model
 * response and the calls it made. A request starts at a response record
 * (assistant text, reasoning or a tool call) whose previous record in the
 * run, meta and file-change rows aside, is not one: the prompt, a tool
 * result or injected context came first. Claude Code writes one response
 * over several lines and may write a tool result between two of them; where
 * the stream has usage, a Claude request therefore starts only on the first
 * line of a usage event (a response), or at the run's first candidate. A
 * Claude response can open with a line that carries only usage (no content,
 * so a meta record): its event then stands at the response's first record
 * after it, for its request's start and for the request its usage is on.
 * Codex writes one usage event per response, after its items, so its
 * requests start by the records alone.
 *
 * A request's lines run to the next request's start, or to the run's end;
 * the first request's usage lines start at the run's start, so every
 * verified usage event of a run that has a request is on exactly one of its
 * requests. Its time starts when the model was asked (the run's previous
 * non-meta record) and ends at its own last activity record
 * (RUN_ACTIVITY_SQL): the run's last request does not run on into a
 * compaction a local command added after the answer.
 */
function runRequestsCtes(): string {
	const run = "PARTITION BY session_id, agent_id, turn_idx";
	const order = "ORDER BY record_idx, block_idx";
	return `${forkReplayCtes()}, ${boundedRunsCte(FORK_REPLAY_FILTER)},
			${usageEventCtes({ generation: true })},
			response_lines AS (
				SELECT session_id, agent_id, record_idx, max(kind IN ${RESPONSE_RECORD_KINDS}) AS response
				FROM ${records()}
				WHERE ${pinnedFilter()} AND kind != 'meta' AND ${FORK_REPLAY_FILTER}
				GROUP BY session_id, agent_id, record_idx
			),
			(SELECT groupArray((${PLACED_USAGE_COLUMNS.join(", ")}))
				FROM (
					SELECT e.*, if(e.source = 'claude_code' AND l.response = 1, l.record_idx, e.first_observed_line) AS line
					FROM resolved_usage e
					ASOF LEFT JOIN response_lines l
						ON e.session_id = l.session_id AND e.stream = l.agent_id AND e.first_observed_line <= l.record_idx
				)) AS ${PLACED_USAGE},
			placed_usage AS (
				SELECT ${PLACED_USAGE_COLUMNS.map((column, index) => `u.${index + 1} AS ${column}`).join(", ")}
				FROM (SELECT arrayJoin(${PLACED_USAGE}) AS u)
			),
			call_outcomes AS (
				SELECT session_id, agent_id, call_id, max(${runToolErrorSql()}) AS failed
				FROM ${records()}
				WHERE ${pinnedFilter()} AND kind IN ('tool_result', 'meta') AND call_id != '' AND ${FORK_REPLAY_FILTER}
				GROUP BY session_id, agent_id, call_id
			),
			request_work AS (
				SELECT session_id, agent_id, turn_idx, record_idx, block_idx, ts, kind, source, tool_name, call_id, command_class,
					if(kind IN ('assistant_text', 'tool_call'), substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '') AS head,
					toUInt8(kind IN ${RESPONSE_RECORD_KINDS}) AS response,
					if(kind = 'file_change', NULL, toUInt8(kind IN ${RESPONSE_RECORD_KINDS})) AS boundary_class,
					anyLast(boundary_class) OVER (${run} ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_class,
					count() OVER (${run} ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS earlier_rows,
					anyLast(ts) OVER (${run} ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_ts
				FROM ${records()} FINAL
				WHERE ${pinnedFilter()} AND turn_idx >= 1 AND kind != 'meta' AND ${FORK_REPLAY_FILTER}
			),
			request_candidates AS (
				SELECT *, toUInt8(response = 1 AND ifNull(previous_class, 0) = 0) AS candidate,
					sum(candidate) OVER (${run} ${order} ROWS UNBOUNDED PRECEDING) AS candidate_number,
					toUInt8((session_id, agent_id, record_idx) IN arrayMap(p -> (p.1, p.2, p.3), ${PLACED_USAGE})) AS event_line,
					toUInt8((session_id, agent_id) IN arrayMap(p -> (p.1, p.2), ${PLACED_USAGE})) AS stream_has_usage
				FROM request_work
			),
			request_marks AS (
				SELECT *,
					toUInt8(candidate = 1 AND (source != 'claude_code' OR stream_has_usage = 0 OR event_line = 1 OR candidate_number = 1)) AS request_start,
					max(if(request_start = 1, toNullable(record_idx), NULL)) OVER (${run} ${order} ROWS UNBOUNDED PRECEDING) AS request
				FROM request_candidates
			),
			request_facts AS (
				SELECT m.session_id AS session_id, m.agent_id AS agent_id, m.turn_idx AS turn_idx, assumeNotNull(m.request) AS start_record,
					toUnixTimestamp64Milli(argMinIf(if(earlier_rows = 0, ts, previous_ts), tuple(record_idx, block_idx), request_start = 1)) AS started_ms,
					toUnixTimestamp64Milli(maxIf(ts, ${RUN_ACTIVITY_SQL})) AS ended_ms,
					arraySort(groupArrayIf(tuple(record_idx, block_idx, toString(tool_name),
						${toolGroupSql("tool_name", "head")}, toString(command_class), toUInt8(o.failed)), kind = 'tool_call')) AS calls,
					countIf(kind = 'assistant_text') AS texts,
					argMaxIf(record_idx, tuple(record_idx, block_idx), kind = 'assistant_text') AS text_record,
					argMaxIf(block_idx, tuple(record_idx, block_idx), kind = 'assistant_text') AS text_block,
					argMaxIf(substringUTF8(head, 1, ${REQUEST_TEXT_HEAD_CHARS}), tuple(record_idx, block_idx), kind = 'assistant_text') AS text_head
				FROM request_marks m
				LEFT ANY JOIN call_outcomes o ON m.session_id = o.session_id AND m.agent_id = o.agent_id AND m.call_id = o.call_id
				WHERE m.request IS NOT NULL
				GROUP BY m.session_id, m.agent_id, m.turn_idx, m.request
			),
			request_ranges AS (
				SELECT q.*, b.first_record AS run_start_record,
					leadInFrame(q.start_record, 1, b.boundary) OVER (
						PARTITION BY q.session_id, q.agent_id, q.turn_idx ORDER BY q.start_record
						ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS end_record,
					if(row_number() OVER (PARTITION BY q.session_id, q.agent_id, q.turn_idx ORDER BY q.start_record) = 1,
						b.first_record, q.start_record) AS usage_from
				FROM request_facts q
				INNER JOIN bounded_runs b ON q.session_id = b.session_id AND q.agent_id = b.agent_id AND q.turn_idx = b.turn_idx
			),
			request_usage AS (
				SELECT q.session_id AS session_id, q.agent_id AS agent_id, q.start_record AS start_record,
					count() AS observations, countIf(e.estimated_cost IS NULL) AS unpriced,
					${pricedSubtotalSql("e.estimated_cost")} AS cost,
					argMax(${USAGE_MODEL_SQL}, tuple(e.first_observed_line, e.event_version, e.event_id)) AS model,
					${TOKEN_KINDS.map((kind) => `sum(e.${kind}) AS ${kind}`).join(", ")}
				FROM (SELECT * FROM placed_usage WHERE verified = 1) e
				ASOF INNER JOIN request_ranges q
					ON e.session_id = q.session_id AND e.stream = q.agent_id AND e.line >= q.usage_from
				WHERE e.line < q.end_record
				GROUP BY q.session_id, q.agent_id, q.start_record
			)`;
}

/** One request of a generation with its calls and priced usage. */
export const RunRequestFactsRowSchema = z.object({
	agent_id: text,
	turn_idx: count,
	run_start_record: count,
	start_record: count,
	end_record: count,
	started_ms: z.coerce.number(),
	ended_ms: z.coerce.number(),
	/** (record, block, tool, group, command class, failed), in record order. */
	calls: z.array(z.tuple([count, count, text, text, text, count])),
	texts: count,
	text_record: count,
	text_block: count,
	text_head: text,
	usage_observations: count,
	usage_unpriced: count,
	usage_model: text,
	cost_usd: z.number().nullable(),
	uncached_input_tokens: tokens,
	cache_read_input_tokens: tokens,
	cache_write_5m_input_tokens: tokens,
	cache_write_1h_input_tokens: tokens,
	output_tokens: tokens,
	reasoning_output_tokens: tokens,
});
export type RunRequestFactsRow = z.infer<typeof RunRequestFactsRowSchema>;

/**
 * Every request of one committed generation with its calls and priced usage,
 * in stream and start order: one statement for the whole session.
 */
export function buildRunRequestsStatement(
	scope: TranscriptReadScope,
	generation: UsageBoundGeneration,
): ClickHouseStatement {
	const tokenCount = (column: string) =>
		`if(u.observations = 0, NULL, toString(u.${column})) AS ${column}`;
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${runRequestsCtes()}
			SELECT q.agent_id AS agent_id, q.turn_idx AS turn_idx, q.run_start_record AS run_start_record,
				q.start_record AS start_record, q.end_record AS end_record,
				q.started_ms AS started_ms, q.ended_ms AS ended_ms, q.calls AS calls,
				q.texts AS texts, q.text_record AS text_record, q.text_block AS text_block, q.text_head AS text_head,
				u.observations AS usage_observations, u.unpriced AS usage_unpriced, u.model AS usage_model,
				if(u.observations = 0, NULL, u.cost) AS cost_usd,
				${TOKEN_KINDS.map((kind) => tokenCount(kind)).join(", ")}
			FROM request_ranges q
			LEFT ANY JOIN request_usage u ON q.session_id = u.session_id AND q.agent_id = u.agent_id AND q.start_record = u.start_record
			ORDER BY agent_id, start_record`,
		query_params: {
			...pinnedParams(scope, [generation]),
			usageGeneration: generation.usageGeneration,
			source: generation.source,
		},
	};
}

/** Session facts of one generation for its receipt. */
export const RunIndexSessionFactsSchema = z.object({
	session_date_ms: z.coerce.number(),
	thread_source: text,
	title: text,
	cost_state: z.record(z.string(), z.string()),
	cost_state_duration_ms: z.number().nullable(),
	has_cost_state: count,
});
export type RunIndexSessionFacts = z.infer<typeof RunIndexSessionFactsSchema>;

/**
 * The generation's session date (from its receipt row), the main stream's
 * Codex thread_source, and its last Claude ai-title and cost-state record
 * (cumulative, so the last one holds the totals).
 */
export function buildRunIndexSessionStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
	calls?: { readonly ctes: string; readonly sql: string },
): ClickHouseStatement {
	const costState =
		"agent_id = '' AND kind = 'meta' AND subtype = 'cost-state'";
	const facts = `SELECT
				toUnixTimestamp64Milli(anyIf(session_date, record_idx = ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX})) AS session_date_ms,
				argMinIf(facts['thread_source'], record_idx, agent_id = '' AND kind = 'meta' AND subtype = 'session_meta' AND facts['thread_source'] != '') AS thread_source,
				argMaxIf(facts['title'], tuple(record_idx, block_idx), agent_id = '' AND kind = 'meta' AND subtype = 'ai-title' AND facts['title'] != '') AS title,
				argMaxIf(mapFilter((k, v) -> k IN (${COST_STATE_KEYS.map((key) => `'${key}'`).join(", ")}), facts), tuple(record_idx, block_idx), ${costState}) AS cost_state,
				-- In a tuple, so a NULL duration stays the last record's, not an earlier one's.
				tupleElement(argMaxIf(tuple(duration_ms), tuple(record_idx, block_idx), ${costState}), 1) AS cost_state_duration_ms,
				countIf(${costState}) AS has_cost_state
			FROM ${records()}
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id = {sessionId:String} AND revision = toUInt64({revision:String})
				AND parser_version = {parserVersion:UInt16}`;
	const params = {
		...scope,
		sessionId: generation.sessionId,
		revision: generation.revision,
		parserVersion: generation.parserVersion,
	};
	if (!calls)
		return {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			query: facts,
			query_params: params,
		};
	return {
		clickhouse_settings: {
			...ANALYSIS_QUERY_SETTINGS,
			max_result_bytes: SESSION_CALLS_MAX_RESULT_BYTES,
		},
		query: `WITH ${calls.ctes}
			SELECT f.*, k.calls AS calls
			FROM (${facts}) AS f CROSS JOIN (${calls.sql}) AS k`,
		query_params: { ...pinnedParams(scope, [generation]), ...params },
	};
}

const SESSION_CALLS_MAX_RESULT_BYTES = "268435456";

/**
 * A Claude Code record of its MCP servers' state: a deferred_tools_delta
 * that lists servers needing authentication, still connecting or failed (a
 * delta that only adds tools lists none and says nothing about them).
 */
const MCP_STATE_RECORD = `source = 'claude_code' AND kind = 'meta' AND subtype = 'attachment:deferred_tools_delta'
	AND match(facts['mcp_server_state_components'], '[.](needsAuthMcpServers|pendingMcpServers|failedMcpServers)')`;

/**
 * The servers a server-state record lists as needing authentication or
 * failed, sorted: the needsAuthMcpServers names and the name of each
 * failedMcpServers entry (an object with name, errorCode and error).
 */
const MCP_UNAVAILABLE = `arraySort(arrayDistinct(arrayFilter(name -> name != '', arrayFlatten(arrayMap(component -> multiIf(
		endsWith(JSONExtractString(component, 'path'), '.needsAuthMcpServers[]'), [JSONExtractString(component, 'value')],
		endsWith(JSONExtractString(component, 'path'), '.failedMcpServers'), arrayMap(entry -> if(JSONType(entry) = 'String', JSONExtractString(entry), JSONExtractString(entry, 'name')),
			JSONExtractArrayRaw(component, 'value')),
		CAST([], 'Array(String)')), JSONExtractArrayRaw(facts['mcp_server_state_components']))))))`;

/** Per stream and run, the servers its last server-state record lists as unavailable. */
export const McpStateRowSchema = z.object({
	agent_id: text,
	turn_idx: count,
	unavailable: strings,
});
export type McpStateRow = z.infer<typeof McpStateRowSchema>;

/**
 * Each stream's MCP server-state records of one generation, the last of
 * each run (turn 0 holds those before the stream's first prompt): the build
 * carries a run's to the stream's later runs (`carriedMcpUnavailable`).
 */
export function buildMcpStateStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: mcpStateSql(),
		query_params: pinnedParams(scope, [generation]),
	};
}

function mcpStateSql(): string {
	return `SELECT agent_id, turn_idx, argMax(${MCP_UNAVAILABLE}, tuple(record_idx, block_idx)) AS unavailable
			FROM ${records()}
			WHERE ${pinnedFilter()} AND ${MCP_STATE_RECORD}
			GROUP BY agent_id, turn_idx
			ORDER BY agent_id, turn_idx`;
}

/** How a build's directory statements leave out a forked Codex session's replayed calls, as the run facts do. */
export const RUN_FORK_REPLAY: ForkReplayRules = {
	ctes: forkReplayCtes(),
	filter: FORK_REPLAY_FILTER,
};

/** Pricing, literal SQL and per-agent gates fingerprint every build, so a change to any of them rebuilds the stored generations. */
export const RUN_INDEX_PRICING_VERSION = `${MODEL_RATE_CARD_VERSION}+${createHash(
	"sha256",
)
	.update(buildPricedUsageEventsCte(""))
	.update(runFactsCtes({ literal: true }))
	.update(runContextCtes())
	.update(runRequestsCtes())
	.update(JSON.stringify(RUN_INDEX_FACT_COLUMNS))
	.update(runDirectoryRules(RUN_FORK_REPLAY))
	.update(mcpStateSql())
	.update(
		"codex-per-turn-effort:lifecycle;claude-abort:l_abort_reason;efforts:lifecycle;rate-limited:lifecycle-usage-limit;permissions:unrecorded",
	)
	.digest("hex")
	.slice(0, 12)}`;
