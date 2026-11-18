import {
	launchedAgentIdInText,
	parseBackgroundHandOff,
	parseTaskNotification,
} from "./background-tasks.js";
import type {
	Conversation,
	ConversationExecutionMode,
	ConversationProvider,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "./conversation-schema.js";
import {
	deriveTranscriptToolActivity,
	type TranscriptToolActivity,
} from "./transcript-tool-activity.js";

/**
 * Reshapes a parsed transcript into the flat invocation trace the session sheet
 * renders: one row per user turn, and one collapsible section per agent turn
 * containing a row per reasoning block, tool call, and assistant message.
 *
 * Tool results arrive as their own `user` entries rather than attached to the
 * call that produced them, so they are paired back onto their `tool_use` by
 * `tool_use_id` and never surface as user turns of their own.
 */

export type TraceToolResult = {
	batch?: { id: string; toolIds: string[] };
	content: ToolResultContent["content"];
	isError: boolean;
	subagentId?: string;
	/** When the result came back — the end of the tool's run. */
	timestamp?: string;
};

export type TraceToolBackground = {
	taskId: string;
	timedOut: boolean;
	status: string | null;
	exitCode: number | null;
	summary: string | null;
	result: string | null;
	finishedAt: string | null;
};

export type TraceSkillContent = {
	baseDirectory: string;
	content: string;
};

export type TraceEvent =
	| {
			kind: "reasoning";
			id: string;
			/** The agent's own id for the step, stable whatever the parser does:
			 * Claude's line uuid, Codex's item id (`rs_…`, `msg_…`), or for a tool
			 * call the provider's call id (`toolu_…`, `call_…`). */
			nativeId?: string;
			provider?: ConversationProvider;
			timestamp: string;
			text: string;
	  }
	| {
			kind: "message";
			id: string;
			nativeId?: string;
			timestamp: string;
			content: TextContent[] | string;
			provider?: ConversationProvider;
			text: string;
	  }
	| {
			kind: "tool";
			activity?: TranscriptToolActivity;
			id: string;
			nativeId?: string;
			timestamp: string;
			toolName: string;
			input: Record<string, unknown>;
			provider?: ConversationProvider;
			result: TraceToolResult | undefined;
			skillContent?: TraceSkillContent;
			background?: TraceToolBackground;
			toolSearch?: { deferredTools: number };
	  }
	| {
			kind: "orphan-result";
			id: string;
			timestamp: string;
			result: TraceToolResult;
	  };

export type UserContent = Extract<
	Conversation,
	{ type: "user" }
>["message"]["content"];

export type TraceSystemType =
	| "context"
	| "interruption"
	| "notification"
	| "system"
	| "compaction"
	| "hooks"
	| "member";

/** What Claude Code records about a compaction: what set it off, the
 * context before and after, the messages it carried over word for word,
 * the deferred tools it had loaded, and the summary it wrote in place of
 * the rest. It records no list of what the summary left out. */
export type TraceCompaction = {
	afterTokens?: number;
	beforeTokens?: number;
	keptMessages?: number;
	loadedTools?: string[];
	summary?: string;
	trigger?: string;
};

export type TraceItem =
	| { kind: "user"; id: string; timestamp: string; content: UserContent }
	| {
			agentName?: string;
			kind: "agent";
			id: string;
			timestamp: string;
			executionMode: ConversationExecutionMode;
			modelSetting?: string;
			provider?: ConversationProvider;
			events: TraceEvent[];
	  }
	| {
			kind: "system";
			id: string;
			timestamp: string;
			text: string;
			systemType: TraceSystemType;
			durationMs?: number;
			compaction?: TraceCompaction;
	  }
	| { kind: "summary"; id: string; timestamp: undefined; text: string };

function isToolResult(value: unknown): value is ToolResultContent {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "tool_result"
	);
}

