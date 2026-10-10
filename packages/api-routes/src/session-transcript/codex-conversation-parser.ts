import {
	attachCodexOperationMetadata,
	buildCodexActivityGraph,
	type CodexCarrier,
	type CodexNormalizedOperation,
	toConversationResultContent,
} from "./codex-activity-graph.js";
import {
	isCodexToolFailure,
	stripCodexInjectedBlocks,
} from "./codex-tool-translation.js";
import type {
	AssistantEntry,
	Conversation,
	ConversationExecutionMode,
	SystemEntry,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
	UserEntry,
} from "./conversation-schema.js";

interface CodexLine {
	timestamp: string;
	type: string;
	payload: Record<string, unknown>;
}

interface CodexContentBlock {
	type: string;
	text?: string;
}

interface CodexAgentAttribution {
	agent?: { agent_name?: string };
}

interface CodexMessagePayload extends CodexAgentAttribution {
	type: string;
	role: string;
	content: Array<CodexContentBlock>;
}

interface CodexReasoningPayload extends CodexAgentAttribution {
	type: "reasoning";
	summary: Array<{ type: string; text: string }>;
}

interface CodexToolCallPayload extends CodexAgentAttribution {
	type: "function_call" | "custom_tool_call" | "tool_search_call";
	name?: string;
	arguments?: unknown;
	input?: string;
	call_id?: string;
}

interface CodexToolOutputPayload extends CodexAgentAttribution {
	type:
		| "function_call_output"
		| "custom_tool_call_output"
		| "tool_search_output";
	call_id?: string;
	output?: unknown;
	tools?: unknown;
}

interface CodexMultiAgentCallPayload extends CodexAgentAttribution {
	type: "multi_agent_call";
	action?: string;
	arguments?: unknown;
	call_id?: string;
}

interface CodexMultiAgentOutputPayload extends CodexAgentAttribution {
	type: "multi_agent_call_output";
	action?: string;
	call_id?: string;
	output?: unknown;
}

interface CodexWebSearchPayload extends CodexAgentAttribution {
	action?: unknown;
	call_id?: string;
	status?: string;
	type: "web_search_call";
}

function hashCodexEntryContent(value: string) {
	let first = 0x81_1c_9d_c5;
	let second = 0x9e_37_79_b9;

	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);
		first = Math.imul(first ^ codeUnit, 0x01_00_01_93);
		second = Math.imul(second ^ codeUnit, 0x85_eb_ca_6b);
	}

	return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function getCodexEntryId(rawLine: string) {
	return `codex-${hashCodexEntryContent(rawLine)}`;
}

function readCodexExecutionMode(
	line: CodexLine,
): ConversationExecutionMode | undefined {
	if (
		line.type === "event_msg" &&
		line.payload.type === "task_started" &&
		typeof line.payload.collaboration_mode_kind === "string"
	) {
		return line.payload.collaboration_mode_kind === "plan" ? "plan" : "default";
	}

	const collaborationMode = line.payload.collaboration_mode;
	if (
		line.type !== "turn_context" ||
		typeof collaborationMode !== "object" ||
		collaborationMode === null ||
		!("mode" in collaborationMode) ||
		typeof collaborationMode.mode !== "string"
	) {
		return undefined;
	}

	return collaborationMode.mode === "plan" ? "plan" : "default";
}

function readCodexModelSetting(line: CodexLine): string | undefined {
	if (line.type !== "turn_context") {
		return undefined;
	}

	if (typeof line.payload.effort === "string") {
		const modelSetting = line.payload.effort.trim();
		if (modelSetting) {
			return modelSetting;
		}
	}

	const collaborationMode = line.payload.collaboration_mode;
	if (
		typeof collaborationMode !== "object" ||
		collaborationMode === null ||
		!("settings" in collaborationMode) ||
		typeof collaborationMode.settings !== "object" ||
		collaborationMode.settings === null ||
		!("reasoning_effort" in collaborationMode.settings) ||
		typeof collaborationMode.settings.reasoning_effort !== "string"
	) {
		return undefined;
	}

	const modelSetting = collaborationMode.settings.reasoning_effort.trim();
	return modelSetting ? modelSetting : undefined;
}

function readAgentName(payload: CodexAgentAttribution) {
	const agentName = payload.agent?.agent_name?.trim();
	return agentName ? agentName : undefined;
}

