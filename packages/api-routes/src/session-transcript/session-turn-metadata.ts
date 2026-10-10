// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: Claude and Codex metadata extraction share deduplication and turn attribution state.

import { z } from "zod";
import {
	createCodexReplayState,
	shouldSuppressCodexReplayEvent,
} from "../codex-usage-replay.js";
import {
	type SessionRequestBillingDimensions,
	type SessionRequestUsageEvent,
	summarizeSessionRequestUsage,
	sumSessionRequestCosts,
} from "../session-request-pricing.js";
import {
	attachCodexOperationMetadata,
	buildCodexActivityGraph,
	type CodexNormalizedOperation,
} from "./codex-activity-graph.js";
import {
	getTranscriptToolFileActivities,
	isCodexToolFailure,
} from "./codex-tool-translation.js";
import { isCodexFormat } from "./conversation-schema.js";
import {
	addUniqueEditedFiles,
	getClaudeMutationFiles,
} from "./session-turn-file-edits.js";
import type { SessionTurn } from "./session-turns.js";
import { deriveTranscriptToolActivity } from "./transcript-tool-activity.js";

// Keep malformed billing metadata unpriceable instead of dropping the usage
// record or silently treating an explicit unsupported tier as standard.
const billingDimensionSchema = z.string().nullish().catch("<invalid>");

const tokenUsageSchema = z.object({
	service_tier: billingDimensionSchema,
	speed: billingDimensionSchema,
	inference_geo: billingDimensionSchema.transform((value) =>
		value?.trim().toLowerCase() === "not_available" ? undefined : value,
	),
	cache_creation: z
		.object({
			ephemeral_1h_input_tokens: z.number().nonnegative().optional(),
			ephemeral_5m_input_tokens: z.number().nonnegative().optional(),
		})
		.optional(),
	cache_creation_input_tokens: z.number().nonnegative().optional(),
	cache_read_input_tokens: z.number().nonnegative().optional(),
	cached_input_tokens: z.number().nonnegative().optional(),
	input_tokens: z.number().nonnegative().optional(),
	output_tokens: z.number().nonnegative().optional(),
	reasoning_output_tokens: z.number().nonnegative().optional(),
});

const claudeErrorContentPartSchema = z
	.object({ text: z.string().optional() })
	.passthrough();

const claudeErrorContentSchema = z.union([
	z.string(),
	z.array(z.union([z.string(), claudeErrorContentPartSchema])),
]);

const claudeContentBlockSchema = z.object({
	content: claudeErrorContentSchema.optional(),
	id: z.string().nullable().optional(),
	input: z.record(z.string(), z.unknown()).nullable().optional(),
	is_error: z.boolean().nullable().optional(),
	name: z.string().nullable().optional(),
	text: z.string().optional(),
	tool_use_id: z.string().nullable().optional(),
	type: z.string().optional(),
});

const claudeLineSchema = z.object({
	isApiErrorMessage: z.boolean().nullable().optional(),
	message: z
		.object({
			content: z
				.union([z.string(), z.array(claudeContentBlockSchema)])
				.optional(),
			id: z.string().optional(),
			model: z.string().optional(),
			usage: tokenUsageSchema.optional(),
		})
		.optional(),
	timestamp: z.string().optional(),
	type: z.string().optional(),
});

const codexLineSchema = z.object({
	payload: z
		.object({
			arguments: z.string().optional(),
			call_id: z.string().optional(),
			info: z
				.object({
					last_token_usage: tokenUsageSchema.optional(),
					service_tier: billingDimensionSchema,
					model_context_window: z.number().positive().optional(),
					total_token_usage: tokenUsageSchema.optional(),
				})
				.nullable()
				.optional(),
			model: z.string().optional(),
			model_provider: billingDimensionSchema,
			service_tier: billingDimensionSchema,
			name: z.string().optional(),
			input: z.string().optional(),
			output: z.unknown().optional(),
			type: z.string().optional(),
		})
		.passthrough()
		.optional(),
	timestamp: z.string().optional(),
	type: z.string().optional(),
});

