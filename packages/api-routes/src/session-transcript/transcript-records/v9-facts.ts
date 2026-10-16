import {
	CENSUS_CONVENTIONS,
	censusPathParts,
	censusRecordKind,
	censusRecordPaths,
	pathMatches,
} from "./fact-census.js";
import { isRecord, type LineItem } from "./line-items.js";
import { literalPatchHunks } from "./patch-hunks.js";
import { clippedText, mergeFacts } from "./record-facts.js";
import {
	TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS,
	TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS,
	TRANSCRIPT_RECORD_INSTRUCTION_LIST_MAX_CHARS,
	TRANSCRIPT_RECORD_INSTRUCTION_PART_MAX_CHARS,
	type TranscriptRecordFactKey,
	type TranscriptSource,
} from "./types.js";
import { V9_SOURCE_FACTS } from "./v9-fact-sources.js";

interface SourceFact {
	readonly key: TranscriptRecordFactKey;
	readonly moreKey: TranscriptRecordFactKey;
	readonly sources: readonly string[];
}

interface Component {
	readonly path: string;
	readonly ordinal: number;
	readonly value: unknown;
}

interface SafeString {
	readonly text: string;
	readonly clipped: boolean;
	readonly more: number;
}

const EXEC_OPTIONS = [
	"workdir",
	"yield_time_ms",
	"max_output_tokens",
	"tty",
	"login",
	"shell",
	"justification",
	"sandbox_permissions",
	"prefix_rule",
	"timeout_ms",
	"environment_id",
];
const mappings = V9_SOURCE_FACTS.map((mapping) => ({
	...mapping,
	sources: mapping.sources.flatMap((source) =>
		source === "response_item/function_call:exec_command.arguments.{*}"
			? EXEC_OPTIONS.map(
					(option) =>
						`response_item/function_call:exec_command.arguments.${option}`,
				)
			: [source],
	),
}));
const candidates = new Map<string, readonly SourceFact[]>();

function factsForKind(
	agent: TranscriptSource,
	kind: string,
): readonly SourceFact[] {
	const cacheKey = `${agent}:${kind}`;
	let facts = candidates.get(cacheKey);
	if (facts === undefined) {
		facts = mappings
			.filter((mapping) => mapping.agent === agent)
			.flatMap((mapping) => {
				const sources = mapping.sources.filter(
					(source) =>
						pathMatches(censusPathParts(source).head, kind) ||
						pathMatches(
							censusPathParts(source).head,
							kind.split(":")[0] ?? kind,
						),
				);
				return sources.length === 0
					? []
					: [{ key: mapping.key, moreKey: mapping.moreKey, sources }];
			});
		candidates.set(cacheKey, facts);
	}
	return facts;
}

