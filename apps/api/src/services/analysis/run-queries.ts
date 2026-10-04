import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";
import { buildPricedUsageEventsCte } from "../usage-event-analytics.service.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	GENUINE_PROMPT_SQL,
	pinnedFilter,
	pinnedParams,
	query,
	records,
	toolErrorSql,
} from "./sql.js";
import { toolGroupSql } from "./tool-groups.js";

export const RunRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.number(),
	first_record: z.number(),
	started_ms: z.coerce.number(),
	/** Wall-clock span from the run's first record to its last non-meta record. */
	minutes: z.coerce.number(),
	/** Sum of the gaps between the run's non-meta records, each capped at `ACTIVE_GAP_CAP_MS`. */
	active_minutes: z.coerce.number(),
	raw_chars: z.coerce.number(),
	genuine_prompt: z.coerce.number(),
	prompt_head: z.string(),
	edits: z.coerce.number(),
	tool_calls: z.coerce.number(),
	failed_calls: z.coerce.number(),
	read_calls: z.coerce.number(),
	search_calls: z.coerce.number(),
	not_found: z.coerce.number(),
	/** Priced cost of the run's usage; null when none of it could be priced (or there is none). */
	cost: z.number().nullable(),
	/** Usage observations of the run that have no price (unknown model or rate). */
	unpriced_observations: z.coerce.number(),
	/** Model of the run's latest attributed usage; empty when none (fall back to the session's). */
	usage_model: z.string(),
	/**
	 * Each model the run used with its own priced cost (null when unpriced) and
	 * its unpriced observations, most expensive first.
	 */
	model_costs: z.array(
		z.tuple([z.string(), z.number().nullable(), z.coerce.number()]),
	),
	/** Usage of the run's session that cannot be tied to one run (repeated on each of its runs). */
	session_unattributed: z.coerce.number(),
	/** `session_unattributed` per model. */
	session_unattributed_models: z.array(z.tuple([z.string(), z.number()])),
});
export type RunRow = z.infer<typeof RunRowSchema>;

const RUN_COLUMNS = [
	"session_id",
	"agent_id",
	"turn_idx",
	"first_record",
	"started_ms",
	"minutes",
	"active_minutes",
	"raw_chars",
	"genuine_prompt",
	"prompt_head",
	"edits",
	"tool_calls",
	"failed_calls",
	"read_calls",
	"search_calls",
	"not_found",
];

/** Facts need only a prefix of each text: a command's first word, the prompt head, an error's last line. */
const FACT_TEXT_CHARS = 240;
/**
 * A gap between two records of a run longer than this counts as this much
 * active time: waiting for an approval or a stalled stream is not work, while a
 * long-running command still counts in part.
 */
export const ACTIVE_GAP_CAP_MS = 5 * 60_000;

/** Every run of the given sessions' committed generations. */
export function queryRunFacts(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): Promise<RunRow[]> {
	return query(
		executor,
		RunRowSchema,
		buildRunFactsStatement(scope, generations),
	);
}

/**
 * Every run of a batch with its facts, aggregated in ClickHouse; nothing per
 * record reaches the API. The caller sorts, groups, prices refs and totals
 * coverage from these rows, so one statement serves a whole request.
 */
