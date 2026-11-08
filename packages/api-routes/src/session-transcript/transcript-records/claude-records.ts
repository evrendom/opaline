import { launchedAgentIdInText } from "../background-tasks.js";
import { getClaudeMutationFiles } from "../session-turn-file-edits.js";
import { readTranscriptToolOutputText } from "../transcript-tool-output.js";
import { appliedChangesFacts } from "./applied-changes.js";
import {
	readClaudeBackgroundHandOff,
	readTaskNotification,
} from "./background-tasks.js";
import {
	classifyCommand,
	extractScriptFileAccess,
	extractShellFileMutations,
	extractShellFileReads,
} from "./command-class.js";
import {
	type ClaudeHookError,
	readClaudeExitCode,
	readClaudeHookError,
} from "./exit-code.js";
import { GUARD_DENIAL_KIND, readGuardRefusal } from "./guard-refusal.js";
import { readImageBlockLabel } from "./image-labels.js";
import {
	COORDINATOR_MESSAGE_PATTERN,
	classifyUserText,
} from "./injected-wrappers.js";
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
	scriptFileChangeItem,
	setStreamCwd,
	shellContext,
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
	durationMs,
	type ExtraFacts,
	factRowText,
	factText,
	guardRefusalFacts,
	mcpFacts,
	mergeFacts,
	setList,
} from "./record-facts.js";
import { callReadFacts, resolveToolPath } from "./shell-call-facts.js";
import {
	isEmptyClaudeShellOutput,
	readShellExitFacts,
	readShellExitShape,
	type ShellExitShape,
} from "./shell-exit.js";
import type { CommandClass } from "./types.js";
import { withV9Facts } from "./v9-facts.js";

