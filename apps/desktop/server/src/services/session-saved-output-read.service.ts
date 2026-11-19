import { createHash } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import {
	SAVED_OUTPUT_MAX_TEXT_BYTES,
	type SessionSavedOutput,
	type SessionSavedOutputInput,
} from "@rudel/api-routes/session-saved-outputs";
import { SESSION_SAVED_OUTPUTS_TABLE } from "@rudel/ch-schema/session-saved-outputs";
import type postgres from "postgres";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";
import {
	TASK_OUTPUTS_ROOT_ID,
	TOOL_RESULTS_ROOT_ID,
} from "./session-saved-outputs.service.js";

const logger = getLogger(["rudel", "api", "session-saved-outputs"]);

interface SavedOutputRow {
	readonly kind: string;
	readonly path: string;
	readonly task_id: string;
	readonly tool_use_id: string;
	readonly agent_id: string;
	readonly record_idx: number | string;
	readonly status: string;
	readonly omitted_reason: string;
	readonly blob_object_id: string;
	readonly source_bytes: string;
	readonly stored_bytes: string;
	readonly original_bytes: string;
	readonly truncated: boolean | number;
	readonly captured_at: string;
	readonly capture_reason: string;
}

export interface SavedOutputReadDependencies {
	readonly clickhouse: ClickHouseExecutor;
	readonly database: postgres.Sql;
	/** The evidence object store, or null when it is not configured. */
	readonly r2: () => Pick<R2MultipartUploadClient, "getObject"> | null;
	readonly maxTextBytes?: number;
	readonly signal?: AbortSignal;
}

type RowStatus = Exclude<SessionSavedOutput["status"], "not_captured">;
const STATUSES: readonly string[] = [
	"captured",
	"truncated",
	"reused",
	"omitted",
	"symlink",
	"missing",
] satisfies readonly RowStatus[];
const WITH_CONTENT = new Set(["captured", "truncated", "reused"]);

/**
 * One saved output of a session whose owner the caller may read (the caller
 * checks), with its text from the evidence object store. The newest row wins
 * when a lookup matches several (`version` ranks content over none, then
 * time). `not_captured` when no capture of the session names it.
 */
export async function readSessionSavedOutput(
	input: SessionSavedOutputInput & {
		readonly organizationId: string;
		readonly ownerId: string;
	},
	deps: SavedOutputReadDependencies,
): Promise<SessionSavedOutput> {
	const where = [
		"organization_id = {organizationId:String}",
		"user_id = {ownerId:String}",
		"session_id = {sessionId:String}",
	];
	const params: Record<string, string> = {
		organizationId: input.organizationId,
		ownerId: input.ownerId,
		sessionId: input.sessionId,
	};
	if (input.taskId !== undefined) {
		where.push("task_id = {taskId:String}", "root_id = {taskRoot:String}");
		params.taskId = input.taskId;
		params.taskRoot = TASK_OUTPUTS_ROOT_ID;
	} else if (input.toolUseId !== undefined) {
		where.push("tool_use_id = {toolUseId:String}");
		params.toolUseId = input.toolUseId;
	} else if (input.path !== undefined) {
		where.push("path = {path:String}");
		params.path = input.path;
	}
	if (input.kind !== undefined) {
		where.push("root_id = {kindRoot:String}");
		params.kindRoot =
			input.kind === "task_output"
				? TASK_OUTPUTS_ROOT_ID
				: TOOL_RESULTS_ROOT_ID;
	}
	const [row] = await deps.clickhouse.query<SavedOutputRow>({
		query: `SELECT kind, path, task_id, tool_use_id, agent_id, record_idx, status,
				omitted_reason, blob_object_id, toString(source_bytes) AS source_bytes,
				toString(stored_bytes) AS stored_bytes,
				toString(original_bytes) AS original_bytes, truncated,
				toString(captured_at) AS captured_at, capture_reason
			FROM ${getSafeClickHouseTable(SESSION_SAVED_OUTPUTS_TABLE)} FINAL
			WHERE ${where.join(" AND ")}
			ORDER BY version DESC, path
			LIMIT 1`,
		query_params: params,
		clickhouse_settings: { max_execution_time: 10 },
		abortSignal: deps.signal,
	});
	if (!row || !isStatus(row.status)) return notCaptured(input);

	const truncated = row.truncated === true || row.truncated === 1;
	const output: SessionSavedOutput = {
		status: row.status,
		kind: row.kind === "task_output" ? "task_output" : "tool_result",
		path: row.path,
		taskId: row.task_id || null,
		toolUseId: row.tool_use_id || null,
		agentId: row.agent_id || null,
		recordIndex: Number(row.record_idx) || null,
		truncated,
		originalBytes: truncated ? Number(row.original_bytes) : null,
		sourceBytes: WITH_CONTENT.has(row.status) ? Number(row.source_bytes) : null,
		storedBytes: WITH_CONTENT.has(row.status) ? Number(row.stored_bytes) : null,
		omittedReason: row.omitted_reason || null,
		capturedAt: `${row.captured_at.replace(" ", "T")}Z`,
		captureReason:
			row.capture_reason === "task-output-sweep" ? "task-output-sweep" : null,
	};
	if (!WITH_CONTENT.has(row.status) || !row.blob_object_id) return output;
	return {
		...output,
		...(await readText({
			blobObjectId: row.blob_object_id,
			storedBytes: Number(row.stored_bytes),
			organizationId: input.organizationId,
			deps,
		})),
	};
}

