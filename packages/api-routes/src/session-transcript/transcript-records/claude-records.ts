import { getClaudeMutationFiles } from "../session-turn-file-edits.js";
import { readTranscriptToolOutputText } from "../transcript-tool-output.js";
import { appliedChangesFacts } from "./applied-changes.js";
import { classifyCommand, extractShellFileMutations } from "./command-class.js";
import { isClaudeBackgroundLaunch, readClaudeExitCode } from "./exit-code.js";
import { readImageBlockLabel } from "./image-labels.js";
import { classifyUserText } from "./injected-wrappers.js";
import {
	injectedAroundPrompt,
	isRecord,
	type LineFacts,
	type LineItem,
	type LineResult,
	metaItem,
	readString,
	type StreamState,
	safeStringify,
	shellFileChangeItem,
} from "./line-items.js";
import {
	claudeInstructionFiles,
	claudeMcpInstructions,
	claudeNestedMemory,
	claudeSystemPrompt,
} from "./received-setup.js";
import {
	claudeApiErrorFacts,
	claudeAutoModeFacts,
	claudeCostStateFacts,
	claudeInstructionFacts,
	claudeLineFacts,
	claudePrLinkFacts,
	claudePromptFacts,
	claudeSystemFacts,
	claudeTitleFacts,
	claudeToolResultFacts,
	factRowText,
	factText,
	mcpFacts,
	mergeFacts,
} from "./record-facts.js";
import type { CommandClass } from "./types.js";
import { withV9Facts } from "./v9-facts.js";

const SUBAGENT_LAUNCH_TOOLS: ReadonlySet<string> = new Set(["task", "agent"]);
const AGENT_ID_IN_TEXT_PATTERN = /\bagentId:\s*([A-Za-z0-9_-]+)/u;

/** Turn one parsed Claude Code JSONL record into record items. */
export function readClaudeLine(
	record: Record<string, unknown>,
	state: StreamState,
): LineResult {
	const result = readClaudeRecord(record, state);
	return {
		...result,
		items: withV9Facts(
			record,
			"claude_code",
			result.items.map((item) =>
				item.kind === "file_change"
					? {
							...item,
							facts: mergeFacts(item.facts, {
								extra: { file_change_basis: "requested" },
							}),
						}
					: item,
			),
		),
	};
}

function readClaudeRecord(
	record: Record<string, unknown>,
	state: StreamState,
): LineResult {
	const timestamp = readString(record.timestamp);
	const type = readString(record.type) ?? "";
	state.isSubagent ||=
		record.isSidechain === true && readString(record.agentId) !== undefined;
	const version = readString(record.version);
	if (version !== undefined) state.agentVersion = factText(version, 64);
	const entrypoint = readString(record.entrypoint);
	if (entrypoint !== undefined) state.entrypoint = factText(entrypoint, 64);
	const cwd = readString(record.cwd);
	if (cwd !== undefined) state.cwd = cwd;
	if (type === "assistant") {
		if (record.isApiErrorMessage === true) {
			return {
				items: withLineFacts([readApiErrorMessage(record)], record),
				timestamp,
			};
		}
		return {
			items: withLineFacts(readAssistantBlocks(record, state), record),
			timestamp,
		};
	}
	if (type === "pr-link") {
		return {
			items: [metaItem(type, { facts: claudePrLinkFacts(record) })],
			timestamp,
		};
	}
	if (type === "cost-state") {
		return {
			items: [metaItem(type, { facts: claudeCostStateFacts(record) })],
			timestamp,
		};
	}
	if (type === "ai-title") {
		return {
			items: [
				metaItem(type, {
					facts: claudeTitleFacts(record),
					text: factRowText(readString(record.aiTitle) ?? ""),
				}),
			],
			timestamp,
		};
	}
	if (type === "attachment") {
		return { items: readAttachment(record.attachment, state), timestamp };
	}
	if (type === "user") {
		return {
			items: withLineFacts(readUserMessage(record, state), record),
			timestamp,
		};
	}
	if (type === "system") {
		const subtype = readString(record.subtype) ?? "";
		const facts = claudeSystemFacts(record);
		if (subtype === "compact_boundary" || isRecord(record.compactMetadata)) {
			return {
				items: [
					{
						facts,
						kind: "compaction",
						subtype: "compact_boundary",
						text: readString(record.content) ?? "",
					},
				],
				timestamp,
			};
		}
		return {
			items: [{ ...readSystemRecord(record, subtype), facts }],
			timestamp,
		};
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
	const attribution = readAttribution(record);
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
				items.push(...readToolUse(block, state, attribution.call));
				break;
			case "web_search_tool_result":
			case "mcp_tool_result":
				items.push(readToolResult(block, state, undefined, undefined));
				break;
			default:
				break;
		}
	}
	const lineItems = items.length === 0 ? [metaItem("assistant_empty")] : items;
	return attribution.line === undefined
		? lineItems
		: lineItems.map((item) => ({
				...item,
				facts: mergeFacts(item.facts, attribution.line),
			}));
}

