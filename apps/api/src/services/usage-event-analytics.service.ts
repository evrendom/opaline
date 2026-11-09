import { ORPCError } from "@orpc/server";
import { USAGE_SESSION_ROLLUPS_TABLE } from "@rudel/ch-schema/usage-session-rollups";
import {
	type ClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import {
	readUsageEventAnalyticsCutoverConfig,
	shouldReadUsageRollups,
	shouldUseUsageEventAnalytics,
} from "../lib/env.js";
import {
	type AnalyticsTenant,
	organizationMatchSql,
} from "./analytics-tenant.js";
import {
	buildEstimatedCostSql,
	getLongContextThresholdTokens,
	getModelPricingCatalog,
	getModelPricingModifierCatalog,
	MODEL_LONG_CONTEXT_THRESHOLD_TOKENS,
} from "./pricing.service.js";
import {
	buildLineageEnrichedMetadataCte,
	buildSessionLineageCteDefinitions,
} from "./session-lineage-analytics.service.js";

const USAGE_EVENTS_TABLE = "rudel.usage_events";
const SESSION_ANALYTICS_TABLE = "rudel.session_analytics";
const READY_TTL_MS = 60_000;
const DEGRADED_TTL_MS = 5_000;
const OPEN_ENDED_DATE = "2299-12-31";
// A development Cloud service can idle and take several seconds to wake. Keep
// the SQL execution limit short, but allow that connection setup to complete.
const PROBE_TIMEOUT_MS =
	process.env.NODE_ENV === "development" ? 30_000 : 2_000;

// session_analytics stores only the undivided cache-write total, so the legacy
// path must assume a tier. Sampled prod transcripts show ~89% of Claude Code
// cache-write tokens are 1-hour tier (Codex reports no cache writes at all),
// so the total is priced at the 1-hour rate: a small overcharge on the 5m
// minority instead of a 37.5% undercharge on the 1h majority. The events path
// needs no assumption: usage_events carries the real 5m/1h split.
const LEGACY_SESSION_COST_SQL = buildEstimatedCostSql({
	modelExpr: "sa.model_used",
	dateExpr: "sa.session_date",
	inputExpr:
		"(ifNull(sa.input_tokens, 0) - ifNull(sa.cache_read_input_tokens, 0) - ifNull(sa.cache_creation_input_tokens, 0))",
	outputExpr: "ifNull(sa.output_tokens, 0)",
	cacheReadInputExpr: "ifNull(sa.cache_read_input_tokens, 0)",
	cacheCreation1hInputExpr: "ifNull(sa.cache_creation_input_tokens, 0)",
});

// A usage event whose response recorded no tier but whose thread was configured
// with one is priced at that configured tier, the only tier Codex logs. The
// `service_tier_configured` quality flag stays on the stored event as the
// explicit price basis, so the cost remains recomputable from the stored row.
const PRICEABLE_EVENT_SQL = `
	e.model_status IN ('resolved', 'unresolved')
	AND e.has_valid_timestamp = 1
	AND NOT has(e.quality_flags, 'service_tier_conflict')
	AND NOT has(e.quality_flags, 'unrecognized_service_tier')
	AND NOT has(e.quality_flags, 'model_provider_conflict')
	AND NOT has(e.quality_flags, 'provider_model_mismatch')
	AND NOT has(e.quality_flags, 'unrecognized_model_provider')
	AND NOT has(e.quality_flags, 'inference_speed_conflict')
	AND NOT has(e.quality_flags, 'unrecognized_inference_speed')
	AND NOT has(e.quality_flags, 'inference_geo_conflict')
	AND NOT has(e.quality_flags, 'unrecognized_inference_geo')
`;

type PricingModifierDimension =
	| "service_tier"
	| "inference_speed"
	| "inference_geo";

const EVENT_PRICING_RATE_CARD_SQL = buildEventPricingRateCardSql();
const EVENT_CANONICAL_PRICING_MODEL_SQL =
	buildCanonicalPricingModelSql("c.pricing_identity");
const EVENT_LONG_CONTEXT_AVAILABLE_SQL = buildLongContextAvailableSql();
const EVENT_LONG_CONTEXT_THRESHOLD_SQL = buildLongContextThresholdSql(
	"if(e.model_status = 'unresolved', e.raw_model, e.resolved_model)",
);
// Stored unresolved events retain the provider's raw model. Resolve that identity
// against today's dated catalog at read time; never infer prices from a session
// label or relax conflicts, provider checks, or receipt consistency.
// Missing billing geography uses standard-region pricing. Expose that assumption
// separately from completeness so an otherwise priceable session keeps its estimate.
const EVENT_GROUP_COST_SQL = buildEventGroupCostSql();

function escapeSqlString(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function sqlString(value: string): string {
	return `'${escapeSqlString(value)}'`;
}

function sqlArray(values: readonly string[]): string {
	return `[${values.join(", ")}]`;
}

function buildEventPricingRateCardSql(): string {
	const rows = getModelPricingCatalog().map(
		(entry) =>
			`(${[
				sqlString(entry.model),
				sqlString(entry.provider),
				sqlString(entry.contextBand),
				sqlString(entry.effectiveFrom),
				sqlString(entry.effectiveTo ?? OPEN_ENDED_DATE),
				entry.inputPerMTok,
				entry.cacheReadPerMTok ?? -1,
				entry.cacheWrite5mPerMTok ?? -1,
				entry.cacheWrite1hPerMTok ?? -1,
				entry.outputPerMTok,
			].join(", ")})`,
	);

	return `
		SELECT
			rate.1 AS model,
			rate.2 AS provider,
			rate.3 AS context_band,
			rate.4 AS effective_from,
			rate.5 AS effective_to,
			rate.6 AS input_rate,
			rate.7 AS cache_read_rate,
			rate.8 AS cache_write_5m_rate,
			rate.9 AS cache_write_1h_rate,
			rate.10 AS output_rate
		FROM (
			SELECT arrayJoin(CAST(
				${sqlArray(rows)},
				'Array(Tuple(String, String, String, Date, Date, Float64, Float64, Float64, Float64, Float64))'
			)) AS rate
		)
	`;
}

export function buildCanonicalPricingModelSql(modelExpr: string): string {
	const canonicalModelByPattern = new Map<string, string>();
	for (const entry of getModelPricingCatalog()) {
		for (const pattern of entry.match) {
			const existingModel = canonicalModelByPattern.get(pattern);
			if (existingModel !== undefined && existingModel !== entry.model) {
				throw new Error(
					`Pricing pattern ${pattern} maps to both ${existingModel} and ${entry.model}`,
				);
			}
			canonicalModelByPattern.set(pattern, entry.model);
		}
	}
	for (const pattern of canonicalModelByPattern.keys()) {
		assertAlternationSafePattern(pattern);
	}

	const alternation = [...canonicalModelByPattern.keys()]
		.map((pattern) => `(${pattern})`)
		.join("|");
	const models = [...canonicalModelByPattern.values()].map(sqlString);
	return `arrayElement(${sqlArray(models)}, arrayFirstIndex(group -> group != '', extractGroups(lowerUTF8(trimBoth(${modelExpr})), ${sqlString(alternation)})))`;
}

// RE2 prefers the earliest alternative that matches at the leftmost position.
function assertAlternationSafePattern(pattern: string): void {
	const capturing = /(?<!\\)\((?!\?)/u;
	if (
		!pattern.startsWith("^") ||
		capturing.test(pattern) ||
		new RegExp(pattern, "u").test("")
	) {
		throw new Error(
			`Pricing pattern ${pattern} must start with ^, have no capture group and never match an empty model`,
		);
	}
}

export function resolveCanonicalPricingModel(model: string): string {
	const normalizedModel = model.trim().toLowerCase();
	return (
		getModelPricingCatalog().find((entry) =>
			entry.match.some((pattern) =>
				new RegExp(pattern, "u").test(normalizedModel),
			),
		)?.model ?? model
	);
}

// The long band starts at the model's own threshold (Claude Haiku 5.5: above
// 100,000 tokens), so it is chosen from the event's pricing identity before
// grouping; models without an override keep the default.
function buildLongContextThresholdSql(identityExpr: string): string {
	const clauses = getModelPricingCatalog()
		.filter(
			(entry) =>
				entry.contextBand === "long" &&
				entry.longContextAboveTokens !== undefined,
		)
		.flatMap((entry) => [
			entry.match
				.map(
					(pattern) =>
						`match(lowerUTF8(trimBoth(${identityExpr})), '${escapeSqlString(pattern)}')`,
				)
				.join(" OR "),
			String(getLongContextThresholdTokens(entry.model)),
		]);
	return clauses.length === 0
		? String(MODEL_LONG_CONTEXT_THRESHOLD_TOKENS)
		: `multiIf(${clauses.join(", ")}, ${MODEL_LONG_CONTEXT_THRESHOLD_TOKENS})`;
}

function buildLongContextAvailableSql(): string {
	const periods = getModelPricingCatalog()
		.filter((entry) => entry.contextBand === "long")
		.map(
			(entry) =>
				`(${sqlString(entry.model)}, ${sqlString(entry.effectiveFrom)}, ${sqlString(entry.effectiveTo ?? OPEN_ENDED_DATE)})`,
		);
	return `arrayExists(period -> g.pricing_model = period.1 AND g.usage_date >= period.2 AND g.usage_date <= period.3, CAST(${sqlArray(periods)}, 'Array(Tuple(String, Date, Date))'))`;
}

function buildEventGroupCostSql(): string {
	const modifierMultiplier = [
		buildModifierDimensionSql("service_tier", "g.service_tier"),
		buildModifierDimensionSql("inference_speed", "g.inference_speed"),
		buildModifierDimensionSql("inference_geo", "g.inference_geo"),
	]
		.map((expression) => `(${expression})`)
		.join(" * ");
	const components = [
		buildRateComponentSql("g.group_uncached_input_tokens", "r.input_rate"),
		buildRateComponentSql(
			"g.group_cache_read_input_tokens",
			"r.cache_read_rate",
		),
		buildRateComponentSql(
			"g.group_cache_write_5m_input_tokens",
			"r.cache_write_5m_rate",
		),
		buildRateComponentSql(
			"g.group_cache_write_1h_input_tokens",
			"r.cache_write_1h_rate",
		),
		buildRateComponentSql("g.group_output_tokens", "r.output_rate"),
	];

	return `if(
		g.group_uncached_input_tokens
			+ g.group_cache_read_input_tokens
			+ g.group_cache_write_5m_input_tokens
			+ g.group_cache_write_1h_input_tokens
			+ g.group_output_tokens = 0,
		toNullable(0.0),
		if(
			g.is_priceable = 1
				AND r.model != ''
				AND lowerUTF8(trimBoth(g.model_provider)) IN ('', r.provider)
				AND r.provider = if(g.source = 'codex', 'openai', 'anthropic'),
			round((${components.join(" + ")}) * (${modifierMultiplier}), 12),
			CAST(NULL, 'Nullable(Float64)')
		)
	)`;
}

function buildRateComponentSql(tokensExpr: string, rateExpr: string): string {
	return `if(
		${tokensExpr} = 0,
		toNullable(0.0),
		if(
			${rateExpr} < 0,
			CAST(NULL, 'Nullable(Float64)'),
			toNullable(${tokensExpr} / 1000000.0 * ${rateExpr})
		)
	)`;
}

function buildModifierDimensionSql(
	dimension: PricingModifierDimension,
	valueExpr: string,
): string {
	const value = `lowerUTF8(trimBoth(${valueExpr}))`;
	const baseValues =
		dimension === "service_tier"
			? `if(
				r.provider = 'anthropic',
				['', 'auto', 'default', 'priority', 'standard'],
				['', 'auto', 'default', 'standard']
			)`
			: dimension === "inference_speed"
				? "['', 'standard']"
				: "['', 'global']";
	const rules = getModelPricingModifierCatalog().filter(
		(rule) => rule.dimension === dimension,
	);
	const conditions = rules.map(
		(rule) =>
			`(${[
				sqlString(rule.model),
				sqlArray(rule.values.map(sqlString)),
				sqlString(rule.effectiveFrom),
				sqlString(rule.effectiveTo ?? OPEN_ENDED_DATE),
				sqlString(rule.contextBand ?? ""),
			].join(", ")})`,
	);
	const multipliers = rules.map((rule) => String(rule.multiplier));

	return `if(
		${value} IN ${baseValues},
		toNullable(1.0),
		arrayElement(
			CAST(${sqlArray(multipliers)}, 'Array(Nullable(Float64))'),
			arrayFirstIndex(
				rule -> g.pricing_model = rule.1
					AND has(rule.2, ${value})
					AND g.usage_date >= rule.3
					AND g.usage_date <= rule.4
					AND (rule.5 = '' OR rule.5 = r.context_band),
				CAST(${sqlArray(conditions)}, 'Array(Tuple(String, Array(String), Date, Date, String))')
			)
		)
	)`;
}

const SESSION_METADATA_COLUMNS = `
	sa.session_date AS session_date,
	sa.last_interaction_date AS last_interaction_date,
	sa.total_interactions AS total_interactions,
	sa.session_id AS session_id,
	sa.organization_id AS organization_id,
	sa.project_path AS project_path,
	sa.git_remote AS git_remote,
	sa.package_name AS package_name,
	sa.package_type AS package_type,
	sa.filter_version AS filter_version,
	sa.ingested_at AS ingested_at,
	sa.user_id AS user_id,
	sa.git_branch AS git_branch,
	sa.git_sha AS git_sha,
	sa.tag AS tag,
	sa.source AS source,
	sa.skills AS skills,
		sa.slash_commands AS slash_commands,
		sa.subagent_types AS subagent_types,
		sa.subagent_count AS subagent_count,
		sa.native_subagents AS native_subagents,
		sa.native_child_sessions AS native_child_sessions,
		sa.native_parent_session_id AS native_parent_session_id,
		sa.is_top_level_session AS is_top_level_session,
		sa.linked_subagent_count AS linked_subagent_count,
		sa.linked_subagents AS linked_subagents,
		sa.actual_duration_min AS actual_duration_min,
	sa.error_count AS error_count
`;

export interface UsageAnalyticsScope {
	readonly tenant?: AnalyticsTenant;
	readonly sessionIdParam?: string;
	readonly sourceParam?: string;
	readonly userIdParam?: string;
	/** Read only these sessions' usage instead of the whole organization's. */
	readonly window?: UsageAnalyticsWindow;
	/**
	 * Further `AND` conditions on `organization_id`, `user_id` and
	 * `session_id` only, such as a primary-key window. Pricing and the
	 * receipt-consistency check run per session, so whole sessions stay whole.
	 */
	readonly sessionKeyFilterSql?: string;
}

/**
 * The sessions a query reports on. Pricing and the receipt-consistency check
 * run per session over all of a session's events, so restricting both inputs
 * to a set of sessions changes nothing about those sessions' rows; it only
 * stops every other session of the organization from being priced. The set is
 * matched on the key prefix of `usage_events` and `session_analytics`, never
 * on `usage_date`: a session's events can fall on any date.
 */
export interface UsageAnalyticsWindow {
	/**
	 * A parameterized SELECT of `organization_id, user_id, source, session_id`.
	 * It may read the lineage CTEs. Never place request values in it directly.
	 */
	readonly sessionsSql: string | ((usageSource: UsageSource) => string);
	/**
	 * Also read every native Codex descendant of those sessions, so a family
	 * cost stays whole. The query must then start with `WITH RECURSIVE`.
	 */
	readonly includeNativeDescendants: boolean;
	readonly onlyForEventPricing?: boolean;
}

const USAGE_WINDOW_FILTER_SQL =
	"(organization_id, user_id, source, session_id) IN (SELECT organization_id, user_id, source, session_id FROM usage_window_sessions)";

/**
 * Sessions of one organization from `session_analytics` (aliased `sa`) whose
 * row matches `filterSql`, for a `UsageAnalyticsWindow`.
 */
export function buildSessionAnalyticsWindowSql(filterSql: string): string {
	return `
				SELECT
					sa.organization_id AS organization_id,
					sa.user_id AS user_id,
					sa.source AS source,
					sa.session_id AS session_id
				FROM ${getSafeClickHouseTable(SESSION_ANALYTICS_TABLE)} AS sa FINAL
				WHERE ${organizationMatchSql("sa.organization_id")}
					AND ${filterSql}`;
}

export function buildSessionDateWindow(
	filterSql: string,
): UsageAnalyticsWindow {
	return {
		includeNativeDescendants: false,
		onlyForEventPricing: true,
		sessionsSql: buildSessionAnalyticsWindowSql(filterSql),
	};
}

export function buildScalarWindowSql(sessionsSql: string): string {
	return `
				SELECT session.1 AS organization_id, session.2 AS user_id,
					session.3 AS source, session.4 AS session_id
				FROM (
					SELECT arrayJoin((
						SELECT groupUniqArray((organization_id, user_id, toString(source), session_id))
						FROM (${sessionsSql}
						)
					)) AS session
				)`;
}

export function buildDateRangeWindowSql(
	usageSource: UsageSource = "events",
): string {
	const start = "toDateTime({startDate:String}, 'UTC')";
	const usageSessions =
		usageSource === "rollups"
			? `FROM ${getSafeClickHouseTable(USAGE_SESSION_ROLLUPS_TABLE)}
							WHERE ${organizationMatchSql("organization_id")}
								AND arrayExists(day -> day BETWEEN toDate({startDate:String}) AND toDate({endDate:String}), usage_dates)`
			: `FROM ${getSafeClickHouseTable(USAGE_EVENTS_TABLE)}
							WHERE ${organizationMatchSql("organization_id")}
								AND usage_date BETWEEN toDate({startDate:String}) AND toDate({endDate:String})`;
	return buildScalarWindowSql(`
							SELECT organization_id, user_id, toString(source) AS source, session_id
							FROM ${getSafeClickHouseTable(SESSION_ANALYTICS_TABLE)}
							WHERE ${organizationMatchSql("organization_id")}
								AND session_date < toDateTime({endDate:String}, 'UTC') + INTERVAL 1 DAY
								AND (session_date >= ${start} OR last_interaction_date >= ${start})
							UNION ALL
							SELECT organization_id, user_id, toString(source) AS source, session_id
							${usageSessions}`);
}

/** Defines `usage_window_sessions`; needs the lineage CTEs before it. */
function buildUsageWindowCte(
	window: UsageAnalyticsWindow,
	usageSource: UsageSource,
): string {
	const sessionsSql =
		typeof window.sessionsSql === "string"
			? window.sessionsSql
			: window.sessionsSql(usageSource);
	const roots = `usage_window_roots AS (${sessionsSql}
		)`;
	if (!window.includeNativeDescendants) {
		return `${roots},
		usage_window_sessions AS (
			SELECT DISTINCT organization_id, user_id, toString(source) AS source, session_id
			FROM usage_window_roots
		)`;
	}
	// The same native edges the family cost walks (session-family-cost.service.ts).
	return `${roots},
		usage_window_walk AS (
			SELECT
				organization_id,
				user_id,
				toString(source) AS source,
				session_id,
				[session_id] AS visited_session_ids
			FROM usage_window_roots

			UNION ALL

			SELECT
				walk.organization_id,
				walk.user_id,
				'codex' AS source,
				edge.child_session_id AS session_id,
				arrayPushBack(walk.visited_session_ids, edge.child_session_id)
			FROM usage_window_walk AS walk
			INNER JOIN session_native_parents AS edge
				ON edge.organization_id = walk.organization_id
				AND edge.user_id = walk.user_id
				AND walk.source = 'codex'
				AND edge.parent_session_id = walk.session_id
			WHERE NOT has(walk.visited_session_ids, edge.child_session_id)
		),
		usage_window_sessions AS (
			SELECT DISTINCT organization_id, user_id, source, session_id
			FROM usage_window_walk
		)`;
}

export const USAGE_ANALYTICS_CLICKHOUSE_SETTINGS = {
	optimize_and_compare_chain: 0,
} as const;

export interface UsageAnalyticsQueryContext {
	readonly clickhouseSettings: typeof USAGE_ANALYTICS_CLICKHOUSE_SETTINGS;
	readonly cteDefinitions: string;
	readonly dailySessionsRelation: "usage_analytics_daily_sessions";
	/** Session metadata with lineage, without usage: a cheap superset of `sessionsRelation`. */
	readonly metadataRelation: "usage_analytics_metadata";
	readonly mode: "events" | "legacy";
	readonly sessionsRelation: "usage_analytics_sessions";
}

interface ReadinessState {
	checkedAt: number;
	status: "degraded" | "ready";
}

interface UsageEventAnalyticsReadinessGateOptions {
	readonly degradedTtlMs: number;
	readonly now?: () => number;
	readonly probe: () => Promise<void>;
	readonly readyTtlMs: number;
	readonly timeoutMs: number;
}

export function buildUsageCostSubtotalSql(
	estimatedCostExpression: string,
	precision: number,
): string {
	return `toNullable(round(sum(ifNull(${estimatedCostExpression}, 0)), ${precision}))`;
}

export function buildPricedUsageEventsCte(filters: string): string {
	return `
		analysis_usage_candidates AS (
			SELECT e.*, if(e.model_status = 'unresolved', e.raw_model, e.resolved_model) AS pricing_identity,
				if(e.context_input_tokens > ${EVENT_LONG_CONTEXT_THRESHOLD_SQL}, 'long', 'base') AS context_band,
				toUInt8(${PRICEABLE_EVENT_SQL}) AS is_priceable,
				e.uncached_input_tokens AS group_uncached_input_tokens,
				e.cache_read_input_tokens AS group_cache_read_input_tokens,
				e.cache_write_5m_input_tokens AS group_cache_write_5m_input_tokens,
				e.cache_write_1h_input_tokens AS group_cache_write_1h_input_tokens,
				e.output_tokens AS group_output_tokens
			FROM ${getSafeClickHouseTable(USAGE_EVENTS_TABLE)} AS e FINAL
			WHERE ${filters} AND e.record_kind = 'event' AND e.is_deleted = 0
		),
		analysis_usage_groups AS (
			SELECT c.*, ${EVENT_CANONICAL_PRICING_MODEL_SQL} AS pricing_model
			FROM analysis_usage_candidates AS c
		),
		analysis_usage_rate_card AS (${EVENT_PRICING_RATE_CARD_SQL}),
		analysis_priced_events AS (
			SELECT g.*, ${EVENT_GROUP_COST_SQL} AS estimated_cost
			FROM analysis_usage_groups AS g
			ANY LEFT JOIN analysis_usage_rate_card AS r
				ON g.pricing_model = r.model
				AND r.context_band = if(g.context_band = 'long' AND ${EVENT_LONG_CONTEXT_AVAILABLE_SQL} = 1, 'long', 'base')
				AND g.usage_date >= r.effective_from AND g.usage_date <= r.effective_to
		)`;
}

export class UsageEventAnalyticsReadinessGate {
	private readonly degradedTtlMs: number;
	private inFlight: Promise<ReadinessState> | null = null;
	private readonly now: () => number;
	private readonly probe: () => Promise<void>;
	private readonly readyTtlMs: number;
	private state: ReadinessState | null = null;
	private readonly timeoutMs: number;

	constructor(options: UsageEventAnalyticsReadinessGateOptions) {
		this.degradedTtlMs = options.degradedTtlMs;
		this.now = options.now ?? Date.now;
		this.probe = options.probe;
		this.readyTtlMs = options.readyTtlMs;
		this.timeoutMs = options.timeoutMs;
	}

	async assertReady(): Promise<void> {
		const ttl =
			this.state?.status === "ready" ? this.readyTtlMs : this.degradedTtlMs;
		if (this.state && this.now() - this.state.checkedAt < ttl) {
			if (this.state.status === "ready") return;
			throwAnalyticsUnavailable();
		}

		this.inFlight ??= this.runProbe().finally(() => {
			this.inFlight = null;
		});
		this.state = await this.inFlight;
		if (this.state.status !== "ready") throwAnalyticsUnavailable();
	}

	private async runProbe(): Promise<ReadinessState> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(
				() =>
					reject(new Error("usage-event analytics readiness probe timed out")),
				this.timeoutMs,
			);
		});

		try {
			await Promise.race([this.probe(), timeout]);
			return { checkedAt: this.now(), status: "ready" };
		} catch {
			return { checkedAt: this.now(), status: "degraded" };
		} finally {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
		}
	}
}

