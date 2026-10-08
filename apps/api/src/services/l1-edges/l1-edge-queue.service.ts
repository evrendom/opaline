import type postgres from "postgres";
import { type SessionIdentity, sessionScopeId } from "./l1-edge-ids.js";

/**
 * The L1 edge worker's queue (docs/adr/0003-l1-evidence-entities-edges.md):
 * Postgres rows in `l1_edge_scope`, one per scope. Requests coalesce on the
 * scope; a claim takes a lease and the next build revision; only the lease
 * holder completes or fails it, so a stale worker cannot overwrite a newer
 * build. A request that arrives during a build leaves the scope due again.
 */

type Sql = postgres.Sql | postgres.TransactionSql;

export type L1EdgeScopeKey =
	| ({ kind: "session"; organizationId: string } & SessionIdentity)
	| { kind: "repository"; organizationId: string; repositoryId: string };

export interface ClaimedL1EdgeScope {
	organizationId: string;
	scopeKind: "session" | "repository";
	scopeId: string;
	userId: string | null;
	source: string | null;
	sessionId: string | null;
	repositoryId: string | null;
	leaseToken: string;
	revision: number;
	attemptCount: number;
	input: Record<string, unknown>;
	coverage: Record<string, unknown>;
	watermark: Date | null;
	builtRevision: number | null;
}

/** Attempts before a scope waits for its next request instead of retrying. */
export const L1_EDGE_MAX_ATTEMPTS = 8;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 6 * 3_600_000;

export function l1EdgeScopeId(scope: L1EdgeScopeKey): string {
	return scope.kind === "session" ? sessionScopeId(scope) : scope.repositoryId;
}

/**
 * Requests a rebuild of a scope, coalescing with a pending request. The scope
 * becomes due after `debounceMs` (or earlier if it already was); a failed
 * scope is retried from its first attempt.
 */
export async function enqueueL1EdgeScope(
	sql: Sql,
	scope: L1EdgeScopeKey,
	options: { debounceMs?: number; priority?: 0 | 1 } = {},
): Promise<void> {
	const session = scope.kind === "session" ? scope : null;
	await sql.unsafe(
		`INSERT INTO l1_edge_scope (organization_id, scope_kind, scope_id, user_id, source, session_id, repository_id, priority, next_attempt_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::bigint * interval '1 millisecond')
		 ON CONFLICT (organization_id, scope_kind, scope_id) DO UPDATE SET
			request_count = l1_edge_scope.request_count + 1,
			priority = LEAST(l1_edge_scope.priority, EXCLUDED.priority),
			next_attempt_at = CASE
				WHEN l1_edge_scope.request_count > l1_edge_scope.built_request_count
					AND l1_edge_scope.next_attempt_at <> 'infinity'
				THEN LEAST(l1_edge_scope.next_attempt_at, EXCLUDED.next_attempt_at)
				ELSE EXCLUDED.next_attempt_at END,
			attempt_count = CASE WHEN l1_edge_scope.next_attempt_at = 'infinity' THEN 0 ELSE l1_edge_scope.attempt_count END,
			updated_at = now()`,
		[
			scope.organizationId,
			scope.kind,
			l1EdgeScopeId(scope),
			session?.userId ?? null,
			session?.source ?? null,
			session?.sessionId ?? null,
			scope.kind === "repository" ? scope.repositoryId : null,
			options.priority ?? 0,
			options.debounceMs ?? 0,
		],
	);
}

/**
 * Claims up to `limit` due scopes, live before backfill, oldest first. Each
 * claim takes a lease, the next build revision and the request count it
 * builds.
 */
