import type postgres from "postgres";
import { type SessionIdentity, sessionScopeId } from "./l1-edge-ids.js";

/**
 * The L1 edge worker's queue (docs/adr/0003-l1-evidence-entities-edges.md):
 * Postgres rows in `l1_edge_scope`, one per scope. Requests coalesce on the
 * scope; a claim takes a lease and the next build revision; only the lease
 * holder completes or fails it, so a stale worker cannot overwrite a newer
 * build. A request that arrives during a build leaves the scope due again.
 *
 * A session has two scopes with the same id: its edges (`session`) and its
 * run index (`run_index`). Only the edges depend on GitHub data, so
 * repository changes and observation lag re-queue or defer `session` scopes
 * alone.
 */

type Sql = postgres.Sql | postgres.TransactionSql;

export type L1EdgeScopeKind = "session" | "repository" | "run_index";

/*
 * Parameters and results never rely on the client's type serializers for
 * dates: the API's shared client is wrapped by drizzle, whose postgres-js
 * driver turns the date and date-array serializers and parsers into
 * identities, so a JS array bound as `timestamptz[]` reaches the wire
 * unserialized and a timestamptz column comes back as text. Times go in as
 * ISO text cast in SQL and come back as epoch milliseconds.
 */

export type L1EdgeScopeKey =
	| ({
			kind: "session" | "run_index";
			organizationId: string;
	  } & SessionIdentity)
	| { kind: "repository"; organizationId: string; repositoryId: string };

export interface ClaimedL1EdgeScope {
	organizationId: string;
	scopeKind: L1EdgeScopeKind;
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
	return scope.kind === "repository"
		? scope.repositoryId
		: sessionScopeId(scope);
}

/**
 * How a request coalesces with an existing scope row: one more request, the
 * more urgent priority, and the due time below.
 */
const ENQUEUE_CONFLICT_SQL = `ON CONFLICT (organization_id, scope_kind, scope_id) DO UPDATE SET
			request_count = l1_edge_scope.request_count + 1,
			priority = LEAST(l1_edge_scope.priority, EXCLUDED.priority),
			-- A pending scope keeps the earlier due time, but a request never
			-- shortens a failed build's backoff (last_error is set by a failure
			-- and cleared only by a completed build); a parked scope
			-- ('infinity') wakes with fresh attempts.
			next_attempt_at = CASE
				WHEN l1_edge_scope.request_count > l1_edge_scope.built_request_count
					AND l1_edge_scope.next_attempt_at <> 'infinity'
				THEN CASE WHEN l1_edge_scope.last_error IS NOT NULL THEN l1_edge_scope.next_attempt_at
					ELSE LEAST(l1_edge_scope.next_attempt_at, EXCLUDED.next_attempt_at) END
				ELSE EXCLUDED.next_attempt_at END,
			attempt_count = CASE WHEN l1_edge_scope.next_attempt_at = 'infinity' THEN 0 ELSE l1_edge_scope.attempt_count END,
			updated_at = now()`;

/** Scopes one bulk request statement queues. */
export const L1_EDGE_ENQUEUE_BATCH = 500;

/**
 * Requests a rebuild of a scope, coalescing with a pending request. The scope
 * becomes due after `debounceMs` (or earlier if it already was); a failed
 * scope is retried from its first attempt. Nothing is queued for a workspace
 * or account that no longer exists, so callers can queue inside their own
 * transaction (an upload, a sweep step, a webhook) without risking it.
 */
export async function enqueueL1EdgeScope(
	sql: Sql,
	scope: L1EdgeScopeKey,
	options: { debounceMs?: number; priority?: 0 | 1 } = {},
): Promise<void> {
	await enqueueScopes(sql, scope, [scope.kind], options);
}

/**
 * Requests rebuilds of many session-shaped scopes (`session` or `run_index`)
 * of one workspace, as `enqueueL1EdgeScope` does for one, in statements of
 * at most `L1_EDGE_ENQUEUE_BATCH` scopes (duplicates coalesce first).
 * Sessions whose owner no longer exists are skipped, and nothing is queued
 * for a workspace that no longer exists. Returns how many scopes were
 * queued or re-requested.
 */