function buildUsageEventFilters(scope: UsageAnalyticsScope): string {
	const filters = [organizationMatchSql("organization_id", scope.tenant)];
	if (scope.window) filters.push(USAGE_WINDOW_FILTER_SQL);
	if (scope.userIdParam) {
		filters.push(`user_id = {${scope.userIdParam}:String}`);
	}
	if (scope.sourceParam) {
		filters.push(`source = {${scope.sourceParam}:String}`);
	}
	if (scope.sessionIdParam) {
		filters.push(`session_id = {${scope.sessionIdParam}:String}`);
	}
	return `${filters.join("\n\t\t\t\t\tAND ")}${
		scope.sessionKeyFilterSql ? `\n\t\t\t\t\t${scope.sessionKeyFilterSql}` : ""
	}`;
}

/**
 * Request usage grouped by everything its price depends on. `keys` are extra
 * grouping columns of `from` (aliased `e`) carried into the groups.
 */
function buildPricingCandidatesSelect(
	from: string,
	keys: readonly string[] = [],
): string {
	return `
			SELECT
				e.organization_id,
				e.user_id,
				e.source,
				e.session_id,
				e.record_kind,
				e.usage_date,${keys.map((key) => `\n\t\t\t\te.${key},`).join("")}
				if(e.model_status = 'unresolved', e.raw_model, e.resolved_model) AS pricing_identity,
				e.model_provider,
				e.service_tier,
				e.inference_speed,
				e.inference_geo,
				if(
					e.context_input_tokens > ${EVENT_LONG_CONTEXT_THRESHOLD_SQL},
					'long',
					'base'
				) AS context_band,
				toUInt8(${PRICEABLE_EVENT_SQL}) AS is_priceable,
				toUInt8(has(e.quality_flags, 'inference_geo_not_available')) AS has_geo_gap,
				any(e.latest_main_model) AS latest_main_model,
				any(e.latest_event_model) AS latest_event_model,
				sum(e.uncached_input_tokens) AS group_uncached_input_tokens,
				sum(e.cache_read_input_tokens) AS group_cache_read_input_tokens,
				sum(e.cache_write_5m_input_tokens) AS group_cache_write_5m_input_tokens,
				sum(e.cache_write_1h_input_tokens) AS group_cache_write_1h_input_tokens,
				sum(e.output_tokens) AS group_output_tokens
			FROM ${from} AS e
			GROUP BY
				e.organization_id,
				e.user_id,
				e.source,
				e.session_id,
				e.record_kind,
				e.usage_date,
				pricing_identity,
				e.model_provider,
				e.service_tier,
				e.inference_speed,
				e.inference_geo,
				context_band,
				is_priceable,
				has_geo_gap${keys.map((key) => `,\n\t\t\t\te.${key}`).join("")}`;
}

