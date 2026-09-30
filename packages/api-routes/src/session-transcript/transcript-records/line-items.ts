import type { ShellFileMutation } from "./command-class.js";
import type {
	CommandClass,
	FileOperation,
	TranscriptRecordKind,
} from "./types.js";

/** One logical row derived from a raw JSONL line, before identity and text caps. */
export interface LineItem {
	readonly callId?: string;
	readonly commandClass?: CommandClass;
	readonly exitCode?: number | null;
	readonly fileOp?: FileOperation;
	readonly filePath?: string;
	readonly isError?: boolean;
	readonly kind: TranscriptRecordKind;
	readonly spawnedAgentId?: string;
	readonly subtype?: string;
	/** Full decoded text. Left empty for kinds whose body is not worth storing. */
	readonly text?: string;
	readonly toolName?: string;
}

export interface LineResult {
	readonly items: readonly LineItem[];
	readonly timestamp?: string;
}

export interface KnownCall {
	readonly commandClass: CommandClass;
	readonly toolName: string;
}

export interface CodexEndEvent {
	readonly exitCode: number | null;
	readonly success: boolean | null;
}

/** Mutable per-stream context shared by the format adapters and the core loop. */
export interface StreamState {
	readonly calls: Map<string, KnownCall>;
	codexAgentPath: string;
	readonly codexEndEvents: Map<string, CodexEndEvent>;
	isSubagent: boolean;
	/** Text of the latest genuine prompt, used to collapse Codex mirror events. */
	lastPromptText: string;
	lastTs: string;
	/** True once any response record followed the latest prompt. */
	responseSincePrompt: boolean;
	turnIdx: number;
}

export function createStreamState(
	fallbackTs: string,
	isSubagent = false,
): StreamState {
	return {
		calls: new Map(),
		codexAgentPath: "",
		codexEndEvents: new Map(),
		isSubagent,
		lastPromptText: "",
		lastTs: fallbackTs,
		responseSincePrompt: false,
		turnIdx: 0,
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}

/** Keep meta labels short and safe to use as LowCardinality values. */
export function sanitizeLabel(value: string): string {
	const cleaned = value.replace(/[^A-Za-z0-9_:.-]/gu, "_").slice(0, 64);
	return cleaned === "" ? "unknown" : cleaned;
}

export function metaItem(
	label: string,
	extra: Partial<LineItem> = {},
): LineItem {
	return { ...extra, kind: "meta", subtype: sanitizeLabel(label) };
}

/**
 * File-change item for a shell mutation. Only a `direct` mutation is recorded
 * as a working-tree change; conditional and index-only ones keep an
 * `inferred_*` operation so facts never count them.
 */
export function shellFileChangeItem(
	mutation: ShellFileMutation,
	callId: string,
	toolName: string,
): LineItem {
	const direct = mutation.basis === "direct";
	return {
		callId,
		fileOp: direct ? mutation.operation : `inferred_${mutation.operation}`,
		filePath: mutation.path,
		kind: "file_change",
		subtype: direct ? "shell" : `shell_${mutation.basis}`,
		toolName,
	};
}
