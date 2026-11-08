import { z } from "zod";
import {
	buildInclusiveDateTimeRangeFilter,
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import {
	buildDigestReport,
	type DigestReport,
	type DigestRow,
	type FrustrationRow,
	type ToolboxRow,
} from "./report.js";
import { addDays, type DigestPeriod, digestWindow } from "./schedule.js";

const number = z.coerce.number();
const LANGUAGE_SIGNALS_TABLE = "rudel.session_language_signals";
const DigestRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	day: z.string(),
	agent: z.string(),
	repository: z.string(),
	model: z.string(),
	runs: number,
	prompts: number,
	active_minutes: number,
	cost_usd: number,
	tool_calls: number,
	failed_calls: number,
	interrupts: number,
	compactions: number,
	api_errors_known_runs: number,
	api_errors: number,
	cache_read_tokens: number,
	longest_run_minutes: number,
	input_tokens: number,
	subagent_launches: number,
	subagent_minutes: number,
	subagent_runs: number,
	subagent_cost_usd: number,
	subagent_tool_calls: number,
	subagent_failed_calls: number,
	turn_errors: number,
	timeouts: number,
	refusals: number,
});
const ToolboxRowSchema = z.object({
	user_id: z.string(),
	kind: z.enum(["skill", "command", "subagent"]),
	name: z.string(),
	uses: number,
});
const SignalRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	day: z.string(),
	negatives: number,
	swears: number,
	apologies: number,
	phrases: z.record(z.string(), number),
});
const TitleRowSchema = z.object({
	session_id: z.string(),
	title: z.string().nullable(),
	repository: z.string(),
});

/** The UTC days from the one holding `from` through the one holding `to`. */
function utcDays(from: number, to: number): string[] {
	const list: string[] = [];
	const last = new Date(to).toISOString().slice(0, 10);
	for (
		let day = new Date(from).toISOString().slice(0, 10);
		day <= last;
		day = addDays(day, 1)
	)
		list.push(day);
	return list;
}

/**
 * A digest's numbers for every member of the workspace and the workspace,
 * summed from the committed run index builds of the period and the period
 * compared against, as read in `timeZone` (digestWindow): runs by when they
 * started, and usage no run claims by its receipt's start, as
 * `weekly_totals` sums a week.
 */
export async function readDigestReport(
	executor: ClickHouseExecutor,
	organizationId: string,
	period: DigestPeriod,
	timeZone: string,
): Promise<DigestReport> {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = "organization_id = {organizationId:String}";
	const committed = committedBuildSql(table, owner, ["user_id", "session_id"]);
	const window = digestWindow(period, timeZone);
	const startedIn = (from: string, to: string) =>
		`(started_at >= fromUnixTimestamp64Milli({${from}:Int64}, 'UTC') AND started_at < fromUnixTimestamp64Milli({${to}:Int64}, 'UTC'))`;
	const current = startedIn("from", "to");
	const run = "row_kind = 'run'";
	const [rows, toolbox] = await Promise.all([
		query(executor, DigestRowSchema, {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			// Later sums read the table's columns through \`r.\`: with the analyzer
			// on, a bare name resolves to the same-named sum selected above it.
			query: `SELECT user_id, session_id, toString(toDate(started_at, {timeZone:String})) AS day,
					toString(source) AS agent, repository, ifNull(toString(model), '') AS model,
					countIf(${run}) AS runs,
					sumIf(genuine_prompts, ${run}) AS prompts,
					sumIf(active_minutes, ${run}) AS active_minutes,
					sum(ifNull(cost_usd, 0)) AS cost_usd,
					sumIf(tool_calls, ${run}) AS tool_calls,
					sumIf(failed_calls, ${run}) AS failed_calls,
					sumIf(interrupt_markers, ${run}) AS interrupts,
					sumIf(compactions, ${run}) AS compactions,
					countIf(${run} AND NOT has(unrecorded_facts, 'api_errors')) AS api_errors_known_runs,
					sumIf(ifNull(api_errors, 0), ${run} AND NOT has(unrecorded_facts, 'api_errors')) AS api_errors,
					sum(ifNull(cache_read_input_tokens, 0)) AS cache_read_tokens,
					maxIf(r.active_minutes, ${run}) AS longest_run_minutes,
					sum(ifNull(uncached_input_tokens, 0) + ifNull(cache_read_input_tokens, 0)
						+ ifNull(cache_write_5m_input_tokens, 0) + ifNull(cache_write_1h_input_tokens, 0)) AS input_tokens,
					sumIf(length(subagent_types), ${run}) AS subagent_launches,
					sumIf(r.active_minutes, ${run} AND agent_id != '') AS subagent_minutes,
					countIf(${run} AND agent_id != '') AS subagent_runs,
					sumIf(ifNull(r.cost_usd, 0), agent_id != '') AS subagent_cost_usd,
					sumIf(r.tool_calls, ${run} AND agent_id != '') AS subagent_tool_calls,
					sumIf(r.failed_calls, ${run} AND agent_id != '') AS subagent_failed_calls,
					countIf(${run} AND NOT has(unrecorded_facts, 'turn_error') AND ifNull(turn_error, '') != '') AS turn_errors,
					sumIf(ifNull(timed_out_calls, 0), ${run} AND NOT has(unrecorded_facts, 'timed_out_calls')) AS timeouts,
					sumIf(ifNull(r.refusals, 0), ${run} AND NOT has(unrecorded_facts, 'refusals')) AS refusals
				FROM ${table} AS r FINAL
				WHERE ${owner}
					AND (${current} OR ${startedIn("previousFrom", "previousTo")})
					AND ${committed}
				GROUP BY user_id, session_id, day, agent, repository, model`,
			query_params: { organizationId, ...window },
		}) as Promise<DigestRow[]>,
		query(executor, ToolboxRowSchema, {
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
			query: `SELECT user_id, item.1 AS kind, item.2 AS name, count() AS uses
				FROM ${table} FINAL
				ARRAY JOIN arrayConcat(
					arrayMap(name -> ('skill', name), skills),
					arrayMap(name -> ('command', name), slash_commands),
					arrayMap(name -> ('subagent', toString(name)), subagent_types)
				) AS item
				WHERE ${owner} AND ${run}
					AND ${current}
					AND ${committed}
				GROUP BY user_id, kind, name`,
			query_params: { organizationId, from: window.from, to: window.to },
		}) as Promise<ToolboxRow[]>,
	]);
	return buildDigestReport(
		rows,
		toolbox,
		await readFrustration(
			executor,
			organizationId,
			[
				...utcDays(window.from, window.to),
				...utcDays(window.previousFrom, window.previousTo),
			],
			rows,
		),
		period,
	);
}

