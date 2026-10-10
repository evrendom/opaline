import { redactReturnedText } from "@rudel/secret-filter";
import { isRecord, type LineFacts, readString } from "./line-items.js";
import { countCodePoints, sliceStart } from "./text-fields.js";
import {
	TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS,
	TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS,
	type TranscriptRecordFactKey,
} from "./types.js";

/**
 * Literal facts a record carries (parser v6, docs/l1-literal-schema.md step 7).
 * Each value is copied as the agent wrote it, never inferred: a fact the line
 * does not carry stays absent. Free text goes through the secret filter and
 * loses URL credentials before it is capped, since the transcript filter ran
 * over the whole line and a value lifted out of it can still match a rule
 * on its own.
 */

const UINT32_MAX = 4_294_967_295;
/** A URL's whole userinfo: up to the authority's last `@`, since passwords may hold one. */
const URL_USERINFO_PATTERN = /([a-z][a-z\d+.-]*:\/\/)[^/\s?#]*@/giu;
const GIT_OPERATION_FIELDS: Readonly<
	Record<string, readonly (readonly [string, TranscriptRecordFactKey])[]>
> = {
	branch: [
		["ref", "git.branch.ref"],
		["action", "git.branch.action"],
	],
	commit: [
		["sha", "git.commit.sha"],
		["kind", "git.commit.kind"],
	],
	pr: [
		["number", "git.pr.number"],
		["action", "git.pr.action"],
		["url", "git.pr.url"],
	],
	push: [["branch", "git.push.branch"]],
};

type ExtraFacts = Partial<Record<TranscriptRecordFactKey, string>>;

/**
 * Free text safe to store as a fact value: URL credentials removed, then
 * known secret formats and generic credentials (assignments such as
 * `API_KEY=…`, `--token …` flags, bearer tokens) redacted, then capped.
 */
export function factText(
	value: string,
	maxChars = TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS,
): string {
	const redacted = redactReturnedText(
		value.replace(URL_USERINFO_PATTERN, "$1"),
	);
	return sliceStart(redacted, maxChars);
}

/** Milliseconds as a UInt32, or undefined when the value is not a usable duration. */
export function durationMs(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return undefined;
	return Math.min(UINT32_MAX, Math.round(value));
}

/** A Codex `{secs, nanos}` duration in milliseconds. */
export function codexDurationMs(value: unknown): number | undefined {
	if (!isRecord(value)) return undefined;
	const secs = typeof value.secs === "number" ? value.secs : undefined;
	const nanos = typeof value.nanos === "number" ? value.nanos : 0;
	return secs === undefined
		? undefined
		: durationMs(secs * 1_000 + nanos / 1e6);
}

/**
 * Facts of a Claude Code tool result: the user record's `toolDenialKind` and
 * the fields of its `toolUseResult` object (a string on denied calls).
 */
export function claudeToolResultFacts(
	toolUseResult: Record<string, unknown> | undefined,
	denialKind: string | undefined,
): LineFacts {
	const facts: { -readonly [K in keyof LineFacts]: LineFacts[K] } = {};
	const extra: ExtraFacts = {};
	if (denialKind !== undefined) facts.denialKind = factText(denialKind, 64);
	if (toolUseResult === undefined) return facts;
	const result = toolUseResult;

	if (typeof result.interrupted === "boolean")
		facts.interrupted = result.interrupted;
	const timedOut = durationMs(result.timedOutAfterMs);
	if (timedOut !== undefined) facts.timedOutAfterMs = timedOut;
	const duration =
		durationMs(result.durationMs) ??
		(typeof result.durationSeconds === "number"
			? durationMs(result.durationSeconds * 1_000)
			: undefined);
	if (duration !== undefined) facts.durationMs = duration;

	setBoolean(extra, "no_output_expected", result.noOutputExpected);
	setBoolean(extra, "is_async", result.isAsync);
	setBoolean(extra, "user_modified", result.userModified);
	setInteger(extra, "timeout_ms", result.timeoutMs);
	setInteger(extra, "persisted_output_bytes", result.persistedOutputSize);
	setText(extra, "return_code_interpretation", result.returnCodeInterpretation);
	setText(extra, "background_task_id", result.backgroundTaskId);
	setText(extra, "stale_read", result.staleReadFileStateHint);
	setInteger(extra, "search_matches", result.numFiles);
	if (typeof result.stdout === "string")
		extra.stdout_chars = String(countCodePoints(result.stdout));
	if (typeof result.stderr === "string")
		extra.stderr_chars = String(countCodePoints(result.stderr));

	const patch = patchLineCounts(result.structuredPatch);
	if (patch !== undefined) {
		extra.patch_lines_added = String(patch.added);
		extra.patch_lines_removed = String(patch.removed);
	}

	if (isRecord(result.gitOperation)) {
		const operations: string[] = [];
		for (const [operation, value] of Object.entries(result.gitOperation)) {
			const fields = GIT_OPERATION_FIELDS[operation];
			if (fields === undefined || !isRecord(value)) continue;
			operations.push(operation);
			for (const [field, key] of fields) setText(extra, key, value[field]);
		}
		if (operations.length > 0) facts.gitOperation = operations;
	}

	if (isRecord(result.bashEditDiff)) {
		Object.assign(extra, shellEditFiles(result.bashEditDiff));
	}

	if (Object.keys(extra).length > 0) facts.extra = extra;
	return facts;
}

/** Facts of a Claude Code `pr-link` record. */
export function claudePrLinkFacts(record: Record<string, unknown>): LineFacts {
	const extra: ExtraFacts = {};
	setText(extra, "pr_repository", record.prRepository);
	setText(extra, "pr_number", record.prNumber);
	setText(extra, "pr_url", record.prUrl);
	return Object.keys(extra).length === 0 ? {} : { extra };
}

/**
 * Facts of a Codex completed item that carries a call's duration and MCP
 * identity (`CommandExecution`, `McpToolCall`).
 */
export function codexItemFacts(item: Record<string, unknown>): LineFacts {
	const facts: { -readonly [K in keyof LineFacts]: LineFacts[K] } = {};
	const extra: ExtraFacts = {};
	const duration = codexDurationMs(item.duration);
	if (duration !== undefined) facts.durationMs = duration;
	if (item.type === "McpToolCall") {
		const server = readString(item.server);
		const tool = readString(item.tool);
		if (server !== undefined) facts.mcpServer = factText(server, 128);
		if (tool !== undefined) facts.mcpTool = factText(tool, 128);
		setBoolean(extra, "mcp_read_only", item.readOnlyHint);
		setText(extra, "attribution_plugin", item.pluginId);
	}
	if (Object.keys(extra).length > 0) facts.extra = extra;
	return facts;
}

/** The MCP identity of a call; it lands on both the call and its result. */
export function mcpFacts(facts: LineFacts): LineFacts {
	return {
		...(facts.mcpServer === undefined ? {} : { mcpServer: facts.mcpServer }),
		...(facts.mcpTool === undefined ? {} : { mcpTool: facts.mcpTool }),
	};
}

/** Merge facts; later values win, `extra` keys merge. */
export function mergeFacts(
	...parts: readonly (LineFacts | undefined)[]
): LineFacts {
	const merged: { -readonly [K in keyof LineFacts]: LineFacts[K] } = {};
	const extra: ExtraFacts = {};
	for (const part of parts) {
		if (part === undefined) continue;
		const { extra: partExtra, ...rest } = part;
		Object.assign(merged, rest);
		if (partExtra !== undefined) Object.assign(extra, partExtra);
	}
	if (Object.keys(extra).length > 0) merged.extra = extra;
	return merged;
}

function patchLineCounts(
	value: unknown,
): { added: number; removed: number } | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	let added = 0;
	let removed = 0;
	for (const hunk of value) {
		if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue;
		for (const line of hunk.lines) {
			if (typeof line !== "string") continue;
			if (line.startsWith("+")) added++;
			else if (line.startsWith("-")) removed++;
		}
	}
	return { added, removed };
}

