import {
	LIVE_SESSION_LIST_MAX_SESSIONS,
	LIVE_SESSION_TAIL_MAIN_LINES,
	LIVE_SESSION_TAIL_MAX_BYTES,
	LIVE_SESSION_TAIL_MAX_STREAMS,
	LIVE_SESSION_TAIL_SUBAGENT_LINES,
	type LiveSessionSource,
	type LiveSessionSummary,
	type LiveSessionTailCursor,
	type LiveSessionTailOutput,
	type LiveSessionTailStream,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { R2EvidenceStorageClient } from "../r2-ingest-storage.service.js";
import { LiveSessionStorageError } from "./live-session-gate.js";
import {
	decodeLiveSessionChunk,
	fromAgentKey,
	toAgentKey,
	utf8ByteLength,
} from "./live-session-lines.js";
import { liveSessionR2Signal } from "./live-session-r2.js";

const LIST_WINDOW_MS = 24 * 60 * 60 * 1000;
const R2_GET_CONCURRENCY = 8;
/** Bytes one subagent stream may take of a tail response. */
const SUBAGENT_MAX_BYTES = 512 * 1024;
/** Bytes the main transcript leaves to subagents, so they are never starved. */
const SUBAGENT_RESERVED_BYTES = 1024 * 1024;
/** R2 objects one tail response reads, and one stream of it. */
const MAX_OBJECT_READS = 256;
const MAX_STREAM_OBJECT_READS = 64;

export type LiveSessionR2Reader = Pick<R2EvidenceStorageClient, "getObject">;

interface LiveSessionRow {
	endedAt: string | null;
	gitBranch: string | null;
	gitRemote: string | null;
	lastActivityAt: string;
	projectPath: string;
	sessionId: string;
	source: LiveSessionSource;
	startedAt: string;
	userId: string;
}

interface StreamRow {
	agentId: string;
	committedLines: number;
	generation: number;
}

interface ChunkRow {
	byteLength: string;
	lineCount: number;
	objectKey: string;
	startLine: number;
}

/**
 * Live sessions of the workspace active in the last 24 hours, newest first.
 * `ownerId` limits them to one member's (own-sessions-only readers).
 */
export async function listLiveSessions(
	input: { readonly organizationId: string; readonly ownerId: string | null },
	env: { readonly database: postgres.Sql; readonly now: () => Date },
): Promise<LiveSessionSummary[]> {
	const since = new Date(env.now().getTime() - LIST_WINDOW_MS);
	const rows = await env.database<LiveSessionRow[]>`
		SELECT ${sessionColumns(env.database)}
		FROM live_session
		WHERE organization_id = ${input.organizationId}
			AND last_activity_at > ${since.toISOString()}::timestamptz
			AND (${input.ownerId}::text IS NULL OR user_id = ${input.ownerId})
		ORDER BY last_activity_at DESC, session_id
		LIMIT ${LIVE_SESSION_LIST_MAX_SESSIONS}
	`;
	return rows.map(toSummary);
}

/**
 * The workspace's live session with this id: of the given source, or else
 * (the session page knows only the id) the most recently active one the
 * reader may read, before any they may not. `readableOwnerId` is the one
 * member whose sessions the reader reads, or null for every member's.
 */
export async function readLiveSession(
	input: {
		readonly organizationId: string;
		readonly readableOwnerId: string | null;
		readonly sessionId: string;
		readonly source: LiveSessionSource | undefined;
	},
	env: { readonly database: postgres.Sql },
): Promise<LiveSessionSummary | null> {
	const [row] = await env.database<LiveSessionRow[]>`
		SELECT ${sessionColumns(env.database)}
		FROM live_session
		WHERE organization_id = ${input.organizationId}
			AND session_id = ${input.sessionId}
			AND (${input.source ?? null}::text IS NULL OR source = ${input.source ?? null})
		ORDER BY
			(${input.readableOwnerId}::text IS NULL OR user_id = ${input.readableOwnerId}) DESC,
			last_activity_at DESC
		LIMIT 1
	`;
	return row ? toSummary(row) : null;
}

/**
 * New lines of every stream of a live session. A stream the cursor names at
 * its current generation, with no more than a tail's worth of new lines,
 * continues from the cursor; any other stream returns its tail (the last 400
 * main / 100 subagent lines). The response carries at most 3 MiB of lines,
 * main transcript first; with subagents the main transcript leaves them
 * 1 MiB, and a subagent takes at most 512 KiB: a continued stream returns
 * its oldest new lines (the client continues from `nextLine`), a tail its
 * newest. Chunks are chosen from their stored sizes before anything is read,
 * stopping before the chunk that would pass the budget (only a stream's
 * first chunk may, so it always moves on), so a response reads about its own
 * size from R2 and at most 256 objects, however far behind the cursor is.
 */
export async function readLiveSessionTail(
	input: {
		readonly cursor: readonly LiveSessionTailCursor[] | undefined;
		readonly organizationId: string;
		readonly session: LiveSessionSummary;
	},
	env: {
		readonly database: postgres.Sql;
		readonly r2: LiveSessionR2Reader;
		readonly signal?: AbortSignal;
	},
): Promise<LiveSessionTailOutput> {
	const streams = await env.database<StreamRow[]>`
		SELECT
			agent_id AS "agentId",
			generation,
			committed_lines AS "committedLines"
		FROM live_session_stream
		WHERE organization_id = ${input.organizationId}
			AND source = ${input.session.source}
			AND session_id = ${input.session.sessionId}
		ORDER BY agent_id = '' DESC, agent_id COLLATE "C"
		LIMIT ${LIVE_SESSION_TAIL_MAX_STREAMS}
	`;
	const cursors = new Map(
		(input.cursor ?? []).map((entry) => [toAgentKey(entry.agentId), entry]),
	);
	const [upload] = await env.database<Array<{ uploaded: boolean }>>`
		SELECT EXISTS (
			SELECT 1 FROM session_ownership
			WHERE organization_id = ${input.organizationId}
				AND session_id = ${input.session.sessionId}
				AND last_ingested_at IS NOT NULL
		) AS uploaded
	`;
	const budget = {
		bytes: LIVE_SESSION_TAIL_MAX_BYTES,
		objects: MAX_OBJECT_READS,
	};
	const output: LiveSessionTailStream[] = [];
	for (const stream of streams) {
		const isMain = stream.agentId === "";
		const tailLines = isMain
			? LIVE_SESSION_TAIL_MAIN_LINES
			: LIVE_SESSION_TAIL_SUBAGENT_LINES;
		const cursor = cursors.get(stream.agentId);
		const continues =
			cursor !== undefined &&
			cursor.generation === stream.generation &&
			stream.committedLines - cursor.nextLine <= tailLines;
		const from =
			continues && cursor
				? Math.min(cursor.nextLine, stream.committedLines)
				: Math.max(0, stream.committedLines - tailLines);
		const streamBudget = isMain
			? budget.bytes - (streams.length > 1 ? SUBAGENT_RESERVED_BYTES : 0)
			: Math.min(budget.bytes, SUBAGENT_MAX_BYTES);
		const window =
			streamBudget > 0 && budget.objects > 0 && from < stream.committedLines
				? await readStreamWindow(
						input,
						stream,
						{
							from,
							maxBytes: streamBudget,
							maxObjects: Math.min(budget.objects, MAX_STREAM_OBJECT_READS),
							newestFirst: !continues,
						},
						env,
					)
				: { bytesRead: 0, firstLine: from, lines: [], objectsRead: 0 };
		const budgetBefore = budget.bytes;
		budget.bytes -= window.bytesRead;
		budget.objects -= window.objectsRead;
		const kept = continues
			? keepOldest(window.lines, streamBudget, budgetBefore)
			: keepNewest(window.lines, streamBudget, budgetBefore);
		const firstLine = continues
			? window.firstLine
			: window.firstLine + window.lines.length - kept.length;
		output.push({
			agentId: fromAgentKey(stream.agentId),
			generation: stream.generation,
			firstLine,
			nextLine: firstLine + kept.length,
			lines: kept,
			truncatedBefore: !continues && firstLine > 0,
		});
	}
	return {
		session: input.session,
		streams: output,
		uploaded: upload?.uploaded === true,
	};
}

/**
 * The lines of the chunks a response reads for one stream: from `from`
 * onwards (oldest first) or ending at the committed count (newest first),
 * taking chunks while the stored bytes before them stay under `maxBytes`, at
 * most `maxObjects` of them. The lines are contiguous from `firstLine`.
 */
async function readStreamWindow(
	input: {
		readonly organizationId: string;
		readonly session: LiveSessionSummary;
	},
	stream: StreamRow,
	window: {
		readonly from: number;
		readonly maxBytes: number;
		readonly maxObjects: number;
		readonly newestFirst: boolean;
	},
	env: {
		readonly database: postgres.Sql;
		readonly r2: LiveSessionR2Reader;
		readonly signal?: AbortSignal;
	},
): Promise<{
	bytesRead: number;
	firstLine: number;
	lines: string[];
	objectsRead: number;
}> {
	const direction = window.newestFirst ? -1 : 1;
	const selected = await env.database<ChunkRow[]>`
		SELECT "startLine", "lineCount", "objectKey", "byteLength"
		FROM (
			SELECT
				start_line AS "startLine",
				line_count AS "lineCount",
				object_key AS "objectKey",
				byte_length::text AS "byteLength",
				COALESCE(
					SUM(byte_length) OVER (
						ORDER BY start_line * ${direction}::int
						ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
					),
					0
				) AS "bytesBefore"
			FROM live_session_chunk
			WHERE organization_id = ${input.organizationId}
				AND source = ${input.session.source}
				AND session_id = ${input.session.sessionId}
				AND agent_id = ${stream.agentId}
				AND generation = ${stream.generation}
				AND start_line < ${stream.committedLines}
				AND start_line + line_count > ${window.from}
		) chunk
		WHERE "bytesBefore" = 0
			OR "bytesBefore" + "byteLength"::bigint <= ${window.maxBytes}
		ORDER BY "startLine" * ${direction}::int
		LIMIT ${window.maxObjects}
	`;
	const chunks = [...selected].sort((a, b) => a.startLine - b.startLine);
	const first = chunks[0];
	const last = chunks.at(-1);
	if (!first || !last) {
		return { bytesRead: 0, firstLine: window.from, lines: [], objectsRead: 0 };
	}
	const chunkLines: string[][] = [];
	for (let index = 0; index < chunks.length; index += R2_GET_CONCURRENCY) {
		chunkLines.push(
			...(await Promise.all(
				chunks.slice(index, index + R2_GET_CONCURRENCY).map(async (chunk) =>
					decodeLiveSessionChunk(
						await env.r2
							.getObject(chunk.objectKey, liveSessionR2Signal(env.signal))
							.catch((error: unknown) => {
								throw new LiveSessionStorageError(error);
							}),
						chunk.lineCount,
					),
				),
			)),
		);
	}
	const firstLine = Math.max(window.from, first.startLine);
	const endLine = Math.min(
		last.startLine + last.lineCount,
		stream.committedLines,
	);
	const lines: string[] = [];
	let expectedStart = first.startLine;
	for (const [index, chunk] of chunks.entries()) {
		if (chunk.startLine !== expectedStart) {
			throw new Error("Live session chunks are not contiguous");
		}
		expectedStart = chunk.startLine + chunk.lineCount;
		lines.push(
			...(chunkLines[index] ?? []).slice(
				Math.max(0, firstLine - chunk.startLine),
				endLine - chunk.startLine,
			),
		);
	}
	if (lines.length !== endLine - firstLine) {
		throw new Error("Live session chunks do not cover the committed lines");
	}
	return {
		bytesRead: chunks.reduce(
			(total, chunk) => total + Number(chunk.byteLength),
			0,
		),
		firstLine,
		lines,
		objectsRead: chunks.length,
	};
}

/**
 * The oldest lines within `budget` bytes. The first line is kept even past
 * `budget` while it fits `hardLimit`, so a stream always moves on.
 */
function keepOldest(
	lines: readonly string[],
	budget: number,
	hardLimit: number,
): string[] {
	return lines.slice(0, countWithin(lines, budget, hardLimit));
}

/** The newest lines within `budget` bytes, like `keepOldest` from the end. */
function keepNewest(
	lines: readonly string[],
	budget: number,
	hardLimit: number,
): string[] {
	const reversed = [...lines].reverse();
	return lines.slice(lines.length - countWithin(reversed, budget, hardLimit));
}

function countWithin(
	lines: readonly string[],
	budget: number,
	hardLimit: number,
): number {
	let bytes = 0;
	let count = 0;
	for (const line of lines) {
		const lineBytes = utf8ByteLength(line);
		const limit =
			count === 0 ? Math.max(budget, Math.min(hardLimit, lineBytes)) : budget;
		if (bytes + lineBytes > limit) break;
		bytes += lineBytes;
		count += 1;
	}
	return count;
}

function sessionColumns(database: postgres.Sql) {
	return database`
		session_id AS "sessionId",
		user_id AS "userId",
		source,
		project_path AS "projectPath",
		git_remote AS "gitRemote",
		git_branch AS "gitBranch",
		${isoTimestamp(database, "started_at")} AS "startedAt",
		${isoTimestamp(database, "last_activity_at")} AS "lastActivityAt",
		${isoTimestamp(database, "ended_at")} AS "endedAt"
	`;
}

/** The column as an ISO 8601 UTC string with milliseconds (null stays null). */
function isoTimestamp(database: postgres.Sql, column: string) {
	return database`to_char(${database(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

function toSummary(row: LiveSessionRow): LiveSessionSummary {
	return {
		sessionId: row.sessionId,
		userId: row.userId,
		source: row.source,
		projectPath: row.projectPath,
		gitRemote: row.gitRemote,
		gitBranch: row.gitBranch,
		startedAt: row.startedAt,
		lastActivityAt: row.lastActivityAt,
		endedAt: row.endedAt,
	};
}