/** Prices pricing groups (aliased `g`) against the dated rate card. */
function buildPricedGroupsSelect(from: string): string {
	return `
			SELECT
				g.*,
				${EVENT_GROUP_COST_SQL} AS group_estimated_cost
			FROM ${from} AS g
			ANY LEFT JOIN usage_event_pricing_rate_card AS r
				ON g.pricing_model = r.model
				AND r.context_band = if(
					g.context_band = 'long'
						AND ${EVENT_LONG_CONTEXT_AVAILABLE_SQL} = 1,
					'long',
					'base'
				)
				AND g.usage_date >= r.effective_from
				AND g.usage_date <= r.effective_to`;
}

/**
 * Prices request usage per agent run, across every tenant. Requests belong to
 * the run whose start is the latest at or before them, so a run owns its
 * subagents' requests and any work until the next run starts. Requests before
 * a session's first run get run_idx 0. Needs the CTEs of
 * `buildUsageEventAnalyticsCte` and a `runWindowsRelation` with the session
 * key and `run_starts` sorted ascending.
 */
export function buildRunPricedUsageCte(runWindowsRelation: string): string {
	return `
		run_usage_records AS (
			SELECT
				e.*,
				arrayLastIndex(start -> start <= e.occurred_at, w.run_starts) AS run_idx
			FROM usage_records_with_display_model AS e
			INNER JOIN ${runWindowsRelation} AS w
				ON e.organization_id = w.organization_id
				AND e.user_id = w.user_id
				AND e.source = w.source
				AND e.session_id = w.session_id
			WHERE e.record_kind = 'event' AND e.has_valid_timestamp = 1
		),
		run_usage_candidates AS (
			${buildPricingCandidatesSelect("run_usage_records", ["run_idx"])}
		),
		run_usage_pricing_groups AS (
			SELECT
				c.*,
				${EVENT_CANONICAL_PRICING_MODEL_SQL} AS pricing_model
			FROM run_usage_candidates AS c
		),
		run_priced_usage_groups AS (
			${buildPricedGroupsSelect("run_usage_pricing_groups")}
		)`;
}

