import { ORPCError } from "@orpc/server";
import {
	AGENT_RUN_DURATIONS,
	type CostDashboard,
	type CostDashboardInput,
	type DashboardMetricData,
} from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	type AnalyticsTenant,
	organizationMatchSql,
} from "./analytics-tenant.js";
import {
	buildCostDashboard,
	type CostAggregateRow,
} from "./cost-dashboard-data.js";
import { SESSION_AGENT_RUN_SCAN_VERSION } from "./session-agent-runs.js";
import {
	buildCanonicalPricingModelSql,
	getAllOrganizationsUsageAnalyticsQueryContext,
	getUsageAnalyticsQueryContext,
} from "./usage-event-analytics.service.js";

const MAX_AGGREGATE_ROWS = 100_000;
type AgentRunDurationInterval = NonNullable<
	CostDashboardInput["durationInterval"]
>;
type AgentRunDurationStats = NonNullable<DashboardMetricData["durationStats"]>;
type DetailedMetric = NonNullable<CostDashboardInput["requestedMetric"]>;

// The all-organizations view is for operators and stays anonymous: it never
// groups by repository or user, so customer repository names and user
// identities stay out of cross-tenant reads.
export type CostDashboardScope =
	| { readonly tenant: "organization"; readonly orgId: string }
	| { readonly tenant: "allOrganizations" };

const DIMENSIONS_BY_METRIC = {
	cost: ["members", "repositories", "models"],
	sessions: ["members", "repositories", "models"],
	signals: ["members", "repositories", "models", "signalTypes", "phrases"],
	agentRuns: [
		"members",
		"repositories",
		"models",
		"runSignals",
		"durations",
		"skillsUsed",
	],
} as const;

interface AgentRunDurationAggregateRow {
	readonly date: string;
	readonly is_overall: number;
	readonly sample_count: number;
	readonly unknown_count: number;
	readonly quantiles: readonly (number | null)[];
}

