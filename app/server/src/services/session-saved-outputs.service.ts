import type { RepositoryEvidenceInitInput } from "@rudel/api-routes";
import {
	type RudelSessionSavedOutputsRow,
	RudelSessionSavedOutputsRowSchema,
} from "@rudel/ch-schema/generated";
import { SESSION_SAVED_OUTPUTS_TABLE } from "@rudel/ch-schema/session-saved-outputs";
import { z } from "zod";
import type { ClickHouseExecutor } from "../clickhouse.js";

/**
 * Saved outputs of a session (gap A1): the files Claude Code saves next to a
 * session, as a capture's manifest lists them. The CLI uploads two roots:
 * `claude-task-outputs` (`<tmp>/claude-<uid>/<project>/<session>/tasks`, the
 * output of background Bash, Monitor and agent tasks; an async agent's output
 * is a symlink to its subagent transcript, never read) and
 * `claude-tool-results` (`<project dir>/<session>/tool-results`, tool outputs
 * too large for the transcript). Each file's text, slimmed and secret-filtered,
 * is a `source-blob` evidence object.
 *
 * The commit turns the verified manifest into one row per file and per task id
 * the transcript names whose output was not on disk, staged in Postgres with
 * the capture and published to `rudel.session_saved_outputs` with its index
 * row. Old CLIs send neither root nor the references, and anything malformed
 * is left out: a capture never fails over its saved outputs.
 */

export const TASK_OUTPUTS_ROOT_ID = "claude-task-outputs";
export const TOOL_RESULTS_ROOT_ID = "claude-tool-results";
/** The CLI's bounds (MAX_TASK_OUTPUT_REFERENCES and friends); more is ignored. */
export const MAX_TASK_OUTPUT_REFERENCES = 512;
export const MAX_TOOL_RESULT_REFERENCES = 512;
export const MAX_MISSING_TASK_IDS = 256;
/** Entries of the two roots read per capture (the CLI keeps at most 256 files of each). */
export const MAX_SAVED_OUTPUT_ENTRIES = 1024;

export type SessionSavedOutputRow = RudelSessionSavedOutputsRow;
export type SavedOutputKind = "task_output" | "tool_result";
export type SavedOutputStatus =
	| "captured"
	| "truncated"
	| "reused"
	| "omitted"
	| "symlink"
	| "missing";

const TASK_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
// `<task id>.output` or one directory below (`rerooted/<task id>.output`).
const TASK_OUTPUT_PATH =
	/^(?:[A-Za-z0-9_-]{1,64}\/)?([A-Za-z0-9_-]{1,64})\.output$/u;
// Relative, without `.` or `..` segments, control characters or a leading slash.
const RELATIVE_PATH = z
	.string()
	.min(1)
	.max(512)
	.refine(
		(path) =>
			!path.startsWith("/") &&
			// biome-ignore lint/suspicious/noControlCharactersInRegex: rejects them
			!/[\u0000-\u001f\u007f\\]/u.test(path) &&
			path
				.split("/")
				.every((part) => part !== "" && part !== "." && part !== ".."),
	);
const IDENTIFIER = z.string().min(1).max(256);
const BYTES = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const BLOB_ID = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
// A file's mtime in ms (fractional), within DateTime64's range (before 2300).
const MODIFIED_AT_MS = z.number().nonnegative().max(10_413_791_999_999);
const TRUNCATION = z.object({
	kept: z.literal("tail"),
	originalByteLength: BYTES,
});
const STORED = {
	blobId: BLOB_ID,
	sourceByteLength: BYTES,
	storedByteLength: BYTES,
	truncation: TRUNCATION.optional(),
};
const CONTENT = z.discriminatedUnion("status", [
	z.object({ status: z.literal("available"), ...STORED }),
	z.object({
		status: z.literal("reused"),
		parentCaptureId: IDENTIFIER,
		...STORED,
	}),
	z.object({
		status: z.literal("omitted"),
		reason: z.string().regex(/^[a-z0-9-]{1,64}$/u),
	}),
]);
const ENTRY = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("file"),
		rootId: z.enum([TASK_OUTPUTS_ROOT_ID, TOOL_RESULTS_ROOT_ID]),
		path: RELATIVE_PATH,
		modifiedAtMs: MODIFIED_AT_MS.optional(),
		content: CONTENT,
	}),
	z.object({
		kind: z.literal("symlink"),
		rootId: z.enum([TASK_OUTPUTS_ROOT_ID, TOOL_RESULTS_ROOT_ID]),
		path: RELATIVE_PATH,
		modifiedAtMs: MODIFIED_AT_MS.optional(),
	}),
]);
type Entry = z.infer<typeof ENTRY>;
const RECORD_INDEX = z.number().int().positive().max(0xffff_ffff);
const TASK_REFERENCE = z.object({
	taskId: TASK_ID,
	path: RELATIVE_PATH,
	agentId: IDENTIFIER.nullable(),
	recordIndex: RECORD_INDEX,
	toolUseId: IDENTIFIER.nullable(),
	source: z.enum(["result", "notification", "read"]),
});
type TaskReference = z.infer<typeof TASK_REFERENCE>;
const TOOL_REFERENCE = z.object({
	path: RELATIVE_PATH,
	agentId: IDENTIFIER.nullable(),
	recordIndex: RECORD_INDEX,
	toolUseId: IDENTIFIER.nullable(),
});
type ToolReference = z.infer<typeof TOOL_REFERENCE>;