export function withV9Facts(
	record: Record<string, unknown>,
	agent: TranscriptSource,
	items: readonly LineItem[],
): LineItem[] {
	const selected = factsForKind(agent, censusRecordKind(record, agent));
	if (selected.length === 0) return [...items];
	const baseItems: readonly LineItem[] =
		items.length === 0 ? [{ kind: "meta", subtype: "v9_metadata" }] : items;
	const payload = isRecord(record.payload) ? record.payload : {};
	const completed = isRecord(payload.item) ? payload.item : {};
	const defaultCall =
		typeof payload.call_id === "string"
			? payload.call_id
			: typeof completed.id === "string" &&
					items.some((item) => item.callId === completed.id)
				? completed.id
				: undefined;
	const resultCall = items.filter((item) => item.kind === "tool_result");
	const resultId = resultCall.length === 1 ? resultCall[0]?.callId : undefined;
	let blockCall: string | undefined;
	let parsedCommandType: unknown;
	const structuredTextPaths = new Set<string>();
	const extras = new Map<
		number,
		Partial<Record<TranscriptRecordFactKey, string>>
	>();
	const components = new Map<
		string,
		{
			fact: SourceFact;
			row: number;
			entries: Component[];
			chars: number;
			more: number;
		}
	>();
	const ordinals = new Map<string, number>();
	const strings = new Map<string, SafeString>();
	censusRecordPaths(record, agent, (path, _key, value) => {
		if (path.endsWith(".parsed_cmd[]") && isRecord(value))
			parsedCommandType = value.type;
		if (typeof value === "string" && /\.(?:arguments|output)$/u.test(path))
			structuredTextPaths.add(path);
		else if (structuredTextPaths.has(path) && isRecord(value)) return;
		if (/\.message\.content\[[^\]]+\]$/u.test(path))
			blockCall = isRecord(value)
				? typeof value.id === "string"
					? value.id
					: typeof value.tool_use_id === "string"
						? value.tool_use_id
						: undefined
				: undefined;
		for (const fact of selected) {
			const source = fact.sources.find((pattern) => {
				const conventionAt = pattern.indexOf("~");
				if (conventionAt === -1)
					return pathMatches(pattern.replaceAll("{*}", "*"), path);
				if (
					typeof value !== "string" ||
					!pathMatches(pattern.slice(0, conventionAt), path)
				)
					return false;
				const convention = CENSUS_CONVENTIONS.find(
					(entry) => entry.id === pattern.slice(conventionAt + 1),
				);
				return convention?.matches(value.slice(0, 512)) === true;
			});
			if (source === undefined || value === undefined) continue;
			if (
				agent === "codex" &&
				record.type === "event_msg" &&
				payload.type === "item_completed"
			) {
				if (
					fact.key === "thinking_duration_ms_components" &&
					completed.type !== "Reasoning"
				)
					continue;
				if (
					fact.key === "call_started_at_components" &&
					![
						"CommandExecution",
						"DynamicToolCall",
						"CollabAgentToolCall",
						"WebSearch",
						"ImageView",
						"Extension",
						"ImageGeneration",
						"FileChange",
						"McpToolCall",
					].includes(String(completed.type))
				)
					continue;
			}
			const lineResult =
				path.startsWith("user.toolUseResult") ||
				path.startsWith("user.permissionDecision") ||
				path.startsWith("user.mcpMeta");
			if (
				(path.startsWith("user.toolUseResult") && resultCall.length !== 1) ||
				(lineResult && resultCall.length > 1)
			)
				continue;
			// The refusal reason is toolUseResult in its string form on a denied
			// result; the object form is the tool's whole output (parser 12:
			// it held Write and Edit `originalFile` and `content`).
			if (
				fact.key === "denial_reason_components" &&
				!source.includes("~") &&
				(typeof value !== "string" || typeof record.toolDenialKind !== "string")
			)
				continue;
			if (
				fact.key === "applied_file_changes_components" &&
				!confirmedChange(record, agent)
			)
				continue;
			if (
				fact.key === "skill_components" &&
				path.includes(".parsed_cmd[") &&
				(parsedCommandType !== "read" ||
					typeof value !== "string" ||
					!/(?:^|\/)SKILL\.md$/u.test(value))
			)
				continue;
			const callId = path.includes(".message.content[")
				? blockCall
				: lineResult
					? resultId
					: defaultCall;
			const completion =
				record.type === "event_msg" &&
				(payload.type === "item_completed" ||
					payload.type === "exec_command_end" ||
					payload.type === "patch_apply_end");
			const rowIndex =
				callId === undefined
					? completion
						? baseItems.findIndex(
								(item) => item.kind === "tool_result" || item.kind === "meta",
							)
						: 0
					: baseItems.length === 1 && baseItems[0]?.kind === "meta"
						? 0
						: baseItems.findIndex(
								(item) =>
									item.callId === callId &&
									(completion
										? item.kind === "tool_result" || item.kind === "meta"
										: path.includes("[tool_use:")
											? item.kind === "tool_call"
											: item.kind !== "file_change"),
							);
			if (rowIndex === -1) continue;
			if (
				(fact.key === "tool_result_text_components" ||
					fact.key === "instruction_text_components") &&
				typeof value === "string" &&
				value === baseItems[rowIndex]?.text
			)
				continue;
			let extra = extras.get(rowIndex);
			if (extra === undefined) {
				extra = {};
				extras.set(rowIndex, extra);
			}
			const identity = `${rowIndex}:${fact.key}`;
			let group = components.get(identity);
			if (group === undefined) {
				group = { fact, row: rowIndex, entries: [], chars: 2, more: 0 };
				components.set(identity, group);
			}
			const ordinal = ordinals.get(`${identity}:${path}`) ?? 0;
			ordinals.set(`${identity}:${path}`, ordinal + 1);
			const conventionValue =
				source.includes("~") && typeof value === "string"
					? readConvention(source.slice(source.indexOf("~") + 1), value)
					: fact.key === "wall_time_ms_components" &&
							path.endsWith(".duration_seconds") &&
							typeof value === "number" &&
							Number.isFinite(value)
						? value * 1_000
						: value;
			const offeredValue =
				fact.key === "offered_tools_components" && isRecord(conventionValue)
					? Object.fromEntries(
							["name", "server"]
								.filter((name) => Object.hasOwn(conventionValue, name))
								.map((name) => [name, conventionValue[name]]),
						)
					: conventionValue;
			const safe = safeComponent(
				offeredValue,
				path,
				fact.key,
				extra,
				0,
				strings,
			);
			const entry = {
				path: source.includes("~")
					? `${path}~${source.slice(source.indexOf("~") + 1)}`
					: path,
				ordinal,
				value: safe,
			};
			const chars = JSON.stringify(entry).length + 1;
			if (
				group.chars + chars > factCaps(fact.key).list ||
				group.entries.length >= 1_024
			) {
				group.more++;
				extra.facts_clipped = addClipped(extra.facts_clipped, fact.key);
			} else {
				group.chars += chars;
				group.entries.push(entry);
			}
		}
	});
	for (const group of components.values()) {
		const extra = extras.get(group.row);
		if (extra === undefined) continue;
		extra[group.fact.key] = JSON.stringify(group.entries);
		if (group.more > 0)
			extra[group.fact.moreKey] = String(
				group.more + Number(extra[group.fact.moreKey] ?? 0),
			);
	}
	if (items.length === 0 && components.size === 0) return [];
	return baseItems.map((item, index) => {
		const extra = extras.get(index);
		return extra === undefined
			? item
			: { ...item, facts: mergeFacts(item.facts, { extra }) };
	});
}

