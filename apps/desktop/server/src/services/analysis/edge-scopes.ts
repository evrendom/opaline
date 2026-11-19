import type postgres from "postgres";
import type { EdgeScopeState, EdgeStateSource } from "./git-edge-links.js";

/** Scope ids read per statement. */
const SCOPES_PER_STATEMENT = 5_000;

/**
 * The edge worker's build records, from `l1_edge_scope`. Times are read as
 * epoch milliseconds: the API's shared client is wrapped by drizzle, which
 * returns timestamptz columns as text.
 */
export function postgresEdgeStateSource(sql: postgres.Sql): EdgeStateSource {
	return {
		async scopes(organizationId, kind, scopeIds) {
			const states = new Map<string, EdgeScopeState>();
			const unique = [...new Set(scopeIds)];
			for (
				let offset = 0;
				offset < unique.length;
				offset += SCOPES_PER_STATEMENT
			) {
				const rows = await sql.unsafe<
					Array<{
						scope_id: string;
						built_revision: string | null;
						resolver_version: number | null;
						input: unknown;
						coverage: unknown;
						frozen_reason: string | null;
						built_ms: number | null;
						rebuilding: boolean;
					}>
				>(
					`SELECT scope_id, built_revision::text AS built_revision, resolver_version, input, coverage, frozen_reason,
						(extract(epoch from built_at) * 1000)::float8 AS built_ms,
						(request_count > built_request_count OR coalesce(lease_expires_at > now(), false)) AS rebuilding
					 FROM l1_edge_scope
					 WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = ANY($3::text[])`,
					[
						organizationId,
						kind,
						unique.slice(offset, offset + SCOPES_PER_STATEMENT),
					],
				);
				for (const row of rows) states.set(row.scope_id, scopeState(row));
			}
			return states;
		},
	};
}

/** A `l1_edge_scope` row as find reads it. */
export function scopeState(row: {
	built_revision: string | null;
	resolver_version: number | null;
	input: unknown;
	coverage: unknown;
	frozen_reason: string | null;
	built_ms: number | string | null;
	rebuilding: boolean;
}): EdgeScopeState {
	return {
		builtRevision:
			row.built_revision === null ? null : Number(row.built_revision),
		resolverVersion: row.resolver_version,
		input: row.input,
		coverage: row.coverage,
		frozenReason: row.frozen_reason,
		builtAt:
			row.built_ms === null
				? null
				: new Date(Number(row.built_ms)).toISOString(),
		rebuilding: row.rebuilding,
	};
}
