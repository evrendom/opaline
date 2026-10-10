import { codexDenialKind } from "./record-facts.js";

/**
 * The drift census (docs/l1-literal-schema.md, "Drift"): every field path the
 * agents write, normalized so that one path names one kind of field, counted
 * per agent and agent version, and compared with the fact catalog's sources
 * and the paths deliberately ignored. Read-only; it never keeps a value
 * except the short enum-like ones listed in `CENSUS_VALUE_KEYS`.
 *
 * Path syntax: `<record type>[/<payload type>][:<item type>].<json path>`.
 * - Claude Code: the record `type`, with `/<subtype>` for `system` and
 *   `/<attachment.type>` for `attachment` records; the path is from the
 *   record's root.
 * - Codex: `<type>/<payload.type>`, with `:<item.type>` for `item_completed`,
 *   `:<name>` for calls and `:<role>` for messages; the path is from the
 *   payload (from `payload.item` for completed items). Fields outside the
 *   payload follow `@` (`response_item/function_call@metadata.…`).
 * - Arrays are `[]`; content blocks are `[<block type>]` and Claude tool
 *   calls `[tool_use:<tool name>]`.
 * - Keys that are data, not names (ids, file paths, model names), and the
 *   keys under `DYNAMIC_KEY_PARENTS`, are `{*}`; MCP tool names are
 *   `mcp__{*}`.
 * - Tool-defined payloads (`OPAQUE_PATHS`) are one path, not walked.
 * - JSON text in Codex call arguments and outputs is walked like an object.
 * - A string that follows a known output convention adds a second path,
 *   `<path>~<convention>` (`CENSUS_CONVENTIONS`).
 */

export type CensusAgent = "claude_code" | "codex";

export const CENSUS_AGENTS: readonly CensusAgent[] = ["claude_code", "codex"];

/** Depth past which a value is counted at its path without walking it. */
const MAX_DEPTH = 12;
/** Characters of a string that conventions look at. */
const CONVENTION_HEAD_CHARS = 512;
/** Distinct values kept per enum-like path. */
const MAX_VALUES = 12;
/** Longest value kept for an enum-like path. */
const MAX_VALUE_CHARS = 48;

/** Object keys whose children are data keyed by id, path or name. */
const DYNAMIC_KEY_PARENTS: ReadonlySet<string> = new Set([
	"changes",
	"env",
	"headers",
	"mcp_servers",
	"mcpServers",
	"modelUsage",
	"properties",
	"wireToolInputs",
	"definitions",
	"$defs",
	"patternProperties",
]);

/** A key that is a name in the schema, not data. */
const NAME_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u;
const ID_KEY_PATTERN =
	/^(?:toolu_|srvtoolu_|call_|ws_|fc_|rs_|msg_)|^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{12,}$/iu;

/**
 * Tool-defined payloads: arguments and results whose keys belong to the tool,
 * not the agent. Counted as one path each.
 */
const OPAQUE_PATHS: readonly string[] = [
	"assistant.message.content[tool_use:mcp__{*}].input",
	"assistant.message.content[mcp_tool_use].input",
	"assistant.wireToolInputs.{*}",
	"response_item/function_call:mcp__{*}.arguments",
	"response_item/function_call:_{*}.arguments",
	"response_item/function_call:{*}.arguments",
	"event_msg/item_completed:McpToolCall.arguments",
	"event_msg/item_completed:DynamicToolCall.arguments",
	"event_msg/mcp_tool_call_end.invocation.arguments",
];

/** Keys that hold a JSON schema or another tool-defined document. */
const OPAQUE_KEYS: ReadonlySet<string> = new Set([
	"input_schema",
	"inputSchema",
	"outputSchema",
	"output_schema",
	"parameters",
	"schema",
	"structuredContent",
	"_meta",
]);

/** Keys whose short string values are kept (enum-like, never free text). */
const CENSUS_VALUE_KEYS: ReadonlySet<string> = new Set([
	"approval_policy",
	"approvals_reviewer",
	"decision",
	"kind",
	"level",
	"mode",
	"operation",
	"permissionMode",
	"phase",
	"reason",
	"reasonType",
	"role",
	"source",
	"status",
	"stop_reason",
	"subtype",
	"thread_source",
	"trigger",
	"type",
]);