function isDelegationToolName(toolName: string | undefined) {
	const normalizedName = toolName?.split(/\.|__/u).at(-1)?.toLowerCase();
	return normalizedName
		? [
				"agent",
				"close_agent",
				"followup_task",
				"interrupt_agent",
				"list_agents",
				"resume_agent",
				"send_message",
				"spawn_agent",
				"task",
				"wait_agent",
			].includes(normalizedName)
		: false;
}

function getCodexSystemEventMessage(
	payload: Readonly<Record<string, unknown>>,
): string | undefined {
	switch (payload.type) {
		case "turn_aborted":
			return "Turn aborted";
		case "context_compacted":
		case "compacted":
			return "Context compacted";
		case "thread_rolled_back":
			return "Thread rolled back";
		case "error": {
			for (const key of ["message", "error", "detail"] as const) {
				const value = payload[key];
				if (typeof value === "string" && value.trim()) {
					return `Error: ${value.trim()}`;
				}
			}
			return "Error";
		}
		default:
			return undefined;
	}
}

function extractSubagentId(outputText: string): string | undefined {
	try {
		const parsed = JSON.parse(outputText) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return undefined;
		}
		for (const key of ["task_name", "agent_name", "agentId", "agent_id"]) {
			if (
				key in parsed &&
				typeof (parsed as Record<string, unknown>)[key] === "string"
			) {
				return (parsed as Record<string, string>)[key];
			}
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function toOperationToolUse(
	operation: CodexNormalizedOperation,
	carrier: CodexCarrier | undefined,
): ToolUseContent {
	return {
		type: "tool_use",
		id: operation.id,
		input: attachCodexOperationMetadata(operation.input, operation, carrier),
		name: operation.name,
	};
}

function toOperationToolResult(
	operation: CodexNormalizedOperation,
	carrier?: CodexCarrier,
): ToolResultContent | undefined {
	// Batch output is shared evidence, not the result of an arbitrary nested call.
	const outputBlocks =
		carrier && carrier.operations.length > 1
			? (operation.lifecycle?.outputBlocks ?? [])
			: operation.outputBlocks;
	if (outputBlocks.length === 0 && operation.lifecycle === undefined) {
		return undefined;
	}
	const text = outputBlocks
		.flatMap((block) => {
			if (block.type === "text") {
				return [block.text];
			}
			if (block.type === "structured") {
				try {
					return [JSON.stringify(block.value) ?? ""];
				} catch {
					return [];
				}
			}
			return [];
		})
		.filter(Boolean)
		.join("\n");
	return {
		type: "tool_result",
		tool_use_id: operation.id,
		content: toConversationResultContent(outputBlocks),
		is_error: isCodexToolFailure(text, operation.lifecycle?.payload)
			? true
			: undefined,
	};
}

function operationResultText(operation: CodexNormalizedOperation) {
	return operation.outputBlocks
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n");
}

/**
 * Detect whether JSONL content is in Codex format by checking the first line.
 */
export function isCodexFormat(content: string): boolean {
	const firstNewline = content.indexOf("\n");
	const firstLine =
		firstNewline === -1 ? content : content.slice(0, firstNewline);
	if (!firstLine) return false;
	try {
		const parsed = JSON.parse(firstLine) as { type?: string };
		return parsed.type === "session_meta";
	} catch {
		return false;
	}
}

/**
 * Parse Codex JSONL content into the Conversation[] format used by ConversationView.
 *
 * Codex entries have: { timestamp, type, payload }
 * We extract user/assistant messages from `response_item` lines and reasoning
 * from `reasoning` response items, skipping internal events.
 */
export function parseCodexConversations(content: string): Array<Conversation> {
	const conversations: Array<Conversation> = [];
	const lines = content.split("\n");
	const activityGraph = buildCodexActivityGraph(content);
	const carriersByLineIndex = new Map(
		activityGraph.carriers.map((carrier) => [carrier.callLineIndex, carrier]),
	);
	const carriersByCallId = new Map(
		activityGraph.carriers.map((carrier) => [carrier.callId, carrier]),
	);
	const orphanOutputsByLineIndex = new Map(
		activityGraph.orphanOutputs.map((output) => [output.lineIndex, output]),
	);
	const standaloneOperationsByLineIndex = new Map<
		number,
		CodexNormalizedOperation[]
	>();
	const ambiguousLifecycleRecordsByLineIndex = new Map(
		activityGraph.lifecycleRecords
			.filter((record) => record.confidence === "ambiguous-positional")
			.map((record) => [record.lineIndex, record]),
	);
	for (const operation of activityGraph.standaloneOperations) {
		const lineIndex = operation.lifecycle?.lineIndex;
		if (lineIndex === undefined) {
			continue;
		}
		const operations = standaloneOperationsByLineIndex.get(lineIndex) ?? [];
		operations.push(operation);
		standaloneOperationsByLineIndex.set(lineIndex, operations);
	}

	let sessionId = "";
	let sawSessionMeta = false;
	let executionMode: ConversationExecutionMode = "unknown";
	let rootModelSetting: string | undefined;
	const modelSettingsByAgent = new Map<string, string>();

	function getModelSetting(payload: CodexAgentAttribution) {
		const agentName = readAgentName(payload);
		if (!agentName || agentName === "/root") {
			return rootModelSetting;
		}
		return modelSettingsByAgent.get(agentName);
	}

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex] ?? "";
		if (!line.trim()) {
			continue;
		}
		let parsed: CodexLine;
		try {
			parsed = JSON.parse(line) as CodexLine;
		} catch {
			continue;
		}

		if (parsed.type === "session_meta") {
			// A fork file replays its parent's session_meta after its own; only the
			// first one names this session.
			if (!sawSessionMeta) {
				sawSessionMeta = true;
				sessionId = (parsed.payload as { id?: string }).id ?? "codex-session";
			}
			continue;
		}

		const nextExecutionMode = readCodexExecutionMode(parsed);
		if (nextExecutionMode !== undefined) {
			executionMode = nextExecutionMode;
		}
		const nextModelSetting = readCodexModelSetting(parsed);
		if (nextModelSetting !== undefined) {
			const agentName = readAgentName(parsed.payload);
			if (agentName && agentName !== "/root") {
				modelSettingsByAgent.set(agentName, nextModelSetting);
			} else {
				rootModelSetting = nextModelSetting;
			}
		}

		const systemEventMessage =
			parsed.type === "event_msg"
				? getCodexSystemEventMessage(parsed.payload)
				: parsed.type === "compacted"
					? "Context compacted"
					: undefined;
		if (systemEventMessage) {
			const entry: SystemEntry = {
				provider: "codex",
				uuid: getCodexEntryId(line),
				timestamp: parsed.timestamp,
				sessionId,
				type: "system",
				message: { content: systemEventMessage },
			};
			conversations.push(entry);
			continue;
		}

		const standaloneOperations = standaloneOperationsByLineIndex.get(lineIndex);
		if (standaloneOperations && standaloneOperations.length > 0) {
			const entryId = getCodexEntryId(line);
			const toolUses = standaloneOperations.map((operation) =>
				toOperationToolUse(operation, undefined),
			);
			conversations.push({
				executionMode,
				message: { content: toolUses, role: "assistant" },
				provider: "codex",
				sessionId,
				timestamp: parsed.timestamp,
				type: "assistant",
				uuid: entryId,
			});
			const results = standaloneOperations.flatMap((operation) => {
				const result = toOperationToolResult(operation);
				return result ? [result] : [];
			});
			if (results.length > 0) {
				conversations.push({
					message: { content: results, role: "user" },
					provider: "codex",
					sessionId,
					timestamp: parsed.timestamp,
					type: "user",
					uuid: `${entryId}-result`,
				});
			}
			continue;
		}

		const ambiguousLifecycle =
			ambiguousLifecycleRecordsByLineIndex.get(lineIndex);
		if (ambiguousLifecycle) {
			const payloadText = JSON.stringify(ambiguousLifecycle.payload) ?? "";
			const evidenceContent =
				ambiguousLifecycle.outputBlocks.length > 0
					? toConversationResultContent(ambiguousLifecycle.outputBlocks)
					: [
							{
								rawType: ambiguousLifecycle.type,
								type: "structured" as const,
								value: {
									call_id: ambiguousLifecycle.callId,
									confidence: ambiguousLifecycle.confidence,
									type: ambiguousLifecycle.type,
								},
							},
						];
			conversations.push({
				message: {
					content: [
						{
							content: evidenceContent,
							is_error: isCodexToolFailure(
								payloadText,
								ambiguousLifecycle.payload,
							)
								? true
								: undefined,
							tool_use_id: `ambiguous-lifecycle:${ambiguousLifecycle.id}`,
							type: "tool_result",
						},
					],
					role: "user",
				},
				provider: "codex",
				sessionId,
				timestamp: parsed.timestamp,
				type: "user",
				uuid: `${getCodexEntryId(line)}-ambiguous`,
			});
			continue;
		}

		if (parsed.type === "event_msg") {
			if (
				parsed.payload.type === "exec_command_end" ||
				parsed.payload.type === "patch_apply_end" ||
				parsed.payload.type === "web_search_end"
			) {
				// These enrich their matching response_item and are never duplicate rows.
				continue;
			}
			if (
				parsed.payload.type === "item_completed" ||
				parsed.payload.type === "sub_agent_activity" ||
				parsed.payload.type === "image_generation_end"
			) {
				// These are completion/lifecycle mirrors without a stable standalone
				// transcript presentation. Their originating item remains visible.
				continue;
			}
		}

		if (parsed.type !== "response_item") continue;

		const payload = parsed.payload as unknown as
			| CodexMessagePayload
			| CodexMultiAgentCallPayload
			| CodexMultiAgentOutputPayload
			| CodexReasoningPayload
			| CodexToolCallPayload
			| CodexToolOutputPayload
			| CodexWebSearchPayload;

		// Handle reasoning blocks — map to assistant entry with thinking content
		if (payload.type === "reasoning") {
			const reasoning = payload as CodexReasoningPayload;
			const modelSetting = getModelSetting(reasoning);
			const summaryText = reasoning.summary
				.map((s) => s.text)
				.filter(Boolean)
				.join("\n");
			if (!summaryText) continue;

			const thinkingBlock: ThinkingContent = {
				type: "thinking",
				thinking: summaryText,
			};

			const entry: AssistantEntry = {
				agentName: readAgentName(reasoning),
				executionMode,
				...(modelSetting ? { modelSetting } : {}),
				provider: "codex",
				uuid: getCodexEntryId(line),
				timestamp: parsed.timestamp,
				sessionId,
				type: "assistant",
				message: {
					role: "assistant",
					content: [thinkingBlock],
				},
			};
			conversations.push(entry);
			continue;
		}

		// Tool calls become assistant tool_use blocks and their outputs become
		// tool_result carriers, so Codex shell/tool activity shows up in the
		// trace the same way Claude Code tool events do.
		if (
			payload.type === "function_call" ||
			payload.type === "custom_tool_call" ||
			payload.type === "tool_search_call" ||
			payload.type === "multi_agent_call" ||
			payload.type === "web_search_call"
		) {
			const call = payload as
				| CodexMultiAgentCallPayload
				| CodexToolCallPayload
				| CodexWebSearchPayload;
			const modelSetting = getModelSetting(call);
			const entryId = getCodexEntryId(line);
			const carrier = carriersByLineIndex.get(lineIndex);
			if (!carrier) {
				continue;
			}
			const toolUses = carrier.operations.map((operation) =>
				toOperationToolUse(operation, carrier),
			);
			const entry: AssistantEntry = {
				agentName: readAgentName(call),
				executionMode,
				...(modelSetting ? { modelSetting } : {}),
				provider: "codex",
				uuid: entryId,
				timestamp: parsed.timestamp,
				sessionId,
				type: "assistant",
				message: { role: "assistant", content: toolUses },
			};
			conversations.push(entry);
			continue;
		}

		if (
			payload.type === "function_call_output" ||
			payload.type === "custom_tool_call_output" ||
			payload.type === "tool_search_output" ||
			payload.type === "multi_agent_call_output"
		) {
			const output = payload as
				| CodexMultiAgentOutputPayload
				| CodexToolOutputPayload;
			if (!output.call_id) continue;
			const carrier = carriersByCallId.get(output.call_id);
			if (!carrier) {
				const blocks =
					orphanOutputsByLineIndex.get(lineIndex)?.outputBlocks ?? [];
				const content = toConversationResultContent(blocks);
				const text = blocks
					.flatMap((block) => (block.type === "text" ? [block.text] : []))
					.join("\n");
				conversations.push({
					agentName: readAgentName(output),
					message: {
						content: [
							{
								content,
								is_error: isCodexToolFailure(text, undefined)
									? true
									: undefined,
								tool_use_id: output.call_id,
								type: "tool_result",
							},
						],
						role: "user",
					},
					provider: "codex",
					sessionId,
					timestamp: parsed.timestamp,
					type: "user",
					uuid: getCodexEntryId(line),
				});
				continue;
			}
			if (lineIndex !== carrier.outputLineIndex) {
				// A few carriers stream more than one output record. The graph aggregates
				// every block onto the carrier, so emit that aggregate exactly once at the
				// final record instead of replaying the growing aggregate for each record.
				continue;
			}
			const resultBlocks = carrier.operations.flatMap((operation) => {
				const result = toOperationToolResult(operation, carrier);
				return result ? [result] : [];
			});
			if (carrier.operations.length > 1 && carrier.outputBlocks.length > 0) {
				const id = `batch:${carrier.callId}`;
				resultBlocks.push({
					type: "tool_result",
					tool_use_id: id,
					batch: {
						id,
						toolIds: carrier.operations.map((operation) => operation.id),
					},
					content: toConversationResultContent(carrier.outputBlocks),
				});
			}
			if (resultBlocks.length === 0) {
				continue;
			}
			const resultText = carrier.operations.map(operationResultText).join("\n");
			const isDelegation = carrier.operations.some((operation) =>
				isDelegationToolName(operation.name),
			);
			const entry: UserEntry = {
				agentName: readAgentName(output),
				provider: "codex",
				uuid: getCodexEntryId(line),
				timestamp: parsed.timestamp,
				sessionId,
				type: "user",
				...(isDelegation
					? {
							toolUseResult: {
								agentId: extractSubagentId(resultText),
							},
						}
					: {}),
				message: { role: "user", content: resultBlocks },
			};
			conversations.push(entry);
			continue;
		}

		if (payload.type !== "message") continue;

		const msg = payload as CodexMessagePayload;

		// Skip developer messages (system prompts, permissions, collaboration mode)
		if (msg.role === "developer") continue;

		const textParts = (msg.content ?? [])
			.filter(
				(block) => block.type === "input_text" || block.type === "output_text",
			)
			.map((block) => block.text ?? "")
			.filter(Boolean);

		if (textParts.length === 0) continue;

		if (msg.role === "user") {
			const userText = stripCodexInjectedBlocks(textParts.join("\n"));
			if (!userText) {
				continue;
			}
			const entry: UserEntry = {
				agentName: readAgentName(msg),
				provider: "codex",
				uuid: getCodexEntryId(line),
				timestamp: parsed.timestamp,
				sessionId,
				type: "user",
				message: {
					role: "user",
					content: userText,
				},
			};
			conversations.push(entry);
		} else if (msg.role === "assistant") {
			const modelSetting = getModelSetting(msg);
			const textBlocks: TextContent[] = textParts.map((text) => ({
				type: "text" as const,
				text,
			}));

			const entry: AssistantEntry = {
				agentName: readAgentName(msg),
				executionMode,
				...(modelSetting ? { modelSetting } : {}),
				provider: "codex",
				uuid: getCodexEntryId(line),
				timestamp: parsed.timestamp,
				sessionId,
				type: "assistant",
				message: {
					role: "assistant",
					content: textBlocks,
				},
			};
			conversations.push(entry);
		}
	}

	return conversations;
}