async function readText(input: {
	readonly blobObjectId: string;
	readonly storedBytes: number;
	readonly organizationId: string;
	readonly deps: SavedOutputReadDependencies;
}): Promise<Pick<SessionSavedOutput, "text" | "textUnavailable">> {
	// The CLI uploads no object for an empty text.
	if (input.storedBytes === 0) return { text: "" };
	const maxBytes = input.deps.maxTextBytes ?? SAVED_OUTPUT_MAX_TEXT_BYTES;
	if (input.storedBytes > maxBytes) return { textUnavailable: "too-large" };
	// Objects are stored once per workspace; a reused blob is the earlier
	// capture's object under the same id.
	const [object] = await input.deps.database.unsafe<
		Array<{ objectKey: string; byteLength: number }>
	>(
		`SELECT object_key AS "objectKey", byte_length AS "byteLength"
		 FROM repository_evidence_object
		 WHERE organization_id = $1 AND object_id = $2 AND status = 'available'
		 LIMIT 1`,
		[input.organizationId, input.blobObjectId],
	);
	if (!object) return { textUnavailable: "blob-unavailable" };
	if (object.byteLength > maxBytes) return { textUnavailable: "too-large" };
	const r2 = input.deps.r2();
	if (!r2) return { textUnavailable: "storage-unavailable" };
	let bytes: Uint8Array;
	try {
		bytes = await r2.getObject(object.objectKey, input.deps.signal);
	} catch (error) {
		logger.warn("Saved output text could not be read: {error}", {
			error: String(error),
		});
		return { textUnavailable: "blob-unavailable" };
	}
	const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
	if (bytes.byteLength > maxBytes || digest !== input.blobObjectId) {
		logger.error("Saved output object {objectId} failed verification", {
			objectId: input.blobObjectId,
		});
		return { textUnavailable: "blob-unavailable" };
	}
	return { text: new TextDecoder().decode(bytes) };
}

function notCaptured(input: SessionSavedOutputInput): SessionSavedOutput {
	return {
		status: "not_captured",
		kind: input.kind ?? (input.taskId === undefined ? null : "task_output"),
		path: input.path ?? null,
		taskId: input.taskId ?? null,
		toolUseId: input.toolUseId ?? null,
		agentId: null,
		recordIndex: null,
		truncated: false,
		originalBytes: null,
		sourceBytes: null,
		storedBytes: null,
		omittedReason: null,
		capturedAt: null,
		captureReason: null,
	};
}

function isStatus(value: string): value is RowStatus {
	return STATUSES.includes(value);
}
