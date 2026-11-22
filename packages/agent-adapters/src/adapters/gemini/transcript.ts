import { createHash } from "node:crypto";
import {
	translateAntigravityTool,
	translateGeminiCliTool,
	unquoteAntigravityArgs,
} from "./tools.js";

/**
 * Gemini sessions are stored in Claude Code's transcript shape, so every
 * reader Opaline has for Claude Code (usage and cost, the session reader,
 * tool activity, facts) reads them too. Each line's `version` names the
 * translation that wrote it; bump this when the translation changes.
 */
export const GEMINI_TRANSCRIPT_VERSION = 1;

/** Marks a line Opaline wrote for a Gemini session (read by nothing else). */
export const GEMINI_TRANSCRIPT_VERSION_TAG = `gemini-v${GEMINI_TRANSCRIPT_VERSION}`;

const SYNTHETIC_MODEL = "<synthetic>";

type Json = Record<string, unknown>;

export interface GeminiTranscript {
	readonly sessionId: string;
	/** Claude Code-shaped JSONL. */
	readonly content: string;
	/** First and last recorded timestamps, ISO 8601. */
	readonly startedAt: string | null;
	readonly endedAt: string | null;
	/** Models in the order they first answered. */
	readonly models: readonly string[];
	/** Subagent session IDs the transcript hands work to. */
	readonly subagentIds: readonly string[];
	readonly kind: "main" | "subagent";
	/** Project directories the session recorded (Gemini CLI only). */
	readonly directories: readonly string[];
}