function confirmedChange(
	record: Record<string, unknown>,
	agent: TranscriptSource,
): boolean {
	if (agent === "codex") {
		const payload = isRecord(record.payload) ? record.payload : {};
		const item = isRecord(payload.item) ? payload.item : payload;
		return (
			(item.type === "FileChange" && item.status === "completed") ||
			(item.type === "patch_apply_end" && item.success === true)
		);
	}
	const result = isRecord(record.toolUseResult) ? record.toolUseResult : {};
	const message = isRecord(record.message) ? record.message : {};
	return (
		Array.isArray(message.content) &&
		message.content.some(
			(block) =>
				isRecord(block) &&
				block.type === "tool_result" &&
				block.is_error !== true,
		) &&
		(Array.isArray(result.structuredPatch) ||
			result.type === "create" ||
			result.type === "update" ||
			isRecord(result.bashEditDiff))
	);
}

/** The caps of one component fact: a system prompt's parts are kept far longer. */
function factCaps(key: TranscriptRecordFactKey): {
	readonly part: number;
	readonly list: number;
} {
	return key === "instruction_text_components"
		? {
				part: TRANSCRIPT_RECORD_INSTRUCTION_PART_MAX_CHARS,
				list: TRANSCRIPT_RECORD_INSTRUCTION_LIST_MAX_CHARS,
			}
		: {
				part: TRANSCRIPT_RECORD_FACT_VALUE_MAX_CHARS,
				list: TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS,
			};
}

function readConvention(convention: string, text: string): unknown {
	if (convention === "Wall time") {
		const seconds = /^Wall time:\s*([\d.]+)\s*seconds/mu.exec(text)?.[1];
		return seconds !== undefined && Number.isFinite(Number(seconds))
			? { duration_ms: Number(seconds) * 1_000 }
			: text;
	}
	if (convention === "Original token count") {
		const count = /^Original token count:\s*(\d+)/mu.exec(text)?.[1];
		return count !== undefined && Number.isSafeInteger(Number(count))
			? { original_token_count: Number(count) }
			: text;
	}
	if (
		convention === "Process running with session ID" ||
		convention === "Script running with cell ID"
	) {
		const pattern =
			convention === "Process running with session ID"
				? /Process running with session ID\s+(\S+)/u
				: /Script running with cell ID\s+(\S+)/u;
		const id = pattern.exec(text)?.[1];
		return id === undefined
			? text
			: {
					[convention === "Process running with session ID"
						? "session_id"
						: "cell_id"]: id,
				};
	}
	if (convention === "AGENTS.md instructions") {
		const path = /^# AGENTS\.md instructions for (.+)/mu.exec(text)?.[1];
		return path === undefined ? text : { path };
	}
	if (convention === "auto-review decision") {
		try {
			const parsed: unknown = JSON.parse(text);
			if (isRecord(parsed))
				return Object.fromEntries(
					["outcome", "risk_level", "user_authorization"]
						.filter((key) => Object.hasOwn(parsed, key))
						.map((key) => [key, parsed[key]]),
				);
		} catch {
			return text;
		}
	}
	return text;
}