export interface CensusConvention {
	/** The name after `~`. */
	readonly id: string;
	/** Paths (globs) whose string values it applies to. */
	readonly paths: readonly string[];
	readonly matches: (head: string) => boolean;
}

const CODEX_OUTPUTS = [
	"response_item/function_call_output.output",
	"response_item/custom_tool_call_output.output",
	"response_item/function_call_output.output[input_text].text",
	"response_item/custom_tool_call_output.output[input_text].text",
	"response_item/function_call_output.output.output",
	"response_item/custom_tool_call_output.output.output",
];
const CLAUDE_RESULTS = [
	"user.message.content[tool_result].content",
	"user.message.content[tool_result].content[text].text",
];
const CLAUDE_USER_TEXT = [
	"user.message.content",
	"user.message.content[text].text",
];

/**
 * Output and text conventions that carry a fact in a string: the call's
 * transport framing or a harness marker, matched at the start of the text.
 */
export const CENSUS_CONVENTIONS: readonly CensusConvention[] = [
	{
		id: "Sandbox(Denied)",
		paths: CODEX_OUTPUTS,
		matches: (head) => codexDenialKind(head) === "Sandbox(Denied)",
	},
	{
		id: "Rejected",
		paths: CODEX_OUTPUTS,
		matches: (head) => codexDenialKind(head) === "Rejected",
	},
	{
		id: "failed",
		paths: CODEX_OUTPUTS,
		matches: (head) =>
			/^[\w.]+ failed\b/u.test(head) && codexDenialKind(head) === undefined,
	},
	{
		id: "aborted by user",
		paths: CODEX_OUTPUTS,
		matches: (head) => /^aborted by user after \d/u.test(head.trim()),
	},
	{
		id: "failed to parse function arguments",
		paths: CODEX_OUTPUTS,
		matches: (head) => head.startsWith("failed to parse function arguments"),
	},
	{
		id: "Process running with session ID",
		paths: CODEX_OUTPUTS,
		matches: (head) => /(?:^|\n)Process running with session ID \d/u.test(head),
	},
	{
		id: "Script running with cell ID",
		paths: CODEX_OUTPUTS,
		matches: (head) => /(?:^|\n)Script running with cell ID \d/u.test(head),
	},
	{
		id: "Process exited with code",
		paths: CODEX_OUTPUTS,
		matches: (head) => /(?:^|\n)Process exited with code -?\d/u.test(head),
	},
	{
		id: "Exit code",
		paths: CODEX_OUTPUTS,
		matches: (head) => /^Exit code: -?\d/u.test(head),
	},
	{
		id: "Wall time",
		paths: CODEX_OUTPUTS,
		matches: (head) => /(?:^|\n)Wall time: \d/u.test(head),
	},
	{
		id: "Chunk ID",
		paths: CODEX_OUTPUTS,
		matches: (head) => /^Chunk ID: /u.test(head),
	},
	{
		id: "Original token count",
		paths: CODEX_OUTPUTS,
		matches: (head) => /(?:^|\n)Original token count: \d/u.test(head),
	},
	{
		id: "unable to locate image at",
		paths: CODEX_OUTPUTS,
		matches: (head) => head.includes("unable to locate image at"),
	},
	{
		id: "<skill>",
		paths: ["response_item/message:user.content[input_text].text"],
		matches: (head) => head.trimStart().startsWith("<skill>"),
	},
	{
		id: "<model_switch>",
		paths: ["response_item/message:developer.content[input_text].text"],
		matches: (head) => head.startsWith("<model_switch>"),
	},
	{
		id: "AGENTS.md instructions",
		paths: [
			"response_item/message:user.content[input_text].text",
			"response_item/message:developer.content[input_text].text",
		],
		matches: (head) => head.startsWith("# AGENTS.md instructions for "),
	},
	{
		id: "auto-review decision",
		paths: ["response_item/message:assistant.content[output_text].text"],
		matches: (head) => head.startsWith('{"risk_level"'),
	},
	{
		id: "hook error",
		paths: CLAUDE_RESULTS,
		matches: (head) => /^\w+:[\w.]+ hook error/u.test(head),
	},
	{
		id: "Exit code",
		paths: CLAUDE_RESULTS,
		matches: (head) => /^Exit code -?\d/u.test(head),
	},
	{
		id: "Request interrupted by user",
		paths: CLAUDE_USER_TEXT,
		matches: (head) => head.startsWith("[Request interrupted by user"),
	},
];

