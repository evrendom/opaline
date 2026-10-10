import { extractCustomExecInvocations } from "../codex-javascript-extractor.js";
import {
	type CodexPatchFile,
	parseCodexPatch,
	translateCodexToolCall,
} from "../codex-tool-translation.js";
import { readTranscriptToolOutputText } from "../transcript-tool-output.js";
import {
	argvToCommand,
	readCompletedItem,
	takeWebSearchMirror,
} from "./codex-completed-items.js";
import {
	classifyCommand,
	combineCommandClasses,
	extractShellFileMutations,
} from "./command-class.js";
import { isCodexRunningOutput, readCodexExitCode } from "./exit-code.js";
import { readCodexImageOutputText } from "./image-labels.js";
import { classifyUserText } from "./injected-wrappers.js";
import {
	injectedAroundPrompt,
	isRecord,
	type LineItem,
	type LineResult,
	metaItem,
	readString,
	type StreamState,
	safeStringify,
	shellFileChangeItem,
} from "./line-items.js";
import { codexDurationMs, factText } from "./record-facts.js";
import type { CommandClass } from "./types.js";

const SPAWN_TOOL_NAMES: ReadonlySet<string> = new Set([
	"spawn_agent",
	"task",
	"agent",
]);
const FAILURE_PREFIX_PATTERN =
	/^(?:apply_patch verification failed|collab spawn failed|Script failed)\b/u;
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
	"shell",
	"shell_command",
	"container.exec",
	"local_shell",
]);
const MIRROR_EVENTS: ReadonlySet<string> = new Set([
	"agent_message",
	"agent_message_delta",
	"agent_reasoning",
	"agent_reasoning_raw_content",
	"agent_reasoning_delta",
]);

/** Turn one parsed Codex JSONL record into record items. */
export function readCodexLine(
	record: Record<string, unknown>,
	state: StreamState,
): LineResult {
	const type = readString(record.type) ?? "";
	const timestamp = readString(record.timestamp);
	const payload = isRecord(record.payload) ? record.payload : {};
	switch (type) {
		case "session_meta":
			readSessionMetadata(payload, state);
			return { items: [metaItem("session_meta")], timestamp };
		case "response_item":
			return { items: readResponseItem(payload, state), timestamp };
		case "event_msg":
			return { items: readEventMessage(payload, state), timestamp };
		case "compacted":
		case "compaction":
			return {
				items: [
					{
						kind: "compaction",
						subtype: "compacted",
						text: readCompactedText(payload),
					},
				],
				timestamp,
			};
		default:
			return {
				items: [metaItem(type === "" ? "unknown" : type)],
				timestamp,
			};
	}
}

/**
 * The summary a Codex compaction carried forward: its `message`, else the
 * `replacement_history` messages that replaced the conversation, by role.
 */
function readCompactedText(payload: Record<string, unknown>): string {
	const message = readString(payload.message);
	if (message !== undefined) return message;
	const history = Array.isArray(payload.replacement_history)
		? payload.replacement_history
		: [];
	return history
		.flatMap((entry) => {
			if (!isRecord(entry)) return [];
			const text = readBlockText(entry.content);
			if (text === "") return [];
			const role = readString(entry.role);
			return [role === undefined ? text : `[${role}]\n${text}`];
		})
		.join("\n\n");
}

function readSessionMetadata(
	payload: Record<string, unknown>,
	state: StreamState,
): void {
	const source = isRecord(payload.source) ? payload.source : undefined;
	const subagent = isRecord(source?.subagent) ? source.subagent : undefined;
	const spawn = isRecord(subagent?.thread_spawn)
		? subagent.thread_spawn
		: undefined;
	const parentId =
		readString(payload.parent_thread_id) ?? readString(spawn?.parent_thread_id);
	state.isSubagent ||=
		payload.thread_source === "subagent" ||
		payload.source === "subagent" ||
		isRecord(source?.subagent) ||
		readString(source?.subagent) !== undefined ||
		(parentId !== undefined &&
			parentId !== payload.id &&
			parentId !== payload.session_id);
	state.codexAgentPath =
		readString(payload.agent_path) ??
		readString(spawn?.agent_path) ??
		state.codexAgentPath;
	const version = readString(payload.cli_version);
	if (version !== undefined) state.agentVersion = factText(version, 64);
	const originator = readString(payload.originator);
	if (originator !== undefined) state.entrypoint = factText(originator, 64);
}

/**
 * In-file sub-agent attribution (`payload.agent.agent_name`). The root agent
 * and unattributed records belong to the stream the file itself represents.
 */
export function readCodexAgentId(
	record: Record<string, unknown>,
): string | undefined {
	const payload = isRecord(record.payload) ? record.payload : undefined;
	const agent = isRecord(payload?.agent) ? payload.agent : undefined;
	const name = readString(agent?.agent_name);
	return name === undefined || name === "/root" ? undefined : name;
}

