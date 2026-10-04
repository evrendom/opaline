import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import type {
	TrendsUsage,
	TrendsUsageMetrics,
} from "@rudel/api-routes/trends-usage";
import { queryClickhouse } from "../clickhouse.js";
import { readNonNegativeSafeIntegerEnv } from "../lib/env.js";
import { SESSION_AGENT_RUN_SCAN_VERSION } from "./session-agent-runs.js";
import {
	buildCanonicalPricingModelSql,
	buildRunPricedUsageCte,
	buildUsageEventAnalyticsCte,
} from "./usage-event-analytics.service.js";

/**
 * Opaline Trends' public In the wild dataset: every workspace's agent runs
 * of all time (through the last complete UTC day), aggregated per model.
 * Only totals, rates and quantiles leave this module; user, workspace and
 * session identities are counted, never returned.
 *
 * Sources, all cross-tenant:
 * - runs, replies, reactions and run time: `session_language_signals.agent_runs`
 * - output tokens and cost per run: `usage_events`, priced like the dashboard,
 *   each request owned by the latest run that started at or before it
 * - apologies and swears: per-session language signals, attributed to the
 *   session's most-used run model
 * - prompts and tool failures: committed `transcript_records` generations
 */

const MIN_RUN_SHARE = 0.01;
const SHARE_WEEKS = 13;
const HARNESS_DAYS = 30;
/** A lower bound before any session Opaline holds: all time starts here. */
const ALL_TIME_START = "2000-01-01";
/** The friction breakdown's cohort: the developers who used this model. */
const COHORT_MODEL = "claude-opus-5-5";
const CACHE_TTL_MS = 60 * 60 * 1000;
const QUERY_SETTINGS = {
	// Reads only; 2 still lets each query set its own limits below.
	readonly: "2",
	max_execution_time: 90,
	max_rows_to_read: "2000000000",
	max_bytes_to_read: String(200 * 1024 * 1024 * 1024),
	timeout_before_checking_execution_speed: 0,
	max_result_rows: "200000",
	result_overflow_mode: "throw",
} as const;

type Period = "current" | "previous";

interface TrendsWindow {
	readonly periodStart: string;
	readonly periodEndExclusive: string;
	/** All time has no prior period: equal to periodStart. */
	readonly previousPeriodStart: string;
	readonly harnessStart: string;
	readonly shareStart: string;
	readonly shareEndExclusive: string;
}

interface RunRow {
	readonly period: Period;
	readonly model: string;
	readonly is_total: number;
	readonly runs: string;
	readonly replied: string;
	readonly negative: string;
	readonly mixed: string;
	readonly neutral: string;
	readonly positive: string;
	readonly timed: string;
	readonly seconds_q: readonly number[];
	readonly developers: string;
	readonly workspaces: string;
	readonly sessions: string;
}

interface RunUsageRow {
	readonly period: Period;
	readonly model: string;
	readonly measured: string;
	readonly tokens_q: readonly number[];
	readonly priced: string;
	readonly cost_q: readonly number[];
}

interface UsageTotalRow {
	readonly day: string;
	readonly model: string;
	readonly source: string;
	readonly input_tokens: string;
	readonly output_tokens: string;
	readonly cost: number;
}

interface SessionSignalRow {
	readonly period: Period;
	readonly model: string;
	readonly session_runs: string;
	readonly apologies: string;
	readonly phrases: readonly [readonly string[], readonly string[]];
	readonly swears: string;
	readonly prompts: string;
}

interface ToolCallMonthRow {
	readonly month: string;
	readonly runs: string;
	readonly developers: string;
	readonly mean_calls: number;
	readonly calls_q: readonly number[];
}

interface RunTimeMonthRow {
	readonly month: string;
	readonly runs: string;
	readonly developers: string;
	readonly mean_seconds: number;
	readonly seconds_q: readonly number[];
}

/** One model's friction figures for each population, flattened. */
interface FrictionRow {
	readonly model: string;
	readonly all_developers: string;
	readonly all_swearers: string;
	readonly all_swears: string;
	readonly all_apologies: string;
	readonly all_tool_errors: string;
	readonly all_tokens: string;
	readonly all_prompts: string;
	readonly swearers_developers: string;
	readonly swearers_swearers: string;
	readonly swearers_swears: string;
	readonly swearers_apologies: string;
	readonly swearers_tool_errors: string;
	readonly swearers_tokens: string;
	readonly swearers_prompts: string;
	readonly cohort_developers: string;
	readonly cohort_swearers: string;
	readonly cohort_swears: string;
	readonly cohort_apologies: string;
	readonly cohort_tool_errors: string;
	readonly cohort_tokens: string;
	readonly cohort_prompts: string;
}

interface ToolRow {
	readonly period: Period;
	readonly model: string;
	readonly calls: string;
	readonly failures: string;
}

interface RunCountRow {
	readonly kind: "week" | "day" | "model_day" | "first";
	readonly key: string;
	readonly model: string;
	readonly runs: string;
}

let cached:
	| {
			readonly periodEndExclusive: string;
			readonly expiresAt: number;
			readonly value: Promise<TrendsUsage>;
	  }
	| undefined;