export interface CensusPathStats {
	/** Records that carry the path. */
	count: number;
	/** Records per agent version (`?` when the stream named none yet). */
	readonly versions: Map<string, number>;
	/** Records per JSON type of the value. */
	readonly types: Map<string, number>;
	/** Longest string value, in characters. */
	maxChars: number;
	/** Counts of short values, for enum-like keys only. */
	readonly values: Map<string, number>;
}

export interface Census {
	readonly files: Map<CensusAgent, number>;
	readonly records: Map<CensusAgent, number>;
	/** Records per record kind (`censusRecordKind`), per agent. */
	readonly kinds: Map<CensusAgent, Map<string, number>>;
	readonly unparseable: Map<CensusAgent, number>;
	readonly paths: Map<CensusAgent, Map<string, CensusPathStats>>;
}

export function createCensus(): Census {
	return {
		files: new Map(),
		records: new Map(),
		kinds: new Map(CENSUS_AGENTS.map((agent) => [agent, new Map()])),
		unparseable: new Map(),
		paths: new Map(CENSUS_AGENTS.map((agent) => [agent, new Map()])),
	};
}

interface PathValue {
	readonly type: string;
	readonly chars: number;
	readonly value: string | undefined;
}

/**
 * The normalized paths of one record, each with a summary of its value
 * (type, length, and the value itself only for enum-like keys).
 */
export function censusRecordPaths(
	record: Record<string, unknown>,
	agent: CensusAgent,
): Map<string, PathValue> {
	const out = new Map<string, PathValue>();
	if (agent === "codex") walkCodex(record, out);
	else walkClaude(record, out);
	return out;
}

/** Add one parsed record of a stream to the census. */
export function addCensusRecord(
	census: Census,
	agent: CensusAgent,
	version: string,
	record: Record<string, unknown>,
): void {
	census.records.set(agent, (census.records.get(agent) ?? 0) + 1);
	const kinds = census.kinds.get(agent) ?? new Map<string, number>();
	census.kinds.set(agent, kinds);
	const kind = censusRecordKind(record, agent);
	kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
	const paths = census.paths.get(agent) ?? new Map();
	census.paths.set(agent, paths);
	for (const [path, value] of censusRecordPaths(record, agent)) {
		let stats = paths.get(path);
		if (stats === undefined) {
			stats = {
				count: 0,
				versions: new Map(),
				types: new Map(),
				maxChars: 0,
				values: new Map(),
			};
			paths.set(path, stats);
		}
		stats.count++;
		stats.versions.set(version, (stats.versions.get(version) ?? 0) + 1);
		stats.types.set(value.type, (stats.types.get(value.type) ?? 0) + 1);
		if (value.chars > stats.maxChars) stats.maxChars = value.chars;
		if (
			value.value !== undefined &&
			(stats.values.has(value.value) || stats.values.size < MAX_VALUES)
		)
			stats.values.set(value.value, (stats.values.get(value.value) ?? 0) + 1);
	}
}

/** Which agent wrote a record: Codex records wrap their content in `payload`. */
export function detectCensusAgent(
	record: Record<string, unknown>,
): CensusAgent {
	return isObject(record.payload) && typeof record.type === "string"
		? "codex"
		: "claude_code";
}

/**
 * The agent version a record names: Claude Code `version` on any record,
 * Codex `session_meta.cli_version`.
 */
export function censusRecordVersion(
	record: Record<string, unknown>,
	agent: CensusAgent,
): string | undefined {
	if (agent === "claude_code")
		return typeof record.version === "string" ? record.version : undefined;
	if (record.type !== "session_meta" || !isObject(record.payload))
		return undefined;
	const version = record.payload.cli_version;
	return typeof version === "string" ? version : undefined;
}

