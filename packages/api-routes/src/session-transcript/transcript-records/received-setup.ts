import { createHash } from "node:crypto";
import { readCodexSkillBlock } from "./injected-wrappers.js";
import { isRecord, type LineItem, readString } from "./line-items.js";
import { countCodePoints, sliceStart } from "./text-fields.js";
import type { TranscriptSource } from "./types.js";

/**
 * Received setup (CONTEXT.md "Received setup"): the setup text the agent
 * received, as its transcript records it. The readers name what a line
 * carries (`LineItem.setup`); this module derives what text conventions
 * carry (skill bodies, AGENTS.md) and turns each piece into the record's
 * `received_setup` fact and the text the writer stores once per content
 * hash. Nothing is read from disk: setup the transcript does not record is
 * unknown.
 */

/** What kind of setup a piece is. */
export type ReceivedSetupKind =
	/** The harness's system prompt: Claude Code `prompt_snapshot`, Codex base instructions. */
	| "system_prompt"
	/** Claude Code `instructions` attachment: CLAUDE.md files loaded at the start. */
	| "instructions"
	/** Claude Code `nested_memory`: a CLAUDE.md loaded when the agent entered its directory. */
	| "nested_memory"
	/** A skill's text: Claude Code's skill body, a Codex `<skill>` message or `cat` of a SKILL.md. */
	| "skill_body"
	/** Claude Code MCP server instructions. */
	| "mcp_instructions"
	/** Codex AGENTS.md instructions. */
	| "agents_md"
	/** A block of a Codex developer message (permissions, collaboration mode, …). */
	| "developer";

/** One piece of setup a line carries, before hashing. */
export interface ReceivedSetupSource {
	readonly kind: ReceivedSetupKind;
	/** The machine path the transcript names; '' for harness text. */
	readonly path: string;
	/** The skill, MCP server or harness part it is; '' for instruction files. */
	readonly name: string;
	/** The exact text received. */
	readonly text: string;
}

/** One piece as the `received_setup` fact lists it. */
export interface ReceivedSetupEntry {
	readonly kind: ReceivedSetupKind;
	readonly path: string;
	readonly name: string;
	/** Working directory the line was written in; '' when not recorded. */
	readonly cwd: string;
	/** SHA-256 of the whole text: the setup file version. */
	readonly sha256: string;
	/** Code points of the whole text. */
	readonly chars: number;
}

/** A distinct text for the writer to store under its hash. */
export interface ReceivedSetupText {
	readonly sha256: string;
	/** The text, cut at `RECEIVED_SETUP_TEXT_MAX_CHARS`. */
	readonly text: string;
	readonly chars: number;
	readonly cut: boolean;
}

/** Longest setup text stored (UTF-16 code units); the hash and length are of the whole. */
export const RECEIVED_SETUP_TEXT_MAX_CHARS = 1_048_576;

/** Claude Code splits its system prompt into a fixed part and a part built per session. */
const DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
const SKILL_BODY_HEADER = /^Base directory for this skill: ([^\n]+)\n\n?/u;
/** Claude Code appends the invocation's arguments after the skill's text. */
const SKILL_ARGUMENTS = "\n\n\nARGUMENTS: ";
const AGENTS_MD =
	/^# AGENTS\.md instructions for ([^\n]+)\n\n<INSTRUCTIONS>\n([\s\S]*?)\n?<\/INSTRUCTIONS>/gmu;
