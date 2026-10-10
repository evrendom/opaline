import { Buffer } from "node:buffer";
import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	enqueueL1EdgeScope,
	enqueueL1EdgeSessionScopes,
} from "./l1-edge-queue.service.js";

const SessionSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
});
type SessionRow = z.infer<typeof SessionSchema>;

const SOURCES = new Set(["claude_code", "codex"]);
const SELECTION_SETTINGS = {
	max_execution_time: 120,
	max_rows_to_read: "1000000000",
	max_bytes_to_read: String(16 * 1024 * 1024 * 1024),
	max_memory_usage: String(4 * 1024 * 1024 * 1024),
	result_overflow_mode: "throw",
} as const;

/** Where a run continues: the last session of the previous one, in key order. */
export interface L1EdgeBackfillCursor {
	readonly organizationId: string;
	readonly userId: string;
	readonly source: string;
	readonly sessionId: string;
}

export interface L1EdgeBackfillOptions {
	readonly organizationId?: string;
	readonly maxSessions: number;
	readonly after?: L1EdgeBackfillCursor;
}

export interface L1EdgeBackfillResult {
	status: "preview" | "queued";
	/** Active bindings queued (first run only: `after` unset). */
	repositories: number;
	sessions: number;
	observedSessions: number;
	capturedSessions: number;
	queued: boolean;
	/** More sessions remain: run again with `--after next`. */
	hasMore: boolean;
	next: string | null;
}

/**
 * Queues every active repository binding and every session with git
 * observations or CLI captures for an L1 edge build, at backfill priority so
 * live changes go first. Repositories come first so GitHub-side edges exist
 * when sessions resolve, and are queued only by the first run of a series
 * (`after` unset), since each repository build re-queues its dependents.
 * Sessions are taken in key order, at most `maxSessions` per run, from one
 * bounded ClickHouse statement and one Postgres statement; `next` names
 * where the following run continues. Queueing is idempotent; the worker does
 * the work. A preview reads and counts, and writes nothing.
 */
