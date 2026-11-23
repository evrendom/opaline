import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import { receiptRow } from "../transcript-generations/generations.js";
import { L1_EDGE_RESOLVER_VERSION } from "./l1-edge-derivation.js";
import { sessionScopeId } from "./l1-edge-ids.js";
import {
	enqueueL1EdgeScope,
	enqueueL1EdgeSessionScopes,
} from "./l1-edge-queue.service.js";

/**
 * The edge census: the durable path that re-queues L1 edge builds whose
 * request was lost (docs/l1-literal-schema.md, "Worker"). Uploads queue a
 * session's edges after its git observations are written and captures queue
 * theirs on commit, both best effort; nothing retried a lost request.
 * Daily, from maintenance (never an upload path), this finds:
 *
 * - sessions with git observations published, or captures taken, in the last
 *   `LOOKBACK_DAYS` whose session scope is missing, was never built, was
 *   built under another resolver version, or was built from another
 *   observation generation than the session's newest;
 * - active repository bindings without a repository scope;
 *
 * and queues them at backfill priority, so live requests go first. Scopes
 * already waiting for a build (pending, failing or parked) and frozen ones
 * are left alone: a request would only wake a parked failure or freeze again.
 *
 * Bounds: at most `MAX_CENSUS` observed and `MAX_CENSUS` captured sessions,
 * in a daily-rotating order so a backlog drains over days, at most
 * `MAX_QUEUED` sessions and `MAX_REPOSITORIES` repositories queued per run,
 * and nothing more once the deadline is near. Older sessions are the edge
 * backfill's (`backfill:l1-edges`).
 */

const LOOKBACK_DAYS = 14;
const MAX_CENSUS = 2_000;
const MAX_QUEUED = 500;
const MAX_REPOSITORIES = 200;
const SCOPE_READ_BATCH = 1_000;
/** Leave this much of the deadline for the response; stop queueing without it. */
const MIN_REMAINING_MS = 2_000;
const SOURCES = new Set(["claude_code", "codex", "gemini"]);
const CENSUS_SETTINGS = {
	max_execution_time: 30,
	max_rows_to_read: "100000000",
	max_bytes_to_read: String(8 * 1024 * 1024 * 1024),
	max_result_rows: String(MAX_CENSUS),
	result_overflow_mode: "throw",
} as const;

const logger = getLogger(["rudel", "api", "l1-edges"]);

export type L1EdgeCensusReason =
	| "missing"
	| "unbuilt"
	| "resolver_version"
	| "generation";

export interface L1EdgeCensusResult {
	readonly enabled: boolean;
	readonly sessionCandidates: number;
	readonly sessionsQueued: number;
	readonly byReason: Record<L1EdgeCensusReason, number>;
	/** Waiting for a build already (pending, failing or parked): left alone. */
	readonly alreadyQueued: number;
	readonly repositoriesQueued: number;
	readonly hasMore: boolean;
}

/** The newest observation generation of a session, as builds record it. */
export interface ObservationGenerationKey {
	readonly revision: string;
	readonly parserVersion: number;
	readonly transcriptParserVersion: number;
}

export interface CensusSession {
	readonly organizationId: string;
	readonly userId: string;
	readonly source: string;
	readonly sessionId: string;
	/** Null for a session found only by its captures. */
	readonly observations: ObservationGenerationKey | null;
}

export const ObservedSessionSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
	revision_text: z.string(),
	parser_version: z.coerce.number(),
	transcript_parser_version: z.coerce.number(),
});

const ScopeStateSchema = z.object({
	scope_id: z.string(),
	built: z.boolean(),
	pending: z.boolean(),
	resolver_version: z.number().nullable(),
	frozen_reason: z.string().nullable(),
	input: z.unknown(),
});
export type SessionScopeState = z.infer<typeof ScopeStateSchema>;

const BuiltGenerationSchema = z.object({
	generation: z
		.object({
			revision: z.string(),
			parserVersion: z.number(),
			transcriptParserVersion: z.number(),
		})
		.nullable(),
});

/**
 * Why a session's edge scope needs a build, or null when it does not (or
 * a request would not help: waiting already, or frozen).
 */
