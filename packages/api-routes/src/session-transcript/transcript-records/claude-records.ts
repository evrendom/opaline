import { getClaudeMutationFiles } from "../session-turn-file-edits.js";
import { readTranscriptToolOutputText } from "../transcript-tool-output.js";
import { classifyCommand, extractShellFileMutations } from "./command-class.js";
import { readClaudeExitCode } from "./exit-code.js";
import { classifyUserText } from "./injected-wrappers.js";
import {
	isRecord,
	type LineItem,
	type LineResult,
	metaItem,
	readString,
	type StreamState,
	safeStringify,
	shellFileChangeItem,
} from "./line-items.js";
import type { CommandClass } from "./types.js";

const SUBAGENT_LAUNCH_TOOLS: ReadonlySet<string> = new Set(["task", "agent"]);
const AGENT_ID_IN_TEXT_PATTERN = /\bagentId:\s*([A-Za-z0-9_-]+)/u;

/** Turn one parsed Claude Code JSONL record into record items. */
export function readClaudeLine(
	record: Record<string, unknown>,
	state: StreamState,
): LineResult {
	const timestamp = readString(record.timestamp);
	const type = readString(record.type) ?? "";
	state.isSubagent ||=
		record.isSidechain === true && readString(record.agentId) !== undefined;
	if (type === "assistant") {
		return { items: readAssistantBlocks(record, state), timestamp };
	}
	if (type === "user") {
		return { items: readUserMessage(record, state), timestamp };
	}
	if (type === "system") {
		const subtype = readString(record.subtype) ?? "";
		if (subtype === "compact_boundary" || isRecord(record.compactMetadata)) {
			return {
				items: [
					{
						kind: "compaction",
						subtype: "compact_boundary",
						text: readString(record.content) ?? "",
					},
				],
				timestamp,
			};
		}
		return { items: [metaItem(`system:${subtype}`)], timestamp };
	}
	return { items: [metaItem(type === "" ? "unknown" : type)], timestamp };
}

function readAssistantBlocks(
	record: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const message = isRecord(record.message) ? record.message : undefined;
	const content = message?.content;
	if (typeof content === "string") {
		return content === "" ? [] : [{ kind: "assistant_text", text: content }];
	}
	if (!Array.isArray(content)) return [metaItem("assistant_empty")];
	const items: LineItem[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		switch (block.type) {
			case "text":
				items.push({
					kind: "assistant_text",
					text: readString(block.text) ?? "",
				});
				break;
			case "thinking":
				items.push({
					kind: "reasoning",
					text: readString(block.thinking) ?? "",
				});
				break;
			case "redacted_thinking":
				items.push({ kind: "reasoning", subtype: "redacted", text: "" });
				break;
			case "tool_use":
			case "server_tool_use":
			case "mcp_tool_use":
				items.push(...readToolUse(block, state));
				break;
			case "web_search_tool_result":
			case "mcp_tool_result":
				items.push(readToolResult(block, state, undefined));
				break;
			default:
				break;
		}
	}
	return items.length === 0 ? [metaItem("assistant_empty")] : items;
}

function readToolUse(
	block: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const toolName = readString(block.name) ?? "unknown";
	const callId = readString(block.id) ?? "";
	const input = isRecord(block.input) ? block.input : {};
	const lowered = toolName.toLowerCase();
	let commandClass: CommandClass = "";
	const items: LineItem[] = [];

	if (lowered === "bash") {
		const command = readString(input.command) ?? "";
		commandClass = classifyCommand(command);
		items.push({
			callId,
			commandClass,
			kind: "tool_call",
			text: command,
			toolName,
		});
		for (const mutation of extractShellFileMutations(command)) {
			items.push(shellFileChangeItem(mutation, callId, toolName));
		}
	} else {
		const mutationFiles = getClaudeMutationFiles({
			input,
			name: toolName,
			type: "tool_use",
		});
		if (mutationFiles.length > 0) {
			const path = mutationFiles[0] ?? "";
			// The input (old/new strings or file content) lives on the file change.
			items.push({
				callId,
				filePath: path,
				kind: "tool_call",
				toolName,
			});
			items.push({
				callId,
				fileOp: lowered === "write" ? "write" : "edit",
				filePath: path,
				kind: "file_change",
				subtype: "native",
				text: safeStringify(input),
				toolName,
			});
		} else {
			const path =
				readString(input.file_path) ??
				readString(input.notebook_path) ??
				readString(input.path) ??
				"";
			items.push({
				callId,
				...(lowered === "read" && path !== ""
					? { fileOp: "read" as const }
					: {}),
				filePath: lowered === "read" ? path : "",
				kind: "tool_call",
				text: safeStringify(input),
				toolName,
			});
		}
	}
	if (callId !== "") state.calls.set(callId, { commandClass, toolName });
	return items;
}