const SUBAGENT_LAUNCH_TOOLS: ReadonlySet<string> = new Set(["task", "agent"]);
const HARNESS_ATTACHMENT_SUBTYPES = {
	silent_turn_reminder: "silent_turn_reminder",
	batching_reminder_sent: "batching_reminder",
	read_truncation_notice: "read_truncation_notice",
} as const;
/** Claude Code's text for a call the user interrupted (`INTERRUPT_MESSAGE_FOR_TOOL_USE`). */
const INTERRUPTED_PATTERN = /^\s*(?:Error: )?\[Request interrupted by user/u;

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
	if (cwd !== undefined) setStreamCwd(state, cwd);
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
		return {
			items: withTaskNotifications(
				readAttachment(record.attachment, state),
				state,
			),
			timestamp,
		};
	}
	if (type === "user") {
		return {
			items: withLineFacts(
				withTaskNotifications(readUserMessage(record, state), state),
				record,
			),
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
				items.push(
					readToolResult(block, state, undefined, undefined, undefined),
				);
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
	let editKeys: readonly string[] = [];
	let exitShape: ShellExitShape | undefined;
	let shellFacts: LineFacts | undefined;

	const context = shellContext(state);
	let readFacts: LineFacts | undefined;
	if (lowered === "bash") {
		const command = readString(input.command) ?? "";
		commandClass = classifyCommand(command);
		const scriptEdits = extractScriptFileAccess(command, context);
		const written = new Set(scriptEdits.map((edit) => edit.path));
		const reads = extractShellFileReads(command, context).filter(
			(path) => !written.has(path),
		);
		readFacts = callReadFacts({ commands: [command], context });
		// The call names the file it edits, else the first it reads.
		const filePath = scriptEdits[0]?.path ?? reads[0] ?? "";
		items.push({
			callId,
			commandClass,
			...(scriptEdits.length === 0 && filePath !== ""
				? { fileOp: "read" as const }
				: {}),
			filePath,
			kind: "tool_call",
			text: command,
			toolName,
		});
		for (const mutation of extractShellFileMutations(command, context)) {
			items.push(shellFileChangeItem(mutation, callId, toolName));
		}
		for (const edit of scriptEdits)
			items.push(scriptFileChangeItem(edit, callId, toolName));
		editKeys = scriptEdits.flatMap((edit) =>
			edit.basis === "direct" && edit.key !== undefined ? [edit.key] : [],
		);
		exitShape = readShellExitShape(command);
		if (reads.length > 0) {
			const extra: ExtraFacts = {};
			setList(extra, "shell_read_paths", "shell_read_paths_more", reads);
			shellFacts = { extra };
		}
	} else {
		const mutationFiles = getClaudeMutationFiles({
			input,
			name: toolName,
			type: "tool_use",
		}).map((path) => resolveToolPath(path, context));
		if (mutationFiles.length > 0) {
			const path = mutationFiles[0] ?? "";
			editKeys = mutationFiles;
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
			const path = resolveToolPath(
				readString(input.file_path) ??
					readString(input.notebook_path) ??
					readString(input.path) ??
					"",
				context,
			);
			if (lowered === "read" && path !== "")
				readFacts = callReadFacts({ context, reads: [path] });
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
	const retried = editKeys
		.map((key) => state.claudeFailedEdits.get(key))
		.find((failed) => failed !== undefined && failed !== callId);
	const ownFacts = mergeFacts(
		callFacts,
		mcpCallIdentity(toolName),
		skill === undefined
			? undefined
			: { extra: { skill: factText(skill, 128) } },
		shellFacts,
		readFacts,
		retried === undefined ? undefined : { extra: { retry_of: retried } },
	);
	if (Object.keys(ownFacts).length > 0 && items[0] !== undefined) {
		items[0] = { ...items[0], facts: ownFacts };
	}
	if (callId !== "") {
		state.calls.set(callId, {
			commandClass,
			...(editKeys.length === 0 ? {} : { editKeys }),
			...(exitShape === undefined ? {} : { exitShape }),
			facts: mcpCallIdentity(toolName),
			toolName,
		});
	}
	return items;
}

/**
 * After an edit call's result: a failure (an error the user, a rule or a
 * hook did not cause) becomes the attempt a later edit of its files retries;
 * a success ends the chain.
 */
function trackFailedEdits(
	state: StreamState,
	callId: string,
	editKeys: readonly string[] | undefined,
	outcome: "failed" | "succeeded" | "other",
): void {
	if (editKeys === undefined || callId === "" || outcome === "other") return;
	for (const key of editKeys) {
		if (outcome === "failed") state.claudeFailedEdits.set(key, callId);
		else state.claudeFailedEdits.delete(key);
	}
}

/**
 * What decided a finished shell call's exit code and whether it printed
 * anything (parser 12). Claude Code writes `Exit code N` on a failure, and
 * reads some non-zero codes as no error (`returnCodeInterpretation`, grep's
 * `No matches found`) in a `toolUseResult` that sub-agent transcripts never
 * carry: a result that is not an error exited 0 only when its
 * `toolUseResult` is there and names no interpretation.
 */
function shellExitFacts(
	shape: ShellExitShape | undefined,
	isError: boolean,
	exitCode: number | null,
	toolUseResult: Record<string, unknown> | undefined,
	text: string,
): LineFacts {
	if (isError && exitCode === null) return {};
	const succeeded = isError
		? exitCode === 0
		: toolUseResult === undefined
			? undefined
			: typeof toolUseResult.returnCodeInterpretation !== "string";
	const exit =
		shape === undefined ? {} : readShellExitFacts(shape, succeeded, text);
	return {
		extra: {
			...(exit.decidedBy === undefined
				? {}
				: { exit_decided_by: factText(exit.decidedBy, 256) }),
			...(exit.masked === undefined ? {} : { exit_masked: exit.masked }),
			no_output: String(isEmptyClaudeShellOutput(text)),
		},
	};
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
				single ? readString(record.toolUseResult) : undefined,
				single && isHookRejection(record.permissionDecision),
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
				{
					kind: "user_prompt",
					...coordinatorSubtype(state, classification.text),
					text: classification.text,
				},
				...injectedAroundPrompt(classification),
			];
		case "injected_context":
			// A forked skill's subagent opens with its task as a meta message;
			// before any prompt it is the stream's task, a delegation that
			// starts its first run (a stream with no prompt has no runs).
			if (
				state.isSubagent &&
				state.turnIdx === 0 &&
				flags.flaggedMeta &&
				classification.subtype === "meta"
			)
				return [{ kind: "user_prompt", text }];
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
	recordedDenialKind: string | undefined,
	/** `toolUseResult` in its string form (errors and refusals). */
	toolUseResultText: string | undefined,
	hookRejected = false,
): LineItem {
	const callId = readString(block.tool_use_id) ?? "";
	const known = callId === "" ? undefined : state.calls.get(callId);
	const text = readResultText(block.content);
	const isError = block.is_error === true;
	const exitCode = isError ? readClaudeExitCode(text) : null;
	const hook = isError ? readClaudeHookError(text) : undefined;
	// Claude Code records a PreToolUse hook's block as `permission-rule`; the
	// hook error text and `permissionDecision.source` name the hook.
	const hookRefused = hook?.blocked === true || hookRejected;
	const guard =
		recordedDenialKind === undefined &&
		hook === undefined &&
		!hookRefused &&
		(isError || known?.toolName.toLowerCase() === "bash")
			? readGuardRefusal([text])
			: undefined;
	const denialKind = hookRefused
		? "hook"
		: (recordedDenialKind ??
			(guard === undefined ? undefined : GUARD_DENIAL_KIND));
	const handOff = isError
		? undefined
		: readClaudeBackgroundHandOff(text, toolUseResult, known?.toolName ?? "");
	if (handOff !== undefined && callId !== "")
		state.claudeBackgroundTasks.set(handOff.taskId, callId);
	// Claude Code's own record of an interruption: its denial kind, or the
	// interrupt text as the result. A user rejection stays a refusal.
	const interrupted =
		denialKind === "interrupted" ||
		INTERRUPTED_PATTERN.test(toolUseResultText ?? "") ||
		(isError && INTERRUPTED_PATTERN.test(text.slice(0, 128)));
	const finished =
		handOff === undefined &&
		denialKind === undefined &&
		hook === undefined &&
		!interrupted &&
		toolUseResult?.interrupted !== true &&
		toolUseResult?.timedOutAfterMs === undefined &&
		known?.toolName.toLowerCase() === "bash";
	trackFailedEdits(
		state,
		callId,
		known?.editKeys,
		denialKind !== undefined || interrupted || handOff !== undefined
			? "other"
			: isError
				? "failed"
				: "succeeded",
	);
	const launchesSubagent =
		known !== undefined &&
		SUBAGENT_LAUNCH_TOOLS.has(known.toolName.toLowerCase());
	const spawnedAgentId = launchesSubagent
		? (readString(toolUseResult?.agentId) ?? launchedAgentIdInText(text) ?? "")
		: "";
	return {
		callId,
		commandClass: known?.commandClass ?? "",
		exitCode,
		facts: mergeFacts(
			known?.facts === undefined ? undefined : mcpFacts(known.facts),
			claudeAppliedChanges(toolUseResult, !isError && denialKind === undefined),
			claudeToolResultFacts(toolUseResult, denialKind),
			interrupted ? { interrupted: true } : undefined,
			finished
				? shellExitFacts(
						known?.exitShape,
						isError,
						exitCode,
						toolUseResult,
						text,
					)
				: undefined,
			hook === undefined ? undefined : hookErrorFacts(hook),
			guard === undefined ? undefined : guardRefusalFacts(guard),
			handOff === undefined
				? undefined
				: {
						// A subagent transcript keeps no toolUseResult: the hand-off
						// text's limit is then the only record of the timeout.
						...(handOff.timeoutMs === undefined ||
						durationMs(toolUseResult?.timedOutAfterMs) !== undefined
							? {}
							: { timedOutAfterMs: handOff.timeoutMs }),
						extra: {
							task_id: handOff.taskId,
							background_launch: handOff.launch,
						},
					},
		),
		isError: isError || guard !== undefined,
		kind: "tool_result",
		...(handOff?.outputFile === undefined
			? {}
			: { filePath: handOff.outputFile }),
		spawnedAgentId,
		subtype:
			known === undefined ? "orphan" : handOff !== undefined ? "running" : "",
		text,
		toolName: known?.toolName ?? "",
	};
}

function isHookRejection(decision: unknown): boolean {
	return (
		isRecord(decision) &&
		decision.decision === "reject" &&
		decision.source === "hook"
	);
}

/** The hook event of a hook error, and why a blocking hook refused the call. */
function hookErrorFacts(hook: ClaudeHookError): LineFacts {
	return {
		extra: {
			hook_event: factText(hook.event, 64),
			...(hook.blocked && hook.message !== ""
				? { denial_reason: factText(hook.message, 512) }
				: {}),
		},
	};
}

/**
 * A task notification names the call whose background work it reports on:
 * the tool use it names, else the call whose hand-off announced its task.
 * It keeps its own record and run; the call reads it by `call_id`.
 */
function withTaskNotifications(
	items: readonly LineItem[],
	state: StreamState,
): LineItem[] {
	return items.map((item) => {
		if (item.kind !== "injected_context" || item.text === undefined)
			return item;
		const notification = readTaskNotification(item.text);
		if (notification === undefined) return item;
		const resolved = new Set(
			notification.taskIds.flatMap((taskId) => {
				const callId = state.claudeBackgroundTasks.get(taskId);
				return callId === undefined ? [] : [callId];
			}),
		);
		const callId =
			notification.toolUseId ??
			(resolved.size === 1 ? [...resolved][0] : undefined);
		const taskId = notification.taskIds[0];
		const status = notification.status;
		// The outcome also sits in the record's own columns, which the calls
		// view reads without the facts map: an error when the task failed or
		// was killed, interrupted when it was killed or stopped (null on a
		// Monitor event, which ends nothing), its exit code and output file.
		const ended = status !== undefined && !notification.event;
		return {
			...item,
			...(callId === undefined ? {} : { callId }),
			subtype: "task_notification",
			isError: status === "failed" || status === "killed",
			exitCode: notification.exitCode,
			...(notification.outputFile === undefined
				? {}
				: { filePath: notification.outputFile }),
			facts: mergeFacts(item.facts, {
				extra: {
					...(taskId === undefined ? {} : { task_id: taskId }),
					...(notification.status === undefined
						? {}
						: { background_status: factText(notification.status, 32) }),
					...(notification.exitCode === null
						? {}
						: { background_exit_code: String(notification.exitCode) }),
					...(notification.event ? { task_event: "true" } : {}),
				},
				...(ended
					? { interrupted: status === "killed" || status === "stopped" }
					: {}),
			}),
		};
	});
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
		// Harness nudges the agent saw (parser 11): placed like other context.
		case "silent_turn_reminder":
		case "batching_reminder_sent":
		case "read_truncation_notice":
			return [
				injected(
					HARNESS_ATTACHMENT_SUBTYPES[type],
					readString(attachment.text) ??
						readString(attachment.content) ??
						readString(attachment.prompt) ??
						"",
				),
			];
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
		{
			kind: "user_prompt",
			subtype: "queued",
			...coordinatorSubtype(state, classification.text),
			text: classification.text,
		},
		...injectedAroundPrompt(classification),
	];
}

/**
 * In a subagent, a message its coordinator sent (queued while it worked, or
 * as its next task) is a parent's task to it, never a person's prompt.
 */
function coordinatorSubtype(
	state: StreamState,
	text: string,
): { subtype?: "delegation" } {
	return state.isSubagent && COORDINATOR_MESSAGE_PATTERN.test(text.trimStart())
		? { subtype: "delegation" }
		: {};
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