export async function claimL1EdgeScopes(
	sql: postgres.Sql,
	options: { limit: number; leaseMs: number },
): Promise<ClaimedL1EdgeScope[]> {
	const leaseToken = crypto.randomUUID();
	return sql
		.begin(async (transaction) =>
			transaction.unsafe<ClaimedL1EdgeScope[]>(
				`WITH due AS MATERIALIZED (
				SELECT organization_id, scope_kind, scope_id FROM l1_edge_scope
				WHERE request_count > built_request_count AND next_attempt_at <= now()
					AND (lease_expires_at IS NULL OR lease_expires_at <= now())
				ORDER BY priority, next_attempt_at
				FOR UPDATE SKIP LOCKED
				LIMIT $1
			), claimed AS (
			UPDATE l1_edge_scope AS scope SET
				lease_token = $2,
				lease_expires_at = now() + $3::bigint * interval '1 millisecond',
				claimed_request_count = scope.request_count,
				claimed_revision = nextval('l1_edge_revision_seq'),
				attempt_count = scope.attempt_count + 1,
				updated_at = now()
			FROM due
			WHERE scope.organization_id = due.organization_id AND scope.scope_kind = due.scope_kind AND scope.scope_id = due.scope_id
			RETURNING scope.organization_id AS "organizationId", scope.scope_kind AS "scopeKind", scope.scope_id AS "scopeId",
				scope.user_id AS "userId", scope.source, scope.session_id AS "sessionId", scope.repository_id AS "repositoryId",
				scope.lease_token AS "leaseToken", scope.claimed_revision::text AS "revision", scope.attempt_count AS "attemptCount",
				scope.input, scope.coverage, scope.watermark, scope.built_revision::text AS "builtRevision",
				scope.priority, scope.next_attempt_at
			)
			-- RETURNING has no order; build live scopes first, oldest first.
			SELECT "organizationId", "scopeKind", "scopeId", "userId", source, "sessionId", "repositoryId",
				"leaseToken", "revision", "attemptCount", input, coverage, watermark, "builtRevision"
			FROM claimed ORDER BY priority, next_attempt_at, "scopeId"`,
				[options.limit, leaseToken, options.leaseMs],
			),
		)
		.then((rows) =>
			rows.map((row) => ({
				...row,
				revision: Number(row.revision),
				builtRevision:
					row.builtRevision === null ? null : Number(row.builtRevision),
			})),
		);
}

/** Whether the claim still holds its lease; checked right before writing edges. */
export async function holdsL1EdgeLease(
	sql: Sql,
	claim: Pick<
		ClaimedL1EdgeScope,
		"organizationId" | "scopeKind" | "scopeId" | "leaseToken"
	>,
): Promise<boolean> {
	const rows = await sql.unsafe(
		`SELECT 1 FROM l1_edge_scope
		 WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = $3
			AND lease_token = $4 AND lease_expires_at > now()`,
		[claim.organizationId, claim.scopeKind, claim.scopeId, claim.leaseToken],
	);
	return rows.length === 1;
}

/** Records a finished build; returns false when the lease was lost. */
export async function completeL1EdgeScope(
	sql: Sql,
	claim: ClaimedL1EdgeScope,
	result: {
		resolverVersion: number;
		input?: Record<string, unknown>;
		coverage?: Record<string, unknown>;
		watermark?: Date | null;
		edgeCount: number;
		unresolvedCount: number;
		frozenReason?: string | null;
	},
): Promise<boolean> {
	const rows = await sql.unsafe(
		`UPDATE l1_edge_scope SET
			built_request_count = claimed_request_count,
			built_revision = claimed_revision,
			resolver_version = $5,
			input = COALESCE($6::text::jsonb, input),
			coverage = COALESCE($7::text::jsonb, coverage),
			watermark = COALESCE($8::timestamptz, watermark),
			edge_count = $9, unresolved_count = $10, frozen_reason = $11,
			attempt_count = 0, last_error = NULL,
			lease_token = NULL, lease_expires_at = NULL,
			built_at = now(), updated_at = now()
		 WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = $3 AND lease_token = $4
		 RETURNING 1`,
		[
			claim.organizationId,
			claim.scopeKind,
			claim.scopeId,
			claim.leaseToken,
			result.resolverVersion,
			result.input ? JSON.stringify(result.input) : null,
			result.coverage ? JSON.stringify(result.coverage) : null,
			result.watermark?.toISOString() ?? null,
			result.edgeCount,
			result.unresolvedCount,
			result.frozenReason ?? null,
		],
	);
	return rows.length === 1;
}

/**
 * Records a failed build and backs off; after `L1_EDGE_MAX_ATTEMPTS` the
 * scope waits for its next request. Returns false when the lease was lost.
 */