/** Rank of what a row knows; a later capture replaces a row only at the same rank or above. */
const STATUS_RANK: Readonly<Record<SavedOutputStatus, bigint>> = {
	captured: 3n,
	truncated: 3n,
	reused: 3n,
	symlink: 3n,
	omitted: 2n,
	missing: 1n,
};
const RANK_SHIFT = 2n ** 48n;

export interface SavedOutputCapture {
	readonly organizationId: string;
	readonly userId: string;
	readonly input: Pick<
		RepositoryEvidenceInitInput,
		"capture" | "objects" | "session"
	>;
	readonly manifest: unknown;
	readonly stagedAt: Date;
}

/**
 * The capture's saved output rows, or an empty list when its manifest names
 * none. Pure; never throws on manifest content.
 */
export function extractSessionSavedOutputs(
	capture: SavedOutputCapture,
): SessionSavedOutputRow[] {
	const local = asRecord(asRecord(capture.manifest)?.localContext);
	if (!local) return [];
	const capturedAt = new Date(capture.input.capture.timing.captureCompletedAt);
	if (!Number.isFinite(capturedAt.getTime())) return [];
	const entries = readEntries(local.entries);
	const taskOutputs = asRecord(local.taskOutputReferences);
	const taskReferences = readList(
		taskOutputs?.references,
		TASK_REFERENCE,
		MAX_TASK_OUTPUT_REFERENCES,
	);
	const toolReferences = readList(
		asRecord(local.toolResultReferences)?.references,
		TOOL_REFERENCE,
		MAX_TOOL_RESULT_REFERENCES,
	);
	const missingTaskIds = [
		...new Set(
			readList(taskOutputs?.missingTaskIds, TASK_ID, MAX_MISSING_TASK_IDS),
		),
	];
	if (entries.length === 0 && missingTaskIds.length === 0) return [];

	const uploaded = new Set(
		capture.input.objects
			.filter((object) => object.kind === "source-blob")
			.map((object) => object.objectId),
	);
	const base = {
		organization_id: capture.organizationId,
		user_id: capture.userId,
		session_id: capture.input.session.sessionId,
		session_source: capture.input.session.source,
		capture_id: capture.input.capture.contextId,
		captured_at: formatDateTime(capturedAt),
		capture_reason:
			local.captureReason === "task-output-sweep" ? "task-output-sweep" : "",
		written_at: formatDateTime(capture.stagedAt),
	};
	const rows = new Map<string, SessionSavedOutputRow>();
	const capturedTaskIds = new Set<string>();
	for (const entry of entries) {
		const key = `${entry.rootId}\0${entry.path}`;
		if (rows.has(key)) continue;
		const kind: SavedOutputKind =
			entry.rootId === TASK_OUTPUTS_ROOT_ID ? "task_output" : "tool_result";
		const taskId =
			kind === "task_output"
				? (TASK_OUTPUT_PATH.exec(entry.path)?.[1] ?? "")
				: "";
		if (taskId) capturedTaskIds.add(taskId);
		const reference =
			kind === "task_output"
				? pickTaskReference(taskReferences, taskId)
				: pickToolReference(toolReferences, entry.path);
		const stored = describeContent(
			entry,
			capture.input.capture.contextId,
			uploaded,
		);
		rows.set(key, {
			...base,
			root_id: entry.rootId,
			path: entry.path,
			kind,
			task_id: taskId,
			...referenceColumns(reference),
			entry_kind: entry.kind,
			...stored,
			file_modified_at:
				entry.modifiedAtMs === undefined
					? null
					: formatDateTime(new Date(Math.floor(entry.modifiedAtMs))),
			version: version(stored.status, capturedAt),
		});
	}
	for (const taskId of missingTaskIds) {
		const path = `${taskId}.output`;
		const key = `${TASK_OUTPUTS_ROOT_ID}\0${path}`;
		// Reported missing, yet on disk under another named path (rerooted).
		if (capturedTaskIds.has(taskId) || rows.has(key)) continue;
		rows.set(key, {
			...base,
			root_id: TASK_OUTPUTS_ROOT_ID,
			path,
			kind: "task_output",
			task_id: taskId,
			...referenceColumns(pickTaskReference(taskReferences, taskId)),
			entry_kind: "",
			status: "missing",
			omitted_reason: "",
			blob_object_id: "",
			blob_capture_id: "",
			source_bytes: "0",
			stored_bytes: "0",
			original_bytes: "0",
			truncated: false,
			file_modified_at: null,
			version: version("missing", capturedAt),
		});
	}
	return [...rows.values()];
}