function isDelegationToolName(toolName: string) {
	const normalizedName = toolName.split(/\.|__/u).at(-1)?.toLowerCase();
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

/**
 * A `user` entry carrying nothing but tool results is the transport for the
 * previous agent turn's output, not something a person typed.
 */
function isToolResultCarrier(content: UserContent): boolean {
	return (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every((item) => isToolResult(item))
	);
}

function collectToolResults(content: UserContent): ToolResultContent[] {
	if (!Array.isArray(content)) {
		return [];
	}

	return content.filter((item): item is ToolResultContent =>
		isToolResult(item),
	);
}

function textFromUserTextBlocks(content: UserContent): string | undefined {
	if (!Array.isArray(content) || content.length === 0) {
		return undefined;
	}

	const textBlocks: TextContent[] = [];
	for (const block of content) {
		if (typeof block === "string" || block.type !== "text") {
			return undefined;
		}

		textBlocks.push(block);
	}

	return textFromBlocks(textBlocks);
}

function toTraceResult(
	result: ToolResultContent,
	subagentId: string | undefined,
	timestamp: string | undefined,
): TraceToolResult {
	return {
		content: result.content,
		...(result.batch ? { batch: result.batch } : {}),
		isError: result.is_error === true,
		...(subagentId ? { subagentId } : {}),
		...(timestamp ? { timestamp } : {}),
	};
}

export function toolResultText(content: ToolResultContent["content"]): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.flatMap((part) =>
			"text" in part && part.type === "text" && part.text ? [part.text] : [],
		)
		.join("\n");
}

/** The prose a person actually typed, with tool-result payloads left out. */
export function userContentText(content: UserContent): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.flatMap((part) => {
			if (typeof part === "string") {
				return part ? [part] : [];
			}

			return part.type === "text" && part.text ? [part.text] : [];
		})
		.join("\n");
}

