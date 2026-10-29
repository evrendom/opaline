import { z } from "zod";
import {
	isCodexFormat,
	parseCodexConversations,
} from "./codex-conversation-parser.js";

// Content block schemas
export const TextContentSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
});

export const ThinkingContentSchema = z.object({
	type: z.literal("thinking"),
	thinking: z.string(),
	signature: z.string().optional(),
});

export const ToolUseContentSchema = z.object({
	type: z.literal("tool_use"),
	id: z.string(),
	name: z.string(),
	input: z.record(z.string(), z.unknown()),
});

export const ToolResultTextContentSchema = TextContentSchema.extend({
	rawType: z.string().optional(),
});

export const ToolResultImageContentSchema = z.object({
	type: z.literal("image"),
	rawType: z.string().optional(),
	source: z.unknown().optional(),
});

export const ToolResultStructuredContentSchema = z.object({
	type: z.literal("structured"),
	rawType: z.string().optional(),
	value: z.unknown().optional(),
});

/** A result block of a kind with no shape of its own here — Claude's
 * `tool_reference`, which ToolSearch answers with — kept whole as a
 * structured block, its kind as its rawType, rather than failing the result
 * and losing it. */
const ToolResultOtherContentSchema = z
	.looseObject({ type: z.string() })
	.transform((block) => ({
		rawType: block.type,
		type: "structured" as const,
		value: block as unknown,
	}));

export const ToolResultContentSchema = z.object({
	type: z.literal("tool_result"),
	tool_use_id: z.string(),
	batch: z.object({ id: z.string(), toolIds: z.array(z.string()) }).optional(),
	content: z.union([
		z.string(),
		z.array(
			z.union([
				ToolResultTextContentSchema,
				ToolResultImageContentSchema,
				ToolResultStructuredContentSchema,
				ToolResultOtherContentSchema,
			]),
		),
	]),
	is_error: z.boolean().optional(),
});

export const UserImageContentSchema = z.object({
	type: z.literal("image"),
	source: z.unknown().optional(),
});

// Message schemas
export const UserMessageSchema = z.object({
	role: z.literal("user"),
	content: z.union([
		z.string(),
		z.array(
			z.union([
				z.string(),
				TextContentSchema,
				UserImageContentSchema,
				ToolResultContentSchema,
			]),
		),
	]),
});

const ToolUseResultMetadataSchema = z
	.object({
		agentId: z.string().optional(),
		total_deferred_tools: z.number().int().nonnegative().optional(),
	})
	.passthrough();

export const AssistantMessageSchema = z.object({
	role: z.literal("assistant"),
	content: z.array(
		z.union([TextContentSchema, ThinkingContentSchema, ToolUseContentSchema]),
	),
});

export const ConversationExecutionModeSchema = z.enum([
	"plan",
	"default",
	"unknown",
]);
export const ConversationProviderSchema = z.enum(["claude", "codex"]);

// Entry schemas
const BaseEntrySchema = z.object({
	agentName: z.string().optional(),
	/** The agent's own id for this entry when `uuid` isn't it — Codex lines
	 * carry none, so their `uuid` is derived and this keeps the item id
	 * (`rs_…`, `msg_…`). */
	nativeId: z.string().optional(),
	provider: ConversationProviderSchema.optional(),
	uuid: z.string(),
	timestamp: z.string(),
	sessionId: z.string(),
});

export const UserEntrySchema = BaseEntrySchema.extend({
	isCompactSummary: z.boolean().optional(),
	queued: z.boolean().optional(),
	isMeta: z.boolean().optional(),
	type: z.literal("user"),
	message: UserMessageSchema,
	// Claude Code writes an object for most tools, a content-block array for
	// MCP tools and a string for some errors; only the object carries
	// `agentId`, and rejecting the other shapes would drop the whole entry.
	toolUseResult: z.preprocess(
		(value) =>
			value !== null && typeof value === "object" && !Array.isArray(value)
				? value
				: undefined,
		ToolUseResultMetadataSchema.optional(),
	),
});

export const AssistantEntrySchema = BaseEntrySchema.extend({
	executionMode: ConversationExecutionModeSchema.default("unknown"),
	modelSetting: z.string().max(128).optional(),
	type: z.literal("assistant"),
	message: AssistantMessageSchema,
});

export const SummaryEntrySchema = z.object({
	type: z.literal("summary"),
	summary: z.string(),
});

export const SystemEntrySchema = BaseEntrySchema.extend({
	type: z.literal("system"),
	message: z.object({ content: z.string() }),
});

export const SystemEventEntrySchema = BaseEntrySchema.extend({
	type: z.literal("system"),
	subtype: z.enum(["compact_boundary", "stop_hook_summary"]),
	compactMetadata: z
		.object({
			durationMs: z.number().nonnegative().optional().catch(undefined),
			postTokens: z.number().nonnegative().optional().catch(undefined),
			preCompactDiscoveredTools: z
				.array(z.string())
				.optional()
				.catch(undefined),
			preTokens: z.number().nonnegative().optional().catch(undefined),
			preservedMessages: z
				.object({ uuids: z.array(z.string()).optional() })
				.optional()
				.catch(undefined),
			trigger: z.string().optional().catch(undefined),
		})
		.optional(),
	hookInfos: z
		.array(z.object({ durationMs: z.number().nonnegative().optional() }))
		.optional(),
});