function readEventMessage(
	payload: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const type = readString(payload.type) ?? "";
	if (type === "user_message") {
		const message = readString(payload.message) ?? readString(payload.text);
		return message === undefined
			? [metaItem("user_message")]
			: userTextItems(message, state, "user_message_mirror");
	}
	if (MIRROR_EVENTS.has(type)) return [metaItem(`${type}_mirror`)];
	if (type === "item_completed") return readCompletedItem(payload.item, state);
	if (type === "exec_command_end") {
		const callId = readString(payload.call_id) ?? "";
		const exitCode = readFiniteNumber(payload.exit_code);
		const success =
			typeof payload.success === "boolean" ? payload.success : null;
		if (callId !== "") {
			state.codexEndEvents.set(callId, {
				exitCode: exitCode ?? null,
				success: success ?? (exitCode === undefined ? null : exitCode === 0),
			});
		}
		const duration = codexDurationMs(payload.duration);
		return [
			metaItem("exec_command_end", {
				callId,
				exitCode: exitCode ?? null,
				...(duration === undefined ? {} : { facts: { durationMs: duration } }),
				isError: exitCode !== undefined && exitCode !== 0,
			}),
		];
	}
	if (type === "patch_apply_end") {
		const callId = readString(payload.call_id) ?? "";
		const success =
			typeof payload.success === "boolean" ? payload.success : null;
		if (callId !== "") {
			state.codexEndEvents.set(callId, { exitCode: null, success });
		}
		return [
			metaItem("patch_apply_end", { callId, isError: success === false }),
		];
	}
	if (
		type === "context_compacted" ||
		type === "context_compaction" ||
		type === "compacted" ||
		type === "compaction"
	) {
		return [{ kind: "compaction", subtype: "compacted" }];
	}
	if (type === "error") {
		return [
			metaItem("error", {
				isError: true,
				text:
					readString(payload.message) ??
					readString(payload.error) ??
					readString(payload.detail) ??
					"",
			}),
		];
	}
	return [metaItem(type === "" ? "event" : type)];
}

function readResponseItem(
	payload: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const type = readString(payload.type) ?? "";
	if (type === "web_search_call") {
		if (takeWebSearchMirror(state)) return [metaItem("web_search_call_mirror")];
	} else {
		// The mirror follows its completion directly; anything else ends the wait.
		state.codexPendingWebSearchMirrors = 0;
	}
	switch (type) {
		case "message":
			return readMessage(payload, state);
		case "reasoning":
			return [{ kind: "reasoning", text: readReasoningText(payload) }];
		case "function_call":
		case "custom_tool_call":
		case "local_shell_call":
		case "tool_search_call":
		case "multi_agent_call":
		case "web_search_call":
			return readCall(type, payload, state);
		case "function_call_output":
		case "custom_tool_call_output":
		case "tool_search_output":
		case "multi_agent_call_output":
			return [readOutput(payload, state)];
		case "compaction":
			return [{ kind: "compaction", subtype: "compacted" }];
		case "agent_message":
			return [readAgentMessage(payload, state)];
		default:
			return [metaItem(type === "" ? "response_item" : type)];
	}
}

function readAgentMessage(
	payload: Record<string, unknown>,
	state: StreamState,
): LineItem {
	const text = readBlockText(payload.content);
	const author = readString(payload.author);
	const recipient = readString(payload.recipient);
	const ownPath = state.codexAgentPath;
	const incoming =
		ownPath !== ""
			? author !== ownPath && (recipient === undefined || recipient === ownPath)
			: recipient === undefined
				? author === undefined || author === "/root"
				: author !== undefined && recipient.startsWith(`${author}/`);
	if (state.isSubagent && incoming && text.trim() !== "") {
		if (ownPath === "" && recipient !== undefined) {
			state.codexAgentPath = recipient;
		}
		return { kind: "user_prompt", subtype: "delegation", text };
	}
	return metaItem("agent_message", { text });
}

function readMessage(
	payload: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const role = readString(payload.role) ?? "";
	const text = readBlockText(payload.content);
	if (role === "developer" || role === "system") {
		return [{ kind: "injected_context", subtype: "developer", text }];
	}
	if (role === "assistant") {
		return text === ""
			? [metaItem("assistant_empty")]
			: [{ kind: "assistant_text", text }];
	}
	if (role === "user") {
		return text.trim() === ""
			? [metaItem("user_empty")]
			: userTextItems(text, state, "user_message_mirror");
	}
	return [metaItem(`message_${role}`)];
}

