import {
	type AnalysisCoverageInput,
	type AnalysisCoverageInventory,
	type AnalysisCoverageOutput,
	COVERAGE_LIVE_MINUTES,
} from "@rudel/api-routes";
import {
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { SESSION_INVENTORY_TABLE } from "@rudel/ch-schema/session-inventory";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { measureParams } from "./retro-measures.js";
import { RUN_INDEX_VERSION } from "./run-index-sql.js";

export interface CoverageOwner {
	readonly organizationId: string;
	readonly userId: string | null;
}

interface CoverageScope {
	readonly window: { from: string; to: string } | null;
	readonly repository: string | null;
	readonly latest: number | null;
	readonly sessions: readonly string[] | null;
}

const COVERAGE_QUERY_SETTINGS = {
	join_use_nulls: 0,
	max_execution_time: 10,
	max_memory_usage: "536870912",
	max_rows_to_read: "50000000",
	timeout_before_checking_execution_speed: 0,
} as const;

const IndexRowSchema = z.object({
	sessions: z.coerce.number(),
	current: z.coerce.number(),
	indexed: z.coerce.number(),
	members: z.array(z.string()),
});

const InventoryRowSchema = z.object({
	reporters: z.array(z.string()),
	oldest_report_ms: z.coerce.number(),
	omitted: z.coerce.number(),
	on_machines: z.coerce.number(),
	missing: z.coerce.number(),
	partial: z.coerce.number(),
	unchecked: z.coerce.number(),
	live: z.coerce.number(),
});

export function resolveCoverageScope(
	input: AnalysisCoverageInput,
	today: Date,
): CoverageScope | { error: string } {
	if (!input.scope)
		return { window: null, repository: null, latest: null, sessions: null };
	const params = measureParams(input.scope, today);
	if ("error" in params) return params;
	return {
		window: { from: params.from, to: params.to },
		repository: params.repository ?? null,
		latest: params.latest ?? null,
		sessions: params.sessions ?? null,
	};
}

export function buildIndexCoverageStatement(
	owner: CoverageOwner,
	scope: CoverageScope,
): ClickHouseStatement {
	const analytics = getSafeClickHouseTable("rudel.session_analytics");
	const runIndex = getSafeClickHouseTable("rudel.run_index");
	const member = owner.userId ? "AND user_id = {userId:String}" : "";
	const filters = [
		"organization_id = {organizationId:String}",
		...(owner.userId ? ["user_id = {userId:String}"] : []),
		...(scope.window
			? [
					"session_date >= toDateTime64({from:String}, 3, 'UTC')",
					"session_date < toDateTime64({to:String}, 3, 'UTC') + INTERVAL 1 DAY",
				]
			: []),
		...(scope.repository
			? [
					"(coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path) = {repository:String} OR endsWith(coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path), {repositorySuffix:String}))",
				]
			: []),
		...(scope.sessions ? ["session_id IN {sessions:Array(String)}"] : []),
	];
	return {
		clickhouse_settings: COVERAGE_QUERY_SETTINGS,
		query: `WITH scoped AS (
				SELECT user_id, session_id, revision
				FROM ${analytics} FINAL
				WHERE ${filters.join(" AND ")}
				${scope.latest ? "ORDER BY session_date DESC LIMIT {latest:UInt32}" : ""}
			),
			committed AS (
				SELECT user_id, session_id, max((revision, parser_version, index_version)) AS build
				FROM ${runIndex}
				WHERE organization_id = {organizationId:String} ${member} AND row_kind = 'receipt'
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM scoped)
				GROUP BY user_id, session_id
			)
			SELECT count() AS sessions,
				countIf(c.indexed = 1 AND c.build.1 >= s.revision
					AND c.build.2 >= {parserVersion:UInt32} AND c.build.3 >= {indexVersion:UInt32}) AS current,
				countIf(c.indexed = 1) AS indexed,
				groupUniqArray(s.user_id) AS members
			FROM scoped AS s
			LEFT JOIN (SELECT user_id, session_id, build, 1 AS indexed FROM committed) AS c
				USING (user_id, session_id)`,
		query_params: {
			...params(owner, scope),
			parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
			indexVersion: RUN_INDEX_VERSION,
		},
	};
}

export function buildInventoryCoverageStatement(
	owner: CoverageOwner,
	scope: CoverageScope,
): ClickHouseStatement {
	const inventory = getSafeClickHouseTable(SESSION_INVENTORY_TABLE);
	const analytics = getSafeClickHouseTable("rudel.session_analytics");
	const records = getSafeClickHouseTable("rudel.transcript_records");
	const member = owner.userId ? "AND user_id = {userId:String}" : "";
	const filters = [
		...(scope.window
			? [
					"coalesce(i.started_at, i.modified_at) >= toDateTime64({from:String}, 3, 'UTC')",
					"coalesce(i.started_at, i.modified_at) < toDateTime64({to:String}, 3, 'UTC') + INTERVAL 1 DAY",
				]
			: []),
		...(scope.sessions ? ["i.session_id IN {sessions:Array(String)}"] : []),
	];
	return {
		clickhouse_settings: COVERAGE_QUERY_SETTINGS,
		query: `WITH reports AS (
				SELECT user_id, reported_at, omitted_count
				FROM ${inventory} FINAL
				WHERE organization_id = {organizationId:String} ${member} AND row_kind = 'report'
			),
			listed AS (
				SELECT i.user_id AS user_id, i.session_id AS session_id,
					i.main_lines + i.subagent_lines AS lines,
					i.modified_at >= r.reported_at - INTERVAL {liveMinutes:UInt32} MINUTE AS live
				FROM ${inventory} AS i FINAL
				INNER JOIN reports AS r ON i.user_id = r.user_id AND i.reported_at = r.reported_at
				WHERE i.organization_id = {organizationId:String} AND i.row_kind = 'session'
					${owner.userId ? "AND i.user_id = {userId:String}" : ""}
					${filters.map((filter) => `AND ${filter}`).join(" ")}
			),
			held AS (
				SELECT DISTINCT user_id, session_id, 1 AS present
				FROM ${analytics} FINAL
				WHERE organization_id = {organizationId:String} ${member}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM listed)
			),
			uploaded AS (
				SELECT user_id, session_id, 1 AS present,
					JSONExtractUInt(argMax(head, (revision, parser_version)), 'lineCount') AS lines
				FROM ${records}
				WHERE organization_id = {organizationId:String} ${member}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM listed)
					AND agent_id = '' AND record_idx = {receiptRecordIdx:UInt32} AND block_idx = 0
				GROUP BY user_id, session_id
			)
			SELECT
				(SELECT groupArray(user_id) FROM reports) AS reporters,
				(SELECT toUnixTimestamp64Milli(min(reported_at)) FROM reports) AS oldest_report_ms,
				(SELECT sum(omitted_count) FROM reports) AS omitted,
				count() AS on_machines,
				countIf(h.present = 0) AS missing,
				countIf(h.present = 1 AND u.present = 1 AND u.lines < l.lines) AS partial,
				countIf(h.present = 1 AND u.present = 0) AS unchecked,
				countIf(l.live) AS live
			FROM listed AS l
			LEFT JOIN held AS h USING (user_id, session_id)
			LEFT JOIN uploaded AS u USING (user_id, session_id)`,
		query_params: {
			...params(owner, scope),
			liveMinutes: COVERAGE_LIVE_MINUTES,
			receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		},
	};
}

export async function computeCoverage(
	executor: ClickHouseExecutor,
	owner: CoverageOwner,
	scope: CoverageScope,
	now: Date,
): Promise<AnalysisCoverageOutput> {
	const [indexRows, inventoryRows] = await Promise.all([
		executor.query<unknown>(buildIndexCoverageStatement(owner, scope)),
		executor.query<unknown>(buildInventoryCoverageStatement(owner, scope)),
	]);
	const index = IndexRowSchema.parse(indexRows[0]);
	const listed = InventoryRowSchema.parse(inventoryRows[0]);
	const inventory: AnalysisCoverageInventory | null =
		listed.reporters.length === 0
			? null
			: {
					membersReporting: listed.reporters.length,
					membersInScope: new Set([...index.members, ...listed.reporters]).size,
					oldestReportAt: new Date(listed.oldest_report_ms).toISOString(),
					allRepositories: scope.repository !== null,
					onMachines: listed.on_machines,
					missing: listed.missing,
					partial: listed.partial,
					unchecked: listed.unchecked,
					live: listed.live,
					omitted: listed.omitted,
				};
	const output = {
		window: scope.window,
		repository: scope.repository,
		sessions: index.sessions,
		current: index.current,
		olderIndex: index.indexed - index.current,
		notIndexed: index.sessions - index.indexed,
		inventory,
	};
	return { ...output, line: renderCoverageLine(output, now) };
}

export function renderCoverageLine(
	coverage: Omit<AnalysisCoverageOutput, "line">,
	now: Date,
): string {
	const n = (value: number) => value.toLocaleString("en-US");
	const index = [
		`${n(coverage.current)} indexed at current versions`,
		...(coverage.olderIndex > 0
			? [`${n(coverage.olderIndex)} at older versions`]
			: []),
		`${n(coverage.notIndexed)} not indexed`,
	].join(", ");
	return `coverage: ${n(coverage.sessions)} sessions in scope; ${index}; ${renderInventory(coverage.inventory, now)}`;
}

function renderInventory(
	inventory: AnalysisCoverageInventory | null,
	now: Date,
): string {
	if (inventory === null)
		return "on members' machines: unknown (no CLI has sent a session inventory; older CLIs do not)";
	const n = (value: number) => value.toLocaleString("en-US");
	const about = [
		`${n(inventory.membersReporting)} of ${n(inventory.membersInScope)} members reporting`,
		`oldest report ${age(now.getTime() - Date.parse(inventory.oldestReportAt))} ago`,
		...(inventory.allRepositories ? ["any repository"] : []),
		...(inventory.omitted > 0
			? [`${n(inventory.omitted)} sessions left out of the inventory`]
			: []),
	].join(", ");
	const partial =
		inventory.unchecked > 0
			? `${n(inventory.partial)} partly uploaded (+${n(inventory.unchecked)} not comparable)`
			: `${n(inventory.partial)} partly uploaded`;
	return `on members' machines (${about}): ${n(inventory.missing)} not uploaded, ${partial}, ${n(inventory.live)} live (changed within ${COVERAGE_LIVE_MINUTES} min of the report)`;
}

function age(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 120) return `${minutes} min`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

function params(owner: CoverageOwner, scope: CoverageScope) {
	return {
		organizationId: owner.organizationId,
		...(owner.userId ? { userId: owner.userId } : {}),
		...(scope.window
			? {
					from: `${scope.window.from} 00:00:00`,
					to: `${scope.window.to} 00:00:00`,
				}
			: {}),
		...(scope.repository
			? {
					repository: scope.repository,
					repositorySuffix: `/${scope.repository}`,
				}
			: {}),
		...(scope.latest ? { latest: scope.latest } : {}),
		...(scope.sessions ? { sessions: [...scope.sessions] } : {}),
	};
}

const CACHE_MS = 60_000;
const CACHE_ENTRIES = 500;
const cache = new Map<
	string,
	{ at: number; value: Promise<AnalysisCoverageOutput> }
>();

export function cachedCoverage(
	executor: ClickHouseExecutor,
	owner: CoverageOwner,
	scope: CoverageScope,
	now: Date,
): Promise<AnalysisCoverageOutput> {
	const key = JSON.stringify([owner, scope]);
	const hit = cache.get(key);
	if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;
	const value = computeCoverage(executor, owner, scope, now);
	cache.set(key, { at: now.getTime(), value });
	value.catch(() => cache.delete(key));
	if (cache.size > CACHE_ENTRIES)
		for (const [stale, entry] of cache)
			if (now.getTime() - entry.at >= CACHE_MS || cache.size > CACHE_ENTRIES)
				cache.delete(stale);
	return value;
}