function readUserMessage(
	record: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const message = isRecord(record.message) ? record.message : undefined;
	const content = message?.content;
	const flags = {
		compactSummary: record.isCompactSummary === true,
		flaggedMeta: record.isMeta === true,
	};
	if (typeof content === "string") {
		return [classifiedUserItem(content, flags)];
	}
	if (!Array.isArray(content)) return [metaItem("user_empty")];

	const resultBlocks = content.filter(
		(block): block is Record<string, unknown> =>
			isRecord(block) && block.type === "tool_result",
	);
	const items: LineItem[] = [];
	const toolUseResult = isRecord(record.toolUseResult)
		? record.toolUseResult
		: undefined;
	for (const block of resultBlocks) {
		items.push(
			readToolResult(
				block,
				state,
				resultBlocks.length === 1 ? toolUseResult : undefined,
			),
		);
	}
	const textParts: string[] = [];
	let hasImage = false;
	for (const block of content) {
		if (typeof block === "string") {
			textParts.push(block);
		} else if (isRecord(block)) {
			if (block.type === "text" && typeof block.text === "string") {
				textParts.push(block.text);
			} else if (block.type === "image") {
				hasImage = true;
			}
		}
	}
	const joined = textParts.join("\n");
	if (joined.trim() !== "") {
		items.push(classifiedUserItem(joined, flags));
	} else if (hasImage && resultBlocks.length === 0) {
		items.push(
			flags.flaggedMeta
				? { kind: "injected_context", subtype: "meta" }
				: { kind: "user_prompt", text: "[image attachment]" },
		);
	}
	return items.length === 0 ? [metaItem("user_empty")] : items;
}

function classifiedUserItem(
	text: string,
	flags: { compactSummary: boolean; flaggedMeta: boolean },
): LineItem {
	const classification = classifyUserText(text, flags);
	switch (classification.kind) {
		case "prompt":
			return { kind: "user_prompt", text: classification.text };
		case "injected_context":
			return {
				kind: "injected_context",
				subtype: classification.subtype,
				text,
			};
		case "compaction":
			return { kind: "compaction", subtype: classification.subtype, text };
		case "meta":
			return metaItem(classification.subtype);
	}
}

function readToolResult(
	block: Record<string, unknown>,
	state: StreamState,
	toolUseResult: Record<string, unknown> | undefined,
): LineItem {
	const callId = readString(block.tool_use_id) ?? "";
	const known = callId === "" ? undefined : state.calls.get(callId);
	const text = readResultText(block.content);
	const isError = block.is_error === true;
	const exitCode = isError ? readClaudeExitCode(text) : null;
	const launchesSubagent =
		known !== undefined &&
		SUBAGENT_LAUNCH_TOOLS.has(known.toolName.toLowerCase());
	const spawnedAgentId = launchesSubagent
		? (readString(toolUseResult?.agentId) ??
			AGENT_ID_IN_TEXT_PATTERN.exec(text.slice(-2_048))?.[1] ??
			"")
		: "";
	return {
		callId,
		commandClass: known?.commandClass ?? "",
		exitCode,
		isError,
		kind: "tool_result",
		spawnedAgentId,
		subtype: known === undefined ? "orphan" : "",
		text,
		toolName: known?.toolName ?? "",
	};
}

function readResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) {
		return content === undefined || content === null
			? ""
			: safeStringify(content);
	}
	const parts: string[] = [];
	for (const part of content) {
		if (
			isRecord(part) &&
			part.type === "text" &&
			typeof part.text === "string"
		) {
			parts.push(part.text);
		} else if (isRecord(part) && part.type === "image") {
			parts.push("[image]");
		} else {
			const unwrapped = readTranscriptToolOutputText(part);
			if (unwrapped !== undefined) parts.push(unwrapped);
		}
	}
	return parts.join("\n");
}