/** A user or assistant line's own run facts, on every record it yields. */
/**
 * A user or assistant line's own run facts on every record it yields; the
 * prompt's facts (permission mode, origin) only on its prompt-side records,
 * not on tool results or file changes of the same line.
 */
function withLineFacts(
	items: readonly LineItem[],
	record: Record<string, unknown>,
): LineItem[] {
	const line = claudeLineFacts(record);
	const prompt = claudePromptFacts(record);
	if (line.extra === undefined && prompt.extra === undefined) return [...items];
	return items.map((item) => ({
		...item,
		facts: mergeFacts(
			item.facts,
			line,
			item.kind === "tool_result" || item.kind === "file_change"
				? undefined
				: prompt,
		),
	}));
}

/**
 * Claude Code attribution of an assistant line: the skill applies to every
 * record of the line; the MCP server and tool to its call, when the line holds
 * exactly one (Claude Code writes one content block per line).
 */
function readAttribution(record: Record<string, unknown>): {
	call: LineFacts | undefined;
	line: LineFacts | undefined;
} {
	const skill = readString(record.attributionSkill);
	const server = readString(record.attributionMcpServer);
	const tool = readString(record.attributionMcpTool);
	const extra = {
		...(server === undefined
			? {}
			: { attribution_mcp_server: factText(server) }),
		...(tool === undefined ? {} : { attribution_mcp_tool: factText(tool) }),
	};
	return {
		call: undefined,
		line: mergeFacts(
			Object.keys(extra).length === 0 ? undefined : { extra },
			skill === undefined
				? undefined
				: { attributionSkill: factText(skill, 128) },
		),
	};
}

function readToolUse(
	block: Record<string, unknown>,
	state: StreamState,
	callFacts: LineFacts | undefined,
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
	// The Skill tool call is the invocation itself; attributionSkill marks
	// only the lines after it.
	const skill = lowered === "skill" ? readString(input.skill) : undefined;
	const ownFacts = mergeFacts(
		callFacts,
		mcpCallIdentity(toolName),
		skill === undefined
			? undefined
			: { extra: { skill: factText(skill, 128) } },
	);
	if (Object.keys(ownFacts).length > 0 && items[0] !== undefined) {
		items[0] = { ...items[0], facts: ownFacts };
	}
	if (callId !== "") {
		state.calls.set(callId, {
			commandClass,
			facts: mcpCallIdentity(toolName),
			toolName,
		});
	}
	return items;
}

function mcpCallIdentity(toolName: string): LineFacts {
	const matched = /^mcp__(.+)__(.+)$/u.exec(toolName);
	return matched === null
		? {}
		: {
				mcpServer: factText(matched[1] ?? "", 128),
				mcpTool: factText(matched[2] ?? "", 128),
			};
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
		return classifiedUserItems(content, flags, state);
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
	// Both describe the line's one result; a line with several stays unattributed.
	const single = resultBlocks.length === 1;
	for (const block of resultBlocks) {
		items.push(
			readToolResult(
				block,
				state,
				single ? toolUseResult : undefined,
				single ? readString(record.toolDenialKind) : undefined,
			),
		);
	}
	const textParts: string[] = [];
	const imageLabels: string[] = [];
	for (const block of content) {
		if (typeof block === "string") {
			textParts.push(block);
		} else if (isRecord(block)) {
			if (block.type === "text" && typeof block.text === "string") {
				textParts.push(block.text);
			} else if (block.type === "image") {
				imageLabels.push(readImageBlockLabel(block) ?? "[image]");
			}
		}
	}
	const joined = textParts.join("\n");
	if (joined.trim() !== "") {
		items.push(...classifiedUserItems(joined, flags, state));
	} else if (imageLabels.length > 0 && resultBlocks.length === 0) {
		items.push(
			flags.flaggedMeta
				? { kind: "injected_context", subtype: "meta" }
				: { kind: "user_prompt", text: formatImagePromptText(imageLabels) },
		);
	}
	return items.length === 0 ? [metaItem("user_empty")] : items;
}

