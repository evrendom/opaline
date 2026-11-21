import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type ClaudeSettingsResult,
	cleanClaudeSettings,
	cleanClaudeState,
} from "./claude.js";
import { type CodexResult, cleanCodexConfig } from "./codex.js";
import {
	claudeGlobalSettingsPaths,
	claudeStatePaths,
	codexConfigPaths,
	type Environment,
	primaryConfigDir,
} from "./paths.js";
import { CREDENTIALS_FILE, isCliConfigDir } from "./state.js";

export interface Leftovers {
	/** Global Claude Code settings files that still run the CLI's hooks. */
	readonly claudeHooks: string[];
	/** Codex configs whose `notify` still runs the CLI. */
	readonly codexNotify: string[];
	/** Files that still list an MCP server on Opaline's retired cloud. */
	readonly cloudMcpServers: string[];
	/** The CLI's saved cloud sign-in. */
	readonly credentials: string[];
}

/**
 * What the retired CLI left on this computer, found by running the cleanup's
 * own transforms in memory: a file counts exactly when `retire` would change
 * it. Reads only; nothing is written, locked or created.
 */
export function findLeftovers(context: {
	readonly env: Environment;
	readonly home: string;
}): Leftovers {
	const leftovers: Leftovers = {
		claudeHooks: [],
		codexNotify: [],
		cloudMcpServers: [],
		credentials: [],
	};
	const configDirs = new Set([
		resolve(primaryConfigDir(undefined, context.env, context.home)),
	]);

	for (const path of claudeGlobalSettingsPaths(context.env, context.home)) {
		const text = readText(path);
		if (text === undefined) continue;
		const result: ClaudeSettingsResult = { removed: 0, configDirs: [] };
		attempt(() => cleanClaudeSettings(text, result));
		if (result.removed) leftovers.claudeHooks.push(path);
		for (const dir of result.configDirs) configDirs.add(resolve(dir));
	}

	for (const path of codexConfigPaths(context.env, context.home)) {
		const text = readText(path);
		if (text === undefined) continue;
		const result: CodexResult = {
			notifyRemoved: false,
			notifyRestored: false,
			mcpRemoved: 0,
			configDirs: [],
		};
		attempt(() => cleanCodexConfig(text, result));
		if (result.notifyRemoved) leftovers.codexNotify.push(path);
		if (result.mcpRemoved) leftovers.cloudMcpServers.push(path);
		for (const dir of result.configDirs) configDirs.add(resolve(dir));
	}

	for (const path of claudeStatePaths(context.env, context.home)) {
		const text = readText(path);
		if (text === undefined) continue;
		const result = { removed: 0 };
		attempt(() => cleanClaudeState(text, result));
		if (result.removed) leftovers.cloudMcpServers.push(path);
	}

	const primary = [...configDirs][0];
	for (const dir of configDirs) {
		// A directory a hook names counts only when it holds a CLI runtime,
		// as in the cleanup.
		if (dir !== primary && !isCliConfigDir(dir)) continue;
		const credentials = join(dir, CREDENTIALS_FILE);
		if (exists(credentials)) leftovers.credentials.push(credentials);
	}
	return leftovers;
}

export function hasLeftovers(leftovers: Leftovers): boolean {
	return (
		leftovers.claudeHooks.length > 0 ||
		leftovers.codexNotify.length > 0 ||
		leftovers.cloudMcpServers.length > 0 ||
		leftovers.credentials.length > 0
	);
}

/** A file the cleanup could not read is one it would leave alone. */
function attempt(transform: () => unknown): void {
	try {
		transform();
	} catch {
		// Counted as nothing to remove.
	}
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function exists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}
