import { getLogger } from "@logtape/logtape";
import {
	USAGE_SESSION_ROLLUP_COLUMNS,
	USAGE_SESSION_ROLLUPS_TABLE,
} from "@rudel/ch-schema/usage-session-rollups";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { isUsageRollupWriteEnabled } from "../lib/env.js";
import { buildUsageEventCandidateCtes } from "./usage-event-analytics.service.js";

export interface UsageRollupSessionKey {
	readonly organizationId: string;
	readonly sessionId: string;
	readonly source: string;
	readonly userId: string;
}

export interface UsageRollupWriteOptions {
	readonly maxExecutionSeconds?: number;
	readonly signal?: AbortSignal;
}

const logger = getLogger(["rudel", "api", "usage-session-rollups"]);

export const USAGE_ROLLUP_INGEST_MAX_EXECUTION_SECONDS = 5;
export const USAGE_ROLLUP_RETRY_AFTER_MINUTES = 60;
const BUILD_VERSION_SLOT = "{rollupBuildVersion}";
const READINESS_TTL_MS = 60_000;

const ROLLUP_KEYS_FILTER =
	"(organization_id, user_id, source, session_id) IN (SELECT organization_id, user_id, source, session_id FROM usage_rollup_keys)";

const ROLLUP_KEYS_CTE = `usage_rollup_keys AS (
			SELECT DISTINCT
				key.1 AS organization_id,
				key.2 AS user_id,
				key.3 AS source,
				key.4 AS session_id
			FROM (
				SELECT arrayJoin(arrayZip(
					{organizationIds:Array(String)},
					{userIds:Array(String)},
					{sources:Array(String)},
					{sessionIds:Array(String)}
				)) AS key
			)
		)`;

const GROUP_FIELDS = [
	["record_kinds", "record_kind"],
	["usage_dates", "usage_date"],
	["pricing_identities", "pricing_identity"],
	["model_providers", "model_provider"],
	["service_tiers", "service_tier"],
	["inference_speeds", "inference_speed"],
	["inference_geos", "inference_geo"],
	["context_bands", "context_band"],
	["priceable", "is_priceable"],
	["geo_gaps", "has_geo_gap"],
	["uncached_input_tokens", "group_uncached_input_tokens"],
	["cache_read_input_tokens", "group_cache_read_input_tokens"],
	["cache_write_5m_input_tokens", "group_cache_write_5m_input_tokens"],
	["cache_write_1h_input_tokens", "group_cache_write_1h_input_tokens"],
	["output_tokens", "group_output_tokens"],
] as const;

const COLUMN_NAMES = USAGE_SESSION_ROLLUP_COLUMNS.map((column) => column.name);

function buildInsertSqlTemplate(): string {
	const groupTuple = GROUP_FIELDS.map(([, field]) => field).join(", ");
	const groupArrays = GROUP_FIELDS.map(
		([column], index) =>
			`arrayMap(group -> group.${index + 1}, g.groups) AS ${column}`,
	).join(",\n\t\t\t");
	return `INSERT INTO ${getSafeClickHouseTable(USAGE_SESSION_ROLLUPS_TABLE)} (${COLUMN_NAMES.join(", ")})
		WITH
		${ROLLUP_KEYS_CTE},
		${buildUsageEventCandidateCtes(ROLLUP_KEYS_FILTER)},
		usage_rollup_groups AS (
			SELECT
				organization_id,
				user_id,
				source,
				session_id,
				any(latest_main_model) AS latest_main_model,
				any(latest_event_model) AS latest_event_model,
				arraySort(groupArray(tuple(${groupTuple}))) AS groups
			FROM usage_event_pricing_candidates
			GROUP BY organization_id, user_id, source, session_id
		)
		SELECT
			k.organization_id AS organization_id,
			k.user_id AS user_id,
			k.source AS source,
			k.session_id AS session_id,
			ifNull(r.receipt_generation, 0) AS receipt_generation,
			toUInt8(ifNull(c.session_id, '') != '') AS is_consistent,
			ifNull(g.latest_main_model, '') AS latest_main_model,
			ifNull(g.latest_event_model, '') AS latest_event_model,
			${groupArrays},
			${BUILD_VERSION_SLOT} AS build_version,
			now64(3, 'UTC') AS built_at,
			toDateTime64(0, 3, 'UTC') AS retry_after
		FROM usage_rollup_keys AS k
		LEFT ANY JOIN usage_session_receipts AS r
			ON r.organization_id = k.organization_id
			AND r.user_id = k.user_id
			AND r.source = k.source
			AND r.session_id = k.session_id
		LEFT ANY JOIN usage_session_consistency AS c
			ON c.organization_id = k.organization_id
			AND c.user_id = k.user_id
			AND c.source = k.source
			AND c.session_id = k.session_id
		LEFT ANY JOIN usage_rollup_groups AS g
			ON g.organization_id = k.organization_id
			AND g.user_id = k.user_id
			AND g.source = k.source
			AND g.session_id = k.session_id`;
}

export function fingerprintUsageRollupBuild(sql: string): number {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(sql)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
}

const INSERT_SQL_TEMPLATE = buildInsertSqlTemplate();

export const USAGE_ROLLUP_BUILD_VERSION =
	fingerprintUsageRollupBuild(INSERT_SQL_TEMPLATE);

const INSERT_SQL = INSERT_SQL_TEMPLATE.replace(
	BUILD_VERSION_SLOT,
	String(USAGE_ROLLUP_BUILD_VERSION),
);