export function buildUsageEventCandidateCtes(
	usageEventFilters: string,
): string {
	// The organization/key filters follow the table's primary-key prefix, so FINAL
	// resolves exact ReplacingMergeTree state without scanning unrelated tenants.
	// Per-session state is grouped once and joined back instead of computed with
	// window functions: ClickHouse inlines repeated CTE references, and a window
	// over every event of an organization sorts all of them in memory for each
	// reference (about 0.8 GiB per copy on the largest organization). Reading
	// latest_usage_records again for the joins is cheap by comparison.
	return `
		latest_usage_records AS (
			SELECT *
			FROM ${getSafeClickHouseTable(USAGE_EVENTS_TABLE)} FINAL
			WHERE ${usageEventFilters}
		),
		usage_session_receipts AS (
			SELECT
				organization_id,
				user_id,
				source,
				session_id,
				argMaxIf(event_version, event_version, record_kind = 'receipt') AS receipt_generation,
				argMaxIf(receipt_event_count, event_version, record_kind = 'receipt') AS latest_receipt_event_count,
				argMaxIf(receipt_is_complete, event_version, record_kind = 'receipt') AS latest_receipt_is_complete,
				argMaxIf(is_deleted, event_version, record_kind = 'receipt') AS latest_receipt_is_deleted
			FROM latest_usage_records
			GROUP BY organization_id, user_id, source, session_id
		),
		usage_session_consistency AS (
			SELECT
				r.organization_id AS organization_id,
				r.user_id AS user_id,
				r.source AS source,
				r.session_id AS session_id,
				any(r.receipt_generation) AS receipt_generation,
				any(r.latest_receipt_event_count) AS latest_receipt_event_count,
				any(r.latest_receipt_is_complete) AS latest_receipt_is_complete,
				any(r.latest_receipt_is_deleted) AS latest_receipt_is_deleted,
				countIf(
					e.record_kind = 'event'
						AND e.is_deleted = 0
						AND e.event_version = r.receipt_generation
				) AS active_event_count,
				argMaxIf(
					if(e.resolved_model != '', e.resolved_model, trimBoth(e.raw_model)),
					tuple(e.has_valid_timestamp, e.occurred_at, e.first_observed_line, e.event_id),
					e.record_kind = 'event'
						AND e.is_deleted = 0
						AND e.event_version = r.receipt_generation
						AND e.agent_id = 'main'
						AND e.model_status IN ('resolved', 'unresolved')
						AND lowerUTF8(trimBoth(if(e.resolved_model != '', e.resolved_model, e.raw_model))) NOT IN ('', 'unknown', '<synthetic>')
				) AS latest_main_model,
				argMaxIf(
					if(e.resolved_model != '', e.resolved_model, trimBoth(e.raw_model)),
					tuple(e.has_valid_timestamp, e.occurred_at, e.first_observed_line, e.event_id),
					e.record_kind = 'event'
						AND e.is_deleted = 0
						AND e.event_version = r.receipt_generation
						AND e.model_status IN ('resolved', 'unresolved')
						AND lowerUTF8(trimBoth(if(e.resolved_model != '', e.resolved_model, e.raw_model))) NOT IN ('', 'unknown', '<synthetic>')
				) AS latest_event_model
			FROM latest_usage_records AS e
			INNER JOIN usage_session_receipts AS r
				ON e.organization_id = r.organization_id
				AND e.user_id = r.user_id
				AND e.source = r.source
				AND e.session_id = r.session_id
			WHERE r.latest_receipt_is_deleted = 0
				AND r.latest_receipt_is_complete = 1
			GROUP BY r.organization_id, r.user_id, r.source, r.session_id
			HAVING active_event_count = latest_receipt_event_count
		),
		usage_records_with_display_model AS (
			SELECT
				e.*,
				s.receipt_generation AS receipt_generation,
				s.latest_receipt_event_count AS latest_receipt_event_count,
				s.latest_receipt_is_complete AS latest_receipt_is_complete,
				s.latest_receipt_is_deleted AS latest_receipt_is_deleted,
				s.active_event_count AS active_event_count,
				s.latest_main_model AS latest_main_model,
				s.latest_event_model AS latest_event_model
			FROM latest_usage_records AS e
			INNER JOIN usage_session_consistency AS s
				ON e.organization_id = s.organization_id
				AND e.user_id = s.user_id
				AND e.source = s.source
				AND e.session_id = s.session_id
			WHERE e.event_version = s.receipt_generation
				AND e.is_deleted = 0
				AND e.record_kind IN ('event', 'receipt')
		),
		usage_event_pricing_candidates AS (
			${buildPricingCandidatesSelect("usage_records_with_display_model")}
		)`;
}

