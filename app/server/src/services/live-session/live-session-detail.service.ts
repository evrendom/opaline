import {
	isLiveSessionActive,
	type LiveSessionSource,
	type LiveSessionSummary,
	liveSessionDetailRevision,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { SessionDetailRawSnapshot } from "../session-detail-derivation.service.js";
import { LiveSessionStorageError } from "./live-session-gate.js";
import {
	decodeLiveSessionChunk,
	fromAgentKey,
	utf8ByteLength,
} from "./live-session-lines.js";
import { liveSessionR2Signal } from "./live-session-r2.js";
import {
	type LiveSessionR2Reader,
	readLiveSession,
} from "./live-session-read.service.js";

// The session page reads a running session the way it reads an uploaded one:
// its live lines, assembled into the raw snapshot the detail derivation
// takes. The derivation is keyed by revision (the session's last update), so
// each change of the session is derived once; between changes the page's
// requests hit the derivation cache.

const R2_GET_CONCURRENCY = 8;
/** Bytes of lines one live session's detail may be built from; older lines fall out first. */
const MAX_CONTENT_BYTES = 64 * 1024 * 1024;
/** Bytes of assembled lines kept in memory across derivations, so a session that moved on reads only its new chunks. */
const STREAM_CACHE_MAX_BYTES = 64 * 1024 * 1024;

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

interface CachedStream {
	bytes: number;
	committedLines: number;
	generation: number;
	lines: string[];
}

const streamCache = new Map<string, CachedStream>();
let streamCacheBytes = 0;

export type LiveSessionDetailSnapshotResult =
	| { kind: "missing" }
	| { kind: "stale"; currentRevision: string }
	| { kind: "snapshot"; snapshot: SessionDetailRawSnapshot };

/**
 * The live session of this member with this id, and the revision the detail
 * of its live lines carries. The upload, when one exists, takes over once
 * the session has stopped running (ended, or quiet for five minutes).
 */
export async function readLiveSessionDetailRevision(
	input: {
		readonly hasUpload: boolean;
		readonly organizationId: string;
		readonly ownerId: string;
		readonly sessionId: string;
	},
	env: { readonly database: postgres.Sql; readonly now: () => Date },
): Promise<{ revision: string; source: LiveSessionSource } | null> {
	const session = await readOwnedLiveSession(input, env);
	if (!session) return null;
	if (input.hasUpload && !isLiveSessionActive(session, env.now().getTime()))
		return null;
	return {
		revision: liveSessionDetailRevision(session),
		source: session.source,
	};
}

/**
 * The raw snapshot of a live session at `revision`: every committed line of
 * its main transcript and of each subagent, from the live chunks. `stale`
 * when the session moved on since the revision was read.
 */
export async function readLiveSessionDetailSnapshot(
	input: {
		readonly organizationId: string;
		readonly ownerId: string;
		readonly revision: string;
		readonly sessionId: string;
		readonly source: LiveSessionSource;
	},
	env: {
		readonly database: postgres.Sql;
		readonly r2: LiveSessionR2Reader;
		readonly signal?: AbortSignal;
	},
): Promise<LiveSessionDetailSnapshotResult> {
	const session = await readOwnedLiveSession(input, env);
	if (!session || session.source !== input.source) return { kind: "missing" };
	const currentRevision = liveSessionDetailRevision(session);
	if (currentRevision !== input.revision)
		return { kind: "stale", currentRevision };
	const streams = await env.database<StreamRow[]>`
		SELECT
			agent_id AS "agentId",
			generation,
			committed_lines AS "committedLines"
		FROM live_session_stream
		WHERE organization_id = ${input.organizationId}
			AND source = ${session.source}
			AND session_id = ${session.sessionId}
		ORDER BY agent_id = '' DESC, agent_id COLLATE "C"
	`;
	let content = "";
	const subagents: Record<string, string> = {};
	for (const stream of streams) {
		const lines = await readStreamLines(input, session, stream, env);
		const agentId = fromAgentKey(stream.agentId);
		if (agentId === null) content = lines.join("\n");
		else if (lines.length > 0) subagents[agentId] = lines.join("\n");
	}
	const startedAtMs = Date.parse(session.startedAt);
	const lastActivityMs = Date.parse(session.lastActivityAt);
	return {
		kind: "snapshot",
		snapshot: {
			content,
			derivedTotals: true,
			durationMinutes:
				Number.isFinite(startedAtMs) && Number.isFinite(lastActivityMs)
					? Math.max(0, (lastActivityMs - startedAtMs) / 60_000)
					: null,
			gitBranch: session.gitBranch,
			gitRemote: session.gitRemote ?? "",
			gitSha: null,
			inputTokens: 0,
			lastInteractionDate: session.lastActivityAt,
			modelUsed: "",
			organizationId: input.organizationId,
			outputTokens: 0,
			ownerId: session.userId,
			packageName: "",
			projectPath: session.projectPath,
			revision: currentRevision,
			sessionDate: session.startedAt,
			sessionId: session.sessionId,
			skills: [],
			slashCommands: [],
			source: session.source,
			subagents,
			totalTokens: 0,
		},
	};
}

async function readOwnedLiveSession(
	input: {
		readonly organizationId: string;
		readonly ownerId: string;
		readonly sessionId: string;
	},
	env: { readonly database: postgres.Sql },
): Promise<LiveSessionSummary | null> {
	const session = await readLiveSession(
		{
			organizationId: input.organizationId,
			readableOwnerId: input.ownerId,
			sessionId: input.sessionId,
			source: undefined,
		},
		env,
	);
	return session?.userId === input.ownerId ? session : null;
}

/**
 * The committed lines of one stream of its current generation, continuing
 * from the lines held since the last derivation when the stream only grew.
 * Past 64 MiB the oldest lines fall out.
 */
async function readStreamLines(
	input: { readonly organizationId: string },
	session: LiveSessionSummary,
	stream: StreamRow,
	env: {
		readonly database: postgres.Sql;
		readonly r2: LiveSessionR2Reader;
		readonly signal?: AbortSignal;
	},
): Promise<string[]> {
	const key = streamCacheKey(
		{
			organizationId: input.organizationId,
			sessionId: session.sessionId,
			source: session.source,
		},
		stream.agentId,
	);
	const held = streamCache.get(key);
	const continues =
		held !== undefined &&
		held.generation === stream.generation &&
		held.committedLines <= stream.committedLines;
	const from = continues ? held.committedLines : 0;
	const chunks = await env.database<ChunkRow[]>`
		SELECT
			start_line AS "startLine",
			line_count AS "lineCount",
			object_key AS "objectKey",
			byte_length::text AS "byteLength"
		FROM live_session_chunk
		WHERE organization_id = ${input.organizationId}
			AND source = ${session.source}
			AND session_id = ${session.sessionId}
			AND agent_id = ${stream.agentId}
			AND generation = ${stream.generation}
			AND start_line >= ${from}
			AND start_line < ${stream.committedLines}
		ORDER BY start_line
	`;
	const read: string[][] = [];
	for (let index = 0; index < chunks.length; index += R2_GET_CONCURRENCY) {
		read.push(
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
	let expectedStart = from;
	const added: string[] = [];
	for (const [index, chunk] of chunks.entries()) {
		if (chunk.startLine !== expectedStart) {
			throw new Error("Live session chunks are not contiguous");
		}
		expectedStart = chunk.startLine + chunk.lineCount;
		added.push(...(read[index] ?? []));
	}
	if (expectedStart !== stream.committedLines) {
		throw new Error("Live session chunks do not cover the committed lines");
	}
	const lines = continues ? [...held.lines, ...added] : added;
	let bytes =
		(continues ? held.bytes : 0) +
		chunks.reduce((total, chunk) => total + Number(chunk.byteLength), 0);
	// Drop the oldest lines past the budget, so one session cannot take the
	// process's memory however long it runs.
	while (bytes > MAX_CONTENT_BYTES && lines.length > 1) {
		const dropped = lines.shift();
		bytes -= utf8ByteLength(dropped ?? "") + 1;
	}
	remember(key, {
		bytes,
		committedLines: stream.committedLines,
		generation: stream.generation,
		lines,
	});
	return lines;
}

function remember(key: string, stream: CachedStream): void {
	const previous = streamCache.get(key);
	if (previous) {
		streamCache.delete(key);
		streamCacheBytes -= previous.bytes;
	}
	streamCache.set(key, stream);
	streamCacheBytes += stream.bytes;
	for (const [oldestKey, oldest] of streamCache) {
		if (streamCacheBytes <= STREAM_CACHE_MAX_BYTES) break;
		streamCache.delete(oldestKey);
		streamCacheBytes -= oldest.bytes;
	}
}

function streamCacheKey(
	input: {
		readonly organizationId: string;
		readonly sessionId: string;
		readonly source: LiveSessionSource;
	},
	agentKey: string,
): string {
	return JSON.stringify([
		input.organizationId,
		input.source,
		input.sessionId,
		agentKey,
	]);
}