export function buildUsageSessionRollupInsertSql(): string {
	return INSERT_SQL;
}

export function buildUsageSessionRollupBackoffSql(): string {
	const rows = getSafeClickHouseTable(USAGE_SESSION_ROLLUPS_TABLE);
	const keyColumns = ["organization_id", "user_id", "source", "session_id"];
	const select = COLUMN_NAMES.map((name) =>
		keyColumns.includes(name)
			? `k.${name} AS ${name}`
			: name === "build_version"
				? `if(r.session_id = '', ${USAGE_ROLLUP_BUILD_VERSION}, r.build_version) AS build_version`
				: name === "retry_after"
					? `now64(3, 'UTC') + INTERVAL ${USAGE_ROLLUP_RETRY_AFTER_MINUTES} MINUTE AS retry_after`
					: `r.${name} AS ${name}`,
	);
	return `INSERT INTO ${rows} (${COLUMN_NAMES.join(", ")})
		WITH ${ROLLUP_KEYS_CTE}
		SELECT
			${select.join(",\n\t\t\t")}
		FROM usage_rollup_keys AS k
		LEFT ANY JOIN (
			SELECT *
			FROM ${rows} FINAL
			WHERE (organization_id, user_id, source, session_id) IN (SELECT organization_id, user_id, source, session_id FROM usage_rollup_keys)
		) AS r
			ON r.organization_id = k.organization_id
			AND r.user_id = k.user_id
			AND r.source = k.source
			AND r.session_id = k.session_id`;
}

export function buildUsageSessionRollupParams(
	sessions: readonly UsageRollupSessionKey[],
): Record<string, string[]> {
	return {
		organizationIds: sessions.map((session) => session.organizationId),
		sessionIds: sessions.map((session) => session.sessionId),
		sources: sessions.map((session) => session.source),
		userIds: sessions.map((session) => session.userId),
	};
}

function rollupWriteSettings(options: UsageRollupWriteOptions) {
	return {
		join_use_nulls: 0,
		max_execution_time: options.maxExecutionSeconds ?? 60,
		select_sequential_consistency: "1",
	} as const;
}

export async function refreshUsageSessionRollups(
	executor: ClickHouseExecutor,
	sessions: readonly UsageRollupSessionKey[],
	options: UsageRollupWriteOptions = {},
): Promise<void> {
	if (sessions.length === 0) return;
	await executor.execute({
		abortSignal: options.signal,
		clickhouse_settings: rollupWriteSettings(options),
		query: INSERT_SQL,
		query_params: buildUsageSessionRollupParams(sessions),
	});
}

export async function backOffUsageSessionRollups(
	executor: ClickHouseExecutor,
	sessions: readonly UsageRollupSessionKey[],
	options: UsageRollupWriteOptions = {},
): Promise<void> {
	if (sessions.length === 0) return;
	await executor.execute({
		abortSignal: options.signal,
		clickhouse_settings: rollupWriteSettings(options),
		query: buildUsageSessionRollupBackoffSql(),
		query_params: buildUsageSessionRollupParams(sessions),
	});
}

export async function refreshUsageSessionRollupAfterWrite(
	executor: ClickHouseExecutor,
	session: UsageRollupSessionKey,
	options: {
		readonly assertWritable?: () => Promise<void>;
		readonly signal?: AbortSignal;
	} = {},
): Promise<boolean> {
	if (!isUsageRollupWriteEnabled()) return false;
	try {
		await options.assertWritable?.();
		await refreshUsageSessionRollups(executor, [session], {
			maxExecutionSeconds: USAGE_ROLLUP_INGEST_MAX_EXECUTION_SECONDS,
			signal: options.signal,
		});
		return true;
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError) return false;
		logger.warn(
			"Usage rollup refresh failed after a usage write; the backfill rebuilds it (organization_id={organizationId} session_id={sessionId} error={error})",
			{
				error: error instanceof Error ? error.message : String(error),
				organizationId: session.organizationId,
				sessionId: session.sessionId,
			},
		);
		return false;
	}
}

const readiness = new Map<string, { checkedAt: number; current: boolean }>();

export async function hasOnlyCurrentUsageRollups(
	executor: ClickHouseExecutor,
	organizationId: string,
	now: () => number = Date.now,
): Promise<boolean> {
	const cached = readiness.get(organizationId);
	if (cached && now() - cached.checkedAt < READINESS_TTL_MS)
		return cached.current;
	let current = false;
	try {
		const rows = await executor.query<{ stale: number }>({
			clickhouse_settings: { max_execution_time: 5 },
			query: `SELECT 1 AS stale
				FROM ${getSafeClickHouseTable(USAGE_SESSION_ROLLUPS_TABLE)} FINAL
				WHERE organization_id = {organizationId:String}
					AND build_version != {buildVersion:UInt32}
				LIMIT 1`,
			query_params: {
				buildVersion: USAGE_ROLLUP_BUILD_VERSION,
				organizationId,
			},
		});
		current = rows.length === 0;
	} catch (error) {
		logger.warn(
			"Usage rollup readiness check failed; pricing from events (organization_id={organizationId} error={error})",
			{
				error: error instanceof Error ? error.message : String(error),
				organizationId,
			},
		);
	}
	readiness.set(organizationId, { checkedAt: now(), current });
	return current;
}

export function clearUsageRollupReadiness(): void {
	readiness.clear();
}