function addClipped(value: string | undefined, key: string): string {
	return [...new Set([...(value ?? "").split(",").filter(Boolean), key])]
		.sort()
		.join(",");
}

function safeComponent(
	value: unknown,
	path: string,
	key: TranscriptRecordFactKey,
	extra: Partial<Record<TranscriptRecordFactKey, string>>,
	depth: number,
	strings: Map<string, SafeString>,
): unknown {
	if (typeof value === "string") {
		if (/\.(?:image_url|audio_url|data)$/u.test(path))
			return { present: true, inline: value.startsWith("data:") };
		let safe = strings.get(value);
		if (safe === undefined) {
			const clipping: Partial<Record<TranscriptRecordFactKey, string>> = {};
			let offered = value;
			if (/^[{[]/u.test(value.trimStart())) {
				try {
					const parsed: unknown = JSON.parse(value);
					if (isRecord(parsed) || Array.isArray(parsed))
						offered = JSON.stringify(
							safeComponent(parsed, path, key, clipping, depth + 1, strings),
						);
				} catch {}
			}
			const text = clippedText(clipping, key, offered, factCaps(key).part);
			safe = {
				text,
				clipped: clipping.facts_clipped !== undefined,
				more: Number(clipping[`${key}_more` as TranscriptRecordFactKey] ?? 0),
			};
			strings.set(value, safe);
		}
		if (safe.clipped)
			extra.facts_clipped = addClipped(extra.facts_clipped, key);
		if (safe.more > 0) {
			const moreKey = `${key}_more` as TranscriptRecordFactKey;
			extra[moreKey] = String(Number(extra[moreKey] ?? 0) + safe.more);
		}
		if (key === "patch_hunks_components" && path.endsWith(".unified_diff")) {
			const ranges = literalPatchHunks(value);
			if (ranges.more > 0)
				extra.facts_clipped = addClipped(extra.facts_clipped, key);
			return { unified_diff: safe.text, ...ranges };
		}
		return safe.text;
	}
	if (depth >= 12) {
		extra.facts_clipped = addClipped(extra.facts_clipped, key);
		return "[depth truncated]";
	}
	if (Array.isArray(value)) {
		if (value.length > 1_024) {
			extra.facts_clipped = addClipped(extra.facts_clipped, key);
			const moreKey = `${key}_more` as TranscriptRecordFactKey;
			extra[moreKey] = String(
				Number(extra[moreKey] ?? 0) + value.length - 1_024,
			);
		}
		return value
			.slice(0, 1_024)
			.map((entry) =>
				safeComponent(entry, path, key, extra, depth + 1, strings),
			);
	}
	if (isRecord(value)) {
		const result: Record<string, unknown> = Object.create(null);
		for (const [name, child] of Object.entries(value)) {
			if (
				/^(?:env|authorization|cookie|password|secret|access_token|api_key|apiKey)$/iu.test(
					name,
				) ||
				/(?:^|[^a-z0-9])(?:keys?|api_?keys?|tokens?|secrets?|passwords?|passwd|pwd|credentials?|authorization|cookies?|bearer|jwt|session_?ids?)(?:$|[^a-z0-9])/u.test(
					name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase(),
				)
			) {
				result[name] = "[redacted]";
				continue;
			}
			if (
				/^(?:image|audio|input_image|input_audio)$/u.test(String(value.type)) &&
				/^(?:data|image_url|audio_url|source)$/u.test(name)
			) {
				result[name] = { present: true };
				continue;
			}
			result[name] = safeComponent(
				child,
				`${path}.${name}`,
				key,
				extra,
				depth + 1,
				strings,
			);
		}
		return result;
	}
	return value;
}