export function classifySessionScope(
	state: SessionScopeState | undefined,
	observations: ObservationGenerationKey | null,
): L1EdgeCensusReason | "waiting" | null {
	if (!state) return "missing";
	if (state.pending) return "waiting";
	if (state.frozen_reason) return null;
	if (!state.built) return "unbuilt";
	if (state.resolver_version !== L1_EDGE_RESOLVER_VERSION)
		return "resolver_version";
	if (observations === null) return null;
	const input = BuiltGenerationSchema.safeParse(state.input);
	const built = input.success ? input.data.generation : null;
	return built?.revision === observations.revision &&
		built.parserVersion === observations.parserVersion &&
		built.transcriptParserVersion === observations.transcriptParserVersion
		? null
		: "generation";
}

/** Sessions with git observations published since `since`, newest generation each. */
export function buildObservedSessionsStatement(
	now: number,
	organizationId?: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: CENSUS_SETTINGS,
		query: `SELECT organization_id, user_id, source, session_id,
				toString(newest.1) AS revision_text, newest.2 AS parser_version, newest.3 AS transcript_parser_version
			FROM (
				SELECT organization_id, user_id, source, session_id,
					max(tuple(revision, parser_version, transcript_parser_version)) AS newest
				FROM ${getSafeClickHouseTable("rudel.session_git_observations")}
				WHERE ${receiptRow()} AND ts >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
					${organizationId === undefined ? "" : "AND organization_id = {organizationId:String}"}
				GROUP BY organization_id, user_id, source, session_id
			)
			ORDER BY cityHash64(session_id, {seed:String})
			LIMIT {limit:UInt32}`,
		query_params: {
			limit: MAX_CENSUS,
			organizationId: organizationId ?? "",
			seed: new Date(now).toISOString().slice(0, 10),
			since: now - LOOKBACK_DAYS * 86_400_000,
		},
	};
}

/** Re-queues the edge builds the census finds missing or stale. */
export async function requeueStaleL1EdgeScopes(options: {
	readonly sql: postgres.Sql;
	readonly deadline: MaintenanceDeadline;
	readonly executor?: ClickHouseExecutor;
	/** Narrows the census (tests and operators). */
	readonly organizationId?: string;
}): Promise<L1EdgeCensusResult> {
	const byReason: Record<L1EdgeCensusReason, number> = {
		missing: 0,
		unbuilt: 0,
		resolver_version: 0,
		generation: 0,
	};
	if (process.env.L1_EDGES_ENQUEUE_ENABLED === "false")
		return {
			enabled: false,
			sessionCandidates: 0,
			sessionsQueued: 0,
			byReason,
			alreadyQueued: 0,
			repositoriesQueued: 0,
			hasMore: false,
		};
	const { sql, deadline } = options;
	const timeLeft = () =>
		deadline.deadlineAt - deadline.now() >= MIN_REMAINING_MS;
	const executor = options.executor ?? getClickhouse();
	const now = deadline.now();

	const repositories = await sql.unsafe<
		{ organization_id: string; repository_id: string }[]
	>(
		`SELECT DISTINCT binding.organization_id, binding.repository_id
		 FROM github_repository_binding binding
		 INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id
		 WHERE binding.status = 'active' AND installation.status = 'active'
			AND ($1::text IS NULL OR binding.organization_id = $1::text)
			AND NOT EXISTS (
				SELECT 1 FROM l1_edge_scope scope
				WHERE scope.organization_id = binding.organization_id
					AND scope.scope_kind = 'repository' AND scope.scope_id = binding.repository_id
			)
		 ORDER BY binding.organization_id, binding.repository_id
		 LIMIT $2`,
		[options.organizationId ?? null, MAX_REPOSITORIES + 1],
	);
	let hasMore = repositories.length > MAX_REPOSITORIES;
	let repositoriesQueued = 0;
	for (const repository of repositories.slice(0, MAX_REPOSITORIES)) {
		if (!timeLeft()) {
			hasMore = true;
			break;
		}
		await enqueueL1EdgeScope(
			sql,
			{
				kind: "repository",
				organizationId: repository.organization_id,
				repositoryId: repository.repository_id,
			},
			{ priority: 1 },
		);
		repositoriesQueued++;
	}

	const observed = z
		.array(ObservedSessionSchema)
		.parse(
			await executor.query<unknown>(
				buildObservedSessionsStatement(now, options.organizationId),
			),
		);
	const captured = await sql.unsafe<
		{
			organization_id: string;
			user_id: string;
			source: string;
			session_id: string;
		}[]
	>(
		`SELECT DISTINCT organization_id, user_id, source, session_id
		 FROM repository_evidence_capture
		 WHERE created_at >= now() - $2::bigint * interval '1 millisecond'
			AND ($1::text IS NULL OR organization_id = $1::text)
		 LIMIT $3`,
		[options.organizationId ?? null, LOOKBACK_DAYS * 86_400_000, MAX_CENSUS],
	);
	hasMore ||= observed.length >= MAX_CENSUS || captured.length >= MAX_CENSUS;
	const sessions = mergeCensusSessions(observed, captured);

	let alreadyQueued = 0;
	let sessionsQueued = 0;
	for (const [organizationId, group] of groupByOrganization(sessions)) {
		if (sessionsQueued >= MAX_QUEUED || !timeLeft()) {
			hasMore = true;
			break;
		}
		const states = await readSessionScopes(sql, organizationId, group);
		const wanted: CensusSession[] = [];
		for (const session of group) {
			const reason = classifySessionScope(
				states.get(sessionScopeId(session)),
				session.observations,
			);
			if (reason === "waiting") alreadyQueued++;
			else if (reason !== null) {
				if (sessionsQueued + wanted.length >= MAX_QUEUED) {
					hasMore = true;
					break;
				}
				byReason[reason]++;
				wanted.push(session);
			}
		}
		if (wanted.length === 0) continue;
		try {
			await enqueueL1EdgeSessionScopes(sql, "session", organizationId, wanted, {
				priority: 1,
			});
			sessionsQueued += wanted.length;
		} catch (error) {
			logger.warn(
				"Edge census could not queue sessions of {organizationId}: {error}",
				{
					organizationId,
					error: error instanceof Error ? error.message : String(error),
				},
			);
		}
	}
	return {
		enabled: true,
		sessionCandidates: sessions.length,
		sessionsQueued,
		byReason,
		alreadyQueued,
		repositoriesQueued,
		hasMore,
	};
}