/**
 * Census of one stream's JSONL text: every line parsed independently; the
 * version carries forward from the latest record that names one.
 */
export function addCensusText(
	census: Census,
	content: string,
	agent?: CensusAgent,
): void {
	const addLine = censusStream(census, agent);
	for (const line of content.split("\n")) addLine(line);
}

/**
 * A census reader for one stream, fed one JSONL line at a time; the agent is
 * detected from the first record unless given.
 */
export function censusStream(
	census: Census,
	agent?: CensusAgent,
): (line: string) => void {
	let version = "?";
	let streamAgent = agent;
	let counted = false;
	return (line) => {
		if (line.trim() === "") return;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			const key = streamAgent ?? "claude_code";
			census.unparseable.set(key, (census.unparseable.get(key) ?? 0) + 1);
			return;
		}
		if (!isObject(record)) return;
		streamAgent ??= detectCensusAgent(record);
		if (!counted) {
			census.files.set(streamAgent, (census.files.get(streamAgent) ?? 0) + 1);
			counted = true;
		}
		version = censusRecordVersion(record, streamAgent) ?? version;
		addCensusRecord(census, streamAgent, version, record);
	};
}

// --- Walking ---------------------------------------------------------------

function walkClaude(
	record: Record<string, unknown>,
	out: Map<string, PathValue>,
): void {
	const type = typeof record.type === "string" ? record.type : "unknown";
	const attachment = isObject(record.attachment) ? record.attachment : {};
	const discriminator = claudeDiscriminator(record);
	for (const [key, value] of Object.entries(record)) {
		if (key === "type" || (key === "subtype" && type === "system")) continue;
		if (key === "attachment" && type === "attachment") {
			for (const [childKey, child] of Object.entries(attachment)) {
				if (childKey === "type") continue;
				walk(
					child,
					joinKey(`${discriminator}.attachment`, key, childKey),
					childKey,
					1,
					out,
				);
			}
			continue;
		}
		walk(value, joinKey(discriminator, "", key), key, 1, out);
	}
}

function walkCodex(
	record: Record<string, unknown>,
	out: Map<string, PathValue>,
): void {
	const payload = isObject(record.payload) ? record.payload : undefined;
	const payloadType =
		typeof payload?.type === "string" ? payload.type : undefined;
	const discriminator = codexDiscriminator(record);
	for (const [key, value] of Object.entries(record)) {
		if (key === "type" || key === "payload") continue;
		walk(value, `${discriminator}@${key}`, key, 1, out);
	}
	if (payload === undefined) return;
	// A payload with nothing but its type is still a record of that type.
	if (Object.keys(payload).every((key) => key === "type"))
		leaf(out, discriminator, "object", 0, undefined);
	for (const [key, value] of Object.entries(payload)) {
		if (key === "type") continue;
		if (key === "item" && payloadType === "item_completed" && isObject(value)) {
			const itemType = typeof value.type === "string" ? value.type : "unknown";
			const base = `${discriminator}:${itemType}`;
			for (const [itemKey, itemValue] of Object.entries(value)) {
				if (itemKey === "type") continue;
				walk(itemValue, `${base}.${itemKey}`, itemKey, 1, out);
			}
			continue;
		}
		walk(value, `${discriminator}.${key}`, key, 1, out);
	}
}

function claudeDiscriminator(record: Record<string, unknown>): string {
	const type = typeof record.type === "string" ? record.type : "unknown";
	if (type === "system" && typeof record.subtype === "string")
		return `system/${record.subtype}`;
	if (type !== "attachment") return type;
	const attachment = isObject(record.attachment) ? record.attachment : {};
	return `attachment/${typeof attachment.type === "string" ? attachment.type : "unknown"}`;
}