type TokenUsage = z.infer<typeof tokenUsageSchema>;
type ClaudeMessageContent = NonNullable<
	z.infer<typeof claudeLineSchema>["message"]
>["content"];

export type TokenUsageEvent = SessionRequestUsageEvent;

type TurnMetricsBuilder = {
	excludedReplayUsageCount: number;
	editedFiles: string[];
	errorCount: number;
	errorEvents: SessionTurnErrorEvent[];
	skills: string[];
	skillEvents: SessionTurnSkillEvent[];
	usageEvents: TokenUsageEvent[];
};

type PendingFileEdit = {
	builder: TurnMetricsBuilder;
	files: readonly string[];
};

export type SessionTurnMetrics = {
	excludedReplayUsageCount?: number;
	editedFiles: readonly string[];
	errorCount: number;
	errorEvents: readonly SessionTurnErrorEvent[];
	estimatedCost: number | undefined;
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	skills: readonly string[];
	skillEvents: readonly SessionTurnSkillEvent[];
	usageEvents: readonly TokenUsageEvent[];
};

export type SessionTurnErrorEvent = {
	at: string;
	content?: string;
};

export type SessionTurnSkillEvent = {
	at: string;
	skill: string;
};

type SessionTurnMetadataOptions = {
	fallbackModel: string | undefined;
	subagents?: Readonly<Record<string, string>>;
	turns: readonly SessionTurn[];
};

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function createTurnMetricsBuilders(turnCount: number): TurnMetricsBuilder[] {
	return Array.from(
		{ length: turnCount },
		(): TurnMetricsBuilder => ({
			excludedReplayUsageCount: 0,
			editedFiles: [],
			errorCount: 0,
			errorEvents: [],
			skills: [],
			skillEvents: [],
			usageEvents: [],
		}),
	);
}

function getTurnAnchorTimestamp(turn: SessionTurn) {
	for (const item of [...turn.userItems, ...turn.responseItems]) {
		if (item.timestamp) {
			return Date.parse(item.timestamp);
		}
	}

	return undefined;
}

function getTurnIndex(
	timestamp: string | undefined,
	anchors: readonly (number | undefined)[],
) {
	if (!timestamp) {
		return undefined;
	}

	const eventTime = Date.parse(timestamp);
	if (Number.isNaN(eventTime)) {
		return undefined;
	}

	for (let index = anchors.length - 1; index >= 0; index--) {
		const anchor = anchors[index];
		if (anchor !== undefined && eventTime >= anchor) {
			return index;
		}
	}

	return undefined;
}

function addErrors(
	builder: TurnMetricsBuilder,
	at: string | undefined,
	contents: readonly (string | undefined)[],
) {
	if (contents.length === 0) {
		return;
	}

	builder.errorCount += contents.length;
	if (!at) {
		return;
	}

	for (const content of contents) {
		builder.errorEvents.push({
			at,
			...(content?.trim() ? { content: content.trim() } : {}),
		});
	}
}

function getClaudeErrorContent(
	content: z.infer<typeof claudeErrorContentSchema> | undefined,
) {
	if (typeof content === "string") {
		return content;
	}
	return content
		?.flatMap((part) =>
			typeof part === "string"
				? [part]
				: part.text === undefined
					? []
					: [part.text],
		)
		.join("\n");
}

function getClaudeApiErrorContent(content: ClaudeMessageContent) {
	if (typeof content === "string") {
		return content;
	}
	return content
		?.flatMap((block) => [block.text, getClaudeErrorContent(block.content)])
		.filter(
			(part): part is string => typeof part === "string" && part.length > 0,
		)
		.join("\n");
}

function addSkill(
	builder: TurnMetricsBuilder,
	skill: string | undefined,
	at: string | undefined,
) {
	const normalizedSkill = skill?.trim();
	if (!normalizedSkill) {
		return;
	}

	if (!builder.skills.includes(normalizedSkill)) {
		builder.skills.push(normalizedSkill);
	}
	if (at) {
		builder.skillEvents.push({ at, skill: normalizedSkill });
	}
}

