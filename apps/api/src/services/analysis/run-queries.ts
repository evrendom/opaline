import { z } from "zod";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	pinnedParams,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import { isRunIndexColumnRecordable } from "./run-index-columns.js";
import {
	runFactsCtes,
	runUsageCtes,
	USAGE_MODEL_SQL,
	usageEventCtes,
} from "./run-index-sql.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./sql.js";

const RunFactsRowSchema = z.object({
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.number(),
	first_record: z.number(),
	started_ms: z.coerce.number(),
	/** Wall-clock span from the run's first record to its last activity record (`RUN_ACTIVITY_SQL`). */
	minutes: z.coerce.number(),
	/** Sum of the gaps between the run's activity records, each capped at `ACTIVE_GAP_CAP_MS`. */
	active_minutes: z.coerce.number(),
	raw_chars: z.coerce.number(),
	genuine_prompt: z.coerce.number(),
	prompt_head: z.string(),
	edits: z.coerce.number(),
	tool_calls: z.coerce.number(),
	failed_calls: z.coerce.number(),
	read_calls: z.coerce.number(),
	search_calls: z.coerce.number(),
	/** Read and search calls that found nothing, before `RunRowSchema` gates it. */
	not_found: z.coerce.number(),
	/** The run's agent and the parser version of its generation, which say what it can record. */
	run_source: z.string(),
	run_parser_version: z.coerce.number(),
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
/**
 * A run as find reads it: a fact the run index cannot record for the run's
 * agent, parser version and stream is unknown here too, never 0.
 */
export const RunRowSchema = RunFactsRowSchema.transform((row) => ({
	...row,
	not_found: isRunIndexColumnRecordable(
		"not_found",
		row.run_parser_version,
		row.run_source,
		row.agent_id,
	)
		? row.not_found
		: null,
}));
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
	"run_source",
	"run_parser_version",
];

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
			${usageEventCtes()},
			${runUsageCtes()},
			session_unattributed AS (
				SELECT session_id, sum(model_cost) AS unattributed, groupArray(tuple(usage_model, model_cost)) AS models
				FROM (
					SELECT e.session_id AS session_id, ${USAGE_MODEL_SQL} AS usage_model, sum(ifNull(e.estimated_cost, 0)) AS model_cost
					FROM unassigned_usage e GROUP BY session_id, usage_model
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