/** Image-only prompts keep `[image attachment]` unless a screenshot is marked. */
function formatImagePromptText(imageLabels: readonly string[]): string {
	return imageLabels.every((label) => label === "[image]")
		? "[image attachment]"
		: imageLabels.join("\n");
}

function classifiedUserItems(
	text: string,
	flags: { compactSummary: boolean; flaggedMeta: boolean },
	state: StreamState,
): LineItem[] {
	const classification = classifyUserText(text, flags);
	switch (classification.kind) {
		case "prompt":
			if (takeQueuedPrompt(state, classification.text)) {
				// The queued-command attachment already recorded this prompt.
				return [metaItem("queued_prompt_mirror")];
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

function readToolResult(
	block: Record<string, unknown>,
	state: StreamState,
	toolUseResult: Record<string, unknown> | undefined,
	denialKind: string | undefined,
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
		facts: mergeFacts(
			known?.facts === undefined ? undefined : mcpFacts(known.facts),
			claudeAppliedChanges(toolUseResult, !isError && denialKind === undefined),
			claudeToolResultFacts(toolUseResult, denialKind),
		),
		isError,
		kind: "tool_result",
		spawnedAgentId,
		subtype:
			known === undefined
				? "orphan"
				: !isError && isClaudeBackgroundLaunch(text)
					? "running"
					: "",
		text,
		toolName: known?.toolName ?? "",
	};
}

function claudeAppliedChanges(
	result: Record<string, unknown> | undefined,
	confirmed: boolean,
): LineFacts {
	if (result === undefined || !confirmed) return {};
	const changes: Record<string, unknown> = {};
	if (
		typeof result.filePath === "string" &&
		(result.type === "create" ||
			result.type === "update" ||
			Array.isArray(result.structuredPatch))
	)
		changes[result.filePath] = { type: result.type, content: result.content };
	if (isRecord(result.bashEditDiff) && Array.isArray(result.bashEditDiff.files))
		for (const file of result.bashEditDiff.files)
			if (isRecord(file) && typeof file.filePath === "string")
				changes[file.filePath] = file;
	return Object.keys(changes).length === 0
		? {}
		: appliedChangesFacts(changes, true);
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
			parts.push(readImageBlockLabel(part) ?? "[image]");
		} else {
			const unwrapped = readTranscriptToolOutputText(part);
			if (unwrapped !== undefined) parts.push(unwrapped);
		}
	}
	return parts.join("\n");
}

/**
 * Claude Code top-level `attachment` records: what the harness added to the
 * model's context outside user messages. Instructions, memory files, MCP
 * server instructions, skill listings and externally edited file snippets are
 * injected context with their text; a prompt the user queued while the agent
 * worked is a genuine prompt (subtype `queued`, which starts a turn like any
 * prompt); everything else is meta that keeps its label and any text.
 */
function readAttachment(attachment: unknown, state: StreamState): LineItem[] {
	if (!isRecord(attachment)) return [metaItem("attachment")];
	const type = readString(attachment.type) ?? "unknown";
	switch (type) {
		case "instructions": {
			const files = Array.isArray(attachment.files) ? attachment.files : [];
			return [
				{
					...injected(
						"instructions",
						files
							.flatMap((file) =>
								isRecord(file)
									? [memoryText(readString(file.path), file.content)]
									: [],
							)
							.join("\n\n"),
					),
					facts: claudeInstructionFacts(attachment),
					setup: claudeInstructionFiles(attachment),
				},
			];
		}
		case "nested_memory": {
			const content = isRecord(attachment.content) ? attachment.content : {};
			const path = readString(attachment.path) ?? readString(content.path);
			return [
				{
					...injected("nested_memory", memoryText(path, content.content)),
					filePath: path ?? "",
					setup: claudeNestedMemory(path, content.content),
				},
			];
		}
		case "mcp_instructions_delta":
			return [
				{
					...injected(
						"mcp_instructions",
						[
							...readStrings(attachment.addedBlocks),
							...readStrings(attachment.removedNames).map(
								(name) => `removed: ${name}`,
							),
						].join("\n\n"),
					),
					setup: claudeMcpInstructions(attachment),
				},
			];
		case "prompt_snapshot":
			return [
				metaItem("attachment:prompt_snapshot", {
					setup: claudeSystemPrompt(attachment),
				}),
			];

		case "skill_listing":
			return [injected("skill_listing", readString(attachment.content) ?? "")];
		case "edited_text_file": {
			const path = readString(attachment.filename) ?? "";
			return [
				{
					...injected("edited_text_file", readString(attachment.snippet) ?? ""),
					filePath: path,
				},
			];
		}
		case "queued_command":
			return readQueuedCommand(attachment, state);
		case "command_permissions":
			return [
				metaItem("attachment:command_permissions", {
					text: readStrings(attachment.allowedTools).join("\n"),
				}),
			];
		case "auto_mode":
			return [
				metaItem("attachment:auto_mode", {
					facts: claudeAutoModeFacts(attachment),
				}),
			];
		default:
			return [
				metaItem(`attachment:${type}`, {
					text:
						readString(attachment.text) ??
						readString(attachment.content) ??
						readString(attachment.prompt) ??
						"",
				}),
			];
	}
}