function codexDiscriminator(record: Record<string, unknown>): string {
	const type = typeof record.type === "string" ? record.type : "unknown";
	const payload = isObject(record.payload) ? record.payload : undefined;
	const payloadType =
		typeof payload?.type === "string" ? payload.type : undefined;
	let discriminator = `${type}/${payloadType ?? ""}`;
	if (payload !== undefined && type === "response_item") {
		const name = typeof payload.name === "string" ? payload.name : undefined;
		if (
			name !== undefined &&
			(payloadType === "function_call" || payloadType === "custom_tool_call")
		)
			discriminator += `:${toolName(name)}`;
		if (payloadType === "message" && typeof payload.role === "string")
			discriminator += `:${payload.role}`;
	}
	return discriminator;
}

/**
 * The kind of a record: the head its paths start with (`user`,
 * `system/turn_duration`, `response_item/function_call:exec_command`), and
 * for a Codex completed item the item's type (`event_msg/item_completed:CommandExecution`).
 */
export function censusRecordKind(
	record: Record<string, unknown>,
	agent: CensusAgent,
): string {
	if (agent === "claude_code") return claudeDiscriminator(record);
	const discriminator = codexDiscriminator(record);
	const item = isObject(record.payload) ? record.payload.item : undefined;
	return record.type === "event_msg" &&
		isObject(record.payload) &&
		record.payload.type === "item_completed" &&
		isObject(item)
		? `${discriminator}:${typeof item.type === "string" ? item.type : "unknown"}`
		: discriminator;
}

function walk(
	value: unknown,
	path: string,
	key: string,
	depth: number,
	out: Map<string, PathValue>,
): void {
	if (Array.isArray(value)) {
		if (value.length === 0 || isOpaque(path) || depth > MAX_DEPTH) {
			leaf(out, path, "array", 0, undefined);
			return;
		}
		for (const element of value) {
			walk(element, `${path}${arrayStep(key, element)}`, key, depth + 1, out);
		}
		return;
	}
	if (isObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0 || isOpaque(path) || depth > MAX_DEPTH) {
			leaf(out, path, "object", 0, undefined);
			return;
		}
		for (const [childKey, child] of entries) {
			// A block's type is already its step (`[tool_use:Bash]`).
			if (childKey === "type" && /\[[^\]]+\]$/u.test(path)) continue;
			walk(child, joinKey(path, key, childKey), childKey, depth + 1, out);
		}
		return;
	}
	if (typeof value === "string") {
		const parsed = jsonText(path, value);
		if (parsed !== undefined) {
			walk(parsed, path, key, depth, out);
			return;
		}
		leaf(
			out,
			path,
			"string",
			value.length,
			CENSUS_VALUE_KEYS.has(key) && value.length <= MAX_VALUE_CHARS
				? value
				: undefined,
		);
		const conventions = conventionsAt(path);
		if (conventions.length === 0) return;
		const head = value.slice(0, CONVENTION_HEAD_CHARS);
		for (const convention of conventions)
			if (convention.matches(head))
				leaf(
					out,
					`${path}~${convention.id}`,
					"string",
					value.length,
					undefined,
				);
		return;
	}
	const type = value === null ? "null" : typeof value;
	leaf(
		out,
		path,
		type,
		0,
		type === "boolean" && CENSUS_VALUE_KEYS.has(key)
			? String(value)
			: undefined,
	);
}

function leaf(
	out: Map<string, PathValue>,
	path: string,
	type: string,
	chars: number,
	value: string | undefined,
): void {
	const previous = out.get(path);
	if (previous === undefined || chars > previous.chars)
		out.set(path, { type, chars, value: value ?? previous?.value });
}

function arrayStep(key: string, element: unknown): string {
	if (!isObject(element) || typeof element.type !== "string") return "[]";
	if (key !== "content" && key !== "output" && key !== "content_items")
		return "[]";
	if (element.type === "tool_use" || element.type === "server_tool_use") {
		const name = typeof element.name === "string" ? element.name : "unknown";
		return `[${element.type}:${toolName(name)}]`;
	}
	return `[${normalizeKey(element.type)}]`;
}

function joinKey(path: string, parentKey: string, key: string): string {
	const name =
		DYNAMIC_KEY_PARENTS.has(parentKey) || !isNameKey(key) ? "{*}" : key;
	return `${path}.${name}`;
}