/**
 * Extract token usage data from Codex JSONL.
 * Codex stores tokens in event_msg lines with type "token_count".
 */
export function extractCodexTokenData(
	content: string,
): Array<{ messageIndex: number; inputTokens: number; outputTokens: number }> {
	const points: Array<{
		messageIndex: number;
		inputTokens: number;
		outputTokens: number;
	}> = [];
	const lines = content.split("\n").filter((line) => line.trim() !== "");
	let previousInputTokens = 0;
	let previousOutputTokens = 0;
	let tokenSnapshotIndex = 0;

	for (let i = 0; i < lines.length; i++) {
		try {
			const parsed = JSON.parse(lines[i] as string) as {
				type?: string;
				payload?: {
					type?: string;
					info?: {
						total_token_usage?: {
							input_tokens?: number;
							cached_input_tokens?: number;
							output_tokens?: number;
						};
					};
				};
			};

			if (parsed.type !== "event_msg") continue;
			if (parsed.payload?.type !== "token_count") continue;

			const usage = parsed.payload.info?.total_token_usage;
			if (!usage) continue;
			const currentInputTokens = Math.max(
				0,
				(usage.input_tokens ?? previousInputTokens) -
					(usage.cached_input_tokens ?? 0),
			);
			const currentOutputTokens = usage.output_tokens ?? previousOutputTokens;
			const inputTokens = Math.max(0, currentInputTokens - previousInputTokens);
			const outputTokens = Math.max(
				0,
				currentOutputTokens - previousOutputTokens,
			);

			previousInputTokens = currentInputTokens;
			previousOutputTokens = currentOutputTokens;

			if (inputTokens === 0 && outputTokens === 0) {
				continue;
			}

			points.push({
				messageIndex: tokenSnapshotIndex,
				inputTokens,
				outputTokens,
			});
			tokenSnapshotIndex += 1;
		} catch {
			// Skip malformed lines
		}
	}

	return points;
}