export interface TranslateOptions {
	readonly cwd: string;
	/** Present when this transcript is a subagent of another session. */
	readonly agentId?: string;
	/** Used when a step records no model (Antigravity). */
	readonly defaultModel?: string;
	/** Used when a step records no time (Antigravity). */
	readonly fallbackTimestamp?: string;
	/** The session's title, when the agent keeps one apart (Antigravity). */
	readonly title?: string;
}

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function tokens(value: unknown): number {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Number(value)
				: Number.NaN;
	return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function isoTimestamp(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		// Seconds or milliseconds since the epoch.
		const ms = value < 1e12 ? value * 1000 : value;
		return new Date(ms).toISOString();
	}
	if (typeof value !== "string" || value === "") return undefined;
	const ms = Date.parse(
		value.includes(" ") && !value.includes("T")
			? value.replace(" ", "T")
			: value,
	);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function stableUuid(...parts: string[]): string {
	const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(
		(Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8
	).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Writes Claude Code-shaped lines with the chain fields every line carries. */
class ClaudeLineWriter {
	private readonly lines: string[] = [];
	private parentUuid: string | null = null;
	private first: string | null = null;
	private last: string | null = null;
	private readonly models: string[] = [];

	constructor(
		private readonly sessionId: string,
		private readonly options: TranslateOptions,
	) {}

	private push(
		uuidSeed: string,
		timestamp: string | undefined,
		record: Json,
	): string {
		const uuid = stableUuid(
			this.sessionId,
			this.options.agentId ?? "",
			uuidSeed,
		);
		const at = timestamp ?? this.last ?? this.options.fallbackTimestamp;
		const line: Json = {
			parentUuid: this.parentUuid,
			isSidechain: this.options.agentId !== undefined,
			userType: "external",
			cwd: this.options.cwd,
			sessionId: this.sessionId,
			version: GEMINI_TRANSCRIPT_VERSION_TAG,
			...(this.options.agentId !== undefined
				? { agentId: this.options.agentId }
				: {}),
			...record,
			uuid,
			...(at ? { timestamp: at } : {}),
		};
		if (at) {
			if (!this.first || at < this.first) this.first = at;
			if (!this.last || at > this.last) this.last = at;
		}
		this.parentUuid = uuid;
		this.lines.push(JSON.stringify(line));
		return uuid;
	}

	user(seed: string, timestamp: string | undefined, content: unknown): void {
		this.push(seed, timestamp, {
			type: "user",
			message: { role: "user", content },
		});
	}

	toolResults(
		seed: string,
		timestamp: string | undefined,
		results: readonly Json[],
		toolUseResult?: Json,
	): void {
		if (results.length === 0) return;
		this.push(seed, timestamp, {
			type: "user",
			message: { role: "user", content: results },
			...(toolUseResult ? { toolUseResult } : {}),
		});
	}

	assistant(
		seed: string,
		timestamp: string | undefined,
		input: {
			model: string | undefined;
			content: readonly Json[];
			usage: Json | undefined;
			stopReason: string;
		},
	): void {
		const model = input.model ?? this.options.defaultModel ?? "";
		if (model && model !== SYNTHETIC_MODEL && !this.models.includes(model))
			this.models.push(model);
		this.push(seed, timestamp, {
			type: "assistant",
			requestId: `gemini-${seed}`,
			message: {
				id: `gemini-${this.sessionId}-${seed}`,
				type: "message",
				role: "assistant",
				model,
				content: input.content,
				stop_reason: input.stopReason,
				stop_sequence: null,
				...(input.usage ? { usage: input.usage } : {}),
			},
		});
	}

	apiError(seed: string, timestamp: string | undefined, message: string): void {
		this.push(seed, timestamp, {
			type: "assistant",
			isApiErrorMessage: true,
			message: {
				id: `gemini-${this.sessionId}-${seed}`,
				type: "message",
				role: "assistant",
				model: SYNTHETIC_MODEL,
				content: [{ type: "text", text: message }],
				stop_reason: "stop_sequence",
				stop_sequence: "",
			},
		});
	}

	summary(summary: string): void {
		this.lines.push(
			JSON.stringify({ type: "summary", summary, leafUuid: this.parentUuid }),
		);
	}

	result(input: {
		subagentIds: readonly string[];
		kind: "main" | "subagent";
		directories: readonly string[];
	}): GeminiTranscript {
		return {
			sessionId: this.sessionId,
			content: this.lines.length > 0 ? `${this.lines.join("\n")}\n` : "",
			startedAt: this.first,
			endedAt: this.last,
			models: this.models,
			...input,
		};
	}
}

/**
 * Gemini's token counts in Claude Code's usage shape. Gemini's prompt count
 * includes the cached tokens and bills thinking as output; Claude Code counts
 * uncached input separately and includes thinking in output_tokens.
 */
export function geminiUsage(input: {
	prompt: number;
	cached: number;
	output: number;
	thoughts: number;
	tool: number;
}): Json {
	const cached = Math.min(input.cached, input.prompt + input.tool);
	return {
		input_tokens: Math.max(0, input.prompt + input.tool - cached),
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: cached,
		output_tokens: input.output + input.thoughts,
		output_tokens_details: { thinking_tokens: input.thoughts },
	};
}

// ── Gemini CLI ────────────────────────────────────────────────────────────

interface GeminiCliMessage {
	id: string;
	timestamp?: string;
	type: string;
	content?: unknown;
	displayContent?: unknown;
	thoughts?: unknown;
	tokens?: unknown;
	model?: unknown;
	toolCalls?: unknown;
}

interface GeminiCliRecord {
	metadata: Json;
	messages: GeminiCliMessage[];
}

function isMessage(value: unknown): value is GeminiCliMessage {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.type === "string" &&
		!Object.hasOwn(value, "$patch")
	);
}

/**
 * Reads a Gemini CLI session: the JSONL log (metadata line, message lines
 * re-written by ID as they fill in, `$set` metadata updates, `$patch` and
 * `$rewindTo` edits) or the single JSON document older versions wrote.
 *
 * Rewinds and removals are ignored on purpose: the turns they drop still
 * happened and were billed.
 */
export function readGeminiCliRecord(raw: string): GeminiCliRecord | null {
	const trimmed = raw.trimStart();
	if (trimmed.startsWith("{") && !trimmed.includes("\n{")) {
		try {
			const document: unknown = JSON.parse(trimmed);
			if (isRecord(document) && Array.isArray(document.messages)) {
				const { messages, ...metadata } = document;
				return {
					metadata,
					messages: (messages as unknown[]).filter(isMessage),
				};
			}
		} catch {
			// Not a single document; read it as JSONL.
		}
	}
	let metadata: Json = {};
	const messages = new Map<string, GeminiCliMessage>();
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(record)) continue;
		if (isRecord(record.$set)) {
			const { messages: replaced, ...rest } = record.$set;
			metadata = { ...metadata, ...rest };
			if (Array.isArray(replaced))
				for (const message of replaced)
					if (isMessage(message)) messages.set(message.id, message);
			continue;
		}
		if (isRecord(record.$patch)) {
			const patch = record.$patch;
			const updates = [
				patch,
				...(Array.isArray(patch.updates) ? patch.updates : []),
			];
			for (const update of updates) {
				if (!isRecord(update) || typeof update.id !== "string") continue;
				const existing = messages.get(update.id);
				if (!existing) continue;
				if (update.content !== undefined) existing.content = update.content;
				if (
					Array.isArray(update.toolCalls) &&
					Array.isArray(existing.toolCalls)
				)
					for (const toolPatch of update.toolCalls) {
						if (!isRecord(toolPatch) || !("result" in toolPatch)) continue;
						const call = (existing.toolCalls as unknown[]).find(
							(candidate) =>
								isRecord(candidate) && candidate.id === toolPatch.id,
						);
						if (isRecord(call)) call.result = toolPatch.result;
					}
			}
			continue;
		}
		if (typeof record.$rewindTo === "string") continue;
		if (isMessage(record)) {
			messages.set(record.id, record);
			continue;
		}
		if (typeof record.sessionId === "string") {
			const { messages: embedded, ...rest } = record;
			metadata = { ...metadata, ...rest };
			if (Array.isArray(embedded))
				for (const message of embedded)
					if (isMessage(message)) messages.set(message.id, message);
		}
	}
	if (typeof metadata.sessionId !== "string") return null;
	return { metadata, messages: [...messages.values()] };
}