/** Cached per process for an hour; concurrent callers share one computation. */
export function getTrendsUsage(now = new Date()): Promise<TrendsUsage> {
	const window = trendsWindow(now);
	if (
		cached &&
		cached.periodEndExclusive === window.periodEndExclusive &&
		cached.expiresAt > now.getTime()
	)
		return cached.value;
	const value = computeTrendsUsage(window, now);
	cached = {
		periodEndExclusive: window.periodEndExclusive,
		expiresAt: now.getTime() + CACHE_TTL_MS,
		value,
	};
	value.catch(() => {
		if (cached?.value === value) cached = undefined;
	});
	return value;
}

/**
 * All time through the last complete UTC day; within it, the last 30 days
 * for the harness balance and the last 13 whole weeks for the share.
 */
export function trendsWindow(now: Date): TrendsWindow {
	const periodEnd = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const shareEnd = new Date(periodEnd);
	shareEnd.setUTCDate(shareEnd.getUTCDate() - ((shareEnd.getUTCDay() + 6) % 7));
	const shareStart = new Date(shareEnd);
	shareStart.setUTCDate(shareStart.getUTCDate() - SHARE_WEEKS * 7);
	return {
		periodStart: ALL_TIME_START,
		periodEndExclusive: isoDay(periodEnd),
		previousPeriodStart: ALL_TIME_START,
		harnessStart: addDays(isoDay(periodEnd), -HARNESS_DAYS),
		shareStart: isoDay(shareStart),
		shareEndExclusive: isoDay(shareEnd),
	};
}

/**
 * Developers left out of every figure (an operator's own and test
 * accounts), from TRENDS_EXCLUDED_USER_IDS: comma-separated user IDs.
 */