/**
 * Claude `bashEditDiff`: the edited `files` (path and created/deleted flags),
 * the `changedFiles` paths, `moreFiles`, and whether the diff was
 * `unavailable` or `shared`. Recorded empty lists and zero counts are kept.
 */
function shellEditFiles(diff: Record<string, unknown>): ExtraFacts {
	const extra: ExtraFacts = {};
	if (Array.isArray(diff.files)) {
		const entries = diff.files.flatMap((file) => {
			if (!isRecord(file)) return [];
			const filePath = readString(file.filePath);
			if (filePath === undefined) return [];
			const entry: Record<string, unknown> = { filePath: factText(filePath) };
			if (file.created === true) entry.created = true;
			if (file.deleted === true) entry.deleted = true;
			return [entry];
		});
		const list = cappedJsonList(entries);
		extra.shell_edit_files = list.json;
		const recordedMore =
			typeof diff.moreFiles === "number" && Number.isSafeInteger(diff.moreFiles)
				? Math.max(0, diff.moreFiles)
				: undefined;
		if (recordedMore !== undefined || list.cut > 0)
			extra.shell_edit_files_more = String((recordedMore ?? 0) + list.cut);
	}
	if (Array.isArray(diff.changedFiles)) {
		const list = cappedJsonList(
			diff.changedFiles.flatMap((path) =>
				typeof path === "string" && path !== "" ? [factText(path)] : [],
			),
		);
		extra.shell_edit_changed_files = list.json;
		if (list.cut > 0) extra.shell_edit_changed_files_more = String(list.cut);
	}
	setBoolean(extra, "shell_edit_unavailable", diff.unavailable);
	setBoolean(extra, "shell_edit_shared", diff.shared);
	return extra;
}

/** A JSON list of whole entries that fits the list cap, and how many were cut. */
function cappedJsonList(entries: readonly unknown[]): {
	json: string;
	cut: number;
} {
	const kept: unknown[] = [];
	let chars = 2;
	for (const entry of entries) {
		const entryChars = countCodePoints(JSON.stringify(entry)) + 1;
		if (chars + entryChars > TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS) break;
		chars += entryChars;
		kept.push(entry);
	}
	return { json: JSON.stringify(kept), cut: entries.length - kept.length };
}

function setBoolean(
	extra: ExtraFacts,
	key: TranscriptRecordFactKey,
	value: unknown,
): void {
	if (typeof value === "boolean") extra[key] = String(value);
}

function setInteger(
	extra: ExtraFacts,
	key: TranscriptRecordFactKey,
	value: unknown,
): void {
	if (typeof value === "number" && Number.isSafeInteger(value))
		extra[key] = String(value);
}

function setText(
	extra: ExtraFacts,
	key: TranscriptRecordFactKey,
	value: unknown,
): void {
	if (typeof value === "number" && Number.isFinite(value)) {
		extra[key] = String(value);
		return;
	}
	const text = readString(value);
	if (text !== undefined) extra[key] = factText(text);
}