/** Staged rows as published; a row that no longer parses is left out. */
export function parseStagedSessionSavedOutputs(value: unknown): {
	readonly rows: SessionSavedOutputRow[];
	readonly invalid: number;
} {
	if (!Array.isArray(value))
		return { rows: [], invalid: value == null ? 0 : 1 };
	const rows: SessionSavedOutputRow[] = [];
	let invalid = 0;
	for (const item of value) {
		const parsed = RudelSessionSavedOutputsRowSchema.safeParse(item);
		if (parsed.success) rows.push(parsed.data);
		else invalid += 1;
	}
	return { rows, invalid };
}

export async function persistSessionSavedOutputRows(input: {
	readonly clickhouse: ClickHouseExecutor;
	readonly rows: readonly SessionSavedOutputRow[];
	readonly signal?: AbortSignal;
}): Promise<void> {
	if (input.rows.length === 0) return;
	await input.clickhouse.insert({
		table: SESSION_SAVED_OUTPUTS_TABLE,
		values: [...input.rows],
		abortSignal: input.signal,
	});
}

function readEntries(value: unknown): Entry[] {
	if (!Array.isArray(value)) return [];
	const entries: Entry[] = [];
	for (const item of value) {
		// Most entries are the repository's; skip them before validating.
		if (
			typeof item !== "object" ||
			item === null ||
			!("rootId" in item) ||
			(item.rootId !== TASK_OUTPUTS_ROOT_ID &&
				item.rootId !== TOOL_RESULTS_ROOT_ID)
		)
			continue;
		const parsed = ENTRY.safeParse(item);
		if (!parsed.success) continue;
		entries.push(parsed.data);
		if (entries.length >= MAX_SAVED_OUTPUT_ENTRIES) break;
	}
	return entries;
}

function readList<T>(value: unknown, schema: z.ZodType<T>, limit: number): T[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, limit).flatMap((item) => {
		const parsed = schema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
}

/**
 * The reference naming the call that started the task: its tool result when
 * listed, else any reference that names the starting call (the CLI copies it
 * onto notifications and reads), else the first.
 */
function pickTaskReference(
	references: readonly TaskReference[],
	taskId: string,
): TaskReference | ToolReference | undefined {
	if (!taskId) return undefined;
	const named = references.filter((reference) => reference.taskId === taskId);
	return (
		named.find(
			(reference) => reference.source === "result" && reference.toolUseId,
		) ??
		named.find((reference) => reference.source === "result") ??
		named.find((reference) => reference.toolUseId) ??
		named[0]
	);
}

/** The first record (in stream order) that names the output with its tool call. */
function pickToolReference(
	references: readonly ToolReference[],
	path: string,
): ToolReference | undefined {
	const named = references.filter((reference) => reference.path === path);
	return named.find((reference) => reference.toolUseId) ?? named[0];
}

function referenceColumns(
	reference: TaskReference | ToolReference | undefined,
) {
	return {
		tool_use_id: reference?.toolUseId ?? "",
		agent_id: reference?.agentId ?? "",
		record_idx: reference?.recordIndex ?? 0,
	};
}

function describeContent(
	entry: Entry,
	captureId: string,
	uploaded: ReadonlySet<string>,
): Pick<
	SessionSavedOutputRow,
	| "status"
	| "omitted_reason"
	| "blob_object_id"
	| "blob_capture_id"
	| "source_bytes"
	| "stored_bytes"
	| "original_bytes"
	| "truncated"
> & { readonly status: SavedOutputStatus } {
	const empty = {
		omitted_reason: "",
		blob_object_id: "",
		blob_capture_id: "",
		source_bytes: "0",
		stored_bytes: "0",
		original_bytes: "0",
		truncated: false,
	};
	if (entry.kind === "symlink") return { ...empty, status: "symlink" };
	const content = entry.content;
	if (content.status === "omitted")
		return { ...empty, status: "omitted", omitted_reason: content.reason };
	// The CLI skips empty blobs; any other blob must be part of this upload.
	if (
		content.status === "available" &&
		content.storedByteLength > 0 &&
		!uploaded.has(content.blobId)
	)
		return { ...empty, status: "omitted", omitted_reason: "blob-not-uploaded" };
	const truncated = content.truncation !== undefined;
	return {
		status:
			content.status === "reused"
				? "reused"
				: truncated
					? "truncated"
					: "captured",
		omitted_reason: "",
		blob_object_id: content.blobId,
		blob_capture_id:
			content.status === "reused" ? content.parentCaptureId : captureId,
		source_bytes: String(content.sourceByteLength),
		stored_bytes: String(content.storedByteLength),
		original_bytes: String(content.truncation?.originalByteLength ?? 0),
		truncated,
	};
}

function version(status: SavedOutputStatus, capturedAt: Date): string {
	return String(
		STATUS_RANK[status] * RANK_SHIFT + BigInt(capturedAt.getTime()),
	);
}

function formatDateTime(value: Date): string {
	return value.toISOString().replace("T", " ").replace("Z", "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}
