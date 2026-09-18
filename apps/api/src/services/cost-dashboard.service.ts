import { ORPCError } from "@orpc/server";
import {
	AGENT_RUN_DURATIONS,
	type CostDashboard,
	type CostDashboardInput,
} from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	buildCostDashboard,
	type CostAggregateRow,
} from "./cost-dashboard-data.js";
import { SESSION_AGENT_RUN_SCAN_VERSION } from "./session-agent-runs.js";
import {
	buildCanonicalPricingModelSql,
	getUsageAnalyticsQueryContext,
} from "./usage-event-analytics.service.js";

const MAX_AGGREGATE_ROWS = 100_000;

export async function getCostDashboard(
	orgId: string,
	input: CostDashboardInput,
): Promise<CostDashboard> {
	const usage = await getUsageAnalyticsQueryContext(orgId);
	// Reuse the request pricing pipeline, before its session rollup replaces the
	// model dimension with a single display model. No transcript bodies are read.
	const source =
		usage.mode === "events"
			? `
  SELECT 'cost' AS metric, toString(p.usage_date) AS date, p.user_id AS member,
   ${repositorySql("sa")} AS repository,
   if(p.pricing_model != '', p.pricing_model, p.pricing_identity) AS model,
   ifNull(p.group_estimated_cost, 0) AS value,
   isNull(p.group_estimated_cost) AS incomplete, '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used
  FROM (
   SELECT * FROM priced_usage_groups
   WHERE record_kind = 'event'
    AND group_uncached_input_tokens + group_cache_read_input_tokens + group_cache_write_5m_input_tokens + group_cache_write_1h_input_tokens + group_output_tokens > 0
    AND organization_id = {orgId:String}
    AND usage_date BETWEEN toDate({startDate:String}) AND toDate({endDate:String})
  ) AS p
  ANY LEFT JOIN usage_analytics_metadata AS sa
   ON p.organization_id = sa.organization_id AND p.user_id = sa.user_id
    AND p.source = sa.source AND p.session_id = sa.session_id
  WHERE sa.organization_id = {orgId:String}
 `
			: `
  SELECT 'cost' AS metric, toString(usage_date) AS date, user_id AS member,
   ${repositorySql("sa")} AS repository, model_used AS model,
   ifNull(estimated_cost, 0) AS value, NOT cost_is_complete AS incomplete, '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used
  FROM ${usage.dailySessionsRelation} AS sa
  WHERE organization_id = {orgId:String}
   AND usage_date BETWEEN toDate({startDate:String}) AND toDate({endDate:String})
 `;
	// One row per session, bucketed by start date. Count it once under the same
	// primary model as the session list, not once per request/model/day.
	const canonicalModel =
		usage.mode === "events"
			? buildCanonicalPricingModelSql("sa.model_used")
			: "sa.model_used";
	const sessions = `
  SELECT metric_value.1 AS metric, toString(toDate(sa.session_date)) AS date,
   sa.user_id AS member, ${repositorySql("sa")} AS repository,
   if(${canonicalModel} != '', ${canonicalModel}, sa.model_used) AS model,
   toFloat64(metric_value.4) AS value,
   toUInt8(metric_value.1 = 'signals' AND signals.scan_version < 5) AS incomplete,
   metric_value.2 AS signal_type, metric_value.3 AS phrase,
   '' AS run_signal, '' AS duration, '' AS skills_used
  FROM (
   SELECT * FROM ${usage.sessionsRelation}
   WHERE organization_id = {orgId:String}
    AND session_date >= toDateTime({startDate:String}, 'UTC')
    AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
  ) AS sa
  ANY LEFT JOIN (
   SELECT organization_id, user_id, source, session_id, session_date,
    scan_version, model_apology_counts, member_negative_counts, member_positive_counts
   FROM rudel.session_language_signals FINAL
   PREWHERE organization_id = {orgId:String}
    AND session_date >= toDateTime({startDate:String}, 'UTC')
    AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
  ) AS signals
   ON sa.organization_id = signals.organization_id AND sa.user_id = signals.user_id
    AND sa.source = signals.source AND sa.session_id = signals.session_id
    AND sa.session_date = signals.session_date
  ARRAY JOIN arrayConcat(
   [tuple('sessions', '', '', toUInt64(1)),
    tuple('signals', 'modelApologies', '', toUInt64(0)),
    tuple('signals', 'userNegative', '', toUInt64(0)),
    tuple('signals', 'userPositive', '', toUInt64(0))],
   arrayMap((phrase, count) -> tuple('signals', 'modelApologies', phrase, toUInt64(count)), mapKeys(signals.model_apology_counts), mapValues(signals.model_apology_counts)),
   arrayMap((phrase, count) -> tuple('signals', 'userNegative', phrase, toUInt64(count)), mapKeys(signals.member_negative_counts), mapValues(signals.member_negative_counts)),
   arrayMap((phrase, count) -> tuple('signals', 'userPositive', phrase, toUInt64(count)), mapKeys(signals.member_positive_counts), mapValues(signals.member_positive_counts))
  ) AS metric_value
 `;
	// Run facts are indexed with each raw revision. Start dates belong to runs,
	// so a long-lived session can contribute on days after it was first opened.
	const durationCases = AGENT_RUN_DURATIONS.filter((bucket) =>
		Number.isFinite(bucket.upperSeconds),
	)
		.map((bucket) => `run.3 < ${bucket.upperSeconds}, '${bucket.id}'`)
		.join(", ");
	const runs = `
  SELECT 'agentRuns' AS metric,
   toString(if(incomplete, toDate({startDate:String}), toDate(run.2))) AS date,
   sa.user_id AS member, ${repositorySql("sa")} AS repository,
   coalesce(nullIf(${buildCanonicalPricingModelSql("run.4")}, ''), nullIf(run.4, ''), sa.model_used) AS model,
   toFloat64(NOT incomplete) AS value,
   toUInt8(signals.scan_version < ${SESSION_AGENT_RUN_SCAN_VERSION} OR signals.raw_revision < sa.revision) AS incomplete,
   '' AS signal_type, '' AS phrase, run.6 AS run_signal,
   multiIf(run.3 < 0, 'unknown', ${durationCases}, '12hPlus') AS duration,
   if(run.5 = 1, 'yes', 'no') AS skills_used
  FROM (
   SELECT * FROM usage_analytics_metadata
   WHERE organization_id = {orgId:String}
    AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
    AND last_interaction_date >= toDateTime({startDate:String}, 'UTC')
  ) AS sa
  ANY LEFT JOIN (
   SELECT organization_id, user_id, source, session_id, session_date, scan_version, raw_revision, agent_runs
   FROM rudel.session_language_signals FINAL
   PREWHERE organization_id = {orgId:String}
    AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
  ) AS signals
   ON sa.organization_id = signals.organization_id AND sa.user_id = signals.user_id
    AND sa.source = signals.source AND sa.session_id = signals.session_id
    AND sa.session_date = signals.session_date
  ARRAY JOIN if(signals.scan_version < ${SESSION_AGENT_RUN_SCAN_VERSION} OR signals.raw_revision < sa.revision,
   [tuple('', toDateTime64({startDate:String}, 3, 'UTC'), toFloat64(-1), '', toUInt8(0), '')],
   signals.agent_runs) AS run
  WHERE incomplete OR (run.2 >= toDateTime({startDate:String}, 'UTC')
   AND run.2 < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY)
 `;

	const memberMatch =
		"(empty({members:Array(String)}) OR has({members:Array(String)}, member))";
	const repositoryMatch =
		"(empty({repositories:Array(String)}) OR has({repositories:Array(String)}, repository))";
	const modelMatch =
		"(empty({models:Array(String)}) OR has({models:Array(String)}, model) OR (metric = 'agentRuns' AND s.incomplete))";
	// Each signal row is one exact phrase frequency, not a copy of the category
	// total. Blank zero rows preserve known-zero categories and indexing state.
	const typeMatch =
		"(metric != 'signals' OR empty({signalTypes:Array(String)}) OR has({signalTypes:Array(String)}, signal_type))";
	const phraseMatch =
		"(metric != 'signals' OR empty({phrases:Array(String)}) OR s.incomplete OR has({phrases:Array(String)}, phrase))";
	const runSignalMatch =
		"(metric != 'agentRuns' OR s.incomplete OR empty({runSignals:Array(String)}) OR has({runSignals:Array(String)}, run_signal))";
	const durationMatch =
		"(metric != 'agentRuns' OR s.incomplete OR empty({durations:Array(String)}) OR has({durations:Array(String)}, duration))";
	const skillsMatch =
		"(metric != 'agentRuns' OR s.incomplete OR empty({skillsUsed:Array(String)}) OR has({skillsUsed:Array(String)}, skills_used))";
	const matches = `${memberMatch} AND ${repositoryMatch} AND ${modelMatch} AND ${typeMatch} AND ${phraseMatch} AND ${runSignalMatch} AND ${durationMatch} AND ${skillsMatch}`;
	const rows = await queryClickhouse<CostAggregateRow>({
		query: `WITH ${usage.cteDefinitions}, dashboard_source AS (${source} UNION ALL ${sessions} UNION ALL ${runs})
   SELECT metric, date, dimension, multiIf(dimension = 'members', member, dimension = 'repositories', repository, dimension = 'models', model, dimension = 'signalTypes', signal_type, dimension = 'runSignals', run_signal, dimension = 'durations', duration, dimension = 'skillsUsed', skills_used, phrase) AS id,
    sum(s.value) AS value, countIf(s.incomplete) AS incomplete,
    sumIf(s.value, ${matches}) AS matched_value,
    countIf(${matches}) AS matched_rows,
    countIf(s.incomplete AND ${matches}) AS matched_incomplete
   FROM dashboard_source AS s
   ARRAY JOIN multiIf(metric = 'agentRuns', ['members', 'repositories', 'models', 'runSignals', 'durations', 'skillsUsed'], metric = 'signals', ['members', 'repositories', 'models', 'signalTypes', 'phrases'], ['members', 'repositories', 'models']) AS dimension
   WHERE (dimension = 'members' OR ${memberMatch})
    AND (dimension = 'repositories' OR ${repositoryMatch})
    AND (dimension = 'models' OR ${modelMatch})
    AND (dimension = 'signalTypes' OR ${typeMatch})
    AND (dimension = 'phrases' OR ${phraseMatch})
    AND (dimension = 'runSignals' OR ${runSignalMatch})
    AND (dimension = 'durations' OR ${durationMatch})
    AND (dimension = 'skillsUsed' OR ${skillsMatch})
   GROUP BY metric, date, dimension, id
   ORDER BY metric, date, dimension, id
   LIMIT ${MAX_AGGREGATE_ROWS + 1}`,
		query_params: {
			orgId,
			startDate: input.startDate,
			endDate: input.endDate,
			members: input.members,
			repositories: input.repositories,
			models: input.models,
			signalTypes: input.signalTypes,
			phrases: input.phrases,
			runSignals: input.runSignals,
			durations: input.durations,
			skillsUsed: input.skillsUsed,
		},
		clickhouse_settings: {
			max_execution_time: 20,
			max_rows_to_read: "100000000",
			max_bytes_to_read: "10000000000",
			timeout_before_checking_execution_speed: 0,
			max_result_rows: String(MAX_AGGREGATE_ROWS + 1),
			result_overflow_mode: "throw",
		},
	});
	// Never present a silently truncated subtotal as the total cost.
	if (rows.length > MAX_AGGREGATE_ROWS)
		throw new ORPCError("BAD_REQUEST", {
			message: "Choose a shorter date range to view this cost breakdown.",
		});
	const memberIds = [
		...new Set(
			rows.filter((row) => row.dimension === "members").map((row) => row.id),
		),
	];
	const members =
		memberIds.length === 0
			? []
			: await sqlClient.unsafe<
					Array<{
						id: string;
						name: string | null;
						email: string;
						image: string | null;
					}>
				>(
					'SELECT id, name, email, image FROM "user" WHERE id = ANY($1::text[])',
					[memberIds],
				);
	return buildCostDashboard(
		rows,
		input,
		new Map(
			members.map((member) => [
				member.id,
				{ label: member.name?.trim() || member.email, image: member.image },
			]),
		),
	);
}

function repositorySql(alias: string): string {
	// Keep the host and owner in the key, so identically named repositories do
	// not collide. Normalize HTTPS/SSH remotes; local projects retain their path.
	return `if(${alias}.git_remote != '',
  replaceRegexpOne(replaceRegexpOne(replaceRegexpOne(${alias}.git_remote, '^(https?://|ssh://)?(git@)?', ''), ':', '/'), '[.]git/?$', ''),
  if(${alias}.project_path != '', ${alias}.project_path, ${alias}.package_name))`;
}