function addUsageEvent(
	builder: TurnMetricsBuilder,
	usage: TokenUsage,
	at: string,
	model: string | undefined,
	inputIncludesCache: boolean,
	billing: SessionRequestBillingDimensions,
	modelContextWindow?: number,
) {
	const cacheReadInputTokens =
		usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? 0;
	const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
	const cacheCreation5mInputTokens =
		usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
	const recordedCacheCreation1hInputTokens =
		usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
	const cacheCreation1hInputTokens =
		recordedCacheCreation1hInputTokens +
		Math.max(
			0,
			cacheCreationInputTokens -
				cacheCreation5mInputTokens -
				recordedCacheCreation1hInputTokens,
		);
	const recordedInputTokens = usage.input_tokens ?? 0;
	const inputTokens = inputIncludesCache
		? Math.max(0, recordedInputTokens - cacheReadInputTokens)
		: recordedInputTokens;
	const outputTokens = usage.output_tokens ?? 0;

	if (
		inputTokens === 0 &&
		outputTokens === 0 &&
		cacheReadInputTokens === 0 &&
		cacheCreationInputTokens === 0
	) {
		return;
	}

	builder.usageEvents.push({
		...billing,
		at,
		cacheCreation1hInputTokens,
		cacheCreation5mInputTokens,
		cacheCreationInputTokens,
		cacheReadInputTokens,
		inputTokens,
		model,
		...(modelContextWindow === undefined ? {} : { modelContextWindow }),
		outputTokens,
	});
}

function extractClaudeTurnMetadata(
	content: string,
	builders: TurnMetricsBuilder[],
	anchors: readonly (number | undefined)[],
	fallbackModel: string | undefined,
	editsOnly: boolean,
) {
	let earliestTimestamp: string | undefined;
	let earliestTimestampValue = Number.POSITIVE_INFINITY;
	let previousAssistantId: string | undefined;
	const pendingFileEdits = new Map<string, PendingFileEdit>();

	for (const rawLine of content.split("\n")) {
		if (!rawLine.trim()) {
			continue;
		}

		const result = claudeLineSchema.safeParse(parseJson(rawLine));
		if (!result.success) {
			continue;
		}

		const line = result.data;
		if (line.timestamp) {
			const timestampValue = Date.parse(line.timestamp);
			if (
				!Number.isNaN(timestampValue) &&
				timestampValue < earliestTimestampValue
			) {
				earliestTimestamp = line.timestamp;
				earliestTimestampValue = timestampValue;
			}
		}
		const turnIndex = getTurnIndex(line.timestamp, anchors);
		const builder = turnIndex === undefined ? undefined : builders[turnIndex];
		if (!builder) {
			continue;
		}

		if (!editsOnly && line.isApiErrorMessage === true) {
			addErrors(builder, line.timestamp, [
				getClaudeApiErrorContent(line.message?.content),
			]);
		}

		const contentBlocks = Array.isArray(line.message?.content)
			? line.message.content
			: [];
		if (!editsOnly) {
			addErrors(
				builder,
				line.timestamp,
				contentBlocks.flatMap((block) =>
					block.is_error === true ? [getClaudeErrorContent(block.content)] : [],
				),
			);
		}

		for (const block of contentBlocks) {
			const mutationFiles = getClaudeMutationFiles(block);
			if (block.id && mutationFiles.length > 0) {
				pendingFileEdits.set(block.id, { builder, files: mutationFiles });
			}

			if (block.type === "tool_result" && block.tool_use_id) {
				const pendingEdit = pendingFileEdits.get(block.tool_use_id);
				if (pendingEdit) {
					if (block.is_error !== true) {
						addUniqueEditedFiles(
							pendingEdit.builder.editedFiles,
							pendingEdit.files,
						);
					}
					pendingFileEdits.delete(block.tool_use_id);
				}
			}

			if (editsOnly || block.type !== "tool_use" || block.name !== "Skill") {
				continue;
			}

			const skill = block.input?.skill;
			addSkill(
				builder,
				typeof skill === "string" ? skill : undefined,
				line.timestamp,
			);
		}

		if (editsOnly || line.type !== "assistant") {
			continue;
		}

		const assistantId = line.message?.id;
		const isDuplicateUsage =
			assistantId !== undefined && assistantId === previousAssistantId;
		previousAssistantId = assistantId;

		if (line.message?.usage && line.timestamp && !isDuplicateUsage) {
			addUsageEvent(
				builder,
				line.message.usage,
				line.timestamp,
				line.message.model ?? fallbackModel,
				false,
				{
					serviceTier: line.message.usage.service_tier,
					inferenceSpeed: line.message.usage.speed,
					inferenceGeo: line.message.usage.inference_geo,
				},
			);
		}
	}

	return earliestTimestamp;
}

