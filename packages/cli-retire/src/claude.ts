import { formatJsonLike, isRecord, UNPARSEABLE } from "./files.js";
import { configDirOfRuntime } from "./paths.js";

const QUOTED = "'((?:[^']|'\\\\'')*)'";
// `'<node>' '<config dir>/runtime/cli.js' hooks claude <event>`, as written
// by every release that kept a runtime, whatever its configuration directory.
const PERSISTENT_HOOK = new RegExp(
	`^${QUOTED} ${QUOTED} hooks claude [a-z][a-z-]*$`,
	"u",
);
// Earlier releases ran the globally installed command.
const BARE_HOOK = /^(?:opaline|rudel) hooks claude [a-z][a-z-]*$/u;

export interface OwnedHook {
	/** The configuration directory of the runtime the hook runs, if any. */
	readonly configDir?: string;
}

export function ownedClaudeHook(command: unknown): OwnedHook | undefined {
	if (typeof command !== "string") return undefined;
	if (BARE_HOOK.test(command)) return {};
	const match = PERSISTENT_HOOK.exec(command);
	const runtime = match?.[2]?.replaceAll("'\\''", "'");
	const configDir = runtime ? configDirOfRuntime(runtime) : undefined;
	return configDir ? { configDir } : undefined;
}

/** Opaline's cloud MCP endpoint, under the retired domains. */
export function isRetiredMcpUrl(value: unknown): boolean {
	if (typeof value !== "string") return false;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	const host = url.hostname.toLowerCase().replace(/\.$/u, "");
	const retired = ["opaline.so", "rudel.ai"].some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	);
	return retired && /^\/api\/mcp(?:\/|$)/u.test(url.pathname);
}

export interface ClaudeSettingsResult {
	removed: number;
	configDirs: string[];
}

/**
 * Removes Opaline's hooks from a Claude Code settings file and keeps every
 * other key, hook and entry exactly as it was.
 */
export function cleanClaudeSettings(
	text: string,
	result: ClaudeSettingsResult,
): string | undefined | typeof UNPARSEABLE {
	let settings: unknown;
	try {
		settings = JSON.parse(text);
	} catch {
		return UNPARSEABLE;
	}
	if (!isRecord(settings)) return UNPARSEABLE;
	const hooks = settings.hooks;
	if (!isRecord(hooks)) return undefined;
	let removed = 0;
	const nextHooks: Record<string, unknown> = {};
	for (const [event, entries] of Object.entries(hooks)) {
		if (!Array.isArray(entries)) {
			nextHooks[event] = entries;
			continue;
		}
		const nextEntries: unknown[] = [];
		let removedHere = 0;
		for (const entry of entries) {
			if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
				nextEntries.push(entry);
				continue;
			}
			const kept = entry.hooks.filter((hook) => {
				const owned = isRecord(hook)
					? ownedClaudeHook(hook.command)
					: undefined;
				if (!owned) return true;
				if (owned.configDir) result.configDirs.push(owned.configDir);
				return false;
			});
			const dropped = entry.hooks.length - kept.length;
			removedHere += dropped;
			if (dropped === 0) nextEntries.push(entry);
			else if (kept.length) nextEntries.push({ ...entry, hooks: kept });
		}
		removed += removedHere;
		if (removedHere === 0 || nextEntries.length) nextHooks[event] = nextEntries;
	}
	if (!removed) return undefined;
	result.removed += removed;
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(settings)) {
		if (key !== "hooks") next[key] = value;
		else if (Object.keys(nextHooks).length) next[key] = nextHooks;
	}
	return formatJsonLike(text, next);
}

/**
 * Removes MCP servers that point at Opaline's cloud from Claude Code's state
 * file: user scope (`mcpServers`) and each project's local scope.
 */
export function cleanClaudeState(
	text: string,
	result: { removed: number },
): string | undefined | typeof UNPARSEABLE {
	let state: unknown;
	try {
		state = JSON.parse(text);
	} catch {
		return UNPARSEABLE;
	}
	if (!isRecord(state)) return UNPARSEABLE;
	let removed = removeServers(state.mcpServers);
	if (isRecord(state.projects))
		for (const project of Object.values(state.projects))
			if (isRecord(project)) removed += removeServers(project.mcpServers);
	if (!removed) return undefined;
	result.removed += removed;
	return formatJsonLike(text, state);
}

function removeServers(servers: unknown): number {
	if (!isRecord(servers)) return 0;
	let removed = 0;
	for (const [name, server] of Object.entries(servers))
		if (isRecord(server) && isRetiredMcpUrl(server.url)) {
			delete servers[name];
			removed++;
		}
	return removed;
}
