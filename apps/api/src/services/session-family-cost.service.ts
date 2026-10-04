import type { ClickHouseSettings } from "@clickhouse/client-web";
import type { Source } from "@rudel/api-routes";
import { queryClickhouse } from "../clickhouse.js";
import { NATIVE_PARENT_EDGE_SQL } from "./session-lineage-analytics.service.js";
import { getUsageAnalyticsQueryContext } from "./usage-event-analytics.service.js";

const SESSION_FAMILY_COST_QUERY_SETTINGS: ClickHouseSettings = {
	max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
	max_execution_time: 30,
	max_result_rows: "1",
	max_rows_to_read: "10000000",
	timeout_before_checking_execution_speed: 0,
};
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

interface SessionFamilyCostRow {
	descendant_cost: number | null;
	descendant_cost_is_complete: number;
	descendant_count: number;
	session_id: string;
}

/**
 * Builds a relation with the input rows unchanged except for the three cost
 * fields, which include every native Codex descendant. The surrounding query
 * must start with `WITH RECURSIVE` and already define `session_lineage_current`.
 *
 * `rootFilterSql` is intended for a parameterized, bounded root predicate in a
 * focused read. Callers must never place request values directly in it.
 */
export function buildSessionFamilyCostCte(input: {
	readonly inputRelation: string;
	readonly outputRelation: string;
	readonly rootFilterSql: string | undefined;
	readonly rootRelation: string | undefined;
}): string {
	assertSqlIdentifier(input.inputRelation);
	assertSqlIdentifier(input.outputRelation);
	if (input.rootRelation) assertSqlIdentifier(input.rootRelation);
	const rootRelation = input.rootRelation ?? input.inputRelation;
	const rootFilter = input.rootFilterSql ? `WHERE ${input.rootFilterSql}` : "";
	return `
		session_family_native_edges AS (
			SELECT
				organization_id,
				user_id,
				parent_session_id,
				child_session_id
			FROM session_lineage_current
			WHERE ${NATIVE_PARENT_EDGE_SQL}
		),
		session_family_walk AS (
			SELECT
				sa.organization_id AS root_organization_id,
				sa.user_id AS root_user_id,
				toString(sa.source) AS root_source,
				sa.session_id AS root_session_id,
				sa.organization_id AS member_organization_id,
				sa.user_id AS member_user_id,
				toString(sa.source) AS member_source,
				sa.session_id AS member_session_id,
				[sa.session_id] AS visited_session_ids
			FROM ${rootRelation} AS sa
			${rootFilter}

			UNION ALL

			SELECT
				walk.root_organization_id,
				walk.root_user_id,
				walk.root_source,
				walk.root_session_id,
				edge.organization_id AS member_organization_id,
				edge.user_id AS member_user_id,
				'codex' AS member_source,
				edge.child_session_id AS member_session_id,
				arrayPushBack(walk.visited_session_ids, edge.child_session_id)
			FROM session_family_walk AS walk
			INNER JOIN session_family_native_edges AS edge
				ON edge.organization_id = walk.member_organization_id
				AND edge.user_id = walk.member_user_id
				AND walk.member_source = 'codex'
				AND edge.parent_session_id = walk.member_session_id
			WHERE NOT has(walk.visited_session_ids, edge.child_session_id)
		),
		session_family_unique_members AS (
			SELECT DISTINCT
				root_organization_id,
				root_user_id,
				root_source,
				root_session_id,
				member_organization_id,
				member_user_id,
				member_source,
				member_session_id
			FROM session_family_walk
		),
		session_family_cost_rollups AS (
			SELECT
				members.root_organization_id AS organization_id,
				members.root_user_id AS user_id,
				members.root_source AS source,
				members.root_session_id AS session_id,
				toUInt8(count() > 1) AS has_native_descendants,
				toUInt8(min(ifNull(cost.cost_is_complete, 0))) AS family_cost_is_complete,
				if(
					min(ifNull(cost.cost_is_complete, 0)) = 1,
					toNullable(sum(ifNull(cost.estimated_cost, 0))),
					CAST(NULL, 'Nullable(Float64)')
				) AS family_estimated_cost,
				toUInt8(max(ifNull(cost.cost_uses_default_region, 0))) AS family_cost_uses_default_region
			FROM session_family_unique_members AS members
			LEFT ANY JOIN ${input.inputRelation} AS cost
				ON cost.organization_id = members.member_organization_id
				AND cost.user_id = members.member_user_id
				AND cost.source = members.member_source
				AND cost.session_id = members.member_session_id
			GROUP BY
				members.root_organization_id,
				members.root_user_id,
				members.root_source,
				members.root_session_id
		),
		${input.outputRelation} AS (
			SELECT
				sa.* EXCEPT (estimated_cost, cost_is_complete, cost_uses_default_region),
				rollup.family_estimated_cost AS estimated_cost,
				rollup.family_cost_is_complete AS cost_is_complete,
				rollup.family_cost_uses_default_region AS cost_uses_default_region,
				rollup.has_native_descendants AS has_native_descendants
			FROM ${input.inputRelation} AS sa
			INNER JOIN session_family_cost_rollups AS rollup
				ON rollup.organization_id = sa.organization_id
				AND rollup.user_id = sa.user_id
				AND rollup.source = sa.source
				AND rollup.session_id = sa.session_id
		)`;
}