/** Observed and captured sessions, once each; captures carry no generation. */
export function mergeCensusSessions(
	observed: readonly z.infer<typeof ObservedSessionSchema>[],
	captured: readonly {
		organization_id: string;
		user_id: string;
		source: string;
		session_id: string;
	}[],
): CensusSession[] {
	const sessions = new Map<string, CensusSession>();
	const key = (row: (typeof captured)[number]) =>
		`${row.organization_id}\u0000${id(row)}`;
	for (const row of captured)
		if (SOURCES.has(row.source))
			sessions.set(key(row), {
				organizationId: row.organization_id,
				userId: row.user_id,
				source: row.source,
				sessionId: row.session_id,
				observations: null,
			});
	for (const row of observed)
		if (SOURCES.has(row.source))
			sessions.set(key(row), {
				organizationId: row.organization_id,
				userId: row.user_id,
				source: row.source,
				sessionId: row.session_id,
				observations: {
					revision: row.revision_text,
					parserVersion: row.parser_version,
					transcriptParserVersion: row.transcript_parser_version,
				},
			});
	return [...sessions.values()];
}

function id(row: { user_id: string; source: string; session_id: string }) {
	return sessionScopeId({
		userId: row.user_id,
		source: row.source,
		sessionId: row.session_id,
	});
}

async function readSessionScopes(
	sql: postgres.Sql,
	organizationId: string,
	sessions: readonly CensusSession[],
): Promise<Map<string, SessionScopeState>> {
	const ids = [...new Set(sessions.map((session) => sessionScopeId(session)))];
	const states = new Map<string, SessionScopeState>();
	for (let offset = 0; offset < ids.length; offset += SCOPE_READ_BATCH) {
		const rows = z.array(ScopeStateSchema).parse(
			await sql.unsafe(
				`SELECT scope_id, built_revision IS NOT NULL AS built,
					request_count > built_request_count AS pending,
					resolver_version, frozen_reason, input
				 FROM l1_edge_scope
				 WHERE organization_id = $1 AND scope_kind = 'session' AND scope_id = ANY($2::text[])`,
				[organizationId, ids.slice(offset, offset + SCOPE_READ_BATCH)],
			),
		);
		for (const row of rows) states.set(row.scope_id, row);
	}
	return states;
}

function groupByOrganization(
	sessions: readonly CensusSession[],
): Map<string, CensusSession[]> {
	const groups = new Map<string, CensusSession[]>();
	for (const session of sessions) {
		const group = groups.get(session.organizationId) ?? [];
		group.push(session);
		groups.set(session.organizationId, group);
	}
	return groups;
}
