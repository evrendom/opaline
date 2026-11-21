import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type ClaudeSettingsResult,
	cleanClaudeSettings,
	cleanClaudeState,
} from "./claude.js";
import { type CodexResult, cleanCodexConfig } from "./codex.js";
import { type FileUpdate, isRecord, updateFile } from "./files.js";
import { withConfigLock } from "./lock.js";
import {
	claudeGlobalSettingsPaths,
	claudeProjectSettingsPath,
	claudeStatePaths,
	codexConfigPaths,
	type Environment,
	primaryConfigDir,
	unique,
} from "./paths.js";
import {
	isCliConfigDir,
	isDirectory,
	type RuntimeRefresh,
	refreshRuntime,
	removeCredentials,
	removeState,
} from "./state.js";

export interface CleanupContext {
	readonly env: Environment;
	readonly home: string;
	readonly cwd: string;
	/** process.argv[1]: a hook runtime at `<config dir>/runtime/cli.js`. */
	readonly argv1: string | undefined;
	/** This release's self-contained `cli.js`, when running from a build. */
	readonly bundlePath: string | undefined;
}

export interface FileChange {
	readonly path: string;
	readonly what: string;
}

export interface CleanupReport {
	readonly configDirs: string[];
	readonly signedOut: string[];
	readonly changed: FileChange[];
	/** Files left untouched because they could not be parsed or kept changing. */
	readonly skipped: { path: string; reason: FileUpdate }[];
	readonly stateRemoved: { configDir: string; names: string[] }[];
	readonly runtimes: { configDir: string; result: RuntimeRefresh }[];
	/** Another Opaline process held the settings lock; only sign-in was removed. */
	busy: boolean;
}

/**
 * Retires this computer's Opaline CLI installation. Idempotent, local only:
 * it removes the saved sign-in first (every released hook stops uploading
 * without it), then Opaline's hooks and cloud MCP servers from Claude Code and
 * Codex settings, then the CLI's own cloud state.
 */
export function retire(context: CleanupContext): CleanupReport {
	const primary = primaryConfigDir(context.argv1, context.env, context.home);
	const report: CleanupReport = {
		configDirs: [primary],
		signedOut: [],
		changed: [],
		skipped: [],
		stateRemoved: [],
		runtimes: [],
		busy: false,
	};
	signOut(primary, report);
	const run = () => cleanSettingsAndState(context, primary, report);
	if (!isDirectory(primary)) run();
	else if (!withConfigLock(primary, run)) report.busy = true;
	return report;
}

function cleanSettingsAndState(
	context: CleanupContext,
	primary: string,
	report: CleanupReport,
): void {
	const configDirs = new Set([resolve(primary)]);
	const claude: ClaudeSettingsResult = { removed: 0, configDirs: [] };
	const claudeFiles = new Set<string>();
	const cleanClaudeFile = (path: string | undefined) => {
		if (!path || claudeFiles.has(path)) return;
		claudeFiles.add(path);
		const before = claude.removed;
		const result = updateFile(path, (text) =>
			cleanClaudeSettings(text, claude),
		);
		record(report, path, result, () => {
			const removed = claude.removed - before;
			return `${removed} automatic-upload hook${removed === 1 ? "" : "s"}`;
		});
	};

	for (const path of claudeGlobalSettingsPaths(context.env, context.home))
		cleanClaudeFile(path);
	cleanClaudeFile(claudeProjectSettingsPath(context.cwd));

	const codex: CodexResult = {
		notifyRemoved: false,
		notifyRestored: false,
		mcpRemoved: 0,
		configDirs: [],
	};
	for (const path of codexConfigPaths(context.env, context.home)) {
		const before = { ...codex };
		const result = updateFile(path, (text) => cleanCodexConfig(text, codex));
		record(report, path, result, () => {
			const parts: string[] = [];
			if (codex.notifyRemoved && !before.notifyRemoved)
				parts.push(
					codex.notifyRestored && !before.notifyRestored
						? "the notify hook (your previous notify command is back)"
						: "the notify hook",
				);
			const servers = codex.mcpRemoved - before.mcpRemoved;
			if (servers)
				parts.push(
					`${servers} Opaline cloud MCP server${servers === 1 ? "" : "s"}`,
				);
			return parts.join(" and ");
		});
	}

	for (const path of claudeStatePaths(context.env, context.home)) {
		const state = { removed: 0 };
		const result = updateFile(path, (text) => cleanClaudeState(text, state));
		record(
			report,
			path,
			result,
			() =>
				`${state.removed} Opaline cloud MCP server${state.removed === 1 ? "" : "s"}`,
		);
	}

	// Hooks name the runtime they run, and so the configuration directory
	// they were installed with, even when this run's environment differs.
	for (const dir of [...claude.configDirs, ...codex.configDirs])
		if (isCliConfigDir(dir)) configDirs.add(resolve(dir));
	for (const dir of configDirs)
		for (const projectPath of autoUploadProjectPaths(dir))
			cleanClaudeFile(claudeProjectSettingsPath(projectPath));
	for (const dir of claude.configDirs)
		if (isCliConfigDir(dir)) configDirs.add(resolve(dir));

	for (const dir of configDirs) {
		if (dir !== resolve(primary)) {
			report.configDirs.push(dir);
			signOut(dir, report);
		}
		const names = removeState(dir);
		if (names.length) report.stateRemoved.push({ configDir: dir, names });
		const runtime = refreshRuntime(dir, context.bundlePath);
		if (runtime !== "absent")
			report.runtimes.push({ configDir: dir, result: runtime });
	}
}

function signOut(configDir: string, report: CleanupReport): void {
	try {
		if (removeCredentials(configDir)) report.signedOut.push(configDir);
	} catch {
		report.skipped.push({
			path: join(configDir, "credentials.json"),
			reason: "failed",
		});
	}
}

function record(
	report: CleanupReport,
	path: string,
	result: FileUpdate,
	describe: () => string,
): void {
	if (result === "changed") report.changed.push({ path, what: describe() });
	else if (result === "unparseable" || result === "busy" || result === "failed")
		report.skipped.push({ path, reason: result });
}

/** Project folders the CLI managed, from its `auto-upload.json`. */
function autoUploadProjectPaths(configDir: string): string[] {
	let value: unknown;
	try {
		value = JSON.parse(
			readFileSync(join(configDir, "auto-upload.json"), "utf8"),
		);
	} catch {
		return [];
	}
	if (!isRecord(value) || !isRecord(value.repositories)) return [];
	const paths: string[] = [];
	for (const repository of Object.values(value.repositories))
		if (isRecord(repository) && Array.isArray(repository.paths))
			for (const path of repository.paths)
				if (typeof path === "string" && path) paths.push(path);
	return unique(paths);
}
