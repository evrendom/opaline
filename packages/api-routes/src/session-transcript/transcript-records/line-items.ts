import type { ShellFileMutation } from "./command-class.js";
import type { UserTextClassification } from "./injected-wrappers.js";
import type {
	CommandClass,
	FileOperation,
	TranscriptRecordFacts,
	TranscriptRecordKind,
} from "./types.js";

/** Facts of one item; the agent version and entrypoint come from the stream. */
export type LineFacts = Partial<
	Omit<TranscriptRecordFacts, "agentVersion" | "entrypoint">
>;

/** One logical row derived from a raw JSONL line, before identity and text caps. */
export interface LineItem {
	readonly callId?: string;
	readonly commandClass?: CommandClass;
	readonly exitCode?: number | null;
	/** Literal facts the line carries for this item (parser v6). */
	readonly facts?: LineFacts;
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
	/** MCP identity recorded with the call, repeated on its result. */
	readonly facts?: LineFacts;
	readonly toolName: string;
}

export interface CodexEndEvent {
	readonly exitCode: number | null;
	readonly success: boolean | null;
}

/** The latest Codex code-mode `exec` script and the patch paths read from its source. */
export interface CodexExecScript {
	readonly callId: string;
	readonly patchPaths: ReadonlySet<string>;
}

/** Mutable per-stream context shared by the format adapters and the core loop. */
export interface StreamState {
	/** Agent version of the latest record that named one (Claude `version`, Codex `cli_version`). */
	agentVersion: string;
	readonly calls: Map<string, KnownCall>;
	codexAgentPath: string;
	/** Ids of completed Codex items already recorded (an item can complete twice). */
	readonly codexCompletedItems: Set<string>;
	readonly codexEndEvents: Map<string, CodexEndEvent>;
	codexExecScript: CodexExecScript | undefined;
	/**
	 * Completed native web searches whose `web_search_call` response item, which
	 * Codex writes right after the completion, has not arrived yet.
	 */
	codexPendingWebSearchMirrors: number;
	/** How the agent was started (Claude `entrypoint`, Codex `originator`). */
	entrypoint: string;
	isSubagent: boolean;
	/**
	 * Claude prompts delivered as queued-command attachments whose user message
	 * copy, which some versions also write, has not been seen yet.
	 */
	readonly claudeQueuedPrompts: string[];
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
		agentVersion: "",
		calls: new Map(),
		claudeQueuedPrompts: [],
		codexAgentPath: "",
		codexCompletedItems: new Set(),
		codexEndEvents: new Map(),
		codexExecScript: undefined,
		codexPendingWebSearchMirrors: 0,
		entrypoint: "",
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

/**
 * The instructions that arrived in one message with a human prompt (Conductor
 * system instructions, reminders, AGENTS.md), kept readable as their own
 * `injected_context` block after the prompt.
 */
export function injectedAroundPrompt(
	classification: Extract<UserTextClassification, { kind: "prompt" }>,
): LineItem[] {
	return classification.injected === ""
		? []
		: [
				{
					kind: "injected_context",
					subtype: classification.injectedSubtype || "injected",
					text: classification.injected,
				},
			];
}