/** Text and images of a Gemini part list, as Claude Code content blocks. */
function partsToBlocks(value: unknown): Json[] {
	if (typeof value === "string")
		return value ? [{ type: "text", text: value }] : [];
	const parts = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
	const blocks: Json[] = [];
	for (const part of parts) {
		if (typeof part === "string") {
			if (part) blocks.push({ type: "text", text: part });
			continue;
		}
		if (!isRecord(part)) continue;
		if (part.thought === true) continue;
		if (typeof part.text === "string" && part.text !== "") {
			blocks.push({ type: "text", text: part.text });
			continue;
		}
		const inline = isRecord(part.inlineData) ? part.inlineData : null;
		if (inline && typeof inline.data === "string") {
			const mediaType = text(inline.mimeType) ?? "application/octet-stream";
			blocks.push(
				mediaType.startsWith("image/")
					? {
							type: "image",
							source: {
								type: "base64",
								media_type: mediaType,
								data: inline.data,
							},
						}
					: { type: "text", text: `[${mediaType} attachment]` },
			);
		}
	}
	return blocks;
}

function blocksText(blocks: readonly Json[]): string {
	return blocks
		.filter((block) => block.type === "text")
		.map((block) => String(block.text))
		.join("");
}

const SLASH_COMMAND = /^\/([A-Za-z][\w:-]*)(?:\s+([\s\S]*))?$/u;

/** A typed prompt; slash commands in Claude Code's command markup. */
function userPrompt(blocks: Json[]): unknown {
	const only = blocks.length === 1 ? blocks[0] : undefined;
	if (only?.type === "text") {
		const prompt = String(only.text);
		const command = SLASH_COMMAND.exec(prompt.trim());
		if (command)
			return `<command-message>${command[1]} is running…</command-message>\n<command-name>/${command[1]}</command-name>\n<command-args>${command[2] ?? ""}</command-args>`;
		return prompt;
	}
	return blocks;
}

function thoughtsText(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.flatMap((thought) => {
			if (!isRecord(thought)) return [];
			const subject = text(thought.subject);
			const description = text(thought.description) ?? "";
			return [subject ? `**${subject}**\n\n${description}` : description];
		})
		.filter((thought) => thought.trim() !== "")
		.join("\n\n");
}

/** A tool call's output text from its Gemini function-response parts. */
function toolOutput(call: Json): string {
	const display = call.resultDisplay;
	const parts = Array.isArray(call.result) ? call.result : [];
	const outputs: string[] = [];
	for (const part of parts) {
		if (!isRecord(part)) continue;
		const response = isRecord(part.functionResponse)
			? part.functionResponse.response
			: undefined;
		if (isRecord(response)) {
			const value = response.output ?? response.error ?? response.content;
			if (typeof value === "string") outputs.push(value);
			else if (value !== undefined) outputs.push(JSON.stringify(value));
			else outputs.push(JSON.stringify(response));
			continue;
		}
		if (typeof part.text === "string") outputs.push(part.text);
	}
	if (outputs.length > 0) return outputs.join("\n");
	if (typeof display === "string") return display;
	return "";
}