export async function backfillL1Edges(
	executor: ClickHouseExecutor,
	sql: postgres.Sql,
	options: L1EdgeBackfillOptions,
	execute: boolean,
): Promise<L1EdgeBackfillResult> {
	if (!Number.isSafeInteger(options.maxSessions) || options.maxSessions < 1)
		throw new Error("maxSessions must be a positive integer");
	if (options.organizationId !== undefined && options.organizationId === "")
		throw new Error("organizationId must not be empty");
	if (
		options.after &&
		options.organizationId !== undefined &&
		options.after.organizationId !== options.organizationId
	)
		throw new Error("after must name a session of organizationId");
	const after = options.after;
	const repositories =
		after === undefined
			? await sql.unsafe<{ organization_id: string; repository_id: string }[]>(
					`SELECT DISTINCT binding.organization_id, binding.repository_id
					 FROM github_repository_binding binding
					 INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id
					 WHERE binding.status = 'active' AND installation.status = 'active'
						AND ($1::text IS NULL OR binding.organization_id = $1::text)
					 ORDER BY binding.organization_id, binding.repository_id`,
					[options.organizationId ?? null],
				)
			: [];
	const observed = z.array(SessionSchema).parse(
		await executor.query<unknown>({
			clickhouse_settings: {
				...SELECTION_SETTINGS,
				max_result_rows: String(options.maxSessions),
			},
			query: `SELECT organization_id, user_id, source, session_id
				FROM ${getSafeClickHouseTable("rudel.session_git_observations")}
				WHERE kind = 'receipt'
					${options.organizationId ? "AND organization_id = {organizationId:String}" : ""}
					${after ? "AND (organization_id, user_id, source, session_id) > ({afterOrganizationId:String}, {afterUserId:String}, {afterSource:String}, {afterSessionId:String})" : ""}
				GROUP BY organization_id, user_id, source, session_id
				ORDER BY organization_id, user_id, source, session_id
				LIMIT {limit:UInt32}`,
			query_params: {
				afterOrganizationId: after?.organizationId ?? "",
				afterSessionId: after?.sessionId ?? "",
				afterSource: after?.source ?? "",
				afterUserId: after?.userId ?? "",
				limit: options.maxSessions,
				organizationId: options.organizationId ?? "",
			},
		}),
	);
	// Byte order, as ClickHouse compares strings, so both lists page alike.
	const captured = z.array(SessionSchema).parse(
		await sql.unsafe(
			`SELECT DISTINCT organization_id COLLATE "C" AS organization_id, user_id COLLATE "C" AS user_id,
				source COLLATE "C" AS source, session_id COLLATE "C" AS session_id
			 FROM repository_evidence_capture
			 WHERE ($1::text IS NULL OR organization_id = $1::text)
				AND ($3::text IS NULL OR (organization_id COLLATE "C", user_id COLLATE "C", source COLLATE "C", session_id COLLATE "C")
					> ($3::text COLLATE "C", $4::text COLLATE "C", $5::text COLLATE "C", $6::text COLLATE "C"))
			 ORDER BY 1, 2, 3, 4
			 LIMIT $2`,
			[
				options.organizationId ?? null,
				options.maxSessions,
				after?.organizationId ?? null,
				after?.userId ?? null,
				after?.source ?? null,
				after?.sessionId ?? null,
			],
		),
	);
	const merged = new Map<string, SessionRow>();
	for (const row of [...observed, ...captured])
		if (SOURCES.has(row.source)) merged.set(sessionKey(row), row);
	const ordered = [...merged.entries()]
		.sort(([left], [right]) =>
			Buffer.compare(Buffer.from(left), Buffer.from(right)),
		)
		.map(([, row]) => row);
	const selected = ordered.slice(0, options.maxSessions);
	const hasMore =
		ordered.length > options.maxSessions ||
		observed.length >= options.maxSessions ||
		captured.length >= options.maxSessions;
	const last = selected.at(-1);
	if (execute) {
		for (const repository of repositories)
			await enqueueL1EdgeScope(
				sql,
				{
					kind: "repository",
					organizationId: repository.organization_id,
					repositoryId: repository.repository_id,
				},
				{ priority: 1 },
			);
		const byOrganization = new Map<string, SessionRow[]>();
		for (const row of selected) {
			const group = byOrganization.get(row.organization_id) ?? [];
			group.push(row);
			byOrganization.set(row.organization_id, group);
		}
		for (const [organizationId, rows] of byOrganization)
			await enqueueL1EdgeSessionScopes(
				sql,
				"session",
				organizationId,
				rows.map((row) => ({
					userId: row.user_id,
					source: row.source,
					sessionId: row.session_id,
				})),
				{ priority: 1 },
			);
	}
	return {
		status: execute ? "queued" : "preview",
		repositories: repositories.length,
		sessions: selected.length,
		observedSessions: observed.length,
		capturedSessions: captured.length,
		queued: execute,
		hasMore,
		next:
			hasMore && last
				? encodeL1EdgeBackfillCursor({
						organizationId: last.organization_id,
						userId: last.user_id,
						source: last.source,
						sessionId: last.session_id,
					})
				: null,
	};
}

/** The key sessions are ordered by: workspace, user, source, session. */
function sessionKey(row: SessionRow): string {
	return [row.organization_id, row.user_id, row.source, row.session_id].join(
		"\u0000",
	);
}

export function encodeL1EdgeBackfillCursor(
	cursor: L1EdgeBackfillCursor,
): string {
	return Buffer.from(
		JSON.stringify([
			cursor.organizationId,
			cursor.userId,
			cursor.source,
			cursor.sessionId,
		]),
	).toString("base64url");
}

export function decodeL1EdgeBackfillCursor(
	value: string,
): L1EdgeBackfillCursor {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		parsed = undefined;
	}
	const tuple = z
		.tuple([
			z.string().min(1),
			z.string().min(1),
			z.string().min(1),
			z.string().min(1),
		])
		.safeParse(parsed);
	if (!tuple.success)
		throw new Error("--after must be the `next` value a previous run printed.");
	const [organizationId, userId, source, sessionId] = tuple.data;
	return { organizationId, userId, source, sessionId };
}