export async function getCostDashboard(
	scope: CostDashboardScope,
	input: CostDashboardInput,
): Promise<CostDashboard> {
	const orgMatch = (column: string) =>
		organizationMatchSql(column, scope.tenant);
	const repositorySql = (alias: string) =>
		scopedRepositorySql(scope.tenant, alias);
	// The unsplit trend is built from the members facet, so the anonymous view
	// keeps that facet with one blank member instead of dropping it.
	const memberSql = (alias: string) =>
		scope.tenant === "allOrganizations" ? "''" : `${alias}.user_id`;
	const dimensionsFor = (metric: DetailedMetric) =>
		DIMENSIONS_BY_METRIC[metric].filter(
			(dimension) =>
				scope.tenant !== "allOrganizations" || dimension !== "repositories",
		);
	const usage =
		scope.tenant === "organization"
			? await getUsageAnalyticsQueryContext(scope.orgId)
			: await getAllOrganizationsUsageAnalyticsQueryContext();
	// Older clients omit the selector and retain the original all-breakdowns
	// response. Current clients name the visible metric so only its detailed
	// facet rows are materialized.
	const legacyAllDetails = input.requestedMetric === undefined;
	const detailedSignals =
		legacyAllDetails || input.requestedMetric === "signals";
	// Reuse the request pricing pipeline, before its session rollup replaces the
	// model dimension with a single display model. No transcript bodies are read.
	const source =
		usage.mode === "events"
			? `
  SELECT 'cost' AS metric, toString(p.usage_date) AS date, ${memberSql("p")} AS member,
   ${repositorySql("sa")} AS repository,
   if(p.pricing_model != '', p.pricing_model, p.pricing_identity) AS model,
   ifNull(p.group_estimated_cost, 0) AS value,
	   isNull(p.group_estimated_cost) AS incomplete, '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
  FROM (
   SELECT * FROM priced_usage_groups
   WHERE record_kind = 'event'
    AND group_uncached_input_tokens + group_cache_read_input_tokens + group_cache_write_5m_input_tokens + group_cache_write_1h_input_tokens + group_output_tokens > 0
    AND ${orgMatch("organization_id")}
    AND usage_date BETWEEN toDate({startDate:String}) AND toDate({endDate:String})
  ) AS p
  ANY LEFT JOIN usage_analytics_metadata AS sa
   ON p.organization_id = sa.organization_id AND p.user_id = sa.user_id
    AND p.source = sa.source AND p.session_id = sa.session_id
  WHERE ${orgMatch("sa.organization_id")}
 `
			: `
  SELECT 'cost' AS metric, toString(sa.usage_date) AS date, ${memberSql("sa")} AS member,
	   ${repositorySql("sa")} AS repository, sa.model_used AS model,
	   ifNull(sa.estimated_cost, 0) AS value, NOT sa.cost_is_complete AS incomplete, '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
  FROM ${usage.dailySessionsRelation} AS sa
  WHERE ${orgMatch("sa.organization_id")}
   AND sa.usage_date BETWEEN toDate({startDate:String}) AND toDate({endDate:String})
 `;
	// One row per session, bucketed by start date. Count it once under the same
	// primary model as the session list, not once per request/model/day.
	const canonicalModel =
		usage.mode === "events"
			? buildCanonicalPricingModelSql("sa.model_used")
			: "sa.model_used";
	const sessions = `
	  SELECT 'sessions' AS metric, toString(toDate(sa.session_date)) AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   if(${canonicalModel} != '', ${canonicalModel}, sa.model_used) AS model,
	   toFloat64(1) AS value, toUInt8(0) AS incomplete,
	   '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
	  FROM dashboard_sessions AS sa
	 `;
	const filteredSignalCount = (map: string, type: string) => `arraySum(arrayMap(
	   (phrase, count) -> if(
	    (empty({signalTypes:Array(String)}) OR has({signalTypes:Array(String)}, '${type}'))
	     AND (empty({phrases:Array(String)}) OR has({phrases:Array(String)}, phrase)),
	    count, 0),
	   mapKeys(${map}), mapValues(${map})
	  ))`;
	const signals = detailedSignals
		? `
	  SELECT 'signals' AS metric, toString(toDate(sa.session_date)) AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   if(${canonicalModel} != '', ${canonicalModel}, sa.model_used) AS model,
	   toFloat64(signal_value.3) AS value,
	   toUInt8(signal_summary.scan_version < 5) AS incomplete,
	   signal_value.1 AS signal_type, signal_value.2 AS phrase,
	   '' AS run_signal, '' AS duration, '' AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
	  FROM dashboard_sessions AS sa
	  ANY LEFT JOIN dashboard_signals AS signal_summary
	   ON sa.organization_id = signal_summary.organization_id AND sa.user_id = signal_summary.user_id
	    AND sa.source = signal_summary.source AND sa.session_id = signal_summary.session_id
	    AND sa.session_date = signal_summary.session_date
	  ARRAY JOIN arrayConcat(
	   [tuple('modelApologies', '', toUInt64(0)),
	    tuple('userNegative', '', toUInt64(0)),
	    tuple('userPositive', '', toUInt64(0))],
	   arrayMap((phrase, count) -> tuple('modelApologies', phrase, toUInt64(count)), mapKeys(signal_summary.model_apology_counts), mapValues(signal_summary.model_apology_counts)),
	   arrayMap((phrase, count) -> tuple('userNegative', phrase, toUInt64(count)), mapKeys(signal_summary.member_negative_counts), mapValues(signal_summary.member_negative_counts)),
	   arrayMap((phrase, count) -> tuple('userPositive', phrase, toUInt64(count)), mapKeys(signal_summary.member_positive_counts), mapValues(signal_summary.member_positive_counts))
	  ) AS signal_value
	 `
		: `
	  SELECT 'signals' AS metric, toString(toDate(sa.session_date)) AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   if(${canonicalModel} != '', ${canonicalModel}, sa.model_used) AS model,
	   toFloat64(
	    ${filteredSignalCount("signal_summary.model_apology_counts", "modelApologies")}
	     + ${filteredSignalCount("signal_summary.member_negative_counts", "userNegative")}
	     + ${filteredSignalCount("signal_summary.member_positive_counts", "userPositive")}
	   ) AS value,
	   toUInt8(signal_summary.scan_version < 5) AS incomplete,
	   '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
	  FROM dashboard_sessions AS sa
	  ANY LEFT JOIN dashboard_signals AS signal_summary
	   ON sa.organization_id = signal_summary.organization_id AND sa.user_id = signal_summary.user_id
	    AND sa.source = signal_summary.source AND sa.session_id = signal_summary.session_id
	    AND sa.session_date = signal_summary.session_date
	 `;
	// Run facts are indexed with each raw revision. Start dates belong to runs,
	// so a long-lived session can contribute on days after it was first opened.
	const durationCases = agentRunDurationCasesSql("run");
	const runModel = agentRunModelSql("run", "sa");
	const runDuration = agentRunDurationSql("run", durationCases);
	const sessionMemberMatch =
		"(empty({members:Array(String)}) OR has({members:Array(String)}, sa.user_id))";
	const sessionRepositoryMatch = `(empty({repositories:Array(String)}) OR has({repositories:Array(String)}, ${repositorySql("sa")}))`;
	const runs =
		input.requestedMetric === "agentRuns"
			? `
	  SELECT 'agentRuns' AS metric,
	   toString(toDate(run.2)) AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   ${runModel} AS model,
	   toFloat64(1) AS value, toUInt8(0) AS incomplete,
	   '' AS signal_type, '' AS phrase, run.6 AS run_signal,
	   ${runDuration} AS duration, if(run.5 = 1, 'yes', 'no') AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
	  FROM agent_run_sessions AS sa
	  ARRAY JOIN if(sa.incomplete, [], sa.agent_runs) AS run
	  WHERE run.2 >= toDateTime({startDate:String}, 'UTC')
	   AND run.2 < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	 `
			: legacyAllDetails
				? `
	  SELECT 'agentRuns' AS metric,
	   toString(if(sa.incomplete, toDate({startDate:String}), toDate(run.2))) AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   ${runModel} AS model,
	   toFloat64(NOT sa.incomplete) AS value, sa.incomplete AS incomplete,
	   '' AS signal_type, '' AS phrase, run.6 AS run_signal,
	   ${runDuration} AS duration, if(run.5 = 1, 'yes', 'no') AS skills_used,
	   '' AS coverage_status, toUInt8(0) AS prefiltered
	  FROM agent_run_sessions AS sa
	  ARRAY JOIN if(sa.incomplete,
	   [tuple('', toDateTime64({startDate:String}, 3, 'UTC'), toFloat64(-1), '', toUInt8(0), '')],
	   sa.agent_runs) AS run
	  WHERE sa.incomplete OR (run.2 >= toDateTime({startDate:String}, 'UTC')
	   AND run.2 < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY)
	 `
				: `
	  SELECT 'agentRuns' AS metric, {startDate:String} AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   '' AS model,
	   toFloat64(if(sa.incomplete, 0, arrayCount(run ->
	    run.2 >= toDateTime({startDate:String}, 'UTC')
	     AND run.2 < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	     AND (empty({models:Array(String)}) OR has({models:Array(String)}, ${runModel}))
	     AND (empty({runSignals:Array(String)}) OR has({runSignals:Array(String)}, run.6))
	     AND (empty({durations:Array(String)}) OR has({durations:Array(String)}, ${runDuration}))
	     AND (empty({skillsUsed:Array(String)}) OR has({skillsUsed:Array(String)}, if(run.5 = 1, 'yes', 'no'))),
	    sa.agent_runs
	   ))) AS value,
	   sa.incomplete AS incomplete,
	   '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used,
	   '' AS coverage_status, toUInt8(1) AS prefiltered
	  FROM agent_run_sessions AS sa
	  WHERE ${sessionMemberMatch} AND ${sessionRepositoryMatch}
	 `;
	const coverage =
		input.requestedMetric === "agentRuns"
			? `
	  SELECT 'agentRunCoverage' AS metric, {startDate:String} AS date,
	   ${memberSql("sa")} AS member, ${repositorySql("sa")} AS repository,
	   sa.model_used AS model, toFloat64(1) AS value, sa.incomplete AS incomplete,
	   '' AS signal_type, '' AS phrase, '' AS run_signal, '' AS duration, '' AS skills_used,
	   multiIf(NOT sa.incomplete, 'indexed', sa.raw_is_retained, 'indexing', 'unavailable') AS coverage_status,
	   toUInt8(1) AS prefiltered
	  FROM agent_run_sessions AS sa
	  WHERE ${sessionMemberMatch} AND ${sessionRepositoryMatch}
	 `
			: undefined;

	const memberMatch =
		"(s.prefiltered = 1 OR empty({members:Array(String)}) OR has({members:Array(String)}, member))";
	const repositoryMatch =
		"(s.prefiltered = 1 OR empty({repositories:Array(String)}) OR has({repositories:Array(String)}, repository))";
	const modelMatch =
		"(s.prefiltered = 1 OR empty({models:Array(String)}) OR has({models:Array(String)}, model) OR (metric = 'agentRuns' AND s.incomplete))";
	// Each signal row is one exact phrase frequency, not a copy of the category
	// total. Blank zero rows preserve known-zero categories and indexing state.
	const typeMatch = detailedSignals
		? "(s.prefiltered = 1 OR metric != 'signals' OR empty({signalTypes:Array(String)}) OR has({signalTypes:Array(String)}, signal_type))"
		: "1";
	const phraseMatch = detailedSignals
		? "(s.prefiltered = 1 OR metric != 'signals' OR empty({phrases:Array(String)}) OR s.incomplete OR has({phrases:Array(String)}, phrase))"
		: "1";
	const runSignalMatch =
		"(s.prefiltered = 1 OR metric != 'agentRuns' OR s.incomplete OR empty({runSignals:Array(String)}) OR has({runSignals:Array(String)}, run_signal))";
	const durationMatch =
		"(s.prefiltered = 1 OR metric != 'agentRuns' OR s.incomplete OR empty({durations:Array(String)}) OR has({durations:Array(String)}, duration))";
	const skillsMatch =
		"(s.prefiltered = 1 OR metric != 'agentRuns' OR s.incomplete OR empty({skillsUsed:Array(String)}) OR has({skillsUsed:Array(String)}, skills_used))";
	const matches = `${memberMatch} AND ${repositoryMatch} AND ${modelMatch} AND ${typeMatch} AND ${phraseMatch} AND ${runSignalMatch} AND ${durationMatch} AND ${skillsMatch}`;
	const dimensionListSql = (metric: DetailedMetric) =>
		`[${dimensionsFor(metric)
			.map((dimension) => `'${dimension}'`)
			.join(", ")}]`;
	const dimensionsSql =
		input.requestedMetric === undefined
			? `arrayConcat(['headline'], multiIf(metric = 'agentRuns', ${dimensionListSql("agentRuns")}, metric = 'signals', ${dimensionListSql("signals")}, ${dimensionListSql("cost")}))`
			: `multiIf(metric = 'agentRunCoverage', ['coverage'], metric = '${input.requestedMetric}', arrayConcat(['headline'], ${dimensionListSql(input.requestedMetric)}), ['headline'])`;
	const retainedRawCte =
		input.requestedMetric === "agentRuns"
			? `,
	 retained_agent_run_sessions AS (
	  SELECT organization_id, user_id, source, session_id, session_date, max(revision) AS raw_revision
	  FROM (
	   SELECT organization_id, user_id, 'claude_code' AS source, session_id, session_date, revision
	   FROM rudel.claude_sessions
	   PREWHERE ${orgMatch("organization_id")}
	   WHERE session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	    AND last_interaction_date >= toDateTime({startDate:String}, 'UTC')
	   UNION ALL
	   SELECT organization_id, user_id, 'codex' AS source, session_id, session_date, revision
	   FROM rudel.codex_sessions
	   PREWHERE ${orgMatch("organization_id")}
	   WHERE session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	    AND last_interaction_date >= toDateTime({startDate:String}, 'UTC')
	  )
	  GROUP BY organization_id, user_id, source, session_id, session_date
	 )`
			: "";
	const retainedRawJoin =
		input.requestedMetric === "agentRuns"
			? `
	  ANY LEFT JOIN retained_agent_run_sessions AS raw
	   ON sa.organization_id = raw.organization_id AND sa.user_id = raw.user_id
	    AND sa.source = raw.source AND sa.session_id = raw.session_id
	    AND sa.session_date = raw.session_date`
			: "";
	const rawIsRetained =
		input.requestedMetric === "agentRuns"
			? "toUInt8(raw.raw_revision >= sa.revision)"
			: "toUInt8(0)";
	const rowsPromise = queryClickhouse<CostAggregateRow>({
		query: `WITH ${usage.cteDefinitions},
	 dashboard_sessions AS (
	  SELECT * FROM ${usage.sessionsRelation}
	  WHERE ${orgMatch("organization_id")}
	   AND session_date >= toDateTime({startDate:String}, 'UTC')
	   AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	 ),
	 dashboard_signals AS (
	  SELECT organization_id, user_id, source, session_id, session_date, scan_version, raw_revision,
	   agent_runs, model_apology_counts, member_negative_counts, member_positive_counts
	  FROM rudel.session_language_signals FINAL
	  PREWHERE ${orgMatch("organization_id")}
	   AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	 )${retainedRawCte},
	 agent_run_sessions AS (
	  SELECT sa.*,
	   signal_summary.scan_version AS scan_version,
	   signal_summary.raw_revision AS signal_raw_revision,
	   signal_summary.agent_runs AS agent_runs,
	   toUInt8(signal_summary.scan_version < ${SESSION_AGENT_RUN_SCAN_VERSION} OR signal_summary.raw_revision < sa.revision) AS incomplete,
	   ${rawIsRetained} AS raw_is_retained
	  FROM usage_analytics_metadata AS sa
	  ANY LEFT JOIN dashboard_signals AS signal_summary
	   ON sa.organization_id = signal_summary.organization_id AND sa.user_id = signal_summary.user_id
	    AND sa.source = signal_summary.source AND sa.session_id = signal_summary.session_id
	    AND sa.session_date = signal_summary.session_date${retainedRawJoin}
	  WHERE ${orgMatch("sa.organization_id")}
	   AND sa.session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	   AND sa.last_interaction_date >= toDateTime({startDate:String}, 'UTC')
	 ),
	 dashboard_source AS (${[source, sessions, signals, runs, coverage]
			.filter((part) => part !== undefined)
			.join(" UNION ALL ")})
	   SELECT metric, date, dimension, multiIf(dimension = 'members', member, dimension = 'repositories', repository, dimension = 'models', model, dimension = 'signalTypes', signal_type, dimension = 'phrases', phrase, dimension = 'runSignals', run_signal, dimension = 'durations', duration, dimension = 'skillsUsed', skills_used, dimension = 'coverage', coverage_status, '') AS id,
	    sum(s.value) AS value, countIf(s.incomplete) AS incomplete,
    sumIf(s.value, ${matches}) AS matched_value,
    countIf(${matches}) AS matched_rows,
	    countIf(s.incomplete AND ${matches}) AS matched_incomplete
	   FROM dashboard_source AS s
	   ARRAY JOIN ${dimensionsSql} AS dimension
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
			...orgParams(scope),
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
	const durationRowsPromise =
		input.requestedMetric === "agentRuns"
			? queryAgentRunDurationStats(scope, input, usage.cteDefinitions)
			: Promise.resolve(undefined);
	const [rows, durationRows] = await Promise.all([
		rowsPromise,
		durationRowsPromise,
	]);
	// Never present a silently truncated subtotal as the total cost.
	if (rows.length > MAX_AGGREGATE_ROWS)
		throw new ORPCError("BAD_REQUEST", {
			message: "Choose a shorter date range to view this cost breakdown.",
		});
	const durationStats =
		durationRows !== undefined
			? buildAgentRunDurationStats(durationRows, input)
			: undefined;
	const memberIds = [
		...new Set(
			rows
				.filter((row) => row.dimension === "members" && row.id !== "")
				.map((row) => row.id),
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
	const dashboard = buildCostDashboard(
		rows,
		input,
		new Map(
			members.map((member) => [
				member.id,
				{ label: member.name?.trim() || member.email, image: member.image },
			]),
		),
		durationStats,
	);
	if (scope.tenant === "allOrganizations") {
		for (const metric of Object.values(dashboard.metrics))
			if (metric) metric.breakdowns.members = [];
	}
	return dashboard;
}

function orgParams(scope: CostDashboardScope): { orgId?: string } {
	return scope.tenant === "organization" ? { orgId: scope.orgId } : {};
}

function scopedRepositorySql(tenant: AnalyticsTenant, alias: string): string {
	return tenant === "allOrganizations" ? "''" : repositorySql(alias);
}

function repositorySql(alias: string): string {
	// Keep the host and owner in the key, so identically named repositories do
	// not collide. Normalize HTTPS/SSH remotes; local projects retain their path.
	return `if(${alias}.git_remote != '',
  replaceRegexpOne(replaceRegexpOne(replaceRegexpOne(${alias}.git_remote, '^(https?://|ssh://)?(git@)?', ''), ':', '/'), '[.]git/?$', ''),
  if(${alias}.project_path != '', ${alias}.project_path, ${alias}.package_name))`;
}

async function queryAgentRunDurationStats(
	scope: CostDashboardScope,
	input: CostDashboardInput,
	usageCteDefinitions: string,
): Promise<AgentRunDurationAggregateRow[]> {
	const interval = input.durationInterval ?? "daily";
	const period = {
		daily: "toStartOfInterval(run.2, INTERVAL 1 DAY, 'UTC')",
		weekly: "toStartOfInterval(run.2, INTERVAL 1 WEEK, 'UTC')",
		monthly: "toStartOfInterval(run.2, INTERVAL 1 MONTH, 'UTC')",
		quarterly: "toStartOfInterval(run.2, INTERVAL 1 QUARTER, 'UTC')",
		yearly: "toStartOfInterval(run.2, INTERVAL 1 YEAR, 'UTC')",
	} satisfies Record<AgentRunDurationInterval, string>;
	const runModel = agentRunModelSql("run", "sa");
	const runDuration = agentRunDurationSql(
		"run",
		agentRunDurationCasesSql("run"),
	);
	return queryClickhouse<AgentRunDurationAggregateRow>({
		query: `WITH ${usageCteDefinitions},
	 dashboard_signals AS (
	  SELECT organization_id, user_id, source, session_id, session_date,
	   scan_version, raw_revision, agent_runs
	  FROM rudel.session_language_signals FINAL
	  PREWHERE ${organizationMatchSql("organization_id", scope.tenant)}
	   AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	 ),
	 agent_run_sessions AS (
	  SELECT sa.*,
	   signal_summary.agent_runs AS agent_runs,
	   toUInt8(signal_summary.scan_version < ${SESSION_AGENT_RUN_SCAN_VERSION}
	    OR signal_summary.raw_revision < sa.revision) AS incomplete
	  FROM usage_analytics_metadata AS sa
	  ANY LEFT JOIN dashboard_signals AS signal_summary
	   ON sa.organization_id = signal_summary.organization_id
	    AND sa.user_id = signal_summary.user_id
	    AND sa.source = signal_summary.source
	    AND sa.session_id = signal_summary.session_id
	    AND sa.session_date = signal_summary.session_date
	  WHERE ${organizationMatchSql("sa.organization_id", scope.tenant)}
	   AND sa.session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	   AND sa.last_interaction_date >= toDateTime({startDate:String}, 'UTC')
	 ),
	 matched_runs AS (
	  SELECT ${period[interval]} AS period, run.3 AS elapsed_seconds
	  FROM agent_run_sessions AS sa
	  ARRAY JOIN if(sa.incomplete, [], sa.agent_runs) AS run
	  WHERE run.2 >= toDateTime({startDate:String}, 'UTC')
	   AND run.2 < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
	   AND (empty({members:Array(String)}) OR has({members:Array(String)}, sa.user_id))
	   AND (empty({repositories:Array(String)}) OR has({repositories:Array(String)}, ${scopedRepositorySql(scope.tenant, "sa")}))
	   AND (empty({models:Array(String)}) OR has({models:Array(String)}, ${runModel}))
	   AND (empty({runSignals:Array(String)}) OR has({runSignals:Array(String)}, run.6))
	   AND (empty({durations:Array(String)}) OR has({durations:Array(String)}, ${runDuration}))
	   AND (empty({skillsUsed:Array(String)}) OR has({skillsUsed:Array(String)}, if(run.5 = 1, 'yes', 'no')))
	 )
	 SELECT toUInt8(grouping(period)) AS is_overall,
	  if(grouping(period) = 1, '', toString(period)) AS date,
	  countIf(elapsed_seconds >= 0) AS sample_count,
	  countIf(elapsed_seconds < 0) AS unknown_count,
	  if(countIf(elapsed_seconds >= 0) = 0,
	   [CAST(NULL AS Nullable(Float64)), CAST(NULL AS Nullable(Float64))],
	   arrayMap(value -> toNullable(value),
	    quantilesExactIf(0.5, 0.95)(elapsed_seconds, elapsed_seconds >= 0)
	   )
	  ) AS quantiles
	 FROM matched_runs
	 GROUP BY GROUPING SETS ((period), ())
	 ORDER BY is_overall, date`,
		query_params: {
			...orgParams(scope),
			startDate: input.startDate,
			endDate: input.endDate,
			members: input.members,
			repositories: input.repositories,
			models: input.models,
			runSignals: input.runSignals,
			durations: input.durations,
			skillsUsed: input.skillsUsed,
		},
		clickhouse_settings: {
			max_execution_time: 20,
			max_rows_to_read: "100000000",
			max_bytes_to_read: "10000000000",
			timeout_before_checking_execution_speed: 0,
			max_result_rows: "368",
			result_overflow_mode: "throw",
		},
	});
}

function buildAgentRunDurationStats(
	rows: readonly AgentRunDurationAggregateRow[],
	input: CostDashboardInput,
): AgentRunDurationStats {
	const interval = input.durationInterval ?? "daily";
	const trend = buildDurationPeriods(input.startDate, input.endDate, interval);
	const byDate = new Map(trend.map((point) => [point.date, point]));
	let sampleCount = 0;
	let unknownCount = 0;
	let medianSeconds: number | null = null;
	let p95Seconds: number | null = null;
	for (const row of rows) {
		const quantiles = readDurationQuantiles(row.quantiles);
		if (Number(row.is_overall) === 1) {
			sampleCount = Number(row.sample_count);
			unknownCount = Number(row.unknown_count);
			[medianSeconds, p95Seconds] = quantiles;
			continue;
		}
		const point = byDate.get(row.date.slice(0, 10));
		if (!point) continue;
		point.sampleCount = Number(row.sample_count);
		point.unknownCount = Number(row.unknown_count);
		[point.medianSeconds, point.p95Seconds] = quantiles;
	}
	return {
		interval,
		sampleCount,
		unknownCount,
		medianSeconds,
		p95Seconds,
		trend,
	};
}

function buildDurationPeriods(
	startDate: string,
	endDate: string,
	interval: AgentRunDurationInterval,
): AgentRunDurationStats["trend"] {
	const periods = new Map<string, AgentRunDurationStats["trend"][number]>();
	for (
		let stamp = Date.parse(startDate);
		stamp <= Date.parse(endDate);
		stamp += 86_400_000
	) {
		const currentDate = new Date(stamp).toISOString().slice(0, 10);
		const date = durationPeriodDate(currentDate, interval);
		const existing = periods.get(date);
		if (existing) {
			existing.endDate = currentDate;
			continue;
		}
		periods.set(date, {
			date,
			startDate: currentDate,
			endDate: currentDate,
			sampleCount: 0,
			unknownCount: 0,
			medianSeconds: null,
			p95Seconds: null,
		});
	}
	return [...periods.values()];
}

function durationPeriodDate(
	value: string,
	interval: AgentRunDurationInterval,
): string {
	const date = new Date(`${value}T00:00:00Z`);
	if (interval === "weekly") {
		date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	} else if (interval !== "daily") {
		date.setUTCDate(1);
		if (interval === "quarterly")
			date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
		if (interval === "yearly") date.setUTCMonth(0);
	}
	return date.toISOString().slice(0, 10);
}

function readDurationQuantiles(
	quantiles: readonly (number | null)[],
): readonly [number | null, number | null] {
	const median = quantiles[0];
	const p95 = quantiles[1];
	return [
		typeof median === "number" && Number.isFinite(median) ? median : null,
		typeof p95 === "number" && Number.isFinite(p95) ? p95 : null,
	];
}

function agentRunModelSql(runAlias: string, sessionAlias: string): string {
	return `coalesce(nullIf(${buildCanonicalPricingModelSql(`${runAlias}.4`)}, ''), nullIf(${runAlias}.4, ''), ${sessionAlias}.model_used)`;
}

function agentRunDurationCasesSql(runAlias: string): string {
	return AGENT_RUN_DURATIONS.filter((bucket) =>
		Number.isFinite(bucket.upperSeconds),
	)
		.map((bucket) => `${runAlias}.3 < ${bucket.upperSeconds}, '${bucket.id}'`)
		.join(", ");
}

function agentRunDurationSql(runAlias: string, cases: string): string {
	return `multiIf(${runAlias}.3 < 0, 'unknown', ${cases}, '12hPlus')`;
}