function readBlockText(content: unknown): string {
	const blocks = Array.isArray(content) ? content : [];
	return blocks
		.flatMap((block) =>
			isRecord(block) && typeof block.text === "string" && block.text !== ""
				? [block.text]
				: [],
		)
		.join("\n");
}

function userTextItems(
	text: string,
	state: StreamState,
	mirrorLabel: string,
): LineItem[] {
	const classification = classifyUserText(text, {});
	switch (classification.kind) {
		case "prompt":
			if (
				!state.responseSincePrompt &&
				state.lastPromptText !== "" &&
				state.lastPromptText === classification.text
			) {
				// Codex records each prompt both as an event and as a response item.
				return [metaItem(mirrorLabel)];
			}
			return [
				{ kind: "user_prompt", text: classification.text },
				...injectedAroundPrompt(classification),
			];
		case "injected_context":
			return [
				{
					kind: "injected_context",
					subtype: classification.subtype,
					text,
				},
			];
		case "compaction":
			return [{ kind: "compaction", subtype: classification.subtype, text }];
		case "meta":
			return [metaItem(classification.subtype)];
	}
}

function readReasoningText(payload: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const key of ["summary", "content"] as const) {
		const value = payload[key];
		if (!Array.isArray(value)) continue;
		for (const part of value) {
			if (isRecord(part) && typeof part.text === "string" && part.text !== "") {
				parts.push(part.text);
			}
		}
	}
	return parts.join("\n");
}

interface CallDescription {
	readonly commands: readonly string[];
	readonly patchFiles: readonly CodexPatchFile[];
	readonly text: string;
}