export function compactPreview(text: string, maxLength = 140): string {
	// Retain only the requested prefix. Normalizing an entire pasted file can
	// allocate millions of temporary strings just to show a short preview.
	let normalized = "";
	let pendingSpace = false;
	for (const point of text) {
		if (/\s/u.test(point)) {
			pendingSpace = normalized.length > 0;
			continue;
		}
		if (pendingSpace) {
			normalized += " ";
			pendingSpace = false;
		}
		normalized += point;
		if (normalized.length > maxLength) break;
	}

	if (normalized.length <= maxLength) {
		return normalized;
	}

	return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function textFromBlocks(blocks: TextContent[]): string {
	return blocks.map((block) => block.text).join("\n");
}

function classifyNonMemberUserEntry(
	entry: Extract<Conversation, { type: "user" }>,
): TraceSystemType | undefined {
	const text = userContentText(entry.message.content).trim();
	if (entry.isMeta === true) {
		return "context";
	}

	if (/^\[Request interrupted by user\]$/iu.test(text)) {
		return "interruption";
	}

	if (/^<task-notification(?:\s|>)/iu.test(text)) {
		return "notification";
	}

	return undefined;
}

function parseClaudeSkillContent(text: string): TraceSkillContent | undefined {
	const normalizedText = text.replace(/\r\n?/gu, "\n");
	const [header, ...contentLines] = normalizedText.split("\n");
	const headerPrefix = "Base directory for this skill:";

	if (!header?.startsWith(headerPrefix)) {
		return undefined;
	}

	const baseDirectory = header.slice(headerPrefix.length).trim();
	const content = contentLines.join("\n").trimStart();

	if (baseDirectory === "" || content === "") {
		return undefined;
	}

	return { baseDirectory, content };
}

function attachClaudeSkillContent(events: TraceEvent[], text: string): boolean {
	const previousEvent = events.at(-1);
	if (
		previousEvent?.kind !== "tool" ||
		previousEvent.toolName.toLowerCase() !== "skill"
	) {
		return false;
	}

	const skillContent = parseClaudeSkillContent(text);
	if (!skillContent) {
		return false;
	}

	previousEvent.skillContent = skillContent;
	return true;
}

/**
 * Groups entries into trace items. Consecutive assistant entries, plus the
 * tool-result carriers between them, collapse into a single agent section.
 */
export function buildConversationTrace(
	conversations: Conversation[],
): TraceItem[] {
	const items: TraceItem[] = [];
	const toolEventIds = new Map<string, string>();
	const toolEventsByCallId = new Map<
		string,
		Extract<TraceEvent, { kind: "tool" }>
	>();
	const unanswered = new Map<string, Extract<TraceEvent, { kind: "tool" }>[]>();
	// Events for the agent section currently being accumulated.
	let agentEvents: TraceEvent[] = [];
	let agentTimestamp: string | undefined;
	let agentId: string | undefined;
	let agentName: string | undefined;
	let agentExecutionMode: ConversationExecutionMode = "unknown";
	let agentModelSetting: string | undefined;
	let agentProvider: ConversationProvider | undefined;
	// tool_use_id -> event awaiting its result, for the open section.
	const pendingToolEvents = new Map<
		string,
		Extract<TraceEvent, { kind: "tool" }>
	>();

	function flushAgentSection(clearPendingToolEvents = true) {
		if (agentEvents.length > 0 && agentId && agentTimestamp) {
			items.push({
				...(agentName ? { agentName } : {}),
				kind: "agent",
				id: agentId,
				timestamp: agentTimestamp,
				executionMode: agentExecutionMode,
				...(agentModelSetting ? { modelSetting: agentModelSetting } : {}),
				...(agentProvider ? { provider: agentProvider } : {}),
				events: agentEvents,
			});
		}

		agentEvents = [];
		agentTimestamp = undefined;
		agentId = undefined;
		agentName = undefined;
		agentExecutionMode = "unknown";
		agentModelSetting = undefined;
		agentProvider = undefined;
		if (clearPendingToolEvents) {
			pendingToolEvents.clear();
		}
	}

	let lastCompaction: TraceCompaction | undefined;

	conversations.forEach((entry, index) => {
		if (entry.type === "summary") {
			flushAgentSection();
			items.push({
				kind: "summary",
				id: `summary-${index}`,
				timestamp: undefined,
				text: entry.summary,
			});
			return;
		}

		if (entry.type === "system" && "subtype" in entry) {
			const compaction = entry.subtype === "compact_boundary";
			const metadata = entry.compactMetadata;
			const durationMs = compaction
				? metadata?.durationMs
				: entry.hookInfos?.reduce(
						(sum, hook) => sum + (hook.durationMs ?? 0),
						0,
					);
			const item: Extract<TraceItem, { kind: "system" }> = {
				kind: "system",
				id: entry.uuid,
				systemType: compaction ? "compaction" : "hooks",
				timestamp: entry.timestamp,
				text: compaction ? "Conversation compacted" : "Stop hooks ran",
				...(durationMs ? { durationMs: Math.round(durationMs) } : {}),
			};
			if (compaction) {
				item.compaction = {
					...(metadata?.trigger ? { trigger: metadata.trigger } : {}),
					...(metadata?.preTokens !== undefined
						? { beforeTokens: Math.round(metadata.preTokens) }
						: {}),
					...(metadata?.postTokens !== undefined
						? { afterTokens: Math.round(metadata.postTokens) }
						: {}),
					...(metadata?.preservedMessages?.uuids
						? { keptMessages: metadata.preservedMessages.uuids.length }
						: {}),
					...(metadata?.preCompactDiscoveredTools?.length
						? { loadedTools: metadata.preCompactDiscoveredTools }
						: {}),
				};
				lastCompaction = item.compaction;
			}
			flushAgentSection();
			items.push(item);
			return;
		}

		if (entry.type === "system") {
			if (attachClaudeSkillContent(agentEvents, entry.message.content)) {
				return;
			}

			flushAgentSection();
			items.push({
				kind: "system",
				id: entry.uuid,
				systemType: "system",
				timestamp: entry.timestamp,
				text: entry.message.content,
			});
			return;
		}

		if (entry.type === "assistant") {
			if (agentId !== undefined && agentName !== entry.agentName) {
				flushAgentSection(false);
			}
			if (agentId === undefined) {
				agentId = entry.uuid;
				agentName = entry.agentName;
				agentTimestamp = entry.timestamp;
				agentExecutionMode = entry.executionMode;
				agentModelSetting = entry.modelSetting;
				agentProvider = entry.provider;
			} else if (agentExecutionMode === "unknown") {
				agentExecutionMode = entry.executionMode;
			}
			if (agentModelSetting === undefined) {
				agentModelSetting = entry.modelSetting;
			}

			// The agent's own id for this line's thinking and text: Claude's
			// line uuid is it; Codex lines carry theirs separately.
			const lineNativeId =
				entry.provider === "codex" ? entry.nativeId : entry.uuid;
			entry.message.content.forEach((block, blockIndex) => {
				const id = `${entry.uuid}-${blockIndex}`;

				if (block.type === "thinking") {
					agentEvents.push({
						kind: "reasoning",
						id,
						...(lineNativeId ? { nativeId: lineNativeId } : {}),
						...(entry.provider ? { provider: entry.provider } : {}),
						timestamp: entry.timestamp,
						text: (block as ThinkingContent).thinking,
					});
					return;
				}

				if (block.type === "tool_use") {
					const toolBlock = block as ToolUseContent;
					const event: Extract<TraceEvent, { kind: "tool" }> = {
						kind: "tool",
						id,
						// The call id the provider minted (`toolu_…`, `call_…`).
						nativeId: toolBlock.id,
						timestamp: entry.timestamp,
						toolName: toolBlock.name,
						input: toolBlock.input,
						...(entry.provider ? { provider: entry.provider } : {}),
						result: undefined,
					};
					agentEvents.push(event);
					pendingToolEvents.set(toolBlock.id, event);
					toolEventIds.set(toolBlock.id, event.id);
					toolEventsByCallId.set(toolBlock.id, event);
					const to =
						toolBlock.name === "SendMessage" &&
						toolBlock.input &&
						typeof toolBlock.input === "object"
							? (toolBlock.input as { to?: unknown }).to
							: undefined;
					if (typeof to === "string" && to)
						unanswered.set(to, [...(unanswered.get(to) ?? []), event]);
					return;
				}

				const textBlock = block as TextContent;
				agentEvents.push({
					kind: "message",
					id,
					...(lineNativeId ? { nativeId: lineNativeId } : {}),
					...(entry.provider ? { provider: entry.provider } : {}),
					timestamp: entry.timestamp,
					content: [textBlock],
					text: textFromBlocks([textBlock]),
				});
			});

			return;
		}

		// entry.type === "user"
		if (entry.isCompactSummary && lastCompaction && !lastCompaction.summary) {
			const summary = userContentText(entry.message.content).trim();
			if (summary) lastCompaction.summary = summary;
		}
		if (isToolResultCarrier(entry.message.content)) {
			if (agentId !== undefined && agentName !== entry.agentName) {
				flushAgentSection(false);
			}
			const subagentId = entry.toolUseResult?.agentId;
			collectToolResults(entry.message.content).forEach(
				(result, resultIndex) => {
					const pending = pendingToolEvents.get(result.tool_use_id);

					if (pending) {
						const text = toolResultText(result.content);
						pending.result = toTraceResult(
							result,
							isDelegationToolName(pending.toolName)
								? (subagentId ?? launchedAgentIdInText(text))
								: undefined,
							entry.timestamp,
						);
						const deferredTools = entry.toolUseResult?.total_deferred_tools;
						if (
							pending.toolName === "ToolSearch" &&
							deferredTools !== undefined
						)
							pending.toolSearch = { deferredTools };
						const handOff = parseBackgroundHandOff(pending.toolName, text);
						if (handOff)
							pending.background = {
								exitCode: null,
								finishedAt: null,
								result: null,
								status: null,
								summary: null,
								...handOff,
							};
						pendingToolEvents.delete(result.tool_use_id);
						return;
					}

					// A result with no matching call in this section still has to be
					// visible rather than silently dropped.
					agentEvents.push({
						kind: "orphan-result",
						id: `${entry.uuid}-${resultIndex}`,
						timestamp: entry.timestamp,
						result: toTraceResult(
							result.batch
								? {
										...result,
										batch: {
											...result.batch,
											toolIds: result.batch.toolIds.map(
												(id) => toolEventIds.get(id) ?? id,
											),
										},
									}
								: result,
							undefined,
							entry.timestamp,
						),
					});
				},
			);

			if (agentId === undefined) {
				agentId = entry.uuid;
				agentName = entry.agentName;
				agentTimestamp = entry.timestamp;
			}

			return;
		}

		const userTextBlockContent = textFromUserTextBlocks(entry.message.content);
		if (
			userTextBlockContent !== undefined &&
			attachClaudeSkillContent(agentEvents, userTextBlockContent)
		) {
			return;
		}

		const notice = parseTaskNotification(
			userContentText(entry.message.content),
		);
		const noticed = notice?.toolUseId
			? toolEventsByCallId.get(notice.toolUseId)
			: undefined;
		const answered = notice ? (unanswered.get(notice.taskId) ?? []) : [];
		if (notice) unanswered.delete(notice.taskId);
		for (const call of new Set([...(noticed ? [noticed] : []), ...answered]))
			call.background = {
				timedOut: call.background?.timedOut ?? false,
				exitCode: notice?.exitCode ?? null,
				finishedAt: entry.timestamp,
				result: notice?.result ?? null,
				status: notice?.status ?? null,
				summary: notice?.summary ?? null,
				taskId: notice?.taskId ?? "",
			};

		if (entry.queued) {
			flushAgentSection();
			items.push({
				kind: "system",
				id: entry.uuid,
				systemType: "member",
				timestamp: entry.timestamp,
				text: userContentText(entry.message.content),
			});
			return;
		}

		const systemType = classifyNonMemberUserEntry(entry);
		if (systemType) {
			flushAgentSection();
			items.push({
				kind: "system",
				id: entry.uuid,
				systemType,
				timestamp: entry.timestamp,
				text: userContentText(entry.message.content),
			});
			return;
		}

		flushAgentSection();
		items.push({
			kind: "user",
			id: entry.uuid,
			timestamp: entry.timestamp,
			content: entry.message.content,
		});
	});

	flushAgentSection();

	for (const item of items) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			if (event.kind === "tool")
				event.activity = deriveTranscriptToolActivity(event);
		}
	}
	return items;
}