const DEVELOPER_TAG = /^<([a-z_][a-z0-9_ -]{0,63})>/u;
/** The skill listing is offered setup, not received text (OPL-392). */
const SKILL_LISTING_TAGS: ReadonlySet<string> = new Set([
	"skills_instructions",
]);
/** A whole-file read the output is exactly the file of: `cat <one SKILL.md>`. */
const CAT_SKILL = /^cat\s+(['"]?)([^\s'"{}*?$`;|&<>]+\/SKILL\.md)\1\s*$/u;

/** The pieces of a Claude Code `prompt_snapshot`: its fixed part and its per-session part. */
export function claudeSystemPrompt(
	attachment: Record<string, unknown>,
): ReceivedSetupSource[] {
	if (!Array.isArray(attachment.systemPrompt)) return [];
	const parts = attachment.systemPrompt.filter(
		(part): part is string => typeof part === "string",
	);
	const boundary = parts.indexOf(DYNAMIC_BOUNDARY);
	const fixed = boundary === -1 ? parts : parts.slice(0, boundary);
	const dynamic = boundary === -1 ? [] : parts.slice(boundary + 1);
	return [
		harness("system_prompt", "system_prompt", fixed.join("\n\n")),
		harness("system_prompt", "system_prompt_dynamic", dynamic.join("\n\n")),
	].filter((piece) => piece.text !== "");
}

/** The files of a Claude Code `instructions` attachment. */
export function claudeInstructionFiles(
	attachment: Record<string, unknown>,
): ReceivedSetupSource[] {
	const files = Array.isArray(attachment.files) ? attachment.files : [];
	return files.flatMap((file) => {
		if (!isRecord(file)) return [];
		const path = readString(file.path);
		const text = typeof file.content === "string" ? file.content : undefined;
		return path === undefined || text === undefined
			? []
			: [{ kind: "instructions" as const, path, name: "", text }];
	});
}

/** A Claude Code `nested_memory` attachment's file. */
export function claudeNestedMemory(
	path: string | undefined,
	content: unknown,
): ReceivedSetupSource[] {
	return path === undefined || typeof content !== "string"
		? []
		: [{ kind: "nested_memory", path, name: "", text: content }];
}

/** The added blocks of a Claude Code `mcp_instructions_delta`, by server. */
export function claudeMcpInstructions(
	attachment: Record<string, unknown>,
): ReceivedSetupSource[] {
	const blocks = Array.isArray(attachment.addedBlocks)
		? attachment.addedBlocks
		: [];
	const names = Array.isArray(attachment.addedNames)
		? attachment.addedNames
		: [];
	return blocks.flatMap((block, index) =>
		typeof block === "string" && block !== ""
			? [
					{
						kind: "mcp_instructions" as const,
						path: "",
						name: typeof names[index] === "string" ? names[index] : "",
						text: block,
					},
				]
			: [],
	);
}

/** Codex `session_meta.base_instructions.text`. */
export function codexBaseInstructions(
	payload: Record<string, unknown>,
): ReceivedSetupSource[] {
	const base = isRecord(payload.base_instructions)
		? payload.base_instructions
		: undefined;
	const text = readString(base?.text);
	return text === undefined
		? []
		: [harness("system_prompt", "base_instructions", text)];
}

/** The blocks of a Codex developer message, each named by its leading tag. */
export function codexDeveloperBlocks(content: unknown): ReceivedSetupSource[] {
	const blocks = Array.isArray(content) ? content : [];
	return blocks.flatMap((block) => {
		if (!isRecord(block)) return [];
		const text = readString(block.text);
		if (text === undefined) return [];
		const tag = DEVELOPER_TAG.exec(text)?.[1] ?? "";
		return SKILL_LISTING_TAGS.has(tag) ? [] : [harness("developer", tag, text)];
	});
}

/**
 * A Codex command that printed one whole SKILL.md (`cat <path>`, completed
 * with exit code 0): its output is the skill's text. Partial reads (`sed`,
 * `head`) and reads of several files are not, since their output is not one
 * file's text.
 */
export function codexSkillRead(
	item: Record<string, unknown>,
	command: string,
	exitCode: number | null,
): ReceivedSetupSource[] {
	const path = CAT_SKILL.exec(command.trim())?.[2];
	const stdout = typeof item.stdout === "string" ? item.stdout : undefined;
	if (
		path === undefined ||
		stdout === undefined ||
		item.status !== "completed" ||
		exitCode !== 0
	)
		return [];
	const cwd = fileUrlPath(readString(item.cwd));
	const absolute = joinPath(cwd, path);
	return [
		{
			kind: "skill_body",
			path: absolute,
			name: skillName(absolute),
			text: stdout,
		},
	];
}

/**
 * The setup an item carries: what its reader named, else what its text's
 * convention names (a Claude Code skill body, Codex AGENTS.md instructions).
 */
export function itemSetup(item: LineItem): readonly ReceivedSetupSource[] {
	if (item.setup !== undefined) return item.setup;
	if (item.kind !== "injected_context" || item.text === undefined) return [];
	if (item.subtype === "skill_body") return skillBody(item.text);
	return agentsMd(item.text);
}

/**
 * The `received_setup` fact and texts of an item's pieces: each piece with
 * the working directory it was received in, its hash and its length.
 */
export function receivedSetupFacts(
	sources: readonly ReceivedSetupSource[],
	cwd: string,
): {
	readonly fact: string | undefined;
	readonly texts: readonly ReceivedSetupText[];
} {
	if (sources.length === 0) return { fact: undefined, texts: [] };
	const entries: ReceivedSetupEntry[] = [];
	const texts: ReceivedSetupText[] = [];
	for (const source of sources) {
		const sha256 = createHash("sha256")
			.update(source.text, "utf8")
			.digest("hex");
		const chars = countCodePoints(source.text);
		const text = sliceStart(source.text, RECEIVED_SETUP_TEXT_MAX_CHARS);
		entries.push({
			kind: source.kind,
			path: source.path,
			name: source.name,
			cwd,
			sha256,
			chars,
		});
		texts.push({ sha256, text, chars, cut: text.length < source.text.length });
	}
	return { fact: JSON.stringify(entries), texts };
}

/** The working directory a line recorded: Claude Code on every line, Codex in session_meta and turn_context. */
export function recordCwd(
	record: Record<string, unknown>,
	source: TranscriptSource,
): string | undefined {
	if (source !== "codex") return readString(record.cwd);
	const payload = isRecord(record.payload) ? record.payload : undefined;
	return record.type === "turn_context" || record.type === "session_meta"
		? fileUrlPath(readString(payload?.cwd))
		: undefined;
}

function skillBody(text: string): ReceivedSetupSource[] {
	const codex = readCodexSkillBlock(text);
	if (codex !== undefined)
		return [
			{
				kind: "skill_body",
				path: codex.path,
				name: codex.name,
				text: codex.text,
			},
		];
	const header = SKILL_BODY_HEADER.exec(text);
	const directory = header?.[1]?.trim();
	if (header === null || directory === undefined || directory === "") return [];
	const body = text.slice(header[0].length);
	const argumentsAt = body.lastIndexOf(SKILL_ARGUMENTS);
	const path = `${directory.replace(/[\\/]+$/u, "")}/SKILL.md`;
	return [
		{
			kind: "skill_body",
			path,
			name: skillName(path),
			text: argumentsAt === -1 ? body : body.slice(0, argumentsAt),
		},
	];
}

function agentsMd(text: string): ReceivedSetupSource[] {
	return [...text.matchAll(AGENTS_MD)].flatMap((match) => {
		const directory = match[1]?.trim();
		const body = match[2];
		return directory === undefined || body === undefined
			? []
			: [
					{
						kind: "agents_md" as const,
						path: `${directory.replace(/[\\/]+$/u, "")}/AGENTS.md`,
						name: "",
						text: body,
					},
				];
	});
}

function harness(
	kind: ReceivedSetupKind,
	name: string,
	text: string,
): ReceivedSetupSource {
	return { kind, path: "", name, text };
}

/** The skill a SKILL.md path belongs to: its directory's name. */
function skillName(path: string): string {
	return path.split(/[\\/]/u).at(-2) ?? "";
}

/** A Codex `file://` working directory as a path. */
function fileUrlPath(value: string | undefined): string {
	if (value === undefined) return "";
	if (!value.startsWith("file://")) return value;
	try {
		return decodeURIComponent(value.slice("file://".length));
	} catch {
		return value.slice("file://".length);
	}
}

/** `path` against `cwd` when relative, without `./` segments. */
function joinPath(cwd: string, path: string): string {
	const relative = path.replace(/^(?:\.\/)+/u, "");
	if (relative.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(relative))
		return relative;
	if (relative.startsWith("~/") || cwd === "") return relative;
	return `${cwd.replace(/\/+$/u, "")}/${relative}`;
}