function buildUsageRollupPricedGroupsCte(usageEventFilters: string): string {
	return `
		priced_usage_groups AS (
			SELECT
				organization_id,
				user_id,
				source,
				session_id,
				record_kind,
				usage_date,
				pricing_identity,
				model_provider,
				service_tier,
				inference_speed,
				inference_geo,
				context_band,
				is_priceable,
				has_geo_gap,
				latest_main_model,
				latest_event_model,
				group_uncached_input_tokens,
				group_cache_read_input_tokens,
				group_cache_write_5m_input_tokens,
				group_cache_write_1h_input_tokens,
				group_output_tokens,
				pricing_model,
				group_estimated_cost
			FROM ${getSafeClickHouseTable(USAGE_SESSION_ROLLUPS_TABLE)} FINAL
			ARRAY JOIN
				record_kinds AS record_kind,
				usage_dates AS usage_date,
				pricing_identities AS pricing_identity,
				model_providers AS model_provider,
				service_tiers AS service_tier,
				inference_speeds AS inference_speed,
				inference_geos AS inference_geo,
				context_bands AS context_band,
				priceable AS is_priceable,
				geo_gaps AS has_geo_gap,
				uncached_input_tokens AS group_uncached_input_tokens,
				cache_read_input_tokens AS group_cache_read_input_tokens,
				cache_write_5m_input_tokens AS group_cache_write_5m_input_tokens,
				cache_write_1h_input_tokens AS group_cache_write_1h_input_tokens,
				output_tokens AS group_output_tokens,
				pricing_models AS pricing_model,
				estimated_costs AS group_estimated_cost
			WHERE ${usageEventFilters} AND is_consistent = 1
		)`;
}

