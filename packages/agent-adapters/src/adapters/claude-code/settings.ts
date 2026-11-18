import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SESSION_END_HOOK_COMMAND = "rudel hooks claude session-end";
const SESSION_START_HOOK_COMMAND = "rudel hooks claude session-start";

interface HookEntry {
	type: string;
	command: string;
	async?: boolean;
}

interface HookMatcher {
	matcher: string;
	hooks: HookEntry[];
}

interface ClaudeSettings {
	hooks?: {
		SessionStart?: HookMatcher[];
		SessionEnd?: HookMatcher[];
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

function findClaudeDir(): string {
	let dir = resolve(process.cwd());

	while (dir !== dirname(dir)) {
		const candidate = join(dir, ".claude");
		if (existsSync(candidate)) {
			return candidate;
		}
		dir = dirname(dir);
	}

	try {
		const gitRoot = execSync("git rev-parse --show-toplevel", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return join(gitRoot, ".claude");
	} catch {
		return join(resolve(process.cwd()), ".claude");
	}
}

export function getClaudeSettingsPath(): string {
	return join(findClaudeDir(), "settings.json");
}

export function readClaudeSettings(
	path: string = getClaudeSettingsPath(),
): ClaudeSettings {
	if (!existsSync(path)) return {};
	const content = readFileSync(path, "utf-8");
	return JSON.parse(content) as ClaudeSettings;
}

export function writeClaudeSettings(
	settings: ClaudeSettings,
	path: string = getClaudeSettingsPath(),
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * SessionEnd is the hook every install has had since auto-upload shipped, so it
 * alone means "enabled". SessionStart was added later and is backfilled by
 * `ensureSessionStartHook`; requiring it here would make existing installs
 * suddenly report that auto-upload is off.
 */
export function isHookEnabled(path: string = getClaudeSettingsPath()): boolean {
	const settings = readClaudeSettings(path);
	return hasHookCommand(settings.hooks?.SessionEnd, SESSION_END_HOOK_COMMAND);
}

/**
 * Adds the SessionStart hook to an install that predates it. Returns true when
 * the settings file changed. Settings without the SessionEnd hook are left
 * alone, so this never enables auto-upload for a project that did not opt in.
 */
export function ensureSessionStartHook(
	path: string = getClaudeSettingsPath(),
): boolean {
	const settings = readClaudeSettings(path);
	const hooks = settings.hooks;
	if (!hooks || !hasHookCommand(hooks.SessionEnd, SESSION_END_HOOK_COMMAND)) {
		return false;
	}
	if (hasHook(hooks.SessionStart, SESSION_START_HOOK_COMMAND)) return false;

	hooks.SessionStart = addHookEntry(
		Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [],
		SESSION_START_HOOK_COMMAND,
	);
	writeClaudeSettings(settings, path);
	return true;
}

export function addHook(path: string = getClaudeSettingsPath()): void {
	const settings = readClaudeSettings(path);
	if (!settings.hooks) {
		settings.hooks = {};
	}
	if (!Array.isArray(settings.hooks.SessionEnd)) {
		settings.hooks.SessionEnd = [];
	}
	if (!Array.isArray(settings.hooks.SessionStart)) {
		settings.hooks.SessionStart = [];
	}
	settings.hooks.SessionStart = addHookEntry(
		settings.hooks.SessionStart,
		SESSION_START_HOOK_COMMAND,
	);
	settings.hooks.SessionEnd = addHookEntry(
		settings.hooks.SessionEnd,
		SESSION_END_HOOK_COMMAND,
	);

	writeClaudeSettings(settings, path);
}

export function removeHook(path: string = getClaudeSettingsPath()): void {
	const settings = readClaudeSettings(path);
	const hooks = settings.hooks;
	if (!hooks) return;
	hooks.SessionStart = removeHookEntries(
		hooks.SessionStart,
		SESSION_START_HOOK_COMMAND,
	);
	hooks.SessionEnd = removeHookEntries(
		hooks.SessionEnd,
		SESSION_END_HOOK_COMMAND,
	);
	if (hooks.SessionStart?.length === 0) delete hooks.SessionStart;
	if (hooks.SessionEnd?.length === 0) delete hooks.SessionEnd;
	if (Object.keys(hooks).length === 0) {
		delete settings.hooks;
	}

	writeClaudeSettings(settings, path);
}

function hasHookCommand(
	entries: HookMatcher[] | undefined,
	command: string,
): boolean {
	return (
		Array.isArray(entries) &&
		entries.some((entry) =>
			entry.hooks?.some((hook) => hook.command === command),
		)
	);
}

function hasHook(entries: HookMatcher[] | undefined, command: string): boolean {
	return (
		Array.isArray(entries) &&
		entries.some((entry) =>
			entry.hooks?.some(
				(hook) =>
					hook.type === "command" &&
					hook.command === command &&
					hook.async === true,
			),
		)
	);
}

function addHookEntry(entries: HookMatcher[], command: string): HookMatcher[] {
	if (hasHook(entries, command)) return entries;
	return [
		...(removeHookEntries(entries, command) ?? []),
		{
			matcher: "",
			hooks: [{ type: "command", command, async: true }],
		},
	];
}

function removeHookEntries(
	entries: HookMatcher[] | undefined,
	command: string,
): HookMatcher[] | undefined {
	return entries
		?.map((entry) => ({
			...entry,
			hooks: entry.hooks.filter((hook) => hook.command !== command),
		}))
		.filter((entry) => entry.hooks.length > 0);
}