/**
 * The language signals (rudel.session_language_signals: negative phrases and
 * swears in the member's own messages, apologies in the agent's) of the
 * sessions with runs in the digest's rows, each on the first day it ran
 * there, with each frustrated session's title from its runs. `days` are the
 * UTC session dates that can hold them.
 */
async function readFrustration(
	executor: ClickHouseExecutor,
	organizationId: string,
	days: readonly string[],
	rows: readonly DigestRow[],
): Promise<FrustrationRow[]> {
	const sessionDays = new Map<string, string>();
	for (const row of rows) {
		const first = sessionDays.get(row.session_id);
		if (row.runs > 0 && (!first || row.day < first))
			sessionDays.set(row.session_id, row.day);
	}
	if (sessionDays.size === 0 || days.length === 0) return [];
	const sortedDays = [...days].sort();
	const signals = await query(executor, SignalRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, session_id, toString(toDate(session_date)) AS day,
				sum(member_negative) AS negatives, sum(member_swears) AS swears,
				sum(model_apologies) AS apologies,
				sumMap(member_negative_counts) AS phrases
			FROM ${getSafeClickHouseTable(LANGUAGE_SIGNALS_TABLE)} FINAL
			WHERE organization_id = {organizationId:String}
				AND ${buildInclusiveDateTimeRangeFilter("firstDay", "lastDay")}
			GROUP BY user_id, session_id, day`,
		query_params: {
			organizationId,
			firstDay: sortedDays[0],
			lastDay: sortedDays.at(-1),
		},
	});
	const daySet = new Set(days);
	const inWindow = signals.flatMap((row) => {
		const day = sessionDays.get(row.session_id);
		return day && daySet.has(row.day) ? [{ ...row, day }] : [];
	});
	const frustrated = inWindow
		.filter((row) => row.negatives + row.swears > 0)
		.map((row) => row.session_id);
	const titles = frustrated.length
		? await query(executor, TitleRowSchema, {
				clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
				query: `SELECT session_id, anyIf(title, isNotNull(title)) AS title,
						any(repository) AS repository
					FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
					WHERE organization_id = {organizationId:String}
						AND row_kind = 'run' AND session_id IN {sessionIds:Array(String)}
					GROUP BY session_id`,
				query_params: { organizationId, sessionIds: frustrated },
			})
		: [];
	const bySession = new Map(titles.map((row) => [row.session_id, row]));
	return inWindow.map((row) => ({
		...row,
		title: bySession.get(row.session_id)?.title ?? null,
		repository: bySession.get(row.session_id)?.repository ?? "",
	}));
}