export function buildPricedUsageGroupsCtes(candidatesRelation: string): string {
	return `
		usage_event_pricing_groups AS (
			SELECT
				c.*,
				${EVENT_CANONICAL_PRICING_MODEL_SQL} AS pricing_model
			FROM ${candidatesRelation} AS c
		),
		usage_event_pricing_rate_card AS (
			${EVENT_PRICING_RATE_CARD_SQL}
		),
		priced_usage_groups AS (
			${buildPricedGroupsSelect("usage_event_pricing_groups")}
		)`;
}

export type UsageSource = "events" | "rollups";

export function buildUsageEventAnalyticsCte(
	scope: UsageAnalyticsScope = {},
	lineageEnabled?: boolean,
	usageSource: UsageSource = "events",
): string {
	const usageEventFilters = buildUsageEventFilters(scope);
	// The organization/key filters follow the table's primary-key prefix, so FINAL
	// resolves exact ReplacingMergeTree state without scanning unrelated tenants.
	// Per-session state is grouped once and joined back instead of computed with
	// window functions: ClickHouse inlines repeated CTE references, and a window
	// over every event of an organization sorts all of them in memory for each
	// reference (about 0.8 GiB per copy on the largest organization). Reading
	// latest_usage_records again for the joins is cheap by comparison.
	return `
		${buildSessionLineageCteDefinitions(lineageEnabled, scope.tenant)},
		${scope.window ? `${buildUsageWindowCte(scope.window, usageSource)},` : ""}
		${
			usageSource === "rollups"
				? buildUsageRollupPricedGroupsCte(usageEventFilters)
				: `${buildUsageEventCandidateCtes(usageEventFilters)},
		${buildPricedUsageGroupsCtes("usage_event_pricing_candidates")}`
		},
		usage_event_session_rollups AS (
			SELECT
				p.organization_id,
				p.user_id,
				p.source,
				p.session_id,
				sum(p.group_uncached_input_tokens + p.group_cache_read_input_tokens + p.group_cache_write_5m_input_tokens + p.group_cache_write_1h_input_tokens) AS input_tokens,
				sum(p.group_output_tokens) AS output_tokens,
				sum(p.group_cache_read_input_tokens) AS cache_read_input_tokens,
				sum(p.group_cache_write_5m_input_tokens + p.group_cache_write_1h_input_tokens) AS cache_creation_input_tokens,
				sum(p.group_uncached_input_tokens + p.group_cache_read_input_tokens + p.group_cache_write_5m_input_tokens + p.group_cache_write_1h_input_tokens + p.group_output_tokens) AS total_tokens,
				toNullable(sum(ifNull(p.group_estimated_cost, 0))) AS estimated_cost,
				toUInt8(countIf(
					p.record_kind = 'event'
					AND isNull(p.group_estimated_cost)
				) = 0) AS cost_is_complete,
				toUInt8(countIf(p.record_kind = 'event' AND p.has_geo_gap = 1) > 0) AS cost_uses_default_region,
				any(p.latest_main_model) AS latest_main_model,
				any(p.latest_event_model) AS latest_event_model
			FROM priced_usage_groups AS p
			GROUP BY p.organization_id, p.user_id, p.source, p.session_id
		),
		usage_event_daily_rollups AS (
			SELECT
				p.organization_id,
				p.user_id,
				p.source,
				p.session_id,
				p.usage_date,
				sum(p.group_uncached_input_tokens + p.group_cache_read_input_tokens + p.group_cache_write_5m_input_tokens + p.group_cache_write_1h_input_tokens) AS input_tokens,
				sum(p.group_output_tokens) AS output_tokens,
				sum(p.group_cache_read_input_tokens) AS cache_read_input_tokens,
				sum(p.group_cache_write_5m_input_tokens + p.group_cache_write_1h_input_tokens) AS cache_creation_input_tokens,
				sum(p.group_uncached_input_tokens + p.group_cache_read_input_tokens + p.group_cache_write_5m_input_tokens + p.group_cache_write_1h_input_tokens + p.group_output_tokens) AS total_tokens,
				toNullable(sum(ifNull(p.group_estimated_cost, 0))) AS estimated_cost,
				toUInt8(countIf(
					isNull(p.group_estimated_cost)
				) = 0) AS cost_is_complete,
				toUInt8(countIf(p.record_kind = 'event' AND p.has_geo_gap = 1) > 0) AS cost_uses_default_region,
				any(p.latest_main_model) AS latest_main_model,
				any(p.latest_event_model) AS latest_event_model
			FROM priced_usage_groups AS p
			WHERE p.record_kind = 'event'
			GROUP BY p.organization_id, p.user_id, p.source, p.session_id, p.usage_date
		),
		usage_analytics_metadata_base AS (
			SELECT *
			FROM ${getSafeClickHouseTable(SESSION_ANALYTICS_TABLE)} FINAL
			WHERE ${usageEventFilters}
		),
		${buildLineageEnrichedMetadataCte({
			baseRelation: "usage_analytics_metadata_base",
			outputRelation: "usage_analytics_metadata",
		})},
		usage_analytics_sessions AS (
			SELECT
				${SESSION_METADATA_COLUMNS},
				if(r.latest_main_model != '', r.latest_main_model, r.latest_event_model) AS model_used,
				r.input_tokens AS input_tokens,
				r.output_tokens AS output_tokens,
				r.cache_read_input_tokens AS cache_read_input_tokens,
				r.cache_creation_input_tokens AS cache_creation_input_tokens,
				r.total_tokens AS total_tokens,
				r.estimated_cost AS estimated_cost,
				r.cost_is_complete AS cost_is_complete,
				r.cost_uses_default_region AS cost_uses_default_region
			FROM usage_analytics_metadata AS sa
			ANY INNER JOIN usage_event_session_rollups AS r
				ON sa.organization_id = r.organization_id
				AND sa.user_id = r.user_id
				AND sa.source = r.source
				AND sa.session_id = r.session_id
		),
		usage_analytics_daily_sessions AS (
			SELECT
				${SESSION_METADATA_COLUMNS},
				if(r.latest_main_model != '', r.latest_main_model, r.latest_event_model) AS model_used,
				r.usage_date AS usage_date,
				r.input_tokens AS input_tokens,
				r.output_tokens AS output_tokens,
				r.cache_read_input_tokens AS cache_read_input_tokens,
				r.cache_creation_input_tokens AS cache_creation_input_tokens,
				r.total_tokens AS total_tokens,
				r.estimated_cost AS estimated_cost,
				r.cost_is_complete AS cost_is_complete,
				r.cost_uses_default_region AS cost_uses_default_region
			FROM usage_event_daily_rollups AS r
			ANY LEFT JOIN usage_analytics_metadata AS sa
				ON sa.organization_id = r.organization_id
				AND sa.user_id = r.user_id
				AND sa.source = r.source
				AND sa.session_id = r.session_id
			WHERE ${organizationMatchSql("sa.organization_id", scope.tenant)}
		)
	`;
}