export function buildRunFactsStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${runFactsCtes()},
			${usageCtes()},
			session_unattributed AS (
				SELECT session_id, sum(model_cost) AS unattributed, groupArray(tuple(usage_model, model_cost)) AS models
				FROM (
					SELECT e.session_id AS session_id, ${USAGE_MODEL_SQL} AS usage_model, sum(ifNull(e.estimated_cost, 0)) AS model_cost
					FROM resolved_usage e WHERE e.verified = 0 GROUP BY session_id, usage_model
				)
				GROUP BY session_id
			)
			SELECT ${RUN_COLUMNS.map((column) => `r.${column} AS ${column}`).join(", ")},
				if(c.observations = 0, NULL, c.cost) AS cost,
				c.unpriced AS unpriced_observations,
				c.model AS usage_model, c.model_costs AS model_costs,
				ifNull(u.unattributed, 0) AS session_unattributed,
				u.models AS session_unattributed_models
			FROM run_facts r
			LEFT ANY JOIN run_costs c ON r.session_id = c.session_id AND r.agent_id = c.agent_id AND r.turn_idx = c.turn_idx
			LEFT ANY JOIN session_unattributed u ON r.session_id = u.session_id`,
		query_params: pinnedParams(scope, generations),
	};
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
 */
function runFactsCtes(): string {
	const callGroup = toolGroupSql("tool_name", "head");
	return `calls AS (
			SELECT session_id, agent_id, call_id,
				argMinIf(${toolGroupSql("tool_name", `substringUTF8(head, 1, ${FACT_TEXT_CHARS})`)}, tuple(record_idx, block_idx), kind = 'tool_call') AS call_group,
				max(${toolErrorSql()}) AS failed
			FROM ${records()}
			WHERE ${pinnedFilter()} AND kind IN ('tool_call', 'tool_result') AND call_id != ''
			GROUP BY session_id, agent_id, call_id
		),
		work_records AS (
			SELECT session_id, agent_id, record_idx, block_idx, turn_idx, ts, kind, subtype,
				tool_name, call_id, file_path, file_op, is_error, exit_code, text_chars,
				if(kind IN ('tool_call', 'user_prompt') OR ${toolErrorSql()}, substringUTF8(head, 1, ${FACT_TEXT_CHARS}), '') AS head,
				if(${toolErrorSql()}, substringUTF8(tail, 1, ${FACT_TEXT_CHARS}), '') AS tail
			FROM ${records()} FINAL WHERE ${pinnedFilter()} AND turn_idx >= 1
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
				uniqExactIf(file_path, kind = 'file_change' AND file_op IN ('write', 'edit', 'delete') AND file_path != '' AND (w.call_id = '' OR NOT c.failed)) AS edits,
				countIf(kind = 'tool_call') AS tool_calls,
				uniqExactIf(if(w.call_id != '', w.call_id, concat(toString(record_idx), ':', toString(block_idx))), ${toolErrorSql()}) AS failed_calls,
				countIf(kind = 'tool_call' AND ${callGroup} = 'read') AS read_calls,
				countIf(kind = 'tool_call' AND ${callGroup} = 'search') AS search_calls,
				countIf(${toolErrorSql()} AND coalesce(nullIf(c.call_group, ''), ${toolGroupSql("w.tool_name", "''")}) IN ('read', 'search')
					AND match(concat(head, '\\n', tail), '(?i)not found|no such file|ENOENT|No files found')) AS not_found
			FROM work_records w
			LEFT ANY JOIN calls c ON w.session_id = c.session_id AND w.agent_id = c.agent_id AND w.call_id = c.call_id
			GROUP BY w.session_id, w.agent_id, w.turn_idx
		),
		bounded_runs AS (
			SELECT session_id, agent_id, turn_idx, first_record,
				leadInFrame(first_record, 1, toUInt32(last_record + 1)) OVER (
					PARTITION BY session_id, agent_id ORDER BY first_record
					ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS boundary
			FROM (
				SELECT session_id, agent_id, turn_idx, min(record_idx) AS first_record, max(record_idx) AS last_record
				FROM ${records()} WHERE ${pinnedFilter()} AND turn_idx >= 1
				GROUP BY session_id, agent_id, turn_idx
			)
		)`;
}

/** The model a usage event is attributed to: resolved, else as recorded. */
const USAGE_MODEL_SQL =
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

/**
 * A usage event prices a run when its line falls in the run's range
 * [first_record, boundary) of the same stream. Only unambiguous events count
 * (`verified`): Codex events resolve their stream from the pinned record at
 * that line and must find exactly one. Claude Code repeats one response on a
 * line per content block, so most events have duplicate observations; those
 * stay verified when all observations came from one transcript, i.e. their
 * `lineage_id` (a hash of the transcripts observed) is also the lineage of an
 * unduplicated event. A response seen in several transcripts, or carrying an
 * identity flag, has a stored line that may belong to another stream.
 * Unverified cost is reported per session, never guessed onto a run.
 */
function usageCtes(): string {
	return `${buildPricedUsageEventsCte("e.organization_id = {organizationId:String} AND e.user_id = {userId:String} AND e.session_id IN {sessionIds:Array(String)}")},
		claude_single_lineages AS (
			SELECT DISTINCT session_id, lineage_id FROM ${getSafeClickHouseTable("rudel.usage_events")} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id IN {sessionIds:Array(String)}
				AND source = 'claude_code' AND record_kind = 'event' AND is_deleted = 0 AND duplicate_observation_count = 0
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
		),
		run_model_costs AS (
			SELECT r.session_id AS session_id, r.agent_id AS agent_id, r.turn_idx AS turn_idx, ${USAGE_MODEL_SQL} AS usage_model,
				count() AS model_observations, countIf(e.estimated_cost IS NULL) AS model_unpriced,
				${pricedSubtotalSql("e.estimated_cost")} AS model_cost,
				max(tuple(e.first_observed_line, e.event_version, e.event_id)) AS last_seen
			FROM bounded_runs r INNER JOIN resolved_usage e ON r.session_id = e.session_id AND r.agent_id = e.stream
			WHERE e.verified = 1 AND e.first_observed_line >= r.first_record AND e.first_observed_line < r.boundary
			GROUP BY r.session_id, r.agent_id, r.turn_idx, usage_model
		),
		run_costs AS (
			SELECT session_id, agent_id, turn_idx, sum(model_observations) AS observations, sum(model_unpriced) AS unpriced,
				${pricedSubtotalSql("model_cost")} AS cost,
				argMax(usage_model, last_seen) AS model,
				arrayReverseSort(pair -> ifNull(pair.2, -1), groupArray(tuple(usage_model, model_cost, model_unpriced))) AS model_costs
			FROM run_model_costs
			GROUP BY session_id, agent_id, turn_idx
		)`;
}
