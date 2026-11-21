import { basename } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { isRetiredMcpUrl } from "./claude.js";
import { isRecord, UNPARSEABLE } from "./files.js";
import { configDirOfRuntime } from "./paths.js";

const HOOK_ARGS = ["hooks", "codex", "turn-complete"] as const;
export const PREVIOUS_NOTIFY_FLAG = "--previous-notify";
const MALFORMED_LEGACY_HOOK = "rudel hooks codex turn-complete";

class InvalidChain extends Error {}

export interface CodexResult {
	notifyRemoved: boolean;
	notifyRestored: boolean;
	mcpRemoved: number;
	configDirs: string[];
}

/**
 * Removes Opaline from Codex's `notify` chain, putting back the command it
 * wrapped, and drops MCP servers that point at Opaline's cloud. The rest of
 * the file keeps its text, comments included, whenever the edit can be
 * verified; otherwise the whole file is rewritten from its parsed value, as
 * the released CLI did.
 */
export function cleanCodexConfig(
	text: string,
	result: CodexResult,
): string | undefined | typeof UNPARSEABLE {
	let config: Record<string, unknown>;
	try {
		config = parseTOML(text) as Record<string, unknown>;
	} catch {
		return UNPARSEABLE;
	}
	let notify: string[] | undefined;
	let notifyChanged = false;
	if (isCommand(config.notify)) {
		const configDirs: string[] = [];
		let next: string[];
		try {
			next = unwrap(config.notify, configDirs);
		} catch (error) {
			if (error instanceof InvalidChain) return UNPARSEABLE;
			throw error;
		}
		if (!sameCommand(next, config.notify)) {
			notifyChanged = true;
			notify = next.length ? next : undefined;
			result.configDirs.push(...configDirs);
		}
	}
	const servers = isRecord(config.mcp_servers) ? config.mcp_servers : {};
	const retiredServers = Object.entries(servers)
		.filter(([, server]) => isRecord(server) && isRetiredMcpUrl(server.url))
		.map(([name]) => name);
	if (!notifyChanged && !retiredServers.length) return undefined;

	const expected: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		if (key === "notify" && notifyChanged) {
			if (notify) expected[key] = notify;
		} else if (key === "mcp_servers" && retiredServers.length) {
			const kept = Object.fromEntries(
				Object.entries(servers).filter(
					([name]) => !retiredServers.includes(name),
				),
			);
			if (Object.keys(kept).length) expected[key] = kept;
		} else expected[key] = value;
	}

	let edited: string | undefined = text;
	if (notifyChanged)
		edited = replaceTopLevelArray(
			edited,
			"notify",
			notify ? `notify = ${tomlArray(notify)}` : undefined,
		);
	for (const name of retiredServers)
		if (edited !== undefined) edited = removeTable(edited, "mcp_servers", name);
	const next =
		edited !== undefined && parsesTo(edited, expected)
			? edited
			: stringifyTOML(expected);

	if (notifyChanged) {
		result.notifyRemoved = true;
		if (notify) result.notifyRestored = true;
	}
	result.mcpRemoved += retiredServers.length;
	return next;
}

/** The command Codex should run in place of Opaline's notify hook. */
export function unwrap(
	command: readonly string[],
	configDirs: string[] = [],
	depth = 0,
): string[] {
	if (depth > 8) throw new InvalidChain();
	// Computer Use owns the outer notify command and forwards to its saved
	// previous command; Opaline may sit inside that chain.
	if (
		basename(command[0] ?? "") === "SkyComputerUseClient" &&
		command[1] === "turn-ended" &&
		(command.length === 2 ||
			(command.length === 4 && command[2] === PREVIOUS_NOTIFY_FLAG))
	) {
		const saved = command[3];
		const previous = saved === undefined ? [] : parsePrevious(saved);
		const next = unwrap(previous, configDirs, depth + 1);
		return next.length
			? [...command.slice(0, 2), PREVIOUS_NOTIFY_FLAG, JSON.stringify(next)]
			: command.slice(0, 2);
	}
	const owned = ownedCodexHook(command);
	if (owned) {
		if (owned.configDir) configDirs.push(owned.configDir);
		return [];
	}
	const prefix = command.slice(0, -2);
	const saved = command.at(-1);
	const wrapper = ownedCodexHook(prefix);
	if (
		command.at(-2) === PREVIOUS_NOTIFY_FLAG &&
		saved !== undefined &&
		wrapper
	) {
		if (wrapper.configDir) configDirs.push(wrapper.configDir);
		return unwrap(parsePrevious(saved), configDirs, depth + 1);
	}
	return [...command];
}

export function parsePrevious(saved: string): string[] {
	let value: unknown;
	try {
		value = JSON.parse(saved);
	} catch {
		throw new InvalidChain();
	}
	if (!isCommand(value)) throw new InvalidChain();
	return value;
}