function isNameKey(key: string): boolean {
	return NAME_KEY_PATTERN.test(key) && !ID_KEY_PATTERN.test(key);
}

function normalizeKey(value: string): string {
	return isNameKey(value) ? value : "{*}";
}

/**
 * A tool name as a path step: MCP tools collapse to `mcp__{*}` and Codex app
 * connector tools (`_create_pull_request`, named with a leading `_`) to `_{*}`.
 */
function toolName(name: string): string {
	if (name.startsWith("mcp__")) return "mcp__{*}";
	if (name.startsWith("_")) return "_{*}";
	return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(name) ? name : "{*}";
}

/**
 * JSON text Codex wrote into a call's arguments, or a call output's transport
 * envelope (`{"output": …, "metadata": {"exit_code": …}}`), parsed. Other
 * JSON output belongs to the tool and stays text.
 */
function jsonText(path: string, value: string): unknown {
	if (!path.startsWith("response_item/")) return undefined;
	const isArguments = path.endsWith(".arguments");
	if (!isArguments && !path.endsWith("_output.output")) return undefined;
	const trimmed = value.trimStart();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!isObject(parsed)) return undefined;
		return isArguments || (isObject(parsed.metadata) && "output" in parsed)
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}

/** Per-path answers; paths repeat across records, so each is worked out once. */
const opaqueCache = new Map<string, boolean>();
const conventionCache = new Map<string, readonly CensusConvention[]>();

function isOpaque(path: string): boolean {
	let opaque = opaqueCache.get(path);
	if (opaque === undefined) {
		const key = /[.@]([^.@[\]]+)$/u.exec(path)?.[1];
		opaque =
			(key !== undefined && OPAQUE_KEYS.has(key)) ||
			OPAQUE_PATHS.some((pattern) => pathMatches(pattern, path));
		opaqueCache.set(path, opaque);
	}
	return opaque;
}

function conventionsAt(path: string): readonly CensusConvention[] {
	let conventions = conventionCache.get(path);
	if (conventions === undefined) {
		conventions = CENSUS_CONVENTIONS.filter((convention) =>
			convention.paths.some((pattern) => pathMatches(pattern, path)),
		);
		conventionCache.set(path, conventions);
	}
	return conventions;
}

// --- Path syntax --------------------------------------------------------------

/** One step of a census path after its head. */
export type CensusPathStep =
	/** `.name`: an object key. */
	| { readonly kind: "key"; readonly name: string }
	/** `@name`: a Codex record field outside the payload. */
	| { readonly kind: "outer"; readonly name: string }
	/** `[]`: an array element. */
	| { readonly kind: "element" }
	/** `[type]` or `[type:name]`: an array element of a block type (and tool). */
	| { readonly kind: "block"; readonly type: string; readonly name?: string }
	/** `~id`: a text convention of the string before it. */
	| { readonly kind: "convention"; readonly id: string };

export interface CensusPathParts {
	/** The record kind (`user`, `response_item/function_call:exec_command`). */
	readonly head: string;
	readonly steps: readonly CensusPathStep[];
}