export async function enqueueL1EdgeSessionScopes(
	sql: Sql,
	kind: "session" | "run_index",
	organizationId: string,
	sessions: readonly SessionIdentity[],
	options: { debounceMs?: number; priority?: 0 | 1 } = {},
): Promise<number> {
	const unique = new Map(
		sessions.map((session) => [sessionScopeId(session), session]),
	);
	const all = [...unique.entries()];
	let queued = 0;
	for (let offset = 0; offset < all.length; offset += L1_EDGE_ENQUEUE_BATCH) {
		const batch = all.slice(offset, offset + L1_EDGE_ENQUEUE_BATCH);
		const rows = await sql.unsafe(
			`INSERT INTO l1_edge_scope (organization_id, scope_kind, scope_id, user_id, source, session_id, repository_id, priority, next_attempt_at)
			 SELECT $1::text, $2::text, scope.scope_id, scope.user_id, scope.source, scope.session_id, NULL, $7::smallint,
				now() + $8::bigint * interval '1 millisecond'
			 FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS scope(scope_id, user_id, source, session_id)
			 WHERE EXISTS (SELECT 1 FROM organization WHERE id = $1::text)
				AND EXISTS (SELECT 1 FROM "user" WHERE id = scope.user_id)
			 ${ENQUEUE_CONFLICT_SQL}
			 RETURNING 1`,
			[
				organizationId,
				kind,
				batch.map(([scopeId]) => scopeId),
				batch.map(([, session]) => session.userId),
				batch.map(([, session]) => session.source),
				batch.map(([, session]) => session.sessionId),
				options.priority ?? 0,
				options.debounceMs ?? 0,
			],
		);
		queued += rows.length;
	}
	return queued;
}