export function buildLegacyUsageAnalyticsCte(
	lineageEnabled?: boolean,
	tenant: AnalyticsTenant = "organization",
	window?: UsageAnalyticsWindow,
): string {
	return `
		${buildSessionLineageCteDefinitions(lineageEnabled, tenant)},
		${window ? `${buildUsageWindowCte(window, "events")},` : ""}
		usage_analytics_metadata_base AS (
			SELECT *
			FROM ${getSafeClickHouseTable(SESSION_ANALYTICS_TABLE)} FINAL
			WHERE ${organizationMatchSql("organization_id", tenant)}${
				window
					? `
				AND ${USAGE_WINDOW_FILTER_SQL}`
					: ""
			}
		),
		${buildLineageEnrichedMetadataCte({
			baseRelation: "usage_analytics_metadata_base",
			outputRelation: "usage_analytics_metadata",
		})},
		usage_analytics_sessions AS (
			SELECT
				sa.*,
				ifNull(${LEGACY_SESSION_COST_SQL}, 0) AS estimated_cost,
				toUInt8(1) AS cost_is_complete,
				toUInt8(0) AS cost_uses_default_region
			FROM usage_analytics_metadata AS sa
		),
		usage_analytics_daily_sessions AS (
			SELECT *, toDate(session_date) AS usage_date
			FROM usage_analytics_sessions
		)
	`;
}

