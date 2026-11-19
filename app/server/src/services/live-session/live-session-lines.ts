import { createHash } from "node:crypto";
import {
	LIVE_SESSION_MAX_LINE_BYTES,
	LIVE_SESSION_MAX_REQUEST_LINE_BYTES,
	LIVE_SESSION_MAX_REQUEST_LINES,
	type LiveSessionAppendInput,
	type LiveSessionSource,
} from "@rudel/api-routes";
import { slimTranscriptText } from "@rudel/api-routes/transcript-slim";
import {
	filterSessionTextFields,
	SecretFilterConvergenceError,
	SecretFilterJsonIntegrityError,
} from "@rudel/secret-filter";

/** `agent_id` of the main transcript's stream row. */
export const MAIN_STREAM_AGENT_KEY = "";
/**
 * Bytes each line adds to the rate-limit charge on top of its own: lines,
 * even empty ones, cost CPU to filter, so a flood of them spends the byte
 * budget too.
 */
const RATE_LIMIT_BYTES_PER_LINE = 256;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export class LiveSessionAppendValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LiveSessionAppendValidationError";
	}
}

/**
 * Checks what the schema cannot: one entry per stream, a reset starting at
 * line 0, the per-line and per-request byte and line limits, and no NUL in
 * the text stored in Postgres. Returns the request's rate-limit charge: its
 * line bytes plus 256 per line.
 */
export function validateLiveSessionAppend(input: LiveSessionAppendInput): {
	chargeBytes: number;
} {
	assertStorableText(input);
	const lineCount = input.streams.reduce(
		(total, stream) => total + stream.lines.length,
		0,
	);
	if (lineCount > LIVE_SESSION_MAX_REQUEST_LINES) {
		throw new LiveSessionAppendValidationError(
			`The request carries more than ${LIVE_SESSION_MAX_REQUEST_LINES} lines`,
		);
	}
	const agentKeys = new Set<string>();
	let lineBytes = 0;
	for (const stream of input.streams) {
		const agentKey = toAgentKey(stream.agentId);
		if (agentKeys.has(agentKey)) {
			throw new LiveSessionAppendValidationError(
				"Each stream may appear only once per request",
			);
		}
		agentKeys.add(agentKey);
		if (
			stream.reset &&
			(stream.startLine !== 0 || stream.previousLineSha256 !== null)
		) {
			throw new LiveSessionAppendValidationError(
				"A reset must start at line 0 without a previous line",
			);
		}
		for (const line of stream.lines) {
			if (line.includes("\n")) {
				throw new LiveSessionAppendValidationError(
					"Lines must not contain a newline",
				);
			}
			const bytes = utf8ByteLength(line);
			if (bytes > LIVE_SESSION_MAX_LINE_BYTES) {
				throw new LiveSessionAppendValidationError(
					`A line exceeds ${LIVE_SESSION_MAX_LINE_BYTES} bytes`,
				);
			}
			lineBytes += bytes;
			if (lineBytes > LIVE_SESSION_MAX_REQUEST_LINE_BYTES) {
				throw new LiveSessionAppendValidationError(
					`The request's lines exceed ${LIVE_SESSION_MAX_REQUEST_LINE_BYTES} bytes`,
				);
			}
		}
	}
	return { chargeBytes: lineBytes + lineCount * RATE_LIMIT_BYTES_PER_LINE };
}

/**
 * Postgres text cannot hold NUL: a NUL in an id, path or git field would
 * fail its query, so it is refused as a bad request.
 */
export function assertStorableText(input: {
	readonly gitBranch?: string;
	readonly gitRemote?: string;
	readonly organizationId: string;
	readonly projectPath?: string;
}): void {
	for (const value of [
		input.organizationId,
		input.projectPath,
		input.gitRemote,
		input.gitBranch,
	]) {
		if (value?.includes("\u0000")) {
			throw new LiveSessionAppendValidationError(
				"Text fields must not contain NUL characters",
			);
		}
	}
}

/** The continuity hash: SHA-256 of the line exactly as the client sent it. */
export function sha256Line(line: string): string {
	return createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * The stored form of one line: slimmed, then secret-filtered, as ingest
 * treats an upload. A line the filter cannot safely rewrite is replaced by an
 * omission marker, so the stream keeps its line numbering. Each line is
 * slimmed on its own: per-record rules (inline images) apply, while Codex
 * compaction dedupe, which needs the earlier records, is left to the CLI's
 * stream slimmer.
 */
export function filterLiveSessionLine(line: string): string {
	try {
		return filterSessionTextFields({
			content: slimTranscriptText(line),
			subagents: undefined,
		}).content;
	} catch (error) {
		if (
			error instanceof SecretFilterConvergenceError ||
			error instanceof SecretFilterJsonIntegrityError
		) {
			return JSON.stringify({
				type: "opaline-live-omitted",
				reason: "filter",
				originalBytes: utf8ByteLength(line),
			});
		}
		throw error;
	}
}

/** One chunk object's bytes: its lines, each terminated by `\n`. */
export function encodeLiveSessionChunk(lines: readonly string[]): Uint8Array {
	return UTF8_ENCODER.encode(`${lines.join("\n")}\n`);
}

export function decodeLiveSessionChunk(
	bytes: Uint8Array,
	expectedLineCount: number,
): string[] {
	const text = UTF8_DECODER.decode(bytes);
	const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : [];
	if (lines.length !== expectedLineCount) {
		throw new Error(
			`Live session chunk holds ${lines.length} lines; ${expectedLineCount} were committed`,
		);
	}
	return lines;
}

/**
 * Content-addressed: an object is only ever written with the bytes its key
 * names, so an aborted write that lands late can never replace a committed
 * chunk with other lines (it lands under its own key, and the orphan sweep
 * removes it). Organization and session ids are hashed under the source, so
 * a Claude Code session and a Codex thread never share objects; subagent
 * streams are prefixed so that no agent id can name the main transcript's
 * directory.
 */
export function buildLiveSessionChunkObjectKey(input: {
	readonly agentId: string | null;
	readonly body: Uint8Array;
	readonly generation: number;
	readonly organizationId: string;
	readonly sessionId: string;
	readonly source: LiveSessionSource;
	readonly startLine: number;
}): string {
	const stream = input.agentId === null ? "main" : `agent-${input.agentId}`;
	return [
		liveSessionOrganizationPrefix(input.organizationId).slice(0, -1),
		input.source,
		sha256Hex(input.sessionId),
		stream,
		`g${input.generation}`,
		`${String(input.startLine).padStart(10, "0")}-${createHash("sha256").update(input.body).digest("hex").slice(0, 32)}.jsonl`,
	].join("/");
}

/** Every live session object key starts with this. */
export const LIVE_SESSION_OBJECT_PREFIX = "live/v1/";

/** The key prefix of every live session object of one workspace. */
export function liveSessionOrganizationPrefix(organizationId: string): string {
	return `${LIVE_SESSION_OBJECT_PREFIX}${sha256Hex(organizationId)}/`;
}

export function toAgentKey(agentId: string | null): string {
	return agentId ?? MAIN_STREAM_AGENT_KEY;
}

export function fromAgentKey(agentKey: string): string | null {
	return agentKey === MAIN_STREAM_AGENT_KEY ? null : agentKey;
}

export function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
