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
import { RUN_INDEX_FACT_COLUMNS } from "./run-index-columns.js";
import {
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

/** Version of the run index rules; a new version is a new run index generation. */
export const RUN_INDEX_VERSION = 2;

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
/** The first value of `expression` in record order among rows where it is set. */
const first = (expression: string, condition = `${expression} != ''`) =>
	`argMinIf(${expression}, tuple(record_idx, block_idx), ${condition})`;
const sortedSet = (expression: string) =>
	`arraySort(groupUniqArrayIf(${expression}, ${expression} != ''))`;

function runToolErrorSql(): string {
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
 * Every CTE reference is a separate scan in ClickHouse, so the facts read the
 * pinned records' wide columns (`head`, `tail`) in exactly one scan,
 * `work_records`, which is also the only one that needs `FINAL`: its counts and
 * sums would double on a retried insert that has not merged yet. The other
 * scans (per-call groups and failures, run boundaries, Codex line streams)
 * aggregate with functions a duplicate row cannot change (min, max, argMin,
 * uniqExact, any), so they read narrow columns without `FINAL`, which lets
 * their filters move to PREWHERE.
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
				if(source = 'codex' AND parser_version >= 9, ${providerErrorKindSql("facts['api_errors_components']")}, '') AS provider_error_kind,
				if(source = 'codex' AND kind = 'tool_result', extractAll(text, '${RUN_INDEX_PR_URL_PATTERN.replaceAll("\\", "\\\\")}'), []) AS result_pr_urls,
				toUInt8(source = 'codex' AND kind = 'meta' AND subtype IN ${CODEX_LIFECYCLE_SUBTYPES}) AS lifecycle,
				${RECORD_FACT_KEYS.map((key) => `facts['${key}'] AS ${factColumn(key)}`).join(", ")}`
		: "";
	const literalFacts = literal
		? `,
				${literalRunFacts()}`
		: "";
	// A native edit tool's own request row, never a path inferred from shell text.
	const nativeEditSql = `kind = 'file_change' AND file_op IN ('write', 'edit', 'delete') AND file_path != ''
		AND subtype IN ('native', 'patch', 'nested') AND ${nativeEditToolSql("tool_name")}`;
	return `${forkReplayCtes()},
		calls AS (
			SELECT session_id, agent_id, call_id,
				argMinIf(${toolGroupSql("tool_name", `substringUTF8(head, 1, ${FACT_TEXT_CHARS})`)}, tuple(record_idx, block_idx), kind = 'tool_call') AS call_group,
				max(${runToolErrorSql()}) AS failed,
				max(mapContains(facts, 'parsed_cmd_types')) AS has_parsed_cmd,
				groupUniqArrayArray(JSONExtract(facts['parsed_cmd_types'], 'Array(String)')) AS parsed_types,
				max(denial_kind != '' AND denial_kind != 'interrupted') AS refused,
				max(denial_kind IN ('cancelled', 'interrupted') OR ifNull(interrupted, false)) AS stopped,
				max(kind = 'tool_result') AS has_result
			FROM ${records()}
			WHERE ${pinnedFilter()} AND kind IN ('tool_call', 'tool_result', 'meta') AND call_id != '' AND ${FORK_REPLAY_FILTER}
			GROUP BY session_id, agent_id, call_id
		),
		work_records AS (
			SELECT session_id, agent_id, record_idx, block_idx, turn_idx, ts, kind, subtype,
				tool_name, call_id, file_path, file_op, is_error, exit_code, text_chars, parser_version, source,
				facts['applied_changes'] AS applied_changes,
				if(${headKinds} OR ${runToolErrorSql()}, substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '') AS head,
				if(${runToolErrorSql()}, substringUTF8(tail, 1, ${FACT_TEXT_CHARS}), '') AS tail${literalColumns}
			FROM ${records()} FINAL WHERE ${pinnedFilter()} AND turn_idx >= 1 AND ${FORK_REPLAY_FILTER}
		),
		run_facts AS (
			SELECT w.session_id AS session_id, w.agent_id AS agent_id, w.turn_idx AS turn_idx,
				min(record_idx) AS first_record,
				toUnixTimestamp64Milli(argMin(ts, tuple(record_idx, block_idx))) AS started_ms,
				greatest(0, toUnixTimestamp64Milli(argMaxIf(ts, tuple(record_idx, block_idx), kind != 'meta')) - started_ms) / 60000 AS minutes,
				arraySum(arrayMap(gap -> least(gap, ${ACTIVE_GAP_CAP_MS}), arrayDifference(arraySort(
					groupArrayIf(toUnixTimestamp64Milli(ts), kind != 'meta'))))) / 60000 AS active_minutes,
				sum(text_chars) AS raw_chars,
				countIf(${GENUINE_PROMPT_SQL}) AS genuine_prompt,
				substringUTF8(argMinIf(head, tuple(record_idx, block_idx), ${GENUINE_PROMPT_SQL}), 1, 160) AS prompt_head,
				if(max(parser_version) >= 9,
					length(arrayDistinct(arrayConcat(
						arrayFlatten(groupArray(arrayMap(change -> JSONExtractString(change, 'path'), JSONExtractArrayRaw(applied_changes)))),
						groupArrayIf(file_path, ${nativeEditSql}
							AND w.call_id != '' AND c.has_result AND NOT c.failed AND NOT c.refused AND NOT c.stopped)))),
					uniqExactIf(file_path, kind = 'file_change' AND file_op IN ('write', 'edit', 'delete') AND file_path != '' AND (w.call_id = '' OR NOT c.failed))) AS edits,
				uniqExactIf(w.call_id, ${nativeEditSql} AND w.call_id != '' AND NOT c.stopped AND c.failed AND NOT c.refused) AS failed_edits,
				uniqExactIf(w.call_id, ${nativeEditSql} AND w.call_id != '' AND c.refused) AS refused_edits,
				countIf(kind = 'tool_call') AS tool_calls,
				uniqExactIf(if(w.call_id != '', w.call_id, concat(toString(record_idx), ':', toString(block_idx))), ${runToolErrorSql()}) AS failed_calls,
				countIf(kind = 'tool_call' AND ${toolActivitySql("read", callGroup)}) AS read_calls,
				countIf(kind = 'tool_call' AND ${toolActivitySql("search", callGroup)}) AS search_calls,
				countIf(${toolErrorSql()} AND (${toolActivitySql("read", `coalesce(nullIf(c.call_group, ''), ${toolGroupSql("w.tool_name", "''")})`)} OR ${toolActivitySql("search", `coalesce(nullIf(c.call_group, ''), ${toolGroupSql("w.tool_name", "''")})`)})
					AND match(concat(head, '\\n', tail), '(?i)not found|no such file|ENOENT|No files found')) AS not_found${literalFacts}
			FROM work_records w
			LEFT ANY JOIN calls c ON w.session_id = c.session_id AND w.agent_id = c.agent_id AND w.call_id = c.call_id
			GROUP BY w.session_id, w.agent_id, w.turn_idx
		),
		${boundedRunsCte(FORK_REPLAY_FILTER)}`;
}

const FORK_REPLAY_FILTER = `facts['fork_replayed'] != 'true' AND (session_id, agent_id, call_id) NOT IN (SELECT session_id, agent_id, call_id FROM replayed_calls)`;

function forkReplayCtes(): string {
	return `fork_links AS (
			SELECT DISTINCT session_id, agent_id, JSONExtractString(component, 'value') AS parent_session_id
			FROM ${records()} ARRAY JOIN JSONExtractArrayRaw(facts['parent_session_components']) AS component
			WHERE ${pinnedFilter()} AND source = 'codex' AND parser_version >= 9
				AND (session_id, agent_id, record_idx) IN (
					SELECT session_id, agent_id, min(record_idx)
					FROM ${records()} WHERE ${pinnedFilter()} AND source = 'codex' AND parser_version >= 9
						AND kind = 'meta' AND subtype = 'session_meta'
					GROUP BY session_id, agent_id)
				AND JSONExtractString(component, 'path') = 'session_meta/.forked_from_id'
				AND parent_session_id != '' AND parent_session_id != session_id
		),
		${forkParentCallsSql("(SELECT parent_session_id FROM fork_links)")},
		replayed_calls AS (
			SELECT f.session_id AS session_id, f.agent_id AS agent_id, p.call_id AS call_id
			FROM fork_links f INNER JOIN parent_calls p ON f.parent_session_id = p.session_id
		)`;
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
	const apiError = `if(source = 'codex', provider_error_kind, ${f("api_error")})`;
	const apiStatuses = `if(source = 'codex', if(provider_error_kind != '', ${httpStatusesSql(f("api_errors_components"))}, []), if(${f("api_error_status")} != '', [${f("api_error_status")}], []))`;
	const slashCommand =
		"if(kind = 'injected_context' AND subtype = 'slash_command', trimBoth(extract(head, '<command-name>/?([^<]*)</command-name>')), '')";
	const jsonEntries = (column: string) =>
		`arrayFlatten(arrayMap(entry -> JSONExtractArrayRaw(entry.2), arraySort(groupArrayIf(tuple(tuple(record_idx, block_idx), ${column}), ${column} != ''))))`;
	return [
		`uniqExact(record_idx) AS l_record_count`,
		`toUnixTimestamp64Milli(if(countIf(kind != 'meta') = 0, argMin(ts, tuple(record_idx, block_idx)), argMaxIf(ts, tuple(record_idx, block_idx), kind != 'meta'))) AS l_ended_ms`,
		`${first("agent_version")} AS l_agent_version`,
		`${first("entrypoint")} AS l_entrypoint`,
		// The run's starting prompt says where it came from, set or not.
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
		`${first(f("model"), `${f("model")} != '' AND lifecycle = 0`)} AS l_model`,
		`arraySort(groupUniqArrayIf(${f("model")}, ${f("model")} != '' AND lifecycle = 0)) AS l_models`,
		`${first(f("effort"), `${f("effort")} != '' AND lifecycle = 0`)} AS l_effort`,
		`${first(`arrayElement(${componentStringsSql(f("abort_reason_components"), ".*")}, 1)`)} AS l_abort_reason`,
		`${first(apiError)} AS l_api_error`,
		`uniqExactIf(${callKey}, kind = 'tool_result' AND denial_kind != '' AND denial_kind != 'interrupted') AS l_denied_calls`,
		`uniqExactIf(${callKey}, kind = 'tool_result' AND interrupted_call) AS l_interrupted_calls`,
		`uniqExactIf(${callKey}, kind = 'tool_result' AND timed_out_after_ms IS NOT NULL) AS l_timed_out_calls`,
		`uniqExactIf(${callKey}, mcp_server != '') AS l_mcp_calls`,
		`${sortedSet("mcp_server")} AS l_mcp_servers`,
		`arraySort(arrayDistinct(arrayConcat(groupUniqArrayIf(CAST(attribution_skill, 'String'), attribution_skill != ''),
					groupUniqArrayIf(${skillInput}, ${skillInput} != ''),
					groupUniqArrayIf(${f("skill")}, ${f("skill")} != ''),
					arrayFlatten(groupArray(${codexSkills}))))) AS l_skills`,
		`arraySort(groupUniqArrayIf(${slashCommand}, ${slashCommand} != '')) AS l_slash_commands`,
		`countIf(kind = 'compaction') AS l_compactions`,
		`countIf(${f("aborted")} = 'true' AND lifecycle = 0) AS l_aborted_true`,
		`countIf(${f("aborted")} = 'false' AND lifecycle = 0) AS l_aborted_false`,
		`countIf(subtype = 'interrupt' AND kind IN ('meta', 'injected_context')) AS l_interrupt_markers`,
		`argMaxIf(${f("stop_reason")}, tuple(record_idx, block_idx), ${f("stop_reason")} != '') AS l_stop_reason`,
		`countIf(${f("prevented_continuation")} = 'true') AS l_prevented_true`,
		`countIf(${f("prevented_continuation")} = 'false') AS l_prevented_false`,
		`countIf(${f("hook_count")} != '') AS l_hook_summaries`,
		`sum(toUInt64OrZero(${f("hook_count")})) AS l_hook_count`,
		`${jsonEntries(f("hook_errors"))} AS l_hook_errors`,
		`${jsonEntries(f("hook_runs"))} AS l_hook_runs`,
		`uniqExactIf(record_idx, ${apiError} != '' OR notEmpty(${apiStatuses})) AS l_api_errors`,
		`arraySort(arrayDistinct(arrayFlatten(groupArray(${apiStatuses})))) AS l_api_error_statuses`,
		`uniqExactIf(record_idx, ${f("retry_attempt")} != '') AS l_retry_attempts`,
		`uniqExactIf(record_idx, ${f("refusal_category")} != '') AS l_refusals`,
		`argMaxIf(${f("goal")}, tuple(record_idx, block_idx), ${f("goal")} != '') AS l_goal`,
		`arraySort(arrayDistinct(arrayFlatten(groupArrayIf(git_operation, notEmpty(git_operation))))) AS l_git_operations`,
		`${sortedSet(f("git.push.branch"))} AS l_pushed_branches`,
		`${sortedSet(f("git.commit.sha"))} AS l_commit_shas`,
		`arraySort(arrayDistinct(arrayConcat(groupUniqArrayIf(${f("git.pr.url")}, ${f("git.pr.url")} != ''),
					groupUniqArrayIf(${f("pr_url")}, ${f("pr_url")} != ''), arrayFlatten(groupArray(result_pr_urls))))) AS l_pr_urls`,
		`countIf(${f("facts_truncated")} = 'true' OR ${f("facts_clipped")} != '') AS l_facts_truncated`,
	].join(",\n\t\t\t\t");
}

/**
 * Per run, the stream's Codex `thread_source` (from its `session_meta`) and
 * the requested types of Claude Task/Agent and Codex spawn_agent calls.
 * Claude inputs are read from stored text; Codex reads only the named
 * agent_type component, never its requested model or reasoning effort.
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
					${componentStringsSql("facts['subagent_type_components']", "[.]arguments[.]agent_type$")},
					[${jsonStringField("text", "subagent_type")}])) AS subagent_type
				FROM ${records()}
				WHERE ${pinnedFilter()} AND turn_idx >= 1 AND ${FORK_REPLAY_FILTER}
					AND (kind = 'tool_call' AND tool_name IN ('Task', 'Agent')
						OR source = 'codex' AND parser_version >= 9 AND facts['subagent_type_components'] != '')
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
 * With `generation`, every usage read is bound to one usage extraction
 * (`{usageGeneration:UInt64}`): the run index prices a complete, consistent
 * set of events, never a mix of two extractions. `find` reads every active
 * event.
 */
export function usageEventCtes(options: { generation?: boolean } = {}): string {
	const generation = options.generation
		? " AND event_version = {usageGeneration:UInt64}"
		: "";
	return `${buildPricedUsageEventsCte(`e.organization_id = {organizationId:String} AND e.user_id = {userId:String} AND e.session_id IN {sessionIds:Array(String)}${generation.replace("event_version", "e.event_version")}`)},
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
	l_denied_calls: count,
	l_interrupted_calls: count,
	l_timed_out_calls: count,
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
): ClickHouseStatement {
	const costState =
		"agent_id = '' AND kind = 'meta' AND subtype = 'cost-state'";
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT
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
				AND parser_version = {parserVersion:UInt16}`,
		query_params: {
			...scope,
			sessionId: generation.sessionId,
			revision: generation.revision,
			parserVersion: generation.parserVersion,
		},
	};
}

/** Pricing, literal SQL and per-agent gates fingerprint every unshipped index-2 rebuild. */
export const RUN_INDEX_PRICING_VERSION = `${MODEL_RATE_CARD_VERSION}+${createHash(
	"sha256",
)
	.update(buildPricedUsageEventsCte(""))
	.update(runFactsCtes({ literal: true }))
	.update(runContextCtes())
	.update(JSON.stringify(RUN_INDEX_FACT_COLUMNS))
	.update("codex-per-turn-effort:lifecycle;claude-abort:l_abort_reason")
	.digest("hex")
	.slice(0, 12)}`;