function getCodexToolErrors(
	outputText: string,
	endEvent: Readonly<Record<string, unknown>> | undefined,
) {
	if (!outputText && !endEvent) {
		return [];
	}
	return isCodexToolFailure(outputText, endEvent)
		? [outputText.trim() || "Tool call failed"]
		: [];
}

function getCodexOperationOutputText(operation: CodexNormalizedOperation) {
	return getCodexOutputBlocksText(operation.outputBlocks);
}

function getCodexOutputBlocksText(
	blocks: CodexNormalizedOperation["outputBlocks"],
) {
	return blocks
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			if (block.type === "image") {
				return "";
			}
			try {
				return JSON.stringify(block.value) ?? "";
			} catch {
				return "";
			}
		})
		.filter(Boolean)
		.join("\n");
}

function getTokenUsageSignature(usage: TokenUsage | undefined) {
	if (!usage) {
		return undefined;
	}

	return [
		usage.input_tokens ?? 0,
		usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? 0,
		usage.output_tokens ?? 0,
	].join(":");
}

function extractCodexTurnMetadata(
	content: string,
	builders: TurnMetricsBuilder[],
	anchors: readonly (number | undefined)[],
	fallbackModel: string | undefined,
) {
	const replayState = createCodexReplayState(content);
	let currentModel = fallbackModel;
	let modelProvider: string | null | undefined;
	let sawSessionMeta = false;
	let configuredServiceTier: string | null | undefined;
	let previousTokenUsageSignature: string | undefined;
	const graph = buildCodexActivityGraph(content);
	const graphOperations = [
		...graph.carriers.flatMap((carrier) =>
			carrier.operations.map((operation) => ({ carrier, operation })),
		),
		...graph.standaloneOperations.map((operation) => ({
			carrier: undefined,
			operation,
		})),
	];

	for (const { carrier, operation } of graphOperations) {
		const turnIndex = getTurnIndex(operation.timestamp, anchors);
		const builder = turnIndex === undefined ? undefined : builders[turnIndex];
		if (!builder) {
			continue;
		}
		const input = attachCodexOperationMetadata(
			operation.input,
			operation,
			carrier,
		);
		const activity = deriveTranscriptToolActivity({
			toolName: operation.name,
			input,
			provider: "codex",
		});
		for (const skill of activity.skills)
			addSkill(builder, skill, operation.timestamp);
		const outputText = getCodexOperationOutputText(operation);
		const errors = getCodexToolErrors(outputText, operation.lifecycle?.payload);
		addErrors(
			builder,
			operation.lifecycle?.timestamp ?? operation.timestamp,
			errors,
		);
		if (errors.length > 0) {
			continue;
		}
		const mutationFiles = getTranscriptToolFileActivities(
			operation.name,
			input,
			"codex",
		)
			.filter(({ operation: activity }) =>
				["created", "deleted", "edited"].includes(activity),
			)
			.map(({ path }) => path);
		addUniqueEditedFiles(builder.editedFiles, mutationFiles);
	}

	for (const lifecycle of graph.lifecycleRecords) {
		if (lifecycle.confidence !== "ambiguous-positional") {
			continue;
		}
		const turnIndex = getTurnIndex(lifecycle.timestamp, anchors);
		const builder = turnIndex === undefined ? undefined : builders[turnIndex];
		if (!builder) {
			continue;
		}
		addErrors(
			builder,
			lifecycle.timestamp,
			getCodexToolErrors(
				getCodexOutputBlocksText(lifecycle.outputBlocks),
				lifecycle.payload,
			),
		);
	}

	for (const rawLine of content.split("\n")) {
		if (!rawLine.trim()) {
			continue;
		}

		const result = codexLineSchema.safeParse(parseJson(rawLine));
		if (!result.success) {
			continue;
		}

		const line = result.data;
		// A fork file replays its parent's session_meta after its own, so the
		// first one names this session's provider.
		if (line.type === "session_meta" && !sawSessionMeta) {
			sawSessionMeta = true;
			modelProvider = line.payload?.model_provider;
		}
		if (line.type === "turn_context" && line.payload?.model) {
			currentModel = line.payload.model;
		}
		// The tier the thread is configured to run at: the only tier Codex logs
		// when a response records none. A cleared setting (null) is standard.
		if (
			line.type === "turn_context" &&
			line.payload?.service_tier !== undefined
		) {
			configuredServiceTier = line.payload.service_tier;
		}
		if (
			line.type === "event_msg" &&
			line.payload?.type === "thread_settings_applied"
		) {
			const settings = line.payload.thread_settings;
			if (
				typeof settings === "object" &&
				settings !== null &&
				Object.hasOwn(settings, "service_tier")
			) {
				const tier = (settings as { service_tier?: unknown }).service_tier;
				configuredServiceTier =
					typeof tier === "string" || tier === null ? tier : "<invalid>";
			}
		}

		const turnIndex = getTurnIndex(line.timestamp, anchors);
		const builder = turnIndex === undefined ? undefined : builders[turnIndex];
		if (!builder) {
			continue;
		}
		if (line.type === "event_msg" && line.payload?.type === "error") {
			const message = line.payload.message;
			addErrors(builder, line.timestamp, [
				typeof message === "string" ? message : "Codex event error",
			]);
			continue;
		}

		if (
			line.type !== "event_msg" ||
			line.payload?.type !== "token_count" ||
			!line.timestamp
		) {
			continue;
		}

		const totalUsage = line.payload.info?.total_token_usage;
		if (!totalUsage) {
			continue;
		}

		const signature = getTokenUsageSignature(totalUsage);
		const replayTotalKey = [
			totalUsage.input_tokens ?? 0,
			totalUsage.cached_input_tokens ?? totalUsage.cache_read_input_tokens ?? 0,
			totalUsage.output_tokens ?? 0,
			totalUsage.reasoning_output_tokens ?? 0,
		].join(":");
		if (
			shouldSuppressCodexReplayEvent(
				replayState,
				replayTotalKey,
				line.timestamp,
			)
		) {
			builder.excludedReplayUsageCount += 1;
			previousTokenUsageSignature = signature;
			continue;
		}
		if (!signature || signature === previousTokenUsageSignature) {
			continue;
		}

		previousTokenUsageSignature = signature;
		const turnUsage = line.payload.info?.last_token_usage ?? totalUsage;
		addUsageEvent(
			builder,
			turnUsage,
			line.timestamp,
			currentModel,
			true,
			{
				modelProvider,
				// The response tier is request-local: a configured Fast setting must not
				// override a response that recorded its own tier (even default). Only
				// when the response records none is the thread's configured tier, the
				// only tier Codex logs, the price basis.
				serviceTier:
					line.payload.info?.service_tier ??
					line.payload.service_tier ??
					configuredServiceTier ??
					undefined,
			},
			line.payload.info?.model_context_window,
		);
	}
}