export function translateGeminiCliSession(
	raw: string,
	options: TranslateOptions,
): GeminiTranscript | null {
	const record = readGeminiCliRecord(raw);
	if (!record) return null;
	const sessionId = String(record.metadata.sessionId);
	const writer = new ClaudeLineWriter(sessionId, options);
	const subagentIds: string[] = [];
	for (const message of record.messages) {
		const at = isoTimestamp(message.timestamp);
		if (message.type === "user") {
			const blocks = partsToBlocks(
				message.displayContent !== undefined && message.displayContent !== ""
					? message.displayContent
					: message.content,
			);
			if (blocks.length > 0) writer.user(message.id, at, userPrompt(blocks));
			continue;
		}
		if (message.type === "error") {
			const error = blocksText(partsToBlocks(message.content));
			if (error) writer.apiError(message.id, at, error);
			continue;
		}
		if (message.type !== "gemini") continue;
		const content: Json[] = [];
		const thinking = thoughtsText(message.thoughts);
		if (thinking) content.push({ type: "thinking", thinking, signature: "" });
		content.push(...partsToBlocks(message.content));
		const calls = (
			Array.isArray(message.toolCalls) ? message.toolCalls : []
		).filter(isRecord);
		for (const call of calls) {
			const translated = translateGeminiCliTool(
				String(call.name ?? "tool"),
				isRecord(call.args) ? call.args : {},
			);
			content.push({
				type: "tool_use",
				id: String(call.id ?? `${message.id}-${content.length}`),
				name: translated.name,
				input: translated.input,
			});
		}
		const counts = isRecord(message.tokens) ? message.tokens : null;
		writer.assistant(message.id, at, {
			model: text(message.model),
			content,
			usage: counts
				? geminiUsage({
						prompt: tokens(counts.input),
						cached: tokens(counts.cached),
						output: tokens(counts.output),
						thoughts: tokens(counts.thoughts),
						tool: tokens(counts.tool),
					})
				: undefined,
			stopReason: calls.length > 0 ? "tool_use" : "end_turn",
		});
		calls.forEach((call, index) => {
			const status = String(call.status ?? "");
			if (
				status === "scheduled" ||
				status === "executing" ||
				status === "validating"
			)
				return;
			const agentId = text(call.agentId);
			if (agentId && !subagentIds.includes(agentId)) subagentIds.push(agentId);
			writer.toolResults(
				`${message.id}:result:${index}`,
				isoTimestamp(call.timestamp) ?? at,
				[
					{
						type: "tool_result",
						tool_use_id: String(call.id ?? ""),
						content:
							status === "cancelled"
								? toolOutput(call) || "The user cancelled this tool call."
								: toolOutput(call),
						...(status === "error" || status === "cancelled"
							? { is_error: true }
							: {}),
					},
				],
				agentId
					? { agentId, status: status === "success" ? "completed" : status }
					: undefined,
			);
		});
	}
	const summary = text(record.metadata.summary);
	if (summary) writer.summary(summary);
	const directories = Array.isArray(record.metadata.directories)
		? record.metadata.directories.filter(
				(directory): directory is string => typeof directory === "string",
			)
		: [];
	return writer.result({
		subagentIds,
		kind: record.metadata.kind === "subagent" ? "subagent" : "main",
		directories,
	});
}

// ── Antigravity ───────────────────────────────────────────────────────────

const ANTIGRAVITY_USER_STEPS = new Set(["USER_INPUT", "USER_EXPLICIT"]);

