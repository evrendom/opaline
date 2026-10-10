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
	if (item.type === "SubAgentActivity") {
		const thread = readString(item.agent_thread_id);
		if (thread !== undefined)
			setList(
				extra,
				"spawned_thread_ids",
				"spawned_thread_ids_more",
				[thread],
				128,
			);
	}
	if (
		item.type === "CollabAgentToolCall" &&
		Array.isArray(item.receiver_thread_ids)
	)
		setList(
			extra,
			"spawned_thread_ids",
			"spawned_thread_ids_more",
			item.receiver_thread_ids.filter(
				(thread): thread is string =>
					typeof thread === "string" && thread !== "",
			),
			128,
		);
	if (Object.keys(extra).length > 0) facts.extra = extra;
	return facts;
}

/**
 * Facts of a Codex `turn_context`: the approval, sandbox and permission
 * settings, collaboration mode, model and effort the turn ran with.
 */
export function codexTurnContextFacts(
	payload: Record<string, unknown>,
): LineFacts {
	const extra: ExtraFacts = {};
	setText(extra, "turn_id", payload.turn_id);
	setText(extra, "approval_policy", payload.approval_policy);
	setText(extra, "approvals_reviewer", payload.approvals_reviewer);
	const sandbox = isRecord(payload.sandbox_policy)
		? payload.sandbox_policy
		: undefined;
	setText(extra, "sandbox_policy", sandbox?.type ?? payload.sandbox_policy);
	setBoolean(extra, "sandbox_network_access", sandbox?.network_access);
	const profile = isRecord(payload.permission_profile)
		? payload.permission_profile
		: undefined;
	setText(
		extra,
		"permission_profile",
		profile?.type ?? payload.permission_profile,
	);
	const collaboration = isRecord(payload.collaboration_mode)
		? payload.collaboration_mode
		: undefined;
	setText(extra, "collaboration_mode", collaboration?.mode);
	setText(extra, "model", payload.model);
	setText(extra, "effort", payload.effort);
	return withExtra({}, extra);
}

/**
 * Facts of a Codex task or abort event: `task_started` (context window,
 * collaboration mode), `task_complete` (duration, time to first token,
 * error), `turn_aborted` (duration, reason), `thread_goal_updated` (goal).
 */
export function codexTaskFacts(
	type: string,
	payload: Record<string, unknown>,
): LineFacts {
	const facts: { -readonly [K in keyof LineFacts]: LineFacts[K] } = {};
	const extra: ExtraFacts = {};
	setText(extra, "turn_id", payload.turn_id);
	if (type === "task_started") {
		setInteger(extra, "context_window", payload.model_context_window);
		setText(extra, "collaboration_mode", payload.collaboration_mode_kind);
	}
	if (type === "task_complete" || type === "turn_aborted") {
		const duration = durationMs(payload.duration_ms);
		if (duration !== undefined) facts.durationMs = duration;
	}
	if (type === "task_complete") {
		setInteger(extra, "time_to_first_token_ms", payload.time_to_first_token_ms);
		const error = isRecord(payload.error) ? payload.error : undefined;
		setText(extra, "turn_error", error?.message ?? payload.error);
		const info = error?.codex_error_info;
		if (isRecord(info)) {
			// A variant with a payload: `{"http_connection_failed": {...}}`.
			setText(extra, "turn_error_kind", Object.keys(info)[0]);
			setText(extra, "turn_error_info", JSON.stringify(info));
		} else setText(extra, "turn_error_kind", info);
	}
	if (type === "turn_aborted") {
		extra.aborted = "true";
		setText(extra, "abort_reason", payload.reason);
	}
	if (type === "thread_goal_updated") {
		const goal = isRecord(payload.goal) ? payload.goal : undefined;
		setText(extra, "goal", goal?.objective ?? payload.goal);
		setText(extra, "goal_status", goal?.status);
		setInteger(extra, "goal_tokens_used", goal?.tokensUsed);
		setInteger(extra, "goal_time_used_seconds", goal?.timeUsedSeconds);
	}
	return withExtra(facts, extra);
}

/**
 * Run facts of a Claude record's own fields, which apply to every record the
 * line yields: the prompt's `permissionMode`, `interruptedByShutdown`, and an
 * assistant line's model, effort and stop reason.
 */
export function claudeLineFacts(record: Record<string, unknown>): LineFacts {
	const extra: ExtraFacts = {};
	setBoolean(extra, "aborted", record.interruptedByShutdown);
	if (record.type === "assistant") {
		const message = isRecord(record.message) ? record.message : undefined;
		setText(extra, "model", message?.model);
		setText(extra, "stop_reason", message?.stop_reason);
		setText(extra, "effort", record.effort);
		setText(extra, "per_turn_effort", record.perTurnEffort);
	}
	return withExtra({}, extra);
}

/**
 * Facts a Claude prompt line records about its prompt: the permission mode.
 * They belong to the prompt's records, not to tool results on the same line.
 */
export function claudePromptFacts(record: Record<string, unknown>): LineFacts {
	const extra: ExtraFacts = {};
	setText(extra, "permission_mode", record.permissionMode);
	return withExtra({}, extra);
}

/** Facts of a Claude API error written as an assistant message. */
export function claudeApiErrorFacts(
	record: Record<string, unknown>,
): LineFacts {
	const extra: ExtraFacts = {};
	setText(extra, "api_error", record.error);
	setInteger(extra, "api_error_status", record.apiErrorStatus);
	return withExtra({}, extra);
}