function finalizeTurnMetrics(builder: TurnMetricsBuilder): SessionTurnMetrics {
	const summary = summarizeSessionRequestUsage(builder.usageEvents);
	const onlyReplay =
		builder.excludedReplayUsageCount > 0 && builder.usageEvents.length === 0;

	return {
		...(builder.excludedReplayUsageCount > 0
			? { excludedReplayUsageCount: builder.excludedReplayUsageCount }
			: {}),
		editedFiles: builder.editedFiles,
		errorCount: builder.errorCount,
		errorEvents: builder.errorEvents,
		estimatedCost: onlyReplay ? 0 : (summary.estimatedCost ?? undefined),
		inputTokens: onlyReplay ? 0 : (summary.inputTokens ?? undefined),
		outputTokens: onlyReplay ? 0 : (summary.outputTokens ?? undefined),
		skills: builder.skills,
		skillEvents: builder.skillEvents,
		usageEvents: builder.usageEvents,
	};
}

function addSubagentUsageTotals(
	turnMetrics: SessionTurnMetrics,
	subagentMetrics: readonly SessionTurnMetrics[],
) {
	const usageMetrics = [turnMetrics, ...subagentMetrics].filter(
		(metrics) => metrics.usageEvents.length > 0 || metrics.estimatedCost === 0,
	);
	if (usageMetrics.length === 0) {
		return turnMetrics;
	}

	return {
		...turnMetrics,
		estimatedCost:
			sumSessionRequestCosts(
				usageMetrics.map((metrics) => ({
					estimatedCost: metrics.estimatedCost ?? null,
					usageEventCount: metrics.usageEvents.length,
				})),
			) ?? undefined,
		inputTokens: usageMetrics.reduce(
			(total, metrics) => total + (metrics.inputTokens ?? 0),
			0,
		),
		outputTokens: usageMetrics.reduce(
			(total, metrics) => total + (metrics.outputTokens ?? 0),
			0,
		),
	};
}