function readQueuedCommand(
	attachment: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const text = readPromptText(attachment.prompt);
	const mode = readString(attachment.commandMode);
	if (text.trim() === "") return [metaItem("attachment:queued_command")];
	if (mode !== undefined && mode !== "prompt") {
		return [
			injected(
				mode === "task-notification" ? "task_notification" : `queued_${mode}`,
				text,
			),
		];
	}
	const classification = classifyUserText(text, {});
	if (classification.kind !== "prompt") {
		return classifiedUserItems(
			text,
			{ compactSummary: false, flaggedMeta: false },
			state,
		);
	}
	if (
		!state.responseSincePrompt &&
		state.lastPromptText === classification.text
	) {
		return [metaItem("queued_prompt_mirror")];
	}
	state.claudeQueuedPrompts.push(classification.text);
	if (state.claudeQueuedPrompts.length > 16) state.claudeQueuedPrompts.shift();
	return [
		{ kind: "user_prompt", subtype: "queued", text: classification.text },
		...injectedAroundPrompt(classification),
	];
}

/**
 * Claude Code `system` records other than compaction: hook summaries (their
 * errors, added context and whether they stopped the agent), API errors and
 * informational notices keep their content.
 */
function readSystemRecord(
	record: Record<string, unknown>,
	subtype: string,
): LineItem {
	const parts: string[] = [];
	const content = readString(record.content);
	if (content !== undefined) parts.push(content);
	const prevented = record.preventedContinuation === true;
	if (prevented) parts.push("preventedContinuation: true");
	const stopReason = readString(record.stopReason);
	if (stopReason !== undefined) parts.push(`stopReason: ${stopReason}`);
	const hookErrors = readTexts(record.hookErrors);
	for (const error of hookErrors) parts.push(`hookError: ${error}`);
	for (const context of readTexts(record.hookAdditionalContext))
		parts.push(`hookAdditionalContext: ${context}`);
	const error = isRecord(record.error) ? record.error : undefined;
	const errorText =
		readString(error?.formatted) ??
		readString(error?.message) ??
		readString(record.error);
	if (errorText !== undefined) parts.push(errorText);
	return metaItem(
		prevented ? `system:${subtype}:prevented` : `system:${subtype}`,
		{
			isError:
				hookErrors.length > 0 ||
				errorText !== undefined ||
				readString(record.level) === "error",
			text: parts.join("\n"),
		},
	);
}

/** An error Claude Code wrote as an assistant message (`isApiErrorMessage`); not model output. */
function readApiErrorMessage(record: Record<string, unknown>): LineItem {
	const message = isRecord(record.message) ? record.message : undefined;
	const text = readPromptText(message?.content);
	const code = readString(record.error);
	return metaItem("api_error_message", {
		facts: claudeApiErrorFacts(record),
		isError: true,
		text: code === undefined ? text : `[${code}] ${text}`,
	});
}

function takeQueuedPrompt(state: StreamState, text: string): boolean {
	const index = state.claudeQueuedPrompts.indexOf(text);
	if (index === -1) return false;
	state.claudeQueuedPrompts.splice(index, 1);
	return true;
}

function injected(subtype: string, text: string): LineItem {
	return { kind: "injected_context", subtype, text };
}

function memoryText(path: string | undefined, content: unknown): string {
	const body = readString(content) ?? "";
	return path === undefined ? body : `Contents of ${path}:\n${body}`;
}

/** Text of a string or of a list of text blocks. */
function readPromptText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.flatMap((block) => {
			if (typeof block === "string") return [block];
			if (isRecord(block) && typeof block.text === "string")
				return [block.text];
			return [];
		})
		.join("\n");
}

function readStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** Strings, or objects rendered as JSON (hook errors may be either). */
function readTexts(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) =>
		typeof item === "string"
			? [item]
			: item === null || item === undefined
				? []
				: [safeStringify(item)],
	);
}