// Union type
export const ConversationSchema = z.union([
	UserEntrySchema,
	AssistantEntrySchema,
	SummaryEntrySchema,
	SystemEntrySchema,
	SystemEventEntrySchema,
]);

export type TextContent = z.infer<typeof TextContentSchema>;
export type ThinkingContent = z.infer<typeof ThinkingContentSchema>;
export type ToolUseContent = z.infer<typeof ToolUseContentSchema>;
export type ToolResultContent = z.infer<typeof ToolResultContentSchema>;
export type ConversationExecutionMode = z.infer<
	typeof ConversationExecutionModeSchema
>;
export type ConversationProvider = z.infer<typeof ConversationProviderSchema>;
export type ToolResultImageContent = z.infer<
	typeof ToolResultImageContentSchema
>;
export type ToolResultStructuredContent = z.infer<
	typeof ToolResultStructuredContentSchema
>;
export type ToolResultTextContent = z.infer<typeof ToolResultTextContentSchema>;
export type UserEntry = z.infer<typeof UserEntrySchema>;
export type AssistantEntry = z.infer<typeof AssistantEntrySchema>;
export type SummaryEntry = z.infer<typeof SummaryEntrySchema>;
export type SystemEntry = z.infer<typeof SystemEntrySchema>;
export type Conversation = z.infer<typeof ConversationSchema>;

function readPermissionMode(value: unknown): string | undefined {
	if (
		typeof value !== "object" ||
		value === null ||
		!("permissionMode" in value) ||
		typeof value.permissionMode !== "string"
	) {
		return undefined;
	}

	return value.permissionMode;
}

function readClaudeModelSetting(value: unknown): string | undefined {
	if (
		typeof value !== "object" ||
		value === null ||
		!("effort" in value) ||
		typeof value.effort !== "string"
	) {
		return undefined;
	}

	const modelSetting = value.effort.trim();
	return modelSetting ? modelSetting : undefined;
}

function toExecutionMode(permissionMode: string): ConversationExecutionMode {
	return permissionMode === "plan" ? "plan" : "default";
}

// Parser
/**
 * What the harness queued while the agent was working, which it writes as a
 * `queued_command` attachment rather than the user line it writes when the
 * agent is idle: a task notification, read as that line, so a subagent's
 * report or a background command's end shows wherever it came; or a message
 * the member wrote meanwhile, handed to the agent after its next call — read
 * as a user line marked `queued`, so it stays in the run it redirected.
 */
function queuedCommand(parsed: unknown): unknown {
	if (!parsed || typeof parsed !== "object") return parsed;
	const record = parsed as Record<string, unknown>;
	const attachment = record.attachment as
		| { prompt?: unknown; type?: unknown }
		| undefined;
	if (record.type !== "attachment" || attachment?.type !== "queued_command")
		return parsed;
	const { prompt } = attachment;
	if (typeof prompt !== "string" && !Array.isArray(prompt)) return parsed;
	const notification =
		typeof prompt === "string" && /^\s*<task-notification[\s>]/u.test(prompt);
	return {
		...record,
		message: { content: prompt, role: "user" },
		type: "user",
		...(notification ? {} : { queued: true }),
	};
}

export function parseConversations(content: string): Array<Conversation> {
	if (isCodexFormat(content)) {
		return parseCodexConversations(content);
	}

	const conversations: Array<Conversation> = [];
	const lines = content.split("\n").filter(Boolean);
	let executionMode: ConversationExecutionMode = "unknown";
	const pendingExitPlanToolIds = new Set<string>();
	const notifications = new Set<string>();

	for (const line of lines) {
		try {
			const parsed = queuedCommand(JSON.parse(line) as unknown);
			const permissionMode = readPermissionMode(parsed);
			const modelSetting = readClaudeModelSetting(parsed);
			const result = ConversationSchema.safeParse(parsed);
			if (result.success) {
				const entry = result.data;
				if (
					entry.type === "user" &&
					typeof entry.message.content === "string" &&
					entry.message.content.trimStart().startsWith("<task-notification")
				) {
					if (notifications.has(entry.message.content)) continue;
					notifications.add(entry.message.content);
				}

				if (entry.type === "user" && permissionMode !== undefined) {
					executionMode = toExecutionMode(permissionMode);
					pendingExitPlanToolIds.clear();
				}

				if (entry.type === "assistant") {
					conversations.push({
						...entry,
						executionMode,
						...(modelSetting ? { modelSetting } : {}),
						provider: "claude",
					});
					for (const block of entry.message.content) {
						if (block.type === "tool_use" && block.name === "ExitPlanMode") {
							pendingExitPlanToolIds.add(block.id);
						}
					}
					continue;
				}

				conversations.push(
					entry.type === "summary" ? entry : { ...entry, provider: "claude" },
				);
				if (entry.type !== "user" || !Array.isArray(entry.message.content)) {
					continue;
				}

				for (const block of entry.message.content) {
					if (
						typeof block !== "string" &&
						block.type === "tool_result" &&
						pendingExitPlanToolIds.has(block.tool_use_id)
					) {
						pendingExitPlanToolIds.delete(block.tool_use_id);
						if (block.is_error !== true) {
							executionMode = "default";
						}
					}
				}
			}
		} catch {
			// Skip malformed lines
		}
	}

	return conversations;
}

export { isCodexFormat } from "./codex-conversation-parser.js";