async function enqueueScopes(
	sql: Sql,
	scope: L1EdgeScopeKey,
	kinds: readonly L1EdgeScopeKind[],
	options: { debounceMs?: number; priority?: 0 | 1 },
): Promise<void> {
	const session = scope.kind === "repository" ? null : scope;
	await sql.unsafe(
		`INSERT INTO l1_edge_scope (organization_id, scope_kind, scope_id, user_id, source, session_id, repository_id, priority, next_attempt_at)
		 SELECT $1::text, kind, $3::text, $4::text, $5::text, $6::text, $7::text, $8::smallint,
			now() + $9::bigint * interval '1 millisecond'
		 FROM unnest($2::text[]) AS kind
		 WHERE EXISTS (SELECT 1 FROM organization WHERE id = $1::text)
			AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM "user" WHERE id = $4::text))
		 ${ENQUEUE_CONFLICT_SQL}`,
		[
			scope.organizationId,
			[...kinds],
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
	options: {
		limit: number;
		leaseMs: number;
		/** Only this workspace's scopes (tests building their own fixtures). */
		organizationId?: string;
		kinds?: readonly L1EdgeScopeKind[];
	},
): Promise<ClaimedL1EdgeScope[]> {
	const leaseToken = crypto.randomUUID();
	return sql
		.begin(async (transaction) =>
			transaction.unsafe<
				(Omit<
					ClaimedL1EdgeScope,
					"watermark" | "revision" | "builtRevision"
				> & {
					revision: string;
					builtRevision: string | null;
					watermarkMs: number | null;
				})[]
			>(
				`WITH due AS MATERIALIZED (
				SELECT organization_id, scope_kind, scope_id FROM l1_edge_scope
				WHERE request_count > built_request_count AND next_attempt_at <= now()
					AND (lease_expires_at IS NULL OR lease_expires_at <= now())
					AND ($4::text IS NULL OR organization_id = $4::text)
					AND ($5::text[] IS NULL OR scope_kind = ANY($5::text[]))
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
				scope.input, scope.coverage, (extract(epoch from scope.watermark) * 1000)::float8 AS "watermarkMs",
				scope.built_revision::text AS "builtRevision",
				scope.priority, scope.next_attempt_at
			)
			-- RETURNING has no order; build live scopes first, oldest first.
			SELECT "organizationId", "scopeKind", "scopeId", "userId", source, "sessionId", "repositoryId",
				"leaseToken", "revision", "attemptCount", input, coverage, "watermarkMs", "builtRevision"
			FROM claimed ORDER BY priority, next_attempt_at, "scopeId"`,
				[
					options.limit,
					leaseToken,
					options.leaseMs,
					options.organizationId ?? null,
					options.kinds ? [...options.kinds] : null,
				],
			),
		)
		.then((rows) =>
			rows.map(({ watermarkMs, ...row }) => ({
				...row,
				revision: Number(row.revision),
				builtRevision:
					row.builtRevision === null ? null : Number(row.builtRevision),
				watermark: watermarkMs === null ? null : new Date(Number(watermarkMs)),
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

export async function heldL1EdgeLeases(
	sql: Sql,
	claims: readonly Pick<
		ClaimedL1EdgeScope,
		"organizationId" | "scopeKind" | "scopeId" | "leaseToken"
	>[],
): Promise<Set<string>> {
	if (claims.length === 0) return new Set();
	const rows = await sql.unsafe<{ scope_id: string }[]>(
		`SELECT scope.scope_id FROM l1_edge_scope AS scope
		 JOIN unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS claim(organization_id, scope_kind, scope_id, lease_token)
			ON scope.organization_id = claim.organization_id AND scope.scope_kind = claim.scope_kind
			AND scope.scope_id = claim.scope_id AND scope.lease_token = claim.lease_token
		 WHERE scope.lease_expires_at > now()`,
		[
			claims.map((claim) => claim.organizationId),
			claims.map((claim) => claim.scopeKind),
			claims.map((claim) => claim.scopeId),
			claims.map((claim) => claim.leaseToken),
		],
	);
	return new Set(rows.map((row) => row.scope_id));
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
		/**
		 * The build wrote nothing (a freeze): the scope keeps the build it
		 * retains, its revision, time, rules, input, coverage and counts, so
		 * rows a failed build wrote after it never become published.
		 */
		retainBuild?: boolean;
	},
): Promise<boolean> {
	const rows = await sql.unsafe(
		`UPDATE l1_edge_scope SET
			built_request_count = claimed_request_count,
			built_revision = CASE WHEN $12::boolean THEN built_revision ELSE claimed_revision END,
			resolver_version = CASE WHEN $12::boolean THEN resolver_version ELSE $5 END,
			input = CASE WHEN $12::boolean THEN input ELSE COALESCE($6::text::jsonb, input) END,
			coverage = CASE WHEN $12::boolean THEN coverage ELSE COALESCE($7::text::jsonb, coverage) END,
			watermark = COALESCE($8::timestamptz, watermark),
			edge_count = CASE WHEN $12::boolean THEN edge_count ELSE $9 END,
			unresolved_count = CASE WHEN $12::boolean THEN unresolved_count ELSE $10 END,
			frozen_reason = $11,
			attempt_count = 0, last_error = NULL,
			lease_token = NULL, lease_expires_at = NULL,
			built_at = CASE WHEN $12::boolean THEN built_at ELSE now() END, updated_at = now()
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
			result.retainBuild ?? false,
		],
	);
	return rows.length === 1;
}

/**
 * Records a failed build and backs off; after `L1_EDGE_MAX_ATTEMPTS` the
 * scope waits for its next request. A request that arrived during that last
 * build already is that next request: the attempts restart and the scope is
 * retried after the first backoff, as when a request reaches a parked scope,
 * rather than parked (a deferred build waits for exactly that request). Every
 * failure backs off, so frequent requests cannot make a failing scope spin.
 * Returns false when the lease was lost.
 */
export async function failL1EdgeScope(
	sql: Sql,
	claim: ClaimedL1EdgeScope,
	error: string,
	random: () => number = Math.random,
): Promise<boolean> {
	const delayMs = l1EdgeRetryDelayMs(claim.attemptCount, random());
	const restartDelayMs = l1EdgeRetryDelayMs(1, random());
	const rows = await sql.unsafe(
		`UPDATE l1_edge_scope SET
			next_attempt_at = CASE
				WHEN attempt_count < $5 THEN now() + $6::bigint * interval '1 millisecond'
				WHEN request_count > claimed_request_count
				THEN now() + $8::bigint * interval '1 millisecond'
				ELSE 'infinity'::timestamptz END,
			attempt_count = CASE
				WHEN attempt_count >= $5 AND request_count > claimed_request_count THEN 0
				ELSE attempt_count END,
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
			restartDelayMs,
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
		 SELECT $1, key, 'session', $2, until::timestamptz
		 FROM unnest($3::text[], $4::text[]) AS dependency(key, until)
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
				THEN CASE WHEN scope.last_error IS NOT NULL THEN scope.next_attempt_at
					ELSE LEAST(scope.next_attempt_at, now() + $4::bigint * interval '1 millisecond') END
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
