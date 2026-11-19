import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../../lib/bounded-maintenance.js";
import type { R2StorageClient } from "../r2-ingest-storage.service.js";
import {
	LIVE_SESSION_OBJECT_PREFIX,
	liveSessionOrganizationPrefix,
} from "./live-session-lines.js";

const logger = getLogger(["rudel", "api", "live-session-cleanup"]);

/** Live sessions are deleted this long after their last activity. */
export const LIVE_SESSION_RETENTION_MS = 72 * 60 * 60 * 1000;
/** An object without a chunk row this old is an orphan (its append failed). */
export const LIVE_SESSION_ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const SESSION_BATCH_SIZE = 25;
// S3 DeleteObjects and ListObjectsV2 take and return at most 1,000 keys.
const MAX_R2_KEYS_PER_CALL = 1_000;
/** Objects the orphan sweep lists per run; it starts at a random key. */
const ORPHAN_SWEEP_MAX_LISTED_OBJECTS = 10_000;

export type LiveSessionR2Cleaner = Pick<
	R2StorageClient,
	"deleteObjects" | "listObjects"
>;

export interface LiveSessionCleanupEnv {
	readonly database: postgres.Sql;
	readonly deadline: MaintenanceDeadline;
	readonly now: () => Date;
	readonly r2: LiveSessionR2Cleaner;
	/** Picks where the orphan sweep starts in the key space (0 ≤ n < 1). */
	readonly random?: () => number;
}

export interface LiveSessionCleanupResult {
	readonly deletedChunks: number;
	readonly deletedOrphans: number;
	readonly deletedSessions: number;
	readonly failedSessions: number;
	readonly hasMore: boolean;
}

/**
 * Hourly: deletes sessions quiet for 72 hours, R2 objects first, then the
 * rows (streams and chunks cascade); the chunks of superseded stream
 * generations (a reset never reads them again); and orphaned objects, written
 * by appends whose transaction then failed. Objects go before rows, so an
 * interrupted pass leaves rows that the next pass deletes again. A failure in
 * one session or step is logged and the rest still runs.
 */
export async function cleanupLiveSessions(
	env: LiveSessionCleanupEnv,
): Promise<LiveSessionCleanupResult> {
	const sessions = await deleteExpiredSessions(env);
	const chunks = await runStep("superseded-chunks", () =>
		deleteSupersededChunks(env),
	);
	const orphans = await runStep("orphaned-objects", () =>
		deleteOrphanedObjects(env),
	);
	return {
		deletedChunks: chunks?.deleted ?? 0,
		deletedOrphans: orphans?.deleted ?? 0,
		deletedSessions: sessions.deleted,
		failedSessions: sessions.failed,
		hasMore:
			sessions.hasMore ||
			(chunks?.hasMore ?? true) ||
			(orphans?.hasMore ?? true),
	};
}

/**
 * Every live session object of a deleted workspace, found by its key prefix
 * rather than by rows, so objects whose rows never committed go too. Runs on
 * every pass of the workspace's purge.
 */
export async function purgeLiveSessionObjectsOfOrganization(
	organizationId: string,
	r2: LiveSessionR2Cleaner,
): Promise<number> {
	const prefix = liveSessionOrganizationPrefix(organizationId);
	let deleted = 0;
	let continuationToken: string | undefined;
	do {
		const page = await r2.listObjects({
			continuationToken,
			maxKeys: MAX_R2_KEYS_PER_CALL,
			prefix,
		});
		const keys = page.objects.map((object) => object.key);
		if (keys.length > 0) await r2.deleteObjects(keys);
		deleted += keys.length;
		continuationToken = page.nextContinuationToken ?? undefined;
	} while (continuationToken);
	return deleted;
}