async function probeUsageEventAnalyticsSchema(
	executor: ClickHouseExecutor,
): Promise<void> {
	await executor.query({
		clickhouse_settings: { max_execution_time: 2 },
		query: `
			SELECT
				organization_id,
				user_id,
				source,
				session_id,
				event_id,
				event_version,
				record_kind,
				receipt_is_complete,
				receipt_event_count,
				resolved_model,
				model_status,
				service_tier,
				model_provider,
				inference_speed,
				inference_geo,
				context_input_tokens,
				uncached_input_tokens,
				cache_read_input_tokens,
				cache_write_5m_input_tokens,
				cache_write_1h_input_tokens,
				output_tokens,
				quality_flags,
				usage_date,
				is_deleted
			FROM ${getSafeClickHouseTable(USAGE_EVENTS_TABLE)}
			WHERE organization_id = {orgId:String}
			LIMIT 0
		`,
		query_params: { orgId: "readiness-probe" },
	});
}

const readinessGate = new UsageEventAnalyticsReadinessGate({
	degradedTtlMs: DEGRADED_TTL_MS,
	probe: () => probeUsageEventAnalyticsSchema(getClickhouse()),
	readyTtlMs: READY_TTL_MS,
	timeoutMs: PROBE_TIMEOUT_MS,
});

function throwAnalyticsUnavailable(): never {
	throw new ORPCError("SERVICE_UNAVAILABLE", {
		message: "Request-level usage analytics is temporarily unavailable",
	});
}

async function resolveUsageSource(
	organizationId: string,
): Promise<UsageSource> {
	if (!shouldReadUsageRollups(organizationId)) return "events";
	const { hasCompleteUsageRollups } = await import(
		"./usage-session-rollup.service.js"
	);
	return (await hasCompleteUsageRollups(getClickhouse(), organizationId))
		? "rollups"
		: "events";
}

export async function getUsageAnalyticsQueryContext(
	organizationId: string,
	scope: UsageAnalyticsScope = {},
): Promise<UsageAnalyticsQueryContext> {
	if (!shouldUseUsageEventAnalytics(organizationId)) {
		return {
			clickhouseSettings: USAGE_ANALYTICS_CLICKHOUSE_SETTINGS,
			cteDefinitions: buildLegacyUsageAnalyticsCte(
				undefined,
				"organization",
				scope.window?.onlyForEventPricing ? undefined : scope.window,
			),
			dailySessionsRelation: "usage_analytics_daily_sessions",
			metadataRelation: "usage_analytics_metadata",
			mode: "legacy",
			sessionsRelation: "usage_analytics_sessions",
		};
	}

	await readinessGate.assertReady();
	const usageSource = await resolveUsageSource(organizationId);
	return {
		clickhouseSettings: USAGE_ANALYTICS_CLICKHOUSE_SETTINGS,
		cteDefinitions: buildUsageEventAnalyticsCte(
			usageSource === "rollups" && scope.window?.onlyForEventPricing
				? { ...scope, window: undefined }
				: scope,
			undefined,
			usageSource,
		),
		dailySessionsRelation: "usage_analytics_daily_sessions",
		metadataRelation: "usage_analytics_metadata",
		mode: "events",
		sessionsRelation: "usage_analytics_sessions",
	};
}

// Canary routing is per organization, so a cross-tenant read uses request-level
// analytics only once the cutover covers every organization.
export async function getAllOrganizationsUsageAnalyticsQueryContext(): Promise<UsageAnalyticsQueryContext> {
	if (readUsageEventAnalyticsCutoverConfig().mode !== "all") {
		return {
			clickhouseSettings: USAGE_ANALYTICS_CLICKHOUSE_SETTINGS,
			cteDefinitions: buildLegacyUsageAnalyticsCte(
				undefined,
				"allOrganizations",
			),
			dailySessionsRelation: "usage_analytics_daily_sessions",
			metadataRelation: "usage_analytics_metadata",
			mode: "legacy",
			sessionsRelation: "usage_analytics_sessions",
		};
	}

	await readinessGate.assertReady();
	return {
		clickhouseSettings: USAGE_ANALYTICS_CLICKHOUSE_SETTINGS,
		cteDefinitions: buildUsageEventAnalyticsCte({ tenant: "allOrganizations" }),
		dailySessionsRelation: "usage_analytics_daily_sessions",
		metadataRelation: "usage_analytics_metadata",
		mode: "events",
		sessionsRelation: "usage_analytics_sessions",
	};
}