function ownedCodexHook(
	command: readonly string[],
): { configDir?: string } | undefined {
	if (
		sameCommand(command, ["opaline", ...HOOK_ARGS]) ||
		sameCommand(command, ["rudel", ...HOOK_ARGS]) ||
		sameCommand(command, [MALFORMED_LEGACY_HOOK])
	)
		return {};
	if (
		command.length === HOOK_ARGS.length + 2 &&
		HOOK_ARGS.every((arg, index) => command[index + 2] === arg)
	) {
		const configDir = configDirOfRuntime(command[1] ?? "");
		if (configDir) return { configDir };
	}
	return undefined;
}

function isCommand(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((item) => typeof item === "string")
	);
}

function sameCommand(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function tomlArray(values: readonly string[]): string {
	return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function parsesTo(text: string, expected: unknown): boolean {
	try {
		return JSON.stringify(parseTOML(text)) === JSON.stringify(expected);
	} catch {
		return false;
	}
}

/**
 * Replaces (or removes) a top-level `key = [ ... ]` assignment, which may span
 * lines. Returns undefined when the assignment cannot be located; the caller
 * verifies the result by parsing it.
 */
function replaceTopLevelArray(
	text: string,
	key: string,
	replacement: string | undefined,
): string | undefined {
	const header = /^[ \t]*\[/mu.exec(text)?.index ?? text.length;
	const assignment = new RegExp(
		`^[ \\t]*(?:${key}|"${key}"|'${key}')[ \\t]*=[ \\t]*`,
		"mu",
	).exec(text.slice(0, header));
	if (!assignment) return undefined;
	const start = assignment.index;
	let index = start + assignment[0].length;
	if (text[index] !== "[") return undefined;
	let depth = 0;
	for (; index < text.length; index++) {
		const char = text[index];
		if (char === '"') {
			for (index++; index < text.length && text[index] !== '"'; index++)
				if (text[index] === "\\") index++;
		} else if (char === "'") {
			index = text.indexOf("'", index + 1);
			if (index < 0) return undefined;
		} else if (char === "#") {
			index = text.indexOf("\n", index);
			if (index < 0) return undefined;
		} else if (char === "[") depth++;
		else if (char === "]" && --depth === 0) break;
	}
	if (depth !== 0 || index >= text.length) return undefined;
	// Keep a comment that followed the value on its last line.
	const lineEnd = text.indexOf("\n", index);
	const rest = text.slice(index + 1, lineEnd < 0 ? text.length : lineEnd);
	const comment = /#.*?(?=\r?$)/u.exec(rest)?.[0];
	const end = lineEnd < 0 ? text.length : lineEnd + 1;
	const ending = lineEnd < 0 ? "" : rest.endsWith("\r") ? "\r\n" : "\n";
	const line =
		replacement === undefined
			? ""
			: `${replacement}${comment ? ` ${comment}` : ""}${ending}`;
	return `${text.slice(0, start)}${line}${text.slice(end)}`;
}

/** Removes `[parent.name]` and its sub-tables such as `[parent.name.headers]`. */
function removeTable(
	text: string,
	parent: string,
	name: string,
): string | undefined {
	const lines = text.split(/(?<=\n)/u);
	let removing = false;
	let found = false;
	const kept: string[] = [];
	let removed: string[] = [];
	const blank = (line: string) => /^[ \t]*\r?\n?$/u.test(line);
	for (const line of lines) {
		const header = /^[ \t]*\[\[?([^\]]+)\]\]?[ \t]*(?:#.*)?\r?\n?$/u.exec(line);
		if (header) {
			const keys = splitDottedKey(header[1] ?? "");
			const next = keys?.[0] === parent && keys[1] === name;
			if (removing && !next) {
				// Comments just above the next table belong to it.
				let start = removed.length;
				while (
					start > 0 &&
					/^[ \t]*(?:#.*)?\r?\n?$/u.test(removed[start - 1] ?? "")
				)
					start--;
				let tail = removed.slice(start);
				if (!kept.length || blank(kept.at(-1) ?? ""))
					while (tail.length && blank(tail[0] ?? "")) tail = tail.slice(1);
				kept.push(...tail);
			}
			removing = next;
			removed = [];
			if (removing) found = true;
		}
		if (removing) removed.push(line);
		else kept.push(line);
	}
	return found ? kept.join("") : undefined;
}

function splitDottedKey(key: string): string[] | undefined {
	const parts: string[] = [];
	const pattern =
		/\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(\.|$)/uy;
	let match: RegExpExecArray | null;
	while (pattern.lastIndex < key.length) {
		match = pattern.exec(key);
		if (!match) return undefined;
		const quoted = match[1];
		parts.push(
			quoted !== undefined
				? (JSON.parse(`"${quoted}"`) as string)
				: (match[2] ?? match[3] ?? ""),
		);
		if (match[4] === "") break;
	}
	return parts;
}
