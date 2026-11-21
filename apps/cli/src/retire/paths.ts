import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Environment = Readonly<Record<string, string | undefined>>;

/** The CLI's configuration directory for a hook runtime at `<dir>/runtime/cli.js`. */
export function configDirOfRuntime(path: string): string | undefined {
	return /[\\/]runtime[\\/]cli\.js$/u.test(path)
		? dirname(dirname(path))
		: undefined;
}

/**
 * A hook runtime knows its configuration directory from its own path, whatever
 * the hook's environment says. Otherwise the CLI's historical resolution
 * applies: OPALINE_CONFIG_DIR, then RUDEL_CONFIG_DIR, then ~/.rudel.
 */
export function primaryConfigDir(
	argv1: string | undefined,
	env: Environment,
	home: string,
): string {
	const runtime = argv1 ? configDirOfRuntime(resolve(argv1)) : undefined;
	if (runtime) return runtime;
	const opaline = env.OPALINE_CONFIG_DIR?.trim();
	if (opaline) return resolve(opaline);
	const rudel = env.RUDEL_CONFIG_DIR?.trim();
	if (rudel) return resolve(rudel);
	return join(home, ".rudel");
}

/** Global Claude Code settings files the CLI may have written hooks to. */
export function claudeGlobalSettingsPaths(
	env: Environment,
	home: string,
): string[] {
	const paths = [join(home, ".claude", "settings.json")];
	const custom = env.CLAUDE_CONFIG_DIR?.trim();
	if (custom) paths.push(join(resolve(custom), "settings.json"));
	return unique(paths);
}

/** Claude Code's own state file, which holds user- and project-scoped MCP servers. */
export function claudeStatePaths(env: Environment, home: string): string[] {
	const paths = [join(home, ".claude.json")];
	const custom = env.CLAUDE_CONFIG_DIR?.trim();
	if (custom) paths.push(join(resolve(custom), ".claude.json"));
	return unique(paths);
}

export function codexConfigPaths(env: Environment, home: string): string[] {
	const paths = [join(home, ".codex", "config.toml")];
	const custom = env.CODEX_HOME?.trim();
	if (custom) paths.push(join(resolve(custom), "config.toml"));
	return unique(paths);
}

/**
 * The project settings file the CLI used for a folder: the nearest `.claude`
 * directory up to the repository root, else `<repository root>/.claude`.
 * Mirrors the released installer so the same file is found again.
 */
export function claudeProjectSettingsPath(
	projectPath: string,
): string | undefined {
	let start: string;
	try {
		start = realpathSync(resolve(projectPath));
	} catch {
		return undefined;
	}
	const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: start,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 2_000,
		windowsHide: true,
	});
	const root =
		git.status === 0 && git.stdout.trim() ? resolve(git.stdout.trim()) : null;
	if (!root) return join(start, ".claude", "settings.json");
	let directory = start;
	while (true) {
		const candidate = join(directory, ".claude");
		if (existsSync(candidate)) return join(candidate, "settings.json");
		const parent = dirname(directory);
		if (directory === root || parent === directory)
			return join(root, ".claude", "settings.json");
		directory = parent;
	}
}

export function unique(paths: readonly string[]): string[] {
	return [...new Set(paths.map((path) => resolve(path)))];
}