/** A census path (or catalog source pattern) split into its head and steps. */
export function censusPathParts(path: string): CensusPathParts {
	const tilde = path.indexOf("~");
	const body = tilde === -1 ? path : path.slice(0, tilde);
	const headEnd = body.search(/[.@[]/u);
	const head = headEnd === -1 ? body : body.slice(0, headEnd);
	const steps: CensusPathStep[] = [];
	let index = head.length;
	while (index < body.length) {
		const char = body[index];
		if (char === "[") {
			const close = body.indexOf("]", index);
			const inner = body.slice(index + 1, close === -1 ? undefined : close);
			const colon = inner.indexOf(":");
			if (inner === "") steps.push({ kind: "element" });
			else if (colon === -1) steps.push({ kind: "block", type: inner });
			else
				steps.push({
					kind: "block",
					type: inner.slice(0, colon),
					name: inner.slice(colon + 1),
				});
			index = close === -1 ? body.length : close + 1;
			continue;
		}
		const rest = body.slice(index + 1);
		const end = rest.search(/[.@[]/u);
		const name = end === -1 ? rest : rest.slice(0, end);
		steps.push({ kind: char === "@" ? "outer" : "key", name });
		index += 1 + name.length;
	}
	if (tilde !== -1)
		steps.push({ kind: "convention", id: path.slice(tilde + 1) });
	return { head, steps };
}

/** One step as the path writes it (`.name`, `@name`, `[]`, `[type:name]`, `~id`). */
export function censusStepText(step: CensusPathStep): string {
	switch (step.kind) {
		case "key":
			return `.${step.name}`;
		case "outer":
			return `@${step.name}`;
		case "element":
			return "[]";
		case "block":
			return `[${step.type}${step.name === undefined ? "" : `:${step.name}`}]`;
		case "convention":
			return `~${step.id}`;
	}
}

// --- Patterns ---------------------------------------------------------------

const patternCache = new Map<string, RegExp>();

function compilePattern(pattern: string, descendants: boolean): RegExp {
	const key = `${descendants ? "d" : "e"}${pattern}`;
	const cached = patternCache.get(key);
	if (cached !== undefined) return cached;
	let source = "";
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index] ?? "";
		if (char === "*" && pattern[index + 1] === "*") {
			source += ".*";
			index++;
		} else if (char === "*") source += "[^.\\[\\]@~]*";
		else source += char.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
	}
	const regex = new RegExp(
		`^${source}${descendants ? "(?:$|[.\\[@])" : "$"}`,
		"u",
	);
	patternCache.set(key, regex);
	return regex;
}

/**
 * Whether a census path matches a pattern: `*` is any text inside one step,
 * `**` any text. With `descendants`, a path under the pattern (a child key,
 * an array element) also matches, but a `~convention` of it does not.
 */