export function extractTranscriptUsageMetrics(
	content: string,
	fallbackModel: string | undefined,
) {
	const builders = createTurnMetricsBuilders(1);
	const anchors = [Number.NEGATIVE_INFINITY];

	if (isCodexFormat(content)) {
		extractCodexTurnMetadata(content, builders, anchors, fallbackModel);
	} else {
		extractClaudeTurnMetadata(content, builders, anchors, fallbackModel, false);
	}

	const builder = builders[0];
	return builder
		? finalizeTurnMetrics(builder)
		: finalizeTurnMetrics({
				excludedReplayUsageCount: 0,
				editedFiles: [],
				errorCount: 0,
				errorEvents: [],
				skills: [],
				skillEvents: [],
				usageEvents: [],
			});
}

export function extractSessionTurnMetrics(
	content: string,
	options: SessionTurnMetadataOptions,
) {
	return extractSessionTurnMetricBreakdown(content, options).turnMetrics;
}

export function extractSessionTurnMetricBreakdown(
	content: string,
	options: SessionTurnMetadataOptions,
) {
	const anchors = options.turns.map(getTurnAnchorTimestamp);
	const builders = createTurnMetricsBuilders(options.turns.length);

	if (isCodexFormat(content)) {
		extractCodexTurnMetadata(content, builders, anchors, options.fallbackModel);
	} else {
		extractClaudeTurnMetadata(
			content,
			builders,
			anchors,
			options.fallbackModel,
			false,
		);
	}

	const primaryTurnMetrics = builders.map(finalizeTurnMetrics);
	const subagentMetrics = Object.entries(options.subagents ?? {}).map(
		([subagentId, subagentContent]) => {
			const startedAt = extractClaudeTurnMetadata(
				subagentContent,
				builders,
				anchors,
				options.fallbackModel,
				true,
			);
			const metrics = extractTranscriptUsageMetrics(subagentContent, undefined);
			const turnIndex = getTurnIndex(startedAt, anchors);
			return { metrics, subagentId, turnIndex };
		},
	);
	const turnMetrics = builders.map((builder, turnIndex) =>
		addSubagentUsageTotals(
			finalizeTurnMetrics(builder),
			subagentMetrics.flatMap((subagent) =>
				subagent.turnIndex === turnIndex ? [subagent.metrics] : [],
			),
		),
	);

	return {
		primaryTurnMetrics,
		subagentMetrics: subagentMetrics.map(({ metrics, subagentId }) => ({
			metrics,
			subagentId,
		})),
		turnMetrics,
	};
}