async function deleteExpiredSessions(env: LiveSessionCleanupEnv): Promise<{
	deleted: number;
	failed: number;
	hasMore: boolean;
}> {
	const cutoff = new Date(env.now().getTime() - LIVE_SESSION_RETENTION_MS);
	let deleted = 0;
	let failed = 0;
	const failedKeys = new Set<string>();
	while (hasMaintenanceTimeRemaining(env.deadline)) {
		const candidates = await env.database<
			Array<{ organizationId: string; sessionId: string; source: string }>
		>`
			SELECT
				organization_id AS "organizationId",
				source,
				session_id AS "sessionId"
			FROM live_session
			WHERE last_activity_at < ${cutoff.toISOString()}::timestamptz
			ORDER BY last_activity_at
			LIMIT ${SESSION_BATCH_SIZE + failedKeys.size}
		`;
		const pending = candidates.filter(
			(candidate) => !failedKeys.has(sessionKey(candidate)),
		);
		if (pending.length === 0) {
			return { deleted, failed, hasMore: failed > 0 };
		}
		let progressed = false;
		for (const candidate of pending) {
			if (!hasMaintenanceTimeRemaining(env.deadline)) break;
			try {
				if (await deleteExpiredSession(candidate, cutoff, env)) {
					deleted += 1;
					progressed = true;
				}
			} catch (error) {
				failed += 1;
				failedKeys.add(sessionKey(candidate));
				progressed = true;
				logger.warn(
					"Live session cleanup could not delete a session; the next run retries it: {error}",
					{ error: String(error) },
				);
			}
		}
		// Every candidate was resumed or is being written: try next hour.
		if (!progressed) return { deleted, failed, hasMore: true };
	}
	return { deleted, failed, hasMore: true };
}

/**
 * Holds the session's row lock, which every append takes first, so a session
 * that resumes meanwhile is either kept (its activity moved on) or waits and
 * starts over as a new session.
 */
async function deleteExpiredSession(
	session: { organizationId: string; sessionId: string; source: string },
	cutoff: Date,
	env: LiveSessionCleanupEnv,
): Promise<boolean> {
	return env.database.begin(async (transaction) => {
		const [locked] = await transaction.unsafe<Array<{ found: number }>>(
			`
				SELECT 1 AS found
				FROM live_session
				WHERE organization_id = $1
					AND session_id = $2
					AND source = $3
					AND last_activity_at < $4::timestamptz
				FOR UPDATE SKIP LOCKED
			`,
			[
				session.organizationId,
				session.sessionId,
				session.source,
				cutoff.toISOString(),
			],
		);
		if (!locked) return false;
		const chunks = await transaction.unsafe<Array<{ objectKey: string }>>(
			`
				SELECT object_key AS "objectKey"
				FROM live_session_chunk
				WHERE organization_id = $1 AND session_id = $2 AND source = $3
			`,
			[session.organizationId, session.sessionId, session.source],
		);
		await deleteObjects(
			chunks.map((chunk) => chunk.objectKey),
			env.r2,
		);
		await transaction.unsafe(
			"DELETE FROM live_session WHERE organization_id = $1 AND session_id = $2 AND source = $3",
			[session.organizationId, session.sessionId, session.source],
		);
		return true;
	});
}

async function deleteSupersededChunks(
	env: LiveSessionCleanupEnv,
): Promise<{ deleted: number; hasMore: boolean }> {
	let deleted = 0;
	while (hasMaintenanceTimeRemaining(env.deadline)) {
		// Generations only grow, and appends write only the current one, so a
		// superseded chunk can never be written or read again. Only reset
		// streams (generation > 0, a partial index) can have such chunks.
		const chunks = await env.database<
			Array<{
				agentId: string;
				generation: number;
				objectKey: string;
				organizationId: string;
				sessionId: string;
				source: string;
				startLine: number;
			}>
		>`
			SELECT
				chunk.organization_id AS "organizationId",
				chunk.source,
				chunk.session_id AS "sessionId",
				chunk.agent_id AS "agentId",
				chunk.generation,
				chunk.start_line AS "startLine",
				chunk.object_key AS "objectKey"
			FROM live_session_stream stream
			INNER JOIN live_session_chunk chunk
				ON chunk.organization_id = stream.organization_id
				AND chunk.source = stream.source
				AND chunk.session_id = stream.session_id
				AND chunk.agent_id = stream.agent_id
				AND chunk.generation < stream.generation
			WHERE stream.generation > 0
			LIMIT ${MAX_R2_KEYS_PER_CALL}
		`;
		if (chunks.length === 0) return { deleted, hasMore: false };
		await env.r2.deleteObjects(chunks.map((chunk) => chunk.objectKey));
		await env.database`
			DELETE FROM live_session_chunk chunk
			USING unnest(
				${chunks.map((chunk) => chunk.organizationId)}::text[],
				${chunks.map((chunk) => chunk.source)}::text[],
				${chunks.map((chunk) => chunk.sessionId)}::text[],
				${chunks.map((chunk) => chunk.agentId)}::text[],
				${chunks.map((chunk) => chunk.generation)}::int[],
				${chunks.map((chunk) => chunk.startLine)}::int[]
			) AS superseded(organization_id, source, session_id, agent_id, generation, start_line)
			WHERE chunk.organization_id = superseded.organization_id
				AND chunk.source = superseded.source
				AND chunk.session_id = superseded.session_id
				AND chunk.agent_id = superseded.agent_id
				AND chunk.generation = superseded.generation
				AND chunk.start_line = superseded.start_line
		`;
		deleted += chunks.length;
	}
	return { deleted, hasMore: true };
}