function readCall(
	payloadType: string,
	payload: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const callId = readString(payload.call_id) ?? readString(payload.id) ?? "";
	const toolName = readCallToolName(payloadType, payload);
	const description = describeCall(payloadType, toolName, payload);
	const commandClass: CommandClass = combineCommandClasses(
		description.commands.map(classifyCommand),
	);
	const items: LineItem[] = [
		{
			callId,
			commandClass,
			kind: "tool_call",
			text: description.text,
			toolName,
		},
	];
	for (const file of description.patchFiles) {
		items.push(...patchFileItems(file, callId, toolName));
	}
	if (payloadType === "custom_tool_call" && toolName.toLowerCase() === "exec") {
		state.codexExecScript = {
			callId,
			patchPaths: new Set(
				description.patchFiles.flatMap((file) =>
					file.movePath === undefined
						? [file.path]
						: [file.path, file.movePath],
				),
			),
		};
	}
	const seen = new Set<string>();
	for (const command of description.commands) {
		for (const mutation of extractShellFileMutations(command)) {
			const key = `${mutation.basis}\u0000${mutation.operation}\u0000${mutation.path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push(shellFileChangeItem(mutation, callId, toolName));
		}
	}
	if (callId !== "") state.calls.set(callId, { commandClass, toolName });
	return items;
}

function readCallToolName(
	payloadType: string,
	payload: Record<string, unknown>,
): string {
	if (payloadType === "web_search_call") return "web_search";
	if (payloadType === "local_shell_call") return "local_shell";
	if (payloadType === "tool_search_call") return "tool_search";
	if (payloadType === "multi_agent_call") {
		return (
			readString(payload.action) ?? readString(payload.name) ?? "multi_agent"
		);
	}
	return readString(payload.name) ?? "unknown";
}

function describeCall(
	payloadType: string,
	toolName: string,
	payload: Record<string, unknown>,
): CallDescription {
	const lowered = toolName.toLowerCase();
	const rawInput =
		payloadType === "custom_tool_call" ? payload.input : payload.arguments;
	const rawText = typeof rawInput === "string" ? rawInput : undefined;
	const args = isRecord(rawInput) ? rawInput : parseObject(rawText);

	if (payloadType === "web_search_call") {
		const action = isRecord(payload.action) ? payload.action : {};
		const queries = Array.isArray(action.queries)
			? action.queries.filter((query) => typeof query === "string")
			: [];
		return {
			commands: [],
			patchFiles: [],
			text:
				readString(action.query) ??
				(queries.length > 0
					? queries.join("\n")
					: (readString(action.url) ?? "")),
		};
	}
	if (lowered === "apply_patch") {
		const patch =
			readString(args?.input) ?? readString(args?.patch) ?? rawText ?? "";
		return { commands: [], patchFiles: parseCodexPatch(patch), text: "" };
	}
	if (lowered === "exec" && payloadType === "custom_tool_call") {
		return describeExecScript(rawText ?? "");
	}
	if (lowered === "exec_command") {
		const command = readString(args?.cmd) ?? "";
		return describeExecCommand(command, args ?? {}, toolName);
	}
	if (payloadType === "local_shell_call" || SHELL_TOOL_NAMES.has(lowered)) {
		const action = isRecord(payload.action) ? payload.action : undefined;
		const command = argvToCommand(
			action?.command ?? args?.command ?? args?.cmd,
		);
		return {
			commands: command === "" ? [] : [command],
			patchFiles: [],
			text: command,
		};
	}
	return {
		commands: [],
		patchFiles: [],
		text: rawText ?? (rawInput === undefined ? "" : safeStringify(rawInput)),
	};
}

function describeExecCommand(
	command: string,
	args: Record<string, unknown>,
	toolName: string,
): CallDescription {
	if (command === "") return { commands: [], patchFiles: [], text: "" };
	const translation = translateCodexToolCall(toolName, args);
	if (translation.resolvedToolName === "apply_patch") {
		// `apply_patch <<'EOF'` through the shell tool.
		return { commands: [], patchFiles: translation.files, text: command };
	}
	return { commands: [command], patchFiles: [], text: command };
}

function describeExecScript(source: string): CallDescription {
	const commands: string[] = [];
	const patchFiles: CodexPatchFile[] = [];
	for (const invocation of extractCustomExecInvocations(source)) {
		if (!invocation.resolvedInput) continue;
		const name = invocation.name.toLowerCase();
		if (name === "exec_command") {
			const command = readString(invocation.input.cmd);
			if (command === undefined) continue;
			const described = describeExecCommand(
				command,
				invocation.input,
				invocation.name,
			);
			commands.push(...described.commands);
			patchFiles.push(...described.patchFiles);
		} else if (name === "apply_patch") {
			const patch =
				readString(invocation.input.input) ??
				readString(invocation.input.patch) ??
				readString(invocation.input.arguments);
			if (patch !== undefined) patchFiles.push(...parseCodexPatch(patch));
		}
	}
	return { commands, patchFiles, text: source };
}

function patchFileItems(
	file: CodexPatchFile,
	callId: string,
	toolName: string,
): LineItem[] {
	const base = {
		callId,
		kind: "file_change" as const,
		subtype: "patch",
		toolName,
	};
	const diff = file.diff ?? "";
	if (file.operation === "delete") {
		return [{ ...base, fileOp: "delete", filePath: file.path, text: diff }];
	}
	if (file.movePath !== undefined && file.movePath !== file.path) {
		return [
			{ ...base, fileOp: "delete", filePath: file.path },
			{ ...base, fileOp: "write", filePath: file.movePath, text: diff },
		];
	}
	return [
		{
			...base,
			fileOp: file.operation === "add" ? "write" : "edit",
			filePath: file.path,
			text: diff,
		},
	];
}

function readOutput(
	payload: Record<string, unknown>,
	state: StreamState,
): LineItem {
	const callId = readString(payload.call_id) ?? "";
	const known = callId === "" ? undefined : state.calls.get(callId);
	const rawOutput = rawOutputString(payload.output ?? payload.tools);
	const decoded =
		readCodexImageOutputText(payload.output) ??
		readTranscriptToolOutputText(payload.output) ??
		rawOutput;
	const end = callId === "" ? undefined : state.codexEndEvents.get(callId);
	const exitCode =
		end?.exitCode ?? readCodexExitCode(payload.output ?? payload.tools);
	const isError =
		exitCode !== null
			? exitCode !== 0
			: end?.success === false || hasFailurePrefix(decoded);
	const launchesSubagent =
		known !== undefined && SPAWN_TOOL_NAMES.has(known.toolName.toLowerCase());
	// Still running when recorded: neither a pass nor a failure.
	const running =
		exitCode === null &&
		!isError &&
		end === undefined &&
		isCodexRunningOutput(payload.output);
	return {
		callId,
		commandClass: known?.commandClass ?? "",
		exitCode,
		isError,
		kind: "tool_result",
		spawnedAgentId: launchesSubagent ? readSpawnedAgentId(decoded) : "",
		subtype: known === undefined ? "orphan" : running ? "running" : "",
		text: decoded,
		toolName: known?.toolName ?? "",
	};
}

function hasFailurePrefix(text: string): boolean {
	return FAILURE_PREFIX_PATTERN.test(text.trimStart().slice(0, 64));
}

function rawOutputString(output: unknown): string {
	if (typeof output === "string") return output;
	if (output === undefined || output === null) return "";
	return safeStringify(output);
}

function readSpawnedAgentId(outputText: string): string {
	const parsed = parseObject(outputText);
	if (parsed === undefined) return "";
	for (const key of ["task_name", "agent_name", "agentId", "agent_id"]) {
		const value = readString(parsed[key]);
		if (value !== undefined) return value;
	}
	return "";
}

function parseObject(
	value: string | undefined,
): Record<string, unknown> | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trimStart();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}