export async function getSessionFamilyCost(input: {
	readonly estimatedCost: number | null;
	readonly organizationId: string;
	readonly ownerId: string;
	readonly sessionId: string;
	readonly source: Source | null;
}): Promise<number | null> {
	if (input.source !== "codex") return input.estimatedCost;
	const usage = await getUsageAnalyticsQueryContext(input.organizationId, {
		sourceParam: "familySource",
		userIdParam: "familyOwnerId",
	});
	const [row] = await queryClickhouse<SessionFamilyCostRow>({
		clickhouse_settings: SESSION_FAMILY_COST_QUERY_SETTINGS,
		query: buildFocusedFamilyCostSql(
			usage.cteDefinitions,
			usage.sessionsRelation,
		),
		query_params: {
			familyOwnerId: input.ownerId,
			familyRootSessionId: input.sessionId,
			familySource: input.source,
			orgId: input.organizationId,
		},
	});
	return resolveFamilyCost(input.estimatedCost, row);
}

function buildFocusedFamilyCostSql(
	usageCteDefinitions: string,
	usageSessionsRelation: string,
): string {
	return `
		WITH RECURSIVE ${usageCteDefinitions},
		focused_session_family_roots AS (
			SELECT
				{orgId:String} AS organization_id,
				{familyOwnerId:String} AS user_id,
				{familySource:String} AS source,
				{familyRootSessionId:String} AS session_id
		),
		${buildSessionFamilyCostCte({
			inputRelation: usageSessionsRelation,
			outputRelation: "focused_session_family_costs",
			rootFilterSql: undefined,
			rootRelation: "focused_session_family_roots",
		})}
		SELECT
			members.root_session_id AS session_id,
			countIf(members.member_session_id != members.root_session_id) AS descendant_count,
			if(
				countIf(members.member_session_id != members.root_session_id) = 0,
				toNullable(0.0),
				if(
					minIf(
						ifNull(cost.cost_is_complete, 0),
						members.member_session_id != members.root_session_id
					) = 1,
					toNullable(sumIf(
						ifNull(cost.estimated_cost, 0),
						members.member_session_id != members.root_session_id
					)),
					CAST(NULL, 'Nullable(Float64)')
				)
			) AS descendant_cost,
			toUInt8(
				countIf(members.member_session_id != members.root_session_id) = 0
				OR minIf(
					ifNull(cost.cost_is_complete, 0),
					members.member_session_id != members.root_session_id
				) = 1
			) AS descendant_cost_is_complete
		FROM session_family_unique_members AS members
		LEFT ANY JOIN ${usageSessionsRelation} AS cost
			ON cost.organization_id = members.member_organization_id
			AND cost.user_id = members.member_user_id
			AND cost.source = members.member_source
			AND cost.session_id = members.member_session_id
		GROUP BY members.root_session_id
		LIMIT 1`;
}

function resolveFamilyCost(
	rootCost: number | null,
	row: SessionFamilyCostRow | undefined,
): number | null {
	if (!row || row.descendant_count === 0) return rootCost;
	if (rootCost === null || row.descendant_cost_is_complete === 0) return null;
	if (row.descendant_cost === null) return null;
	return rootCost + Number(row.descendant_cost);
}

function assertSqlIdentifier(identifier: string): void {
	if (!SQL_IDENTIFIER.test(identifier)) {
		throw new Error(`Unsafe SQL identifier: ${identifier}`);
	}
}