/**
 * Lists up to 10,000 live objects from a random point of the key space
 * (wrapping around once) and deletes those older than an hour that no chunk
 * row names. Appends write an object just before its row, under the session
 * lock, and delete it when the transaction fails, so an object this old
 * without a row was left by a failed append (or a crash between the write and
 * the commit). Over the hourly runs every key is visited.
 */
async function deleteOrphanedObjects(
	env: LiveSessionCleanupEnv,
): Promise<{ deleted: number; hasMore: boolean }> {
	const random = env.random ?? Math.random;
	const startAfter = `${LIVE_SESSION_OBJECT_PREFIX}${Math.floor(random() * 256)
		.toString(16)
		.padStart(2, "0")}`;
	const olderThan = env.now().getTime() - LIVE_SESSION_ORPHAN_MIN_AGE_MS;
	let deleted = 0;
	let listed = 0;
	// First from the random start to the end, then from the beginning to it.
	for (const range of [
		{ startAfter, until: undefined },
		{ startAfter: undefined, until: startAfter },
	]) {
		let continuationToken: string | undefined;
		do {
			if (
				listed >= ORPHAN_SWEEP_MAX_LISTED_OBJECTS ||
				!hasMaintenanceTimeRemaining(env.deadline)
			) {
				return { deleted, hasMore: true };
			}
			const page = await env.r2.listObjects({
				continuationToken,
				maxKeys: MAX_R2_KEYS_PER_CALL,
				prefix: LIVE_SESSION_OBJECT_PREFIX,
				startAfter: continuationToken ? undefined : range.startAfter,
			});
			const objects = page.objects.filter(
				(object) => range.until === undefined || object.key <= range.until,
			);
			listed += objects.length;
			const old = objects
				.filter((object) => object.lastModified.getTime() < olderThan)
				.map((object) => object.key);
			if (old.length > 0) {
				const known = await env.database<Array<{ objectKey: string }>>`
					SELECT object_key AS "objectKey"
					FROM live_session_chunk
					WHERE object_key = ANY(${old}::text[])
				`;
				const knownKeys = new Set(known.map((row) => row.objectKey));
				const orphans = old.filter((key) => !knownKeys.has(key));
				if (orphans.length > 0) await env.r2.deleteObjects(orphans);
				deleted += orphans.length;
			}
			continuationToken =
				objects.length === page.objects.length
					? (page.nextContinuationToken ?? undefined)
					: undefined;
		} while (continuationToken);
	}
	return { deleted, hasMore: false };
}

async function runStep<T>(
	step: string,
	run: () => Promise<T>,
): Promise<T | undefined> {
	try {
		return await run();
	} catch (error) {
		logger.warn(
			"Live session cleanup step {step} failed; the next run retries it: {error}",
			{ error: String(error), step },
		);
		return undefined;
	}
}

async function deleteObjects(
	objectKeys: readonly string[],
	r2: LiveSessionR2Cleaner,
): Promise<void> {
	for (
		let index = 0;
		index < objectKeys.length;
		index += MAX_R2_KEYS_PER_CALL
	) {
		await r2.deleteObjects(
			objectKeys.slice(index, index + MAX_R2_KEYS_PER_CALL),
		);
	}
}

function sessionKey(session: {
	organizationId: string;
	sessionId: string;
	source: string;
}): string {
	return JSON.stringify([
		session.organizationId,
		session.source,
		session.sessionId,
	]);
}