export function pathMatches(
	pattern: string,
	path: string,
	descendants = false,
): boolean {
	return compilePattern(pattern, descendants).test(path);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Comparison with the catalog --------------------------------------------

/** A path deliberately not a fact, with the reason. */
export interface IgnoredPath {
	/** A census path pattern (`*` inside a step, `**` anything). */
	readonly path: string;
	/** Paths under `path` that are not ignored (they must be catalogued). */
	readonly except?: readonly string[];
	/** Only for this agent; both when absent. */
	readonly agent?: CensusAgent;
	readonly reason: string;
}

export interface CensusPathReport {
	readonly path: string;
	readonly count: number;
	/** Oldest and newest agent version that wrote it. */
	readonly versions: readonly [string, string];
	/** JSON types of its values, most common first. */
	readonly types: readonly string[];
	readonly maxChars: number;
	/** Recorded values of enum-like keys, most common first, with counts. */
	readonly values: readonly (readonly [string, number])[];
}

export interface CensusAgentReport {
	readonly agent: CensusAgent;
	readonly files: number;
	readonly records: number;
	readonly unparseable: number;
	readonly paths: number;
	readonly mappedPaths: number;
	readonly ignoredPaths: number;
	/** Paths neither a catalog source nor ignored, most frequent first. */
	readonly unmapped: readonly CensusPathReport[];
	/** Catalog sources no path of this corpus matches (stale or not in this corpus). */
	readonly unseenSources: readonly string[];
}

export interface CensusReport {
	readonly agents: readonly CensusAgentReport[];
}

export interface CensusCatalog {
	/** Source patterns per agent. */
	readonly sources: (agent: CensusAgent) => readonly string[];
	readonly ignored: readonly IgnoredPath[];
}

/** The first ignore rule for the agent that covers a census path. */
export function ignoreRuleFor(
	path: string,
	agent: CensusAgent,
	ignored: readonly IgnoredPath[],
): IgnoredPath | undefined {
	return ignored.find(
		(rule) =>
			(rule.agent === undefined || rule.agent === agent) &&
			pathMatches(rule.path, path) &&
			!(rule.except ?? []).some((pattern) => pathMatches(pattern, path)),
	);
}

/** Whether a census path is covered by an ignore rule for the agent. */
export function isIgnoredPath(
	path: string,
	agent: CensusAgent,
	ignored: readonly IgnoredPath[],
): boolean {
	return ignoreRuleFor(path, agent, ignored) !== undefined;
}

/** Compare a census with the catalog's sources and the ignored paths. */
export function compareCensus(
	census: Census,
	catalog: CensusCatalog,
): CensusReport {
	const agents: CensusAgentReport[] = [];
	for (const agent of CENSUS_AGENTS) {
		const records = census.records.get(agent) ?? 0;
		const paths = census.paths.get(agent) ?? new Map<string, CensusPathStats>();
		if (records === 0 && paths.size === 0) continue;
		const sources = [...new Set(catalog.sources(agent))];
		const seen = new Set<string>();
		const unmapped: CensusPathReport[] = [];
		let mappedPaths = 0;
		let ignoredPaths = 0;
		for (const [path, stats] of paths) {
			const matching = sources.filter((source) => pathMatches(source, path));
			if (matching.length > 0) {
				mappedPaths++;
				for (const source of matching) seen.add(source);
				continue;
			}
			if (isIgnoredPath(path, agent, catalog.ignored)) {
				ignoredPaths++;
				continue;
			}
			unmapped.push(censusPathReport(path, stats));
		}
		unmapped.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
		agents.push({
			agent,
			files: census.files.get(agent) ?? 0,
			records,
			unparseable: census.unparseable.get(agent) ?? 0,
			paths: paths.size,
			mappedPaths,
			ignoredPaths,
			unmapped,
			unseenSources: sources.filter((source) => !seen.has(source)).sort(),
		});
	}
	return { agents };
}

/** One path's census numbers: count, version range, types and enum values. */
export function censusPathReport(
	path: string,
	stats: CensusPathStats,
): CensusPathReport {
	const versions = [...stats.versions.keys()].sort(compareVersions);
	return {
		path,
		count: stats.count,
		versions: [versions[0] ?? "?", versions.at(-1) ?? "?"],
		types: [...stats.types].sort((a, b) => b[1] - a[1]).map(([type]) => type),
		maxChars: stats.maxChars,
		values: [...stats.values].sort((a, b) => b[1] - a[1]),
	};
}

/** Numeric-aware version order (`0.9` before `0.10`; `?` first). */
export function compareVersions(a: string, b: string): number {
	return a.localeCompare(b, "en", { numeric: true });
}

/** The census report as text: unmapped paths per agent, then stale sources. */
export function formatCensusReport(
	report: CensusReport,
	options: { readonly limit?: number } = {},
): string {
	const limit = options.limit ?? 50;
	const lines: string[] = [];
	for (const agent of report.agents) {
		lines.push(
			`## ${agent.agent}: ${agent.files} files, ${agent.records} records${agent.unparseable > 0 ? ` (${agent.unparseable} unparseable lines)` : ""}`,
			`${agent.paths} paths: ${agent.mappedPaths} catalogued, ${agent.ignoredPaths} ignored, ${agent.unmapped.length} unmapped.`,
			"",
		);
		if (agent.unmapped.length > 0) {
			lines.push(
				`Unmapped paths${agent.unmapped.length > limit ? ` (top ${limit})` : ""}:`,
				"",
				"| records | versions | type | path | values |",
				"|---:|---|---|---|---|",
			);
			for (const path of agent.unmapped.slice(0, limit)) {
				const type =
					path.types.join("|") +
					(path.maxChars > 0 ? ` ≤${path.maxChars} chars` : "");
				const values = path.values
					.slice(0, 6)
					.map(([value, count]) => `${value} ${count}`)
					.join(", ");
				lines.push(
					`| ${path.count} | ${path.versions[0]}–${path.versions[1]} | ${type} | \`${path.path}\` | ${values} |`,
				);
			}
			lines.push("");
		}
		if (agent.unseenSources.length > 0) {
			lines.push(
				`Catalog sources not seen in this corpus (${agent.unseenSources.length}):`,
				"",
				...agent.unseenSources.map((source) => `- \`${source}\``),
				"",
			);
		}
	}
	return lines.join("\n");
}

/** A census report as JSON, for CI diffing. */
export function censusReportJson(report: CensusReport): string {
	return `${JSON.stringify(report, null, "\t")}\n`;
}