function firstText(record: Json, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

function stepModel(step: Json): string | undefined {
	const metadata = isRecord(step.metadata) ? step.metadata : {};
	return (
		firstText(step, ["model", "model_name", "model_id", "modelName"]) ??
		firstText(metadata, ["model", "model_name", "model_id"])
	);
}

function stepUsage(step: Json): Json | undefined {
	// Antigravity records each request's counts on the step: input_tokens is
	// the uncached input (cache reads are counted apart and often exceed it),
	// and output_tokens includes thinking.
	if (
		typeof step.input_tokens === "number" ||
		typeof step.output_tokens === "number"
	) {
		const input = tokens(step.input_tokens);
		const cached = tokens(step.cache_read_tokens);
		const output = tokens(step.output_tokens);
		if (input + cached + output === 0) return undefined;
		return {
			input_tokens: input,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: cached,
			output_tokens: output,
		};
	}
	const metadata = isRecord(step.metadata) ? step.metadata : {};
	const usage = [
		step.usage,
		step.usage_metadata,
		step.usageMetadata,
		metadata.usage,
	].find(isRecord);
	if (!usage) return undefined;
	const pick = (...keys: string[]) => {
		for (const key of keys)
			if (usage[key] !== undefined) return tokens(usage[key]);
		return 0;
	};
	const prompt = pick(
		"prompt_token_count",
		"promptTokenCount",
		"input_tokens",
		"inputTokens",
	);
	const output = pick(
		"candidates_token_count",
		"candidatesTokenCount",
		"output_tokens",
		"outputTokens",
	);
	const cached = pick(
		"cached_content_token_count",
		"cachedContentTokenCount",
		"cache_read_input_tokens",
		"cached_tokens",
	);
	const thoughts = pick(
		"thoughts_token_count",
		"thoughtsTokenCount",
		"thinking_tokens",
		"reasoning_tokens",
	);
	const tool = pick("tool_use_prompt_token_count", "toolUsePromptTokenCount");
	if (prompt + output + cached + thoughts + tool === 0) return undefined;
	return geminiUsage({ prompt, cached, output, thoughts, tool });
}

function stepTimestamp(step: Json): string | undefined {
	for (const key of [
		"created_at",
		"createdAt",
		"timestamp",
		"time",
		"completed_at",
	]) {
		const at = isoTimestamp(step[key]);
		if (at) return at;
	}
	return undefined;
}

/** The workspace an Antigravity conversation ran in, from its commands. */
export function inferAntigravityCwd(raw: string): string | null {
	for (const line of raw.split("\n")) {
		if (!line.includes("Cwd")) continue;
		try {
			const step: unknown = JSON.parse(line);
			if (!isRecord(step) || !Array.isArray(step.tool_calls)) continue;
			for (const call of step.tool_calls) {
				if (!isRecord(call)) continue;
				const cwd = unquoteAntigravityArgs(call.args).Cwd;
				if (typeof cwd === "string" && cwd.startsWith("/")) return cwd;
			}
		} catch {}
	}
	return null;
}

/**
 * Reads an Antigravity transcript (`transcript_full.jsonl`, else the compact
 * `transcript.jsonl`): one step per line. PLANNER_RESPONSE steps carry the
 * model's reply, `thinking` and `tool_calls`; the GENERIC steps after them
 * are the calls' results, logged in call order.
 */
export function translateAntigravityTranscript(
	raw: string,
	sessionId: string,
	options: TranslateOptions,
): GeminiTranscript | null {
	const writer = new ClaudeLineWriter(sessionId, options);
	const subagentIds: string[] = [];
	let pending: { id: string; name: string }[] = [];
	let sawStep = false;
	let lineNumber = 0;
	for (const line of raw.split("\n")) {
		lineNumber += 1;
		if (!line.trim()) continue;
		let step: unknown;
		try {
			step = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(step) || typeof step.type !== "string") continue;
		sawStep = true;
		const seed = `step-${Number.isFinite(step.step_index) ? step.step_index : `line-${lineNumber}`}`;
		const at = stepTimestamp(step);
		if (ANTIGRAVITY_USER_STEPS.has(step.type)) {
			const prompt = antigravityPrompt(
				firstText(step, ["content", "text", "user_input", "message"]) ?? "",
			);
			if (prompt)
				writer.user(seed, at, userPrompt([{ type: "text", text: prompt }]));
			pending = [];
			continue;
		}
		if (step.type === "PLANNER_RESPONSE") {
			const content: Json[] = [];
			const thinking = firstText(step, ["thinking"]);
			if (thinking) content.push({ type: "thinking", thinking, signature: "" });
			const reply = firstText(step, ["content", "text"]);
			if (reply) content.push({ type: "text", text: reply });
			pending = [];
			const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
			calls.forEach((call, index) => {
				if (!isRecord(call)) return;
				const name = text(call.name) ?? "tool";
				const id = text(call.id) ?? `${sessionId}-${seed}-${index}`;
				const translated = translateAntigravityTool(name, call.args);
				content.push({
					type: "tool_use",
					id,
					name: translated.name,
					input: translated.input,
				});
				pending.push({ id, name });
			});
			writer.assistant(seed, at, {
				model: stepModel(step),
				content,
				usage: stepUsage(step),
				stopReason: pending.length > 0 ? "tool_use" : "end_turn",
			});
			continue;
		}
		if (step.type === "GENERIC") {
			const call = pending.shift();
			if (!call) continue;
			const status = String(step.status ?? "");
			if (status === "RUNNING") continue;
			const output =
				firstText(step, ["output", "content", "result", "text"]) ??
				firstText(step, ["error"]) ??
				(status === "CLEARED" ? "[output cleared]" : "");
			const agentId =
				call.name === "invoke_subagent"
					? SUBAGENT_CONVERSATION.exec(output)?.[1]
					: undefined;
			if (agentId && !subagentIds.includes(agentId)) subagentIds.push(agentId);
			writer.toolResults(
				seed,
				at,
				[
					{
						type: "tool_result",
						tool_use_id: call.id,
						content: output,
						...(status === "ERROR" ? { is_error: true } : {}),
					},
				],
				agentId ? { agentId, status: "async_launched" } : undefined,
			);
			continue;
		}
		if (step.type === "ERROR_MESSAGE") {
			const error = firstText(step, ["error", "content", "text"]);
			if (error) writer.apiError(seed, at, error);
			continue;
		}
		if (step.type === "SYSTEM_MESSAGE") {
			// A subagent reports back to its parent as a message; written as
			// Claude Code's notice of a background agent, so the report's time
			// ends the subagent's work. Other system messages are reminders.
			const report = SUBAGENT_REPORT.exec(firstText(step, ["content"]) ?? "");
			const sender = report?.[2];
			if (report && sender && subagentIds.includes(sender))
				writer.user(
					seed,
					isoTimestamp(report[1]) ?? at,
					`<task-notification>\n<task-id>${sender}</task-id>\n<status>completed</status>\n<summary>Subagent ${sender} reported back</summary>\n<result>${report[3] ?? ""}</result>\n</task-notification>`,
				);
		}
	}
	if (!sawStep) return null;
	if (options.title) writer.summary(options.title);
	return writer.result({
		subagentIds,
		kind: options.agentId === undefined ? "main" : "subagent",
		directories: [],
	});
}

/** `[Message] timestamp=… sender=<conversation> priority=… content=…` */
const SUBAGENT_REPORT =
	/\[Message\] timestamp=(\S+) sender=([A-Za-z0-9_-]{1,200}) priority=\S+ content=([\s\S]*?)\s*(?:<\/SYSTEM_MESSAGE>|$)/u;

/** The conversation an invoke_subagent call started, from its result. */
const SUBAGENT_CONVERSATION =
	/"conversationId"\s*:\s*"([A-Za-z0-9_-]{1,200})"/u;

/**
 * What the user typed. Hosts wrap it: the request goes in `<USER_REQUEST>`
 * with the host's own blocks around it (T3 Code puts its instructions and
 * runtime notes there, and the first prompt in a `<user_request>`), and
 * Antigravity appends `<ADDITIONAL_METADATA>` and settings changes after.
 */
export function antigravityPrompt(content: string): string {
	const request =
		/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/u.exec(content)?.[1] ??
		content;
	const inner = /<user_request>\s*([\s\S]*?)\s*<\/user_request>/u.exec(
		request,
	)?.[1];
	if (inner !== undefined) return inner.trim();
	let body = request;
	for (;;) {
		const next = body
			.replace(/^\s*<([A-Za-z_][\w-]*)>[\s\S]*?<\/\1>\s*/u, "")
			.replace(/\s*<([A-Za-z_][\w-]*)>[\s\S]*?<\/\1>\s*$/u, "");
		if (next === body) return body.trim();
		body = next;
	}
}
