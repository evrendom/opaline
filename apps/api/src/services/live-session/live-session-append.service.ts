import { getLogger } from "@logtape/logtape";
import type {
	LiveSessionAppendInput,
	LiveSessionAppendOutput,
	LiveSessionSource,
	LiveSessionStateOutput,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { R2EvidenceStorageClient } from "../r2-ingest-storage.service.js";
import {
	type LiveSessionGate,
	LiveSessionStorageError,
} from "./live-session-gate.js";
import {
	buildLiveSessionChunkObjectKey,
	encodeLiveSessionChunk,
	filterLiveSessionLine,
	fromAgentKey,
	sha256Line,
	toAgentKey,
	validateLiveSessionAppend,
} from "./live-session-lines.js";
import { liveSessionR2Signal } from "./live-session-r2.js";

const logger = getLogger(["rudel", "api", "live-session"]);
// Appends to one session serialize on its row. One follower writes a session,
// so a wait is short; a stuck holder must not pile requests up behind it.
const SESSION_LOCK_TIMEOUT = "15s";
const R2_PUT_CONCURRENCY = 8;

export type LiveSessionR2Writer = Pick<
	R2EvidenceStorageClient,
	"deleteObjects" | "putObject"
>;

/** A live session: Claude Code session ids and Codex thread ids are separate. */
export interface LiveSessionTarget {
	readonly organizationId: string;
	readonly sessionId: string;
	readonly source: LiveSessionSource;
	readonly userId: string;
}

export interface LiveSessionAppendEnv {
	readonly database: postgres.Sql;
	/** Bounds the append transactions holding live pool connections. */
	readonly gate: LiveSessionGate;
	readonly now: () => Date;
	readonly r2: LiveSessionR2Writer;
	readonly signal?: AbortSignal;
}

/** The session belongs to another member (live or uploaded). */
export class LiveSessionOwnershipConflictError extends Error {
	constructor() {
		super("The session belongs to another organization member");
		this.name = "LiveSessionOwnershipConflictError";
	}
}

type AppendStatus = LiveSessionAppendOutput["streams"][number]["status"];

interface StreamState {
	readonly committedBytes: number;
	readonly committedLines: number;
	readonly exists: boolean;
	readonly generation: number;
	readonly lastLineSha256: string | null;
}

interface StreamDecision {
	readonly agentId: string | null;
	readonly appendedLines: readonly string[];
	readonly chunk: PendingChunk | null;
	readonly next: StreamState;
	readonly reset: boolean;
	readonly status: AppendStatus;
}

interface PendingChunk {
	readonly body: Uint8Array;
	readonly lineCount: number;
	readonly objectKey: string;
	readonly startLine: number;
}

const EMPTY_STREAM: StreamState = {
	committedBytes: 0,
	committedLines: 0,
	exists: false,
	generation: 0,
	lastLineSha256: null,
};

/**
 * Applies one append request in two steps, so no database connection or
 * lock waits on R2:
 *
 * 1. Without locks, it reads the committed state, decides what the request
 *    would append, and writes those chunks to R2. Object keys name their
 *    bytes, so a write never replaces a committed chunk.
 * 2. In one transaction holding the session's row lock (and the streams'),
 *    it decides again and commits a chunk row only for an object it wrote
 *    for exactly that decision (a state that moved in between is written
 *    then, under the lock). Objects it wrote but did not commit are deleted
 *    afterwards; the hourly orphan sweep catches any that survive.
 */
export async function appendLiveSession(
	target: LiveSessionTarget,
	input: LiveSessionAppendInput,
	env: LiveSessionAppendEnv,
): Promise<LiveSessionAppendOutput> {
	validateLiveSessionAppend(input);
	await assertNoUploadedSessionConflict(target, env.database);
	// Filtering is CPU work: done before the session lock is taken. Lines of
	// streams that turn out to be retries are filtered for nothing. It runs on
	// this thread, not through the ingest filter queue: that queue is shared
	// with uploads and first-come first-served, so a live append would wait
	// behind seconds of upload filtering, while one append is bounded at
	// 1.5 MiB and 20,000 lines (tens of milliseconds).
	const storedLines = input.streams.map((stream) =>
		stream.lines.map(filterLiveSessionLine),
	);
	const plan = (states: Map<string, StreamState>) =>
		input.streams.map((stream, index) =>
			withChunk(
				target,
				decideStream(
					stream,
					states.get(toAgentKey(stream.agentId)) ?? EMPTY_STREAM,
				),
				storedLines[index] ?? [],
			),
		);

	const snapshot = await readCommittedStreams(target, input, env.database);
	if (snapshot.ownerId !== null && snapshot.ownerId !== target.userId) {
		throw new LiveSessionOwnershipConflictError();
	}
	const written = new Map<string, PendingChunk>();
	await putChunks(chunksOf(plan(snapshot.states)), written, env);

	let committed: {
		decisions: StreamDecision[];
		output: LiveSessionAppendOutput;
	};
	try {
		committed = await env.gate.run(() =>
			env.database.begin(async (transaction) => {
				await transaction.unsafe(
					`SET LOCAL lock_timeout = '${SESSION_LOCK_TIMEOUT}'`,
				);
				let session = await lockSession(target, transaction);
				if (!session) {
					// Only lines that start a stream can create the session;
					// anything else is answered against empty streams.
					if (!input.streams.some(startsEmptyStream)) {
						const decisions = plan(new Map());
						return {
							decisions: [],
							output: toOutput(input, decisions),
						};
					}
					await insertSession(target, input, env.now(), transaction);
					session = await lockSession(target, transaction);
				}
				if (!session || session.userId !== target.userId) {
					throw new LiveSessionOwnershipConflictError();
				}
				const decisions = plan(await lockStreams(target, input, transaction));
				// The state moved between the read and the lock: rare.
				await putChunks(
					chunksOf(decisions).filter((chunk) => !written.has(chunk.objectKey)),
					written,
					env,
				);
				await persistDecisions(target, decisions, env.now(), transaction);
				await updateSession(
					target,
					input,
					decisions,
					session.ended,
					env.now(),
					transaction,
				);
				return { decisions, output: toOutput(input, decisions) };
			}),
		);
	} catch (error) {
		await deleteChunks([...written.values()], env);
		throw error;
	}
	const committedKeys = new Set(
		chunksOf(committed.decisions).map((chunk) => chunk.objectKey),
	);
	await deleteChunks(
		[...written.values()].filter(
			(chunk) => !committedKeys.has(chunk.objectKey),
		),
		env,
	);
	return committed.output;
}

/**
 * The committed state of the caller's session: whether it ended and every
 * stream, main transcript first, then subagents by id. An unknown session
 * has no streams.
 */
export async function readLiveSessionState(
	target: LiveSessionTarget,
	env: { readonly database: postgres.Sql },
): Promise<LiveSessionStateOutput> {
	await assertNoUploadedSessionConflict(target, env.database);
	const [session] = await env.database<
		Array<{ ended: boolean; userId: string }>
	>`
		SELECT user_id AS "userId", ended_at IS NOT NULL AS ended
		FROM live_session
		WHERE organization_id = ${target.organizationId}
			AND source = ${target.source}
			AND session_id = ${target.sessionId}
	`;
	if (!session) return { ended: false, streams: [] };
	if (session.userId !== target.userId) {
		throw new LiveSessionOwnershipConflictError();
	}
	const streams = await env.database<
		Array<{
			agentId: string;
			committedLines: number;
			lastLineSha256: string | null;
		}>
	>`
		SELECT
			agent_id AS "agentId",
			committed_lines AS "committedLines",
			last_line_sha256 AS "lastLineSha256"
		FROM live_session_stream
		WHERE organization_id = ${target.organizationId}
			AND source = ${target.source}
			AND session_id = ${target.sessionId}
		ORDER BY agent_id = '' DESC, agent_id COLLATE "C"
	`;
	return {
		ended: session.ended,
		streams: streams.map((stream) => ({
			agentId: fromAgentKey(stream.agentId),
			committedLines: stream.committedLines,
			lastLineSha256: stream.lastLineSha256,
		})),
	};
}

/** Rules 1–4 of the append protocol for one stream, without side effects. */
function decideStream(
	stream: LiveSessionAppendInput["streams"][number],
	current: StreamState,
): StreamDecision {
	const reset = stream.reset === true;
	const state: StreamState = reset
		? {
				committedBytes: 0,
				committedLines: 0,
				exists: current.exists,
				generation: current.exists ? current.generation + 1 : 0,
				lastLineSha256: null,
			}
		: current;
	const unchanged = {
		agentId: stream.agentId,
		appendedLines: [],
		chunk: null,
		next: state,
		reset: reset && current.exists,
	} as const;

	if (
		stream.startLine === state.committedLines &&
		stream.previousLineSha256 === state.lastLineSha256
	) {
		const lastLine = stream.lines.at(-1);
		if (lastLine === undefined) {
			return { ...unchanged, status: "already-committed" };
		}
		return {
			...unchanged,
			appendedLines: stream.lines,
			next: {
				...state,
				committedLines: state.committedLines + stream.lines.length,
				lastLineSha256: sha256Line(lastLine),
			},
			status: "appended",
		};
	}
	const lastLine = stream.lines.at(-1);
	if (
		lastLine !== undefined &&
		stream.startLine + stream.lines.length === state.committedLines &&
		sha256Line(lastLine) === state.lastLineSha256
	) {
		return { ...unchanged, status: "already-committed" };
	}
	return { ...unchanged, status: "out-of-sync" };
}

/** Prepares the chunk object an append's stored (filtered) lines become. */
function withChunk(
	target: LiveSessionTarget,
	decision: StreamDecision,
	storedLines: readonly string[],
): StreamDecision {
	if (decision.appendedLines.length === 0) return decision;
	if (storedLines.length !== decision.appendedLines.length) {
		throw new Error("Filtered live session lines do not match the append");
	}
	const startLine =
		decision.next.committedLines - decision.appendedLines.length;
	const body = encodeLiveSessionChunk(storedLines);
	return {
		...decision,
		chunk: {
			body,
			lineCount: decision.appendedLines.length,
			objectKey: buildLiveSessionChunkObjectKey({
				agentId: decision.agentId,
				body,
				generation: decision.next.generation,
				organizationId: target.organizationId,
				sessionId: target.sessionId,
				source: target.source,
				startLine,
			}),
			startLine,
		},
		next: {
			...decision.next,
			committedBytes: decision.next.committedBytes + body.byteLength,
		},
	};
}

/** Writes the chunks to R2, recording each in `written` before its write. */
async function putChunks(
	chunks: readonly PendingChunk[],
	written: Map<string, PendingChunk>,
	env: LiveSessionAppendEnv,
): Promise<void> {
	try {
		for (let index = 0; index < chunks.length; index += R2_PUT_CONCURRENCY) {
			await Promise.all(
				chunks.slice(index, index + R2_PUT_CONCURRENCY).map((chunk) => {
					written.set(chunk.objectKey, chunk);
					return env.r2.putObject({
						body: chunk.body,
						contentType: "application/x-ndjson",
						metadata: {},
						objectKey: chunk.objectKey,
						signal: liveSessionR2Signal(env.signal),
					});
				}),
			);
		}
	} catch (error) {
		await deleteChunks([...written.values()], env);
		throw new LiveSessionStorageError(error);
	}
}

/** Best effort: the hourly orphan sweep removes what this misses. */
async function deleteChunks(
	chunks: readonly PendingChunk[],
	env: LiveSessionAppendEnv,
): Promise<void> {
	if (chunks.length === 0) return;
	try {
		await env.r2.deleteObjects(chunks.map((chunk) => chunk.objectKey));
	} catch (error) {
		logger.warn(
			"Could not delete uncommitted live session chunks ({count}): {error}",
			{ count: chunks.length, error: String(error) },
		);
	}
}

async function persistDecisions(
	target: LiveSessionTarget,
	decisions: readonly StreamDecision[],
	now: Date,
	transaction: postgres.TransactionSql,
): Promise<void> {
	for (const decision of decisions) {
		if (!decision.chunk && !decision.reset) continue;
		const agentKey = toAgentKey(decision.agentId);
		await transaction.unsafe(
			`
				INSERT INTO live_session_stream (
					organization_id, session_id, agent_id, generation, committed_lines,
					committed_bytes, last_line_sha256, updated_at, source
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)
				ON CONFLICT (organization_id, source, session_id, agent_id) DO UPDATE
				SET
					generation = EXCLUDED.generation,
					committed_lines = EXCLUDED.committed_lines,
					committed_bytes = EXCLUDED.committed_bytes,
					last_line_sha256 = EXCLUDED.last_line_sha256,
					updated_at = EXCLUDED.updated_at
			`,
			[
				target.organizationId,
				target.sessionId,
				agentKey,
				decision.next.generation,
				decision.next.committedLines,
				decision.next.committedBytes,
				decision.next.lastLineSha256,
				now.toISOString(),
				target.source,
			],
		);
		if (!decision.chunk) continue;
		await transaction.unsafe(
			`
				INSERT INTO live_session_chunk (
					organization_id, session_id, agent_id, generation, start_line,
					line_count, byte_length, object_key, created_at, source
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10)
			`,
			[
				target.organizationId,
				target.sessionId,
				agentKey,
				decision.next.generation,
				decision.chunk.startLine,
				decision.chunk.lineCount,
				decision.chunk.body.byteLength,
				decision.chunk.objectKey,
				now.toISOString(),
				target.source,
			],
		);
	}
}

/**
 * Activity moves on with every change. `ended: true` ends the session (an
 * already ended one stays as it was); new lines without it resume an ended
 * one. Project and git details follow the latest lines.
 */
async function updateSession(
	target: LiveSessionTarget,
	input: LiveSessionAppendInput,
	decisions: readonly StreamDecision[],
	wasEnded: boolean,
	now: Date,
	transaction: postgres.TransactionSql,
): Promise<void> {
	const appendedLines = decisions.some((decision) => decision.chunk !== null);
	const changed =
		appendedLines ||
		decisions.some((decision) => decision.reset) ||
		(input.ended === true && !wasEnded);
	if (!changed) return;
	const ended = input.ended === true;
	await transaction.unsafe(
		`
			UPDATE live_session
			SET
				last_activity_at = $3::timestamptz,
				ended_at = CASE
					WHEN $4::boolean THEN CASE WHEN $5::boolean THEN $3::timestamptz ELSE NULL END
					WHEN $5::boolean THEN COALESCE(ended_at, $3::timestamptz)
					ELSE ended_at
				END,
				project_path = CASE WHEN $4::boolean THEN $6 ELSE project_path END,
				git_remote = CASE WHEN $4::boolean THEN COALESCE($7, git_remote) ELSE git_remote END,
				git_branch = CASE WHEN $4::boolean THEN COALESCE($8, git_branch) ELSE git_branch END
			WHERE organization_id = $1 AND session_id = $2 AND source = $9
		`,
		[
			target.organizationId,
			target.sessionId,
			now.toISOString(),
			appendedLines,
			ended,
			input.projectPath,
			input.gitRemote ?? null,
			input.gitBranch ?? null,
			target.source,
		],
	);
}

async function insertSession(
	target: LiveSessionTarget,
	input: LiveSessionAppendInput,
	startedAt: Date,
	transaction: postgres.TransactionSql,
): Promise<void> {
	await transaction.unsafe(
		`
			INSERT INTO live_session (
				organization_id, session_id, source, user_id, project_path,
				git_remote, git_branch, started_at, last_activity_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz)
			ON CONFLICT (organization_id, source, session_id) DO NOTHING
		`,
		[
			target.organizationId,
			target.sessionId,
			target.source,
			target.userId,
			input.projectPath,
			input.gitRemote ?? null,
			input.gitBranch ?? null,
			startedAt.toISOString(),
		],
	);
}

async function lockSession(
	target: LiveSessionTarget,
	transaction: postgres.TransactionSql,
): Promise<{ ended: boolean; userId: string } | undefined> {
	const [session] = await transaction.unsafe<
		Array<{ ended: boolean; userId: string }>
	>(
		`
			SELECT user_id AS "userId", ended_at IS NOT NULL AS ended
			FROM live_session
			WHERE organization_id = $1 AND session_id = $2 AND source = $3
			FOR UPDATE
		`,
		[target.organizationId, target.sessionId, target.source],
	);
	return session;
}

/** The committed state as it stands, without locks: what step 1 writes for. */
async function readCommittedStreams(
	target: LiveSessionTarget,
	input: LiveSessionAppendInput,
	database: postgres.Sql,
): Promise<{ ownerId: string | null; states: Map<string, StreamState> }> {
	const [session] = await database<Array<{ userId: string }>>`
		SELECT user_id AS "userId"
		FROM live_session
		WHERE organization_id = ${target.organizationId}
			AND session_id = ${target.sessionId}
			AND source = ${target.source}
	`;
	return {
		ownerId: session?.userId ?? null,
		states: session
			? await selectStreams(target, input, database, "")
			: new Map(),
	};
}

function lockStreams(
	target: LiveSessionTarget,
	input: LiveSessionAppendInput,
	transaction: postgres.TransactionSql,
): Promise<Map<string, StreamState>> {
	return selectStreams(target, input, transaction, "FOR UPDATE");
}

async function selectStreams(
	target: LiveSessionTarget,
	input: LiveSessionAppendInput,
	database: postgres.Sql | postgres.TransactionSql,
	lock: "" | "FOR UPDATE",
): Promise<Map<string, StreamState>> {
	const agentKeys = input.streams.map((stream) => toAgentKey(stream.agentId));
	if (agentKeys.length === 0) return new Map();
	const rows = await database.unsafe<
		Array<{
			agentId: string;
			committedBytes: string;
			committedLines: number;
			generation: number;
			lastLineSha256: string | null;
		}>
	>(
		`
			SELECT
				agent_id AS "agentId",
				generation,
				committed_lines AS "committedLines",
				committed_bytes::text AS "committedBytes",
				last_line_sha256 AS "lastLineSha256"
			FROM live_session_stream
			WHERE organization_id = $1
				AND session_id = $2
				AND agent_id = ANY($3::text[])
				AND source = $4
			${lock}
		`,
		[target.organizationId, target.sessionId, agentKeys, target.source],
	);
	return new Map(
		rows.map((row) => [
			row.agentId,
			{
				committedBytes: Number(row.committedBytes),
				committedLines: row.committedLines,
				exists: true,
				generation: row.generation,
				lastLineSha256: row.lastLineSha256,
			},
		]),
	);
}

/**
 * A session uploaded by another member cannot be streamed by this one.
 * Uploaded sessions are owned per workspace and session id, whatever the
 * agent (`session_ownership`), so this check is too.
 */
async function assertNoUploadedSessionConflict(
	target: LiveSessionTarget,
	database: postgres.Sql,
): Promise<void> {
	const [owner] = await database<Array<{ userId: string }>>`
		SELECT user_id AS "userId"
		FROM session_ownership
		WHERE organization_id = ${target.organizationId}
			AND session_id = ${target.sessionId}
		LIMIT 1
	`;
	if (owner && owner.userId !== target.userId) {
		throw new LiveSessionOwnershipConflictError();
	}
}

function chunksOf(decisions: readonly StreamDecision[]): PendingChunk[] {
	return decisions.flatMap((decision) =>
		decision.chunk ? [decision.chunk] : [],
	);
}

function toOutput(
	input: LiveSessionAppendInput,
	decisions: readonly StreamDecision[],
): LiveSessionAppendOutput {
	return {
		streams: input.streams.map((stream, index) => {
			const decision = decisions[index];
			if (!decision) throw new Error("Missing live stream decision");
			return toOutputStream(stream.agentId, decision.next, decision);
		}),
	};
}

function startsEmptyStream(
	stream: LiveSessionAppendInput["streams"][number],
): boolean {
	return (
		stream.lines.length > 0 &&
		stream.startLine === 0 &&
		stream.previousLineSha256 === null
	);
}

function toOutputStream(
	agentId: string | null,
	state: StreamState,
	decision: StreamDecision,
): LiveSessionAppendOutput["streams"][number] {
	return {
		agentId,
		committedLines: state.committedLines,
		lastLineSha256: state.lastLineSha256,
		status: decision.status,
	};
}