export function readExcludedUserIds(): string[] {
	return (process.env.TRENDS_EXCLUDED_USER_IDS ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}

export function readTrendsThresholds(): TrendsUsage["thresholds"] {
	return {
		minRuns: readNonNegativeSafeIntegerEnv("TRENDS_MIN_RUNS", 100),
		minDevelopers: readNonNegativeSafeIntegerEnv("TRENDS_MIN_DEVELOPERS", 3),
		minWorkspaces: readNonNegativeSafeIntegerEnv("TRENDS_MIN_WORKSPACES", 2),
		minRunShare: MIN_RUN_SHARE,
	};
}

async function computeTrendsUsage(
	window: TrendsWindow,
	now: Date,
): Promise<TrendsUsage> {
	const params = {
		periodStart: window.periodStart,
		periodEnd: window.periodEndExclusive,
		previousStart: window.previousPeriodStart,
		harnessStart: window.harnessStart,
		shareStart: window.shareStart,
		shareEnd: window.shareEndExclusive,
		scanVersion: SESSION_AGENT_RUN_SCAN_VERSION,
		receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		cohortModel: COHORT_MODEL,
		excludedUsers: readExcludedUserIds(),
	};
	const query = <T>(sql: string) =>
		queryClickhouse<T>({
			query: sql,
			query_params: params,
			clickhouse_settings: QUERY_SETTINGS,
		});
	const [
		runs,
		counts,
		runUsage,
		usageTotals,
		sessions,
		tools,
		runTimeMonths,
		toolCallMonths,
		friction,
	] = await Promise.all([
		query<RunRow>(RUN_METRICS_SQL),
		query<RunCountRow>(RUN_COUNTS_SQL),
		query<RunUsageRow>(runUsageSql()),
		query<UsageTotalRow>(usageTotalsSql()),
		query<SessionSignalRow>(SESSION_SIGNALS_SQL),
		query<ToolRow>(TOOL_FAILURES_SQL),
		query<RunTimeMonthRow>(RUN_TIME_MONTHS_SQL),
		query<ToolCallMonthRow>(toolCallMonthsSql()),
		query<FrictionRow>(frictionSql()),
	]);
	return assembleTrendsUsage(
		{
			runs,
			counts,
			runUsage,
			usageTotals,
			sessions,
			tools,
			runTimeMonths,
			toolCallMonths,
			friction,
		},
		window,
		readTrendsThresholds(),
		now,
	);
}

export interface TrendsUsageRows {
	readonly runs: readonly RunRow[];
	readonly counts: readonly RunCountRow[];
	readonly runUsage: readonly RunUsageRow[];
	readonly usageTotals: readonly UsageTotalRow[];
	readonly sessions: readonly SessionSignalRow[];
	readonly tools: readonly ToolRow[];
	readonly runTimeMonths: readonly RunTimeMonthRow[];
	readonly toolCallMonths: readonly ToolCallMonthRow[];
	readonly friction: readonly FrictionRow[];
}

/** Pure: turns the aggregate rows into the published, thresholded dataset. */
export function assembleTrendsUsage(
	rows: TrendsUsageRows,
	window: TrendsWindow,
	thresholds: TrendsUsage["thresholds"],
	now: Date,
): TrendsUsage {
	const keyOf = (period: Period, model: string) => `${period}\u0000${model}`;
	const index = <T extends { period: Period; model: string }>(
		list: readonly T[],
	) => new Map(list.map((row) => [keyOf(row.period, row.model), row]));
	const runRows = index(rows.runs.filter((row) => Number(row.is_total) === 0));
	const runUsage = index(rows.runUsage);
	const sessions = index(rows.sessions);
	const tools = index(rows.tools);
	const total = rows.runs.find(
		(row) => Number(row.is_total) === 1 && row.period === "current",
	);
	const totalRuns = Number(total?.runs ?? 0);

	const metricsFor = (
		period: Period,
		model: string,
	): TrendsUsageMetrics | null => {
		const run = runRows.get(keyOf(period, model));
		if (!run || Number(run.runs) === 0) return null;
		const usage = runUsage.get(keyOf(period, model));
		const session = sessions.get(keyOf(period, model));
		const tool = tools.get(keyOf(period, model));
		const replied = Number(run.replied);
		const sessionRuns = Number(session?.session_runs ?? 0);
		const prompts = Number(session?.prompts ?? 0);
		const calls = Number(tool?.calls ?? 0);
		return {
			runs: Number(run.runs),
			apologiesPer100Runs:
				sessionRuns > 0
					? (100 * Number(session?.apologies ?? 0)) / sessionRuns
					: null,
			reactions:
				replied > 0
					? {
							negative: Number(run.negative) / replied,
							mixed: Number(run.mixed) / replied,
							neutral: Number(run.neutral) / replied,
							positive: Number(run.positive) / replied,
						}
					: null,
			replyRate: replied / Number(run.runs),
			swearsPer1kPrompts:
				prompts > 0 ? (1000 * Number(session?.swears ?? 0)) / prompts : null,
			toolFailureRate:
				calls > 0 ? Math.min(1, Number(tool?.failures ?? 0) / calls) : null,
			runSeconds: Number(run.timed) > 0 ? quantiles(run.seconds_q) : null,
			outputTokensPerRun:
				Number(usage?.measured ?? 0) > 0 ? quantiles(usage?.tokens_q) : null,
			costPerRunUsd:
				Number(usage?.priced ?? 0) > 0 ? quantiles(usage?.cost_q) : null,
		};
	};

	const totalsByModel = new Map<string, { tokens: number; cost: number }>();
	for (const row of rows.usageTotals) {
		if (row.model === "") continue;
		const entry = totalsByModel.get(row.model) ?? { tokens: 0, cost: 0 };
		entry.tokens += Number(row.output_tokens);
		entry.cost += Number(row.cost);
		totalsByModel.set(row.model, entry);
	}
	const firstUsed = new Map(
		rows.counts
			.filter((row) => row.kind === "first")
			.map((row) => [row.model, row.key]),
	);
	// All time is published from the first day any run started.
	const firstDay = [...firstUsed.values()].sort()[0] ?? window.periodStart;

	const models = [...runRows.values()]
		.filter((row) => row.period === "current" && row.model !== "")
		.filter(
			(row) =>
				Number(row.runs) >= thresholds.minRuns &&
				Number(row.developers) >= thresholds.minDevelopers &&
				Number(row.workspaces) >= thresholds.minWorkspaces &&
				totalRuns > 0 &&
				Number(row.runs) / totalRuns >= thresholds.minRunShare,
		)
		.flatMap((row) => {
			const current = metricsFor("current", row.model);
			if (!current) return [];
			const phrases = sessions.get(keyOf("current", row.model))?.phrases;
			return [
				{
					familyId: row.model,
					runs: roundTo(Number(row.runs), 10),
					sessions: roundTo(Number(row.sessions), 10),
					developers: Number(row.developers),
					workspaces: Number(row.workspaces),
					firstUsedAt: firstUsed.get(row.model) ?? firstDay,
					totalOutputTokens: totalsByModel.get(row.model)?.tokens ?? 0,
					totalCostUsd: totalsByModel.get(row.model)?.cost ?? 0,
					topApology: phrases ? topPhrase(phrases) : null,
					current,
					previous: metricsFor("previous", row.model),
				},
			];
		})
		.sort(
			(first, second) =>
				second.current.runs - first.current.runs ||
				first.familyId.localeCompare(second.familyId),
		);

	const weeks = Array.from({ length: SHARE_WEEKS }, (_, offset) => {
		const weekStart = addDays(window.shareStart, offset * 7);
		return {
			weekStart,
			runsByModel: Object.fromEntries(
				models.map((model) => [
					model.familyId,
					Number(
						rows.counts.find(
							(row) =>
								row.kind === "week" &&
								row.key === weekStart &&
								row.model === model.familyId,
						)?.runs ?? 0,
					),
				]),
			),
		};
	});

	// The published models' runs on every day since the first with any,
	// for the daily share and volume by model, kept whole so the history
	// grows with each capture.
	const runsOnDay = new Map(
		rows.counts
			.filter((row) => row.kind === "model_day")
			.map((row) => [`${row.key} ${row.model}`, Number(row.runs)]),
	);
	const published = new Set(models.map((model) => model.familyId));
	const firstModelDay = rows.counts
		.filter((row) => row.kind === "model_day" && published.has(row.model))
		.map((row) => row.key)
		.sort()[0];
	const modelDays: NonNullable<TrendsUsage["modelDays"]> = [];
	for (
		let day = firstModelDay ?? window.periodEndExclusive;
		day < window.periodEndExclusive;
		day = addDays(day, 1)
	)
		modelDays.push({
			day,
			runsByModel: Object.fromEntries(
				models.map((model) => [
					model.familyId,
					runsOnDay.get(`${day} ${model.familyId}`) ?? 0,
				]),
			),
		});

	// Each harness's runs, tokens and cost on every day since the first
	// with any, so the history grows with each capture; the balance chart
	// reads its last days.
	const harnessRuns = new Map(
		rows.counts
			.filter((row) => row.kind === "day")
			.map((row) => [`${row.key} ${row.model}`, Number(row.runs)]),
	);
	const harnessUsage = new Map<
		string,
		{ input: number; output: number; cost: number }
	>();
	for (const row of rows.usageTotals) {
		const key = `${row.day} ${row.source}`;
		const entry = harnessUsage.get(key) ?? { input: 0, output: 0, cost: 0 };
		entry.input += Number(row.input_tokens);
		entry.output += Number(row.output_tokens);
		entry.cost += Number(row.cost);
		harnessUsage.set(key, entry);
	}
	const firstHarnessDay = [
		...rows.counts.filter((row) => row.kind === "day").map((row) => row.key),
		...rows.usageTotals.map((row) => row.day),
	].sort()[0];
	const harnessDays: TrendsUsage["harnessDays"] = [];
	for (
		let day =
			firstHarnessDay && firstHarnessDay < window.harnessStart
				? firstHarnessDay
				: window.harnessStart;
		day < window.periodEndExclusive;
		day = addDays(day, 1)
	) {
		const runsOn = (source: string) => harnessRuns.get(`${day} ${source}`) ?? 0;
		const usageOn = (source: string, key: "input" | "output" | "cost") =>
			harnessUsage.get(`${day} ${source}`)?.[key] ?? 0;
		harnessDays.push({
			day,
			runs: { "claude-code": runsOn("claude_code"), codex: runsOn("codex") },
			outputTokens: {
				"claude-code": usageOn("claude_code", "output"),
				codex: usageOn("codex", "output"),
			},
			inputTokens: {
				"claude-code": usageOn("claude_code", "input"),
				codex: usageOn("codex", "input"),
			},
			costUsd: {
				"claude-code": usageOn("claude_code", "cost"),
				codex: usageOn("codex", "cost"),
			},
		});
	}

	// A month is published once complete, with enough runs and developers.
	const publishable = (row: {
		readonly month: string;
		readonly runs: string;
		readonly developers: string;
	}) =>
		row.month < `${window.periodEndExclusive.slice(0, 7)}-01` &&
		Number(row.runs) >= thresholds.minRuns &&
		Number(row.developers) >= thresholds.minDevelopers;

	return {
		generatedAt: now.toISOString(),
		scope: "all_time",
		periodStart: firstDay,
		periodEndExclusive: window.periodEndExclusive,
		previousPeriodStart: firstDay,
		thresholds,
		totals: {
			runs: roundTo(totalRuns, 10),
			sessions: roundTo(Number(total?.sessions ?? 0), 10),
			// Developer prompts over every session with a run model.
			prompts: roundTo(
				rows.sessions
					.filter((row) => row.period === "current")
					.reduce((sum, row) => sum + Number(row.prompts), 0),
				10,
			),
			developers: Number(total?.developers ?? 0),
			workspaces: Number(total?.workspaces ?? 0),
		},
		models,
		shareWindow: {
			start: window.shareStart,
			endExclusive: window.shareEndExclusive,
			completeWeeks: SHARE_WEEKS,
		},
		weeks,
		modelDays,
		// Complete months only, each clearing the run and developer thresholds.
		runTimeMonths: rows.runTimeMonths.filter(publishable).map((row) => ({
			monthStart: row.month,
			runs: roundTo(Number(row.runs), 10),
			meanSeconds: Number(row.mean_seconds),
			p95Seconds: Number(row.seconds_q[0] ?? 0),
			p99Seconds: Number(row.seconds_q[1] ?? 0),
		})),
		toolCallMonths: rows.toolCallMonths.filter(publishable).map((row) => ({
			monthStart: row.month,
			runs: roundTo(Number(row.runs), 10),
			meanCalls: Number(row.mean_calls),
			p95Calls: Number(row.calls_q[0] ?? 0),
			p99Calls: Number(row.calls_q[1] ?? 0),
		})),
		harnessDays,
		friction: assembleFriction(rows.friction, thresholds),
	};
}

/**
 * Friction per model for three populations, so a reader can pick what
 * counts, whose and per what: developers' swear words, the model's
 * apologies and its failed tool calls, among every developer, only
 * developers who have sworn at any model, or only developers who used
 * COHORT_MODEL. A model row is listed per population once enough of that
 * population's developers used it.
 */
function assembleFriction(
	rows: readonly FrictionRow[],
	thresholds: TrendsUsage["thresholds"],
): TrendsUsage["friction"] {
	const population = (key: "all" | "swearers" | "cohort") => ({
		models: rows
			.filter(
				(row) =>
					row.model !== "" &&
					Number(row[`${key}_developers`]) >= thresholds.minDevelopers,
			)
			.map((row) => ({
				familyId: row.model,
				developers: Number(row[`${key}_developers`]),
				swearers: Number(row[`${key}_swearers`]),
				swears: Number(row[`${key}_swears`]),
				apologies: Number(row[`${key}_apologies`]),
				toolErrors: Number(row[`${key}_tool_errors`]),
				outputTokens: Number(row[`${key}_tokens`]),
				prompts: Number(row[`${key}_prompts`]),
			})),
	});
	return {
		cohortFamilyId: COHORT_MODEL,
		all: population("all"),
		swearers: population("swearers"),
		cohort: population("cohort"),
	};
}

const RUN_MODEL_SQL = buildCanonicalPricingModelSql("run.4");

/** Indexed sessions whose run facts are current. */
const SIGNALS_CTE = `
	signals AS (
		SELECT organization_id, user_id, source, session_id, session_date,
			agent_runs, model_apologies, model_apology_counts, member_swears
		FROM rudel.session_language_signals FINAL
		WHERE scan_version >= {scanVersion:UInt16}
			AND session_date < toDateTime64({periodEnd:String}, 3, 'UTC')
			AND user_id NOT IN {excludedUsers:Array(String)}
	)`;

const RUNS_CTE = `${SIGNALS_CTE},
	runs AS (
		SELECT s.organization_id AS organization_id, s.user_id AS user_id,
			s.session_id AS session_id,
			s.source AS source, run.2 AS started_at, run.3 AS seconds,
			run.6 AS reaction, ${RUN_MODEL_SQL} AS model
		FROM signals AS s
		ARRAY JOIN s.agent_runs AS run
	)`;

const PERIOD_SQL = (column: string) =>
	`if(${column} >= toDateTime64({periodStart:String}, 3, 'UTC'), 'current', 'previous')`;

const IN_PERIODS_SQL = (column: string) =>
	`${column} >= toDateTime64({previousStart:String}, 3, 'UTC') AND ${column} < toDateTime64({periodEnd:String}, 3, 'UTC')`;

/** Per session: runs in start order with their models, and its main model. */
const SESSION_WINDOWS_CTE = `
	session_windows AS (
		SELECT organization_id, user_id, source, session_id, session_date,
			arraySort(run -> run.2, agent_runs) AS ordered_runs,
			arrayMap(run -> run.2, ordered_runs) AS run_starts,
			arrayMap(run -> ${RUN_MODEL_SQL}, ordered_runs) AS run_models,
			ifNull(arrayReduce('topK(1)', arrayFilter(model -> model != '', run_models))[1], '') AS session_model,
			length(agent_runs) AS session_runs,
			model_apologies, model_apology_counts, member_swears
		FROM signals
		WHERE length(agent_runs) > 0
			AND arrayMax(arrayMap(run -> run.2, agent_runs)) >= toDateTime64({previousStart:String}, 3, 'UTC')
	)`;

const RUN_METRICS_SQL = `
	WITH ${RUNS_CTE}
	SELECT ${PERIOD_SQL("started_at")} AS period, model,
		toUInt8(grouping(model)) AS is_total,
		count() AS runs,
		countIf(reaction != 'noReply') AS replied,
		countIf(reaction = 'negative') AS negative,
		countIf(reaction = 'mixed') AS mixed,
		countIf(reaction = 'none') AS neutral,
		countIf(reaction = 'positive') AS positive,
		countIf(seconds >= 0) AS timed,
		if(countIf(seconds >= 0) = 0, [0., 0., 0.],
			quantilesExactIf(0.5, 0.9, 0.99)(seconds, seconds >= 0)) AS seconds_q,
		uniqExact(user_id) AS developers,
		uniqExact(organization_id) AS workspaces,
		uniqExact(organization_id, user_id, session_id) AS sessions
	FROM runs
	WHERE ${IN_PERIODS_SQL("started_at")}
	GROUP BY GROUPING SETS ((period, model), (period))
`;

/**
 * Per model and developer: swears, apologies and prompts over sessions
 * attributed to the model (each session to its most-used run model, as
 * everywhere), failed tool calls against the run that made them (as for
 * the tool failure rate) and output tokens per request against its model;
 * then summed per model for every developer, for developers who have sworn
 * at any model, and for developers who used the cohort model.
 */
function frictionSql(): string {
	const population = (name: string, condition: string) => `
		uniqExactIf(r.organization_id, r.user_id, ${condition}) AS ${name}_developers,
		uniqExactIf(r.organization_id, r.user_id, r.swears > 0 AND ${condition}) AS ${name}_swearers,
		sumIf(r.swears, ${condition}) AS ${name}_swears,
		sumIf(r.apologies, ${condition}) AS ${name}_apologies,
		sumIf(r.tool_errors, ${condition}) AS ${name}_tool_errors,
		sumIf(r.output_tokens, ${condition}) AS ${name}_tokens,
		sumIf(r.prompts, ${condition}) AS ${name}_prompts`;
	return `
	WITH ${buildUsageEventAnalyticsCte({ tenant: "allOrganizations" })},
	${SIGNALS_CTE},
	${SESSION_WINDOWS_CTE},
	${TRANSCRIPT_CTE},
	session_prompts AS (
		SELECT organization_id, user_id, session_id,
			countIf(kind = 'user_prompt' AND agent_id = '' AND subtype != 'delegation') AS prompts
		FROM transcript_events
		GROUP BY organization_id, user_id, session_id
	),
	tool_errors AS (
		SELECT t.organization_id AS organization_id, t.user_id AS user_id,
			t.session_id AS session_id,
			arrayLastIndex(start -> start <= t.ts, w.run_starts) AS run_idx,
			if(run_idx > 0 AND w.run_models[run_idx] != '', w.run_models[run_idx], w.session_model) AS model
		FROM transcript_events AS t
		INNER JOIN session_windows AS w
			ON t.organization_id = w.organization_id AND t.user_id = w.user_id
			AND t.session_id = w.session_id
		WHERE t.kind = 'tool_result' AND t.is_error
			AND ${IN_PERIODS_SQL("t.ts")}
	),
	dev_records AS (
		SELECT w.session_model AS model, w.organization_id AS organization_id,
			w.user_id AS user_id, w.session_id AS session_id,
			toUInt64(0) AS output_tokens,
			toUInt64(if(p.prompts > 0, w.member_swears, 0)) AS swears,
			toUInt64(w.model_apologies) AS apologies,
			toUInt64(0) AS tool_errors,
			toUInt64(ifNull(p.prompts, 0)) AS prompts
		FROM session_windows AS w
		LEFT JOIN session_prompts AS p
			ON w.organization_id = p.organization_id AND w.user_id = p.user_id
			AND w.session_id = p.session_id
		WHERE w.session_model != '' AND ${IN_PERIODS_SQL("w.session_date")}
		UNION ALL
		SELECT model, organization_id, user_id, session_id, toUInt64(0),
			toUInt64(0), toUInt64(0), toUInt64(1), toUInt64(0)
		FROM tool_errors
		WHERE model != ''
		UNION ALL
		SELECT pricing_model AS model, organization_id, user_id, session_id,
			toUInt64(group_output_tokens), toUInt64(0), toUInt64(0),
			toUInt64(0), toUInt64(0)
		FROM priced_usage_groups
		WHERE record_kind = 'event'
			AND usage_date >= toDate({previousStart:String})
			AND usage_date < toDate({periodEnd:String})
			AND user_id NOT IN {excludedUsers:Array(String)}
	),
	dev_rows AS (
		SELECT model, organization_id, user_id,
			sum(output_tokens) AS output_tokens, sum(swears) AS swears,
			sum(apologies) AS apologies, sum(tool_errors) AS tool_errors,
			sum(prompts) AS prompts
		FROM dev_records
		GROUP BY model, organization_id, user_id
	),
	dev_totals AS (
		SELECT organization_id, user_id, sum(swears) AS swears_anywhere,
			sumIf(output_tokens, model = {cohortModel:String}) AS cohort_tokens
		FROM dev_rows
		GROUP BY organization_id, user_id
	)
	SELECT r.model AS model,
		${population("all", "1")},
		${population("swearers", "d.swears_anywhere > 0")},
		${population("cohort", "d.cohort_tokens > 0")}
	FROM dev_rows AS r
	INNER JOIN dev_totals AS d
		ON r.organization_id = d.organization_id AND r.user_id = d.user_id
	GROUP BY model
`;
}

/**
 * Tool calls per agent run, all models together, per month: every tool
 * call between the run's prompt and its answer, from the main transcript
 * and its subagents alike (reads, edits, shell, MCP tools, skills and the
 * subagents themselves), each owned by the run that started latest at or
 * before it. Only sessions with committed transcript records count, so a
 * run without a record of its calls is never read as zero; their runs
 * without a call count as zero.
 */
function toolCallMonthsSql(): string {
	return `
	WITH ${SIGNALS_CTE},
	${SESSION_WINDOWS_CTE},
	${TRANSCRIPT_CTE},
	run_calls AS (
		SELECT t.organization_id AS organization_id, t.user_id AS user_id,
			t.session_id AS session_id,
			arrayLastIndex(start -> start <= t.ts, w.run_starts) AS run_idx,
			count() AS calls
		FROM transcript_events AS t
		INNER JOIN session_windows AS w
			ON t.organization_id = w.organization_id AND t.user_id = w.user_id
			AND t.session_id = w.session_id
		WHERE t.kind = 'tool_call'
		GROUP BY organization_id, user_id, session_id, run_idx
	),
	recorded_runs AS (
		SELECT w.organization_id AS organization_id, w.user_id AS user_id,
			w.session_id AS session_id, idx AS run_idx,
			w.run_starts[idx] AS started_at, w.run_models[idx] AS model
		FROM session_windows AS w
		INNER JOIN transcript_generations AS g
			ON w.organization_id = g.organization_id AND w.user_id = g.user_id
			AND w.session_id = g.session_id
		ARRAY JOIN arrayEnumerate(w.run_starts) AS idx
	)
	SELECT toString(toStartOfMonth(r.started_at)) AS month, count() AS runs,
		uniqExact(r.user_id) AS developers,
		avg(ifNull(c.calls, 0)) AS mean_calls,
		quantilesExact(0.95, 0.99)(ifNull(c.calls, 0)) AS calls_q
	FROM recorded_runs AS r
	LEFT JOIN run_calls AS c
		ON r.organization_id = c.organization_id AND r.user_id = c.user_id
		AND r.session_id = c.session_id AND r.run_idx = c.run_idx
	WHERE r.model != ''
		AND r.started_at < toDateTime64({periodEnd:String}, 3, 'UTC')
	GROUP BY month
	ORDER BY month
`;
}

/** Wall-clock time per timed agent run, all models together, per month. */
const RUN_TIME_MONTHS_SQL = `
	WITH ${RUNS_CTE}
	SELECT toString(toStartOfMonth(started_at)) AS month, count() AS runs,
		uniqExact(user_id) AS developers,
		avg(seconds) AS mean_seconds,
		quantilesExact(0.95, 0.99)(seconds) AS seconds_q
	FROM runs
	WHERE model != '' AND seconds >= 0
		AND started_at < toDateTime64({periodEnd:String}, 3, 'UTC')
	GROUP BY month
	ORDER BY month
`;

/**
 * Weekly runs per model, daily runs per harness and per model (every day),
 * first use per model.
 */
const RUN_COUNTS_SQL = `
	WITH ${RUNS_CTE}
	SELECT 'week' AS kind, toString(toMonday(started_at)) AS key, model, count() AS runs
	FROM runs
	WHERE model != ''
		AND started_at >= toDateTime64({shareStart:String}, 3, 'UTC')
		AND started_at < toDateTime64({shareEnd:String}, 3, 'UTC')
	GROUP BY key, model
	UNION ALL
	SELECT 'day' AS kind, toString(toDate(started_at)) AS key, source AS model, count() AS runs
	FROM runs
	WHERE started_at < toDateTime64({periodEnd:String}, 3, 'UTC')
	GROUP BY key, model
	UNION ALL
	SELECT 'model_day' AS kind, toString(toDate(started_at)) AS key, model, count() AS runs
	FROM runs
	WHERE model != ''
		AND started_at < toDateTime64({periodEnd:String}, 3, 'UTC')
	GROUP BY key, model
	UNION ALL
	SELECT 'first' AS kind, toString(toDate(min(started_at))) AS key, model, count() AS runs
	FROM runs
	WHERE model != ''
	GROUP BY model
`;

/** Output tokens and list-price cost of each run, as quantiles per model. */
function runUsageSql(): string {
	return `
	WITH ${buildUsageEventAnalyticsCte({ tenant: "allOrganizations" })},
	${SIGNALS_CTE},
	${SESSION_WINDOWS_CTE},
	${buildRunPricedUsageCte("session_windows")},
	per_run AS (
		SELECT organization_id, user_id, source, session_id, run_idx,
			sum(group_output_tokens) AS output_tokens,
			sum(ifNull(group_estimated_cost, 0)) AS cost,
			toUInt8(countIf(isNull(group_estimated_cost)) = 0) AS cost_complete
		FROM run_priced_usage_groups
		WHERE run_idx > 0
		GROUP BY organization_id, user_id, source, session_id, run_idx
	),
	attributed AS (
		SELECT p.output_tokens AS output_tokens, p.cost AS cost,
			p.cost_complete AS cost_complete,
			w.run_starts[p.run_idx] AS started_at,
			w.run_models[p.run_idx] AS model
		FROM per_run AS p
		INNER JOIN session_windows AS w
			ON p.organization_id = w.organization_id AND p.user_id = w.user_id
			AND p.source = w.source AND p.session_id = w.session_id
	)
	SELECT ${PERIOD_SQL("started_at")} AS period, model,
		count() AS measured,
		quantilesExact(0.5, 0.9, 0.99)(output_tokens) AS tokens_q,
		countIf(cost_complete = 1) AS priced,
		if(countIf(cost_complete = 1) = 0, [0., 0., 0.],
			quantilesExactIf(0.5, 0.9, 0.99)(cost, cost_complete = 1)) AS cost_q
	FROM attributed
	WHERE model != '' AND ${IN_PERIODS_SQL("started_at")}
	GROUP BY period, model
`;
}

/**
 * Input and output tokens and list-price cost per model, harness and day.
 */
function usageTotalsSql(): string {
	return `
	WITH ${buildUsageEventAnalyticsCte({ tenant: "allOrganizations" })}
	SELECT toString(usage_date) AS day,
		pricing_model AS model, source,
		sum(group_uncached_input_tokens + group_cache_read_input_tokens
			+ group_cache_write_5m_input_tokens + group_cache_write_1h_input_tokens) AS input_tokens,
		sum(group_output_tokens) AS output_tokens,
		sum(ifNull(group_estimated_cost, 0)) AS cost
	FROM priced_usage_groups
	WHERE record_kind = 'event'
		AND usage_date >= toDate({previousStart:String})
		AND usage_date < toDate({periodEnd:String})
		AND user_id NOT IN {excludedUsers:Array(String)}
	GROUP BY day, model, source
`;
}

/** The newest committed transcript-records generation of each session. */
const TRANSCRIPT_CTE = `
	transcript_generations AS (
		SELECT organization_id, user_id, session_id,
			argMax(tuple(revision, parser_version), tuple(revision, parser_version)) AS generation
		FROM rudel.transcript_records
		WHERE agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND block_idx = 0
			AND session_date < toDateTime64({periodEnd:String}, 3, 'UTC')
			AND user_id NOT IN {excludedUsers:Array(String)}
		GROUP BY organization_id, user_id, session_id
	),
	transcript_events AS (
		SELECT r.organization_id AS organization_id, r.user_id AS user_id,
			r.session_id AS session_id, r.kind AS kind, r.subtype AS subtype,
			r.agent_id AS agent_id, r.is_error AS is_error, r.ts AS ts
		FROM rudel.transcript_records AS r FINAL
		INNER JOIN transcript_generations AS g
			ON r.organization_id = g.organization_id AND r.user_id = g.user_id
			AND r.session_id = g.session_id
		WHERE r.revision = g.generation.1 AND r.parser_version = g.generation.2
			AND r.record_idx < {receiptRecordIdx:UInt32}
			AND r.kind IN ('user_prompt', 'tool_call', 'tool_result')
			AND r.session_date < toDateTime64({periodEnd:String}, 3, 'UTC')
	)`;

/**
 * Apologies and swears are counted per session; each session counts toward
 * its most-used run model and its start day. Prompts come from the same
 * sessions' committed transcript records, so swears per prompt only covers
 * sessions that have them.
 */
const SESSION_SIGNALS_SQL = `
	WITH ${SIGNALS_CTE},
	${SESSION_WINDOWS_CTE},
	${TRANSCRIPT_CTE},
	session_prompts AS (
		SELECT organization_id, user_id, session_id,
			countIf(kind = 'user_prompt' AND agent_id = '' AND subtype != 'delegation') AS prompts
		FROM transcript_events
		GROUP BY organization_id, user_id, session_id
	)
	SELECT ${PERIOD_SQL("w.session_date")} AS period, w.session_model AS model,
		sum(w.session_runs) AS session_runs,
		sum(w.model_apologies) AS apologies,
		sumMap(mapKeys(w.model_apology_counts), mapValues(w.model_apology_counts)) AS phrases,
		sumIf(w.member_swears, p.prompts > 0) AS swears,
		sum(p.prompts) AS prompts
	FROM session_windows AS w
	LEFT JOIN session_prompts AS p
		ON w.organization_id = p.organization_id AND w.user_id = p.user_id
		AND w.session_id = p.session_id
	WHERE w.session_model != '' AND ${IN_PERIODS_SQL("w.session_date")}
	GROUP BY period, model
`;

/**
 * Tool calls and failed tool results, each owned by the run that started
 * latest at or before it; records before a session's first run fall back to
 * the session's model.
 */
const TOOL_FAILURES_SQL = `
	WITH ${SIGNALS_CTE},
	${SESSION_WINDOWS_CTE},
	${TRANSCRIPT_CTE},
	tool_records AS (
		SELECT t.kind AS kind, t.is_error AS is_error, t.ts AS ts,
			arrayLastIndex(start -> start <= t.ts, w.run_starts) AS run_idx,
			if(run_idx > 0 AND w.run_models[run_idx] != '', w.run_models[run_idx], w.session_model) AS model
		FROM transcript_events AS t
		INNER JOIN session_windows AS w
			ON t.organization_id = w.organization_id AND t.user_id = w.user_id
			AND t.session_id = w.session_id
		WHERE t.kind IN ('tool_call', 'tool_result')
	)
	SELECT ${PERIOD_SQL("ts")} AS period, model,
		countIf(kind = 'tool_call') AS calls,
		countIf(kind = 'tool_result' AND is_error) AS failures
	FROM tool_records
	WHERE model != '' AND ${IN_PERIODS_SQL("ts")}
	GROUP BY period, model
`;

function quantiles(values: readonly number[] | undefined) {
	const [p50 = 0, p90 = 0, p99 = 0] = (values ?? []).map(Number);
	return { p50, p90, p99 };
}

function topPhrase(
	phrases: readonly [readonly string[], readonly (string | number)[]],
) {
	const [keys, counts] = phrases;
	let best: { phrase: string; count: number } | null = null;
	keys.forEach((phrase, position) => {
		const count = Number(counts[position] ?? 0);
		if (
			count > 0 &&
			(!best ||
				count > best.count ||
				(count === best.count && phrase < best.phrase))
		)
			best = { phrase, count };
	});
	return (best as { phrase: string } | null)?.phrase ?? null;
}

function roundTo(value: number, step: number) {
	return Math.round(value / step) * step;
}

function addDays(day: string, count: number) {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + count);
	return isoDay(date);
}

function isoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}