export async function failL1EdgeScope(
	sql: Sql,
	claim: ClaimedL1EdgeScope,
	error: string,
	random: () => number = Math.random,
): Promise<boolean> {
	const delayMs = l1EdgeRetryDelayMs(claim.attemptCount, random());
	const rows = await sql.unsafe(
		`UPDATE l1_edge_scope SET
			next_attempt_at = CASE WHEN attempt_count >= $5 THEN 'infinity'::timestamptz
				ELSE now() + $6::bigint * interval '1 millisecond' END,
			last_error = $7, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
		 WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = $3 AND lease_token = $4
		 RETURNING 1`,
		[
			claim.organizationId,
			claim.scopeKind,
			claim.scopeId,
			claim.leaseToken,
			L1_EDGE_MAX_ATTEMPTS,
			delayMs,
			error.slice(0, 1_000),
		],
	);
	return rows.length === 1;
}

/**
 * Exponential backoff with up to 25% jitter. Kept here so callers that only
 * queue requests (ingest, extraction) load no database client.
 */
export function l1EdgeRetryDelayMs(attempt: number, random: number): number {
	const delay = Math.min(
		RETRY_MAX_MS,
		RETRY_BASE_MS * 2 ** (Math.max(1, attempt) - 1),
	);
	return Math.min(
		RETRY_MAX_MS,
		delay + Math.floor(delay * 0.25 * Math.min(1, Math.max(0, random))),
	);
}

/** Removes a scope whose owner or workspace is being purged. */
export async function dropL1EdgeScope(
	sql: Sql,
	claim: Pick<ClaimedL1EdgeScope, "organizationId" | "scopeKind" | "scopeId">,
): Promise<void> {
	await sql.unsafe(
		"DELETE FROM l1_edge_scope WHERE organization_id = $1 AND scope_kind = $2 AND scope_id = $3",
		[claim.organizationId, claim.scopeKind, claim.scopeId],
	);
}

/**
 * Replaces the repositories a session scope depends on, each open until its
 * time, so a repository change re-queues the session while it is open.
 */
export async function recordL1EdgeDependencies(
	sql: Sql,
	scope: Pick<ClaimedL1EdgeScope, "organizationId" | "scopeId">,
	dependencies: readonly { repositoryKey: string; openUntil: Date }[],
): Promise<void> {
	await sql.unsafe(
		`DELETE FROM l1_edge_scope_dependency WHERE organization_id = $1 AND scope_kind = 'session' AND scope_id = $2`,
		[scope.organizationId, scope.scopeId],
	);
	if (dependencies.length === 0) return;
	await sql.unsafe(
		`INSERT INTO l1_edge_scope_dependency (organization_id, repository_key, scope_kind, scope_id, open_until)
		 SELECT $1, key, 'session', $2, until
		 FROM unnest($3::text[], $4::timestamptz[]) AS dependency(key, until)
		 ON CONFLICT (organization_id, repository_key, scope_id) DO UPDATE SET open_until = EXCLUDED.open_until`,
		[
			scope.organizationId,
			scope.scopeId,
			dependencies.map((dependency) => dependency.repositoryKey),
			dependencies.map((dependency) => dependency.openUntil.toISOString()),
		],
	);
}

/**
 * Re-queues the open session scopes that depend on a repository, at most
 * `limit` per call; returns how many were queued.
 */
export async function enqueueL1EdgeDependents(
	sql: Sql,
	organizationId: string,
	repositoryKeys: readonly string[],
	options: { limit: number; debounceMs?: number },
): Promise<number> {
	const rows = await sql.unsafe(
		`WITH dependents AS (
			SELECT DISTINCT scope_id FROM l1_edge_scope_dependency
			WHERE organization_id = $1 AND repository_key = ANY($2::text[]) AND open_until > now()
			LIMIT $3
		)
		UPDATE l1_edge_scope AS scope SET
			request_count = scope.request_count + 1,
			next_attempt_at = CASE
				WHEN scope.request_count > scope.built_request_count AND scope.next_attempt_at <> 'infinity'
				THEN LEAST(scope.next_attempt_at, now() + $4::bigint * interval '1 millisecond')
				ELSE now() + $4::bigint * interval '1 millisecond' END,
			attempt_count = CASE WHEN scope.next_attempt_at = 'infinity' THEN 0 ELSE scope.attempt_count END,
			updated_at = now()
		FROM dependents
		WHERE scope.organization_id = $1 AND scope.scope_kind = 'session' AND scope.scope_id = dependents.scope_id
		RETURNING 1`,
		[
			organizationId,
			[...repositoryKeys],
			options.limit,
			options.debounceMs ?? 0,
		],
	);
	return rows.length;
}