/**
 * Facts of a Claude `system` record: stop hook summaries, API retries,
 * model refusals and compaction metadata.
 */
export function claudeSystemFacts(record: Record<string, unknown>): LineFacts {
	const extra: ExtraFacts = {};
	if (record.subtype === "stop_hook_summary") {
		if (typeof record.stopReason === "string")
			extra.hook_stop_reason = clippedText(
				extra,
				"hook_stop_reason",
				record.stopReason,
			);
		setBoolean(extra, "prevented_continuation", record.preventedContinuation);
		setInteger(extra, "hook_count", record.hookCount);
		if (Array.isArray(record.hookErrors))
			setList(
				extra,
				"hook_errors",
				"hook_errors_more",
				record.hookErrors.flatMap((error) =>
					error === null || error === undefined
						? []
						: [typeof error === "string" ? error : JSON.stringify(error)],
				),
			);
		if (Array.isArray(record.hookInfos)) {
			const runs = record.hookInfos.flatMap((hook) => {
				if (!isRecord(hook)) return [];
				const run: Record<string, unknown> = {};
				const command = readString(hook.command);
				if (command !== undefined)
					run.command = clippedText(extra, "hook_runs", command);
				const duration = durationMs(hook.durationMs);
				if (duration !== undefined) run.durationMs = duration;
				return [run];
			});
			const list = cappedJsonList(runs);
			extra.hook_runs = list.json;
			if (list.cut > 0) extra.hook_runs_more = String(list.cut);
		}
	}
	setInteger(extra, "retry_attempt", record.retryAttempt);
	setInteger(extra, "max_retries", record.maxRetries);
	setInteger(extra, "retry_in_ms", record.retryInMs);
	setText(extra, "refusal_category", record.apiRefusalCategory);
	setText(extra, "original_model", record.originalModel);
	setText(extra, "fallback_model", record.fallbackModel);
	if (isRecord(record.compactMetadata)) {
		setText(extra, "compact_trigger", record.compactMetadata.trigger);
		setInteger(extra, "compact_pre_tokens", record.compactMetadata.preTokens);
	}
	return withExtra({}, extra);
}

/** Facts of a Claude `auto_mode` attachment. */
export function claudeAutoModeFacts(
	attachment: Record<string, unknown>,
): LineFacts {
	const extra: ExtraFacts = {};
	setBoolean(extra, "auto_mode_bash_first", attachment.bashFirst);
	setText(extra, "auto_mode_bash_first_steer", attachment.bashFirstSteer);
	setBoolean(extra, "auto_mode_bypass", attachment.bypass);
	setBoolean(extra, "auto_mode_steer_only", attachment.steerOnly);
	setBoolean(extra, "auto_mode_consent_flow", attachment.autoModeConsentFlow);
	return withExtra({}, extra);
}

function withExtra(
	facts: { -readonly [K in keyof LineFacts]: LineFacts[K] },
	extra: ExtraFacts,
): LineFacts {
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
	const clipped = new Set<string>();
	for (const part of parts) {
		if (part === undefined) continue;
		const { extra: partExtra, ...rest } = part;
		Object.assign(merged, rest);
		if (partExtra === undefined) continue;
		Object.assign(extra, partExtra);
		for (const key of (partExtra.facts_clipped ?? "").split(","))
			if (key !== "") clipped.add(key);
	}
	// Each part lists its own clipped keys; the merge keeps all of them.
	if (clipped.size > 0) extra.facts_clipped = [...clipped].sort().join(",");
	if (Object.keys(extra).length > 0) merged.extra = extra;
	return merged;
}

/**
 * Text of a record lifted from one field of its line (an error, a goal, a
 * title): redacted like a fact value but not capped; the text fields cap it.
 */
export function factRowText(value: string): string {
	return factText(value, Number.MAX_SAFE_INTEGER);
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
		// A comma separates entries; the first needs none.
		const entryChars =
			countCodePoints(JSON.stringify(entry)) + (kept.length > 0 ? 1 : 0);
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
	if (text !== undefined) extra[key] = clippedText(extra, key, text);
}

/** `factText`, noting `key` in `facts_clipped` when the cap cut the value. */
function clippedText(
	extra: ExtraFacts,
	key: TranscriptRecordFactKey,
	value: string,
	maxChars = TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS,
): string {
	const full = factText(value, Number.MAX_SAFE_INTEGER);
	const text = sliceStart(full, maxChars);
	if (text.length < full.length) {
		const keys = new Set(
			(extra.facts_clipped ?? "").split(",").filter((name) => name !== ""),
		);
		keys.add(key);
		extra.facts_clipped = [...keys].sort().join(",");
	}
	return text;
}

/**
 * A JSON list of text entries cut to whole entries at the list cap, with the
 * number cut under `moreKey`; an entry cut at its own cap marks `key` clipped.
 */
function setList(
	extra: ExtraFacts,
	key: TranscriptRecordFactKey,
	moreKey: TranscriptRecordFactKey,
	entries: readonly string[],
	entryMaxChars = TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS,
): void {
	const list = cappedJsonList(
		entries.map((entry) => clippedText(extra, key, entry, entryMaxChars)),
	);
	extra[key] = list.json;
	if (list.cut > 0) extra[moreKey] = String(list.cut);
}