/** Wall-clock gap between two ISO timestamps, or undefined if unusable. */
export function formatTimeDelta(
	fromTimestamp: string | undefined,
	toTimestamp: string | undefined,
): string | undefined {
	if (!fromTimestamp || !toTimestamp) {
		return undefined;
	}

	const from = new Date(fromTimestamp).getTime();
	const to = new Date(toTimestamp).getTime();

	if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
		return undefined;
	}

	// Round up: a gap the user waited through should never read as less time
	// than it took.
	const totalSeconds = Math.ceil((to - from) / 1000);

	// Every block in one assistant message carries that message's timestamp, so
	// a zero gap means "no measurable time passed" rather than a real duration.
	// Rendering "+0s" on each of those rows is noise.
	if (totalSeconds === 0) {
		return undefined;
	}

	if (totalSeconds < 60) {
		return `+${totalSeconds}s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	if (minutes < 60) {
		return seconds === 0 ? `+${minutes}m` : `+${minutes}m ${seconds}s`;
	}

	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	// Past a few days, hours stop being the unit anyone reads in.
	if (hours >= 72) {
		const days = Math.floor(hours / 24);
		const remainingHours = hours % 24;

		return remainingHours === 0 ? `+${days}d` : `+${days}d ${remainingHours}h`;
	}

	return remainingMinutes === 0
		? `+${hours}h`
		: `+${hours}h ${remainingMinutes}m`;
}

export function formatClockTime(timestamp: string | undefined): string {
	if (!timestamp) {
		return "";
	}

	const date = new Date(timestamp);

	if (Number.isNaN(date.getTime())) {
		return "";
	}

	return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
