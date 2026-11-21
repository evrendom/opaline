import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	CREDENTIALS_FILE,
	STATE_DIRECTORIES,
	STATE_FILES,
} from "@rudel/cli-retire";
import { parse as parseTOML } from "smol-toml";
import {
	fakeBundle,
	makeHome,
	NODE,
	persistentClaudeHook,
	read,
	readJson,
	runInProcess,
	runRetire,
	testEnv,
	write,
} from "./helpers.js";

let home: string;
let cwd: string;
let cleanup: () => void;

beforeEach(() => {
	({ home, cwd, cleanup } = makeHome());
});
afterEach(() => cleanup());

function seedState(configDir: string): void {
	write(join(configDir, CREDENTIALS_FILE), {
		token: "secret",
		apiBaseUrl: "https://opaline.so",
	});
	for (const name of STATE_FILES) write(join(configDir, name), "{}");
	for (const name of STATE_DIRECTORIES)
		write(join(configDir, name, "item.json"), "{}");
	write(join(configDir, "credentials.json.123.abc.tmp"), "{}");
	write(join(configDir, "logs", "hook-upload.log"), "kept\n");
	write(join(configDir, "auto-upload.json"), { version: 1, repositories: {} });
	write(join(configDir, "failed-uploads.json.bak-2026-11-08"), "user backup");
}

test("removes only Opaline's hooks and leaves the app's plugin and every other setting alone", () => {
	const configDir = join(home, ".rudel");
	seedState(configDir);
	const settingsPath = join(home, ".claude", "settings.json");
	const settings = {
		permissions: { allow: ["Read"] },
		enabledPlugins: { "opaline@opaline-local": true, "other@market": true },
		extraKnownMarketplaces: {
			"opaline-local": { source: { source: "directory", path: "/x" } },
		},
		hooks: {
			SessionEnd: [
				{ matcher: "", hooks: [{ type: "command", command: "echo keep" }] },
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(configDir, "session-end"),
							async: true,
							timeout: 60,
						},
					],
				},
			],
			SessionStart: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(configDir, "session-start"),
							async: true,
						},
						{ type: "command", command: "my-own-start-hook" },
					],
				},
			],
			Stop: [
				{
					hooks: [
						{ type: "command", command: "rudel hooks claude session-end" },
					],
				},
			],
			PreToolUse: [
				{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] },
			],
		},
	};
	write(settingsPath, settings);
	// The Mac app keeps its hooks inside its own plugin, never in settings.json.
	const pluginHooks = join(
		home,
		"Library",
		"Application Support",
		"Opaline",
		"marketplace",
		"opaline-claude",
		"hooks",
		"hooks.json",
	);
	const pluginHooksContent = JSON.stringify({
		hooks: {
			Stop: [
				{
					hooks: [
						{ type: "command", command: '"/app/bin/opaline-hook" claude' },
					],
				},
			],
		},
	});
	write(pluginHooks, pluginHooksContent);

	const report = runRetire(home, cwd);

	expect(readJson(settingsPath)).toEqual({
		permissions: { allow: ["Read"] },
		enabledPlugins: { "opaline@opaline-local": true, "other@market": true },
		extraKnownMarketplaces: settings.extraKnownMarketplaces,
		hooks: {
			SessionEnd: [
				{ matcher: "", hooks: [{ type: "command", command: "echo keep" }] },
			],
			SessionStart: [
				{
					matcher: "",
					hooks: [{ type: "command", command: "my-own-start-hook" }],
				},
			],
			PreToolUse: [
				{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] },
			],
		},
	});
	expect(read(pluginHooks)).toBe(pluginHooksContent);
	expect(report.changed).toEqual([
		{ path: settingsPath, what: "3 automatic-upload hooks" },
	]);
	expect(report.signedOut).toEqual([configDir]);
	expect(existsSync(join(configDir, CREDENTIALS_FILE))).toBe(false);
	for (const name of [...STATE_FILES, ...STATE_DIRECTORIES])
		expect(existsSync(join(configDir, name))).toBe(false);
	expect(existsSync(join(configDir, "credentials.json.123.abc.tmp"))).toBe(
		false,
	);
	expect(read(join(configDir, "logs", "hook-upload.log"))).toBe("kept\n");
	expect(existsSync(join(configDir, "auto-upload.json"))).toBe(true);
	expect(read(join(configDir, "failed-uploads.json.bak-2026-11-08"))).toBe(
		"user backup",
	);
});

test("drops the hooks key only when Opaline's hooks were all it held", () => {
	const settingsPath = join(home, ".claude", "settings.json");
	write(
		settingsPath,
		'{\n\t"model": "opus",\n\t"hooks": {\n\t\t"SessionEnd": [{ "hooks": [{ "type": "command", "command": "opaline hooks claude session-end" }] }]\n\t}\n}',
	);
	runRetire(home, cwd);
	expect(read(settingsPath)).toBe('{\n\t"model": "opus"\n}');
});

test("a shared OPALINE_CONFIG_DIR keeps the Mac app's server data", () => {
	const shared = join(home, ".opaline");
	seedState(shared);
	write(join(shared, "server", "server.json"), '{"port":4790}');
	write(join(shared, "server", "postgres", "PG_VERSION"), "17");
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(shared, "session-end"),
						},
					],
				},
			],
		},
	});

	runRetire(home, cwd, { env: testEnv(home, { OPALINE_CONFIG_DIR: shared }) });

	expect(read(join(shared, "server", "server.json"))).toBe('{"port":4790}');
	expect(read(join(shared, "server", "postgres", "PG_VERSION"))).toBe("17");
	expect(existsSync(join(shared, CREDENTIALS_FILE))).toBe(false);
	expect(existsSync(join(shared, "failed-uploads.json"))).toBe(false);
	expect(readJson(join(home, ".claude", "settings.json"))).toEqual({});
});

test("finds hooks installed under another configuration directory than this run's", () => {
	const custom = join(home, "custom-profile");
	seedState(custom);
	write(join(custom, "runtime", "cli.js"), fakeBundle("0.17.1"));
	const bundle = join(cwd, "bundle", "cli.js");
	write(bundle, fakeBundle("0.18.0"));
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(custom, "session-end"),
						},
					],
				},
			],
		},
	});
	write(
		join(home, ".codex", "config.toml"),
		`notify = ${JSON.stringify([NODE, join(custom, "runtime", "cli.js"), "hooks", "codex", "turn-complete"])}\n`,
	);

	// No OPALINE_CONFIG_DIR in this environment: the default is ~/.rudel.
	const report = runRetire(home, cwd, { bundlePath: bundle });

	expect(report.configDirs).toEqual([join(home, ".rudel"), custom]);
	expect(report.signedOut).toEqual([custom]);
	expect(existsSync(join(custom, "failed-uploads.json"))).toBe(false);
	expect(read(join(custom, "runtime", "cli.js"))).toBe(fakeBundle("0.18.0"));
	expect(readJson(join(custom, "runtime", "package.json"))).toEqual({
		type: "module",
	});
	expect(report.runtimes).toEqual([{ configDir: custom, result: "refreshed" }]);
	expect(readJson(join(home, ".claude", "settings.json"))).toEqual({});
	expect(read(join(home, ".codex", "config.toml"))).toBe("");
	// A default directory that never existed is not created.
	expect(existsSync(join(home, ".rudel"))).toBe(false);
});

test("a hook pointing at a folder without an Opaline runtime removes the hook and deletes nothing there", () => {
	const unrelated = join(home, "not-opaline");
	seedState(unrelated);
	write(
		join(unrelated, "runtime", "cli.js"),
		"#!/usr/bin/env node\n// someone else's tool\n",
	);
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(unrelated, "session-end"),
						},
					],
				},
			],
		},
	});

	const report = runRetire(home, cwd);

	expect(readJson(join(home, ".claude", "settings.json"))).toEqual({});
	expect(report.configDirs).not.toContain(unrelated);
	expect(existsSync(join(unrelated, "credentials.json"))).toBe(true);
	expect(existsSync(join(unrelated, "failed-uploads.json"))).toBe(true);
});

test("a hook runtime cleans the directory it lives in, whatever its environment says", () => {
	const custom = join(home, "custom-profile");
	seedState(custom);
	const runtime = join(custom, "runtime", "cli.js");
	write(runtime, fakeBundle("0.18.0"));
	const report = runRetire(home, cwd, {
		argv1: runtime,
		env: testEnv(home, { OPALINE_CONFIG_DIR: join(home, "elsewhere") }),
	});
	expect(report.configDirs[0]).toBe(custom);
	expect(existsSync(join(custom, CREDENTIALS_FILE))).toBe(false);
	// Kept: it is the retired runtime any returning hook will run.
	expect(read(runtime)).toBe(fakeBundle("0.18.0"));
	expect(report.runtimes).toEqual([{ configDir: custom, result: "current" }]);
});

test("never replaces a newer runtime and never creates one", () => {
	const configDir = join(home, ".rudel");
	write(join(configDir, "runtime", "cli.js"), fakeBundle("0.19.0"));
	const bundle = join(cwd, "cli.js");
	write(bundle, fakeBundle("0.18.0"));
	runRetire(home, cwd, { bundlePath: bundle });
	expect(read(join(configDir, "runtime", "cli.js"))).toBe(fakeBundle("0.19.0"));

	const other = makeHome();
	try {
		write(join(other.home, ".rudel", CREDENTIALS_FILE), "{}");
		runRetire(other.home, other.cwd, { bundlePath: bundle });
		expect(existsSync(join(other.home, ".rudel", "runtime"))).toBe(false);
	} finally {
		other.cleanup();
	}
});

test("restores the Codex notify command Opaline wrapped and keeps the file's comments", () => {
	const configDir = join(home, ".rudel");
	const previous = ["terminal-notifier", "-title", "Codex"];
	const configPath = join(home, ".codex", "config.toml");
	write(
		configPath,
		[
			"# my Codex settings",
			'model = "gpt-5.2" # pinned',
			`notify = [${[NODE, join(configDir, "runtime", "cli.js"), "hooks", "codex", "turn-complete", "--previous-notify", JSON.stringify(previous)].map((value) => JSON.stringify(value)).join(", ")}]`,
			"",
			"[mcp_servers.opaline]",
			'url = "https://opaline.so/api/mcp"',
			"",
			"[mcp_servers.opaline.http_headers]",
			'Authorization = "Bearer key"',
			"",
			"# local tools",
			"[mcp_servers.local]",
			'url = "http://127.0.0.1:4790/api/mcp"',
			"",
			"[profiles.fast]",
			'model = "gpt-5.2-mini"',
			"",
		].join("\n"),
	);

	const report = runRetire(home, cwd);

	expect(read(configPath)).toBe(
		[
			"# my Codex settings",
			'model = "gpt-5.2" # pinned',
			'notify = ["terminal-notifier", "-title", "Codex"]',
			"",
			"# local tools",
			"[mcp_servers.local]",
			'url = "http://127.0.0.1:4790/api/mcp"',
			"",
			"[profiles.fast]",
			'model = "gpt-5.2-mini"',
			"",
		].join("\n"),
	);
	expect(report.changed).toEqual([
		{
			path: configPath,
			what: "the notify hook (your previous notify command is back) and 1 Opaline cloud MCP server",
		},
	]);
});

test("unwraps Opaline from inside Computer Use's notify chain", () => {
	const configPath = join(home, ".codex", "config.toml");
	const inner = [
		"opaline",
		"hooks",
		"codex",
		"turn-complete",
		"--previous-notify",
		JSON.stringify(["say", "done"]),
	];
	write(
		configPath,
		`notify = ${JSON.stringify(["/Apps/SkyComputerUseClient", "turn-ended", "--previous-notify", JSON.stringify(inner)])}\n`,
	);
	runRetire(home, cwd);
	expect(parseTOML(read(configPath))).toEqual({
		notify: [
			"/Apps/SkyComputerUseClient",
			"turn-ended",
			"--previous-notify",
			JSON.stringify(["say", "done"]),
		],
	});

	for (const legacy of [
		["rudel", "hooks", "codex", "turn-complete"],
		["rudel hooks codex turn-complete"],
	]) {
		write(
			configPath,
			`approval_policy = "never"\nnotify = ${JSON.stringify(legacy)}\n`,
		);
		runRetire(home, cwd);
		expect(read(configPath)).toBe('approval_policy = "never"\n');
	}
});

test("removes Opaline's cloud MCP servers from Claude Code's state and nothing else", () => {
	const statePath = join(home, ".claude.json");
	write(statePath, {
		numStartups: 12,
		mcpServers: {
			opaline: {
				type: "http",
				url: "https://opaline.so/api/mcp",
				headers: { Authorization: "Bearer k" },
			},
			mine: { type: "http", url: "https://example.com/api/mcp" },
		},
		projects: {
			"/repo": {
				mcpServers: {
					rudel: { type: "http", url: "https://app.rudel.ai/api/mcp" },
				},
				history: [],
			},
		},
	});
	runRetire(home, cwd);
	expect(readJson(statePath)).toEqual({
		numStartups: 12,
		mcpServers: { mine: { type: "http", url: "https://example.com/api/mcp" } },
		projects: { "/repo": { mcpServers: {}, history: [] } },
	});
});

test("cleans project hooks in every folder the CLI managed", () => {
	const project = join(home, "code", "app");
	write(join(project, ".claude", "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{ type: "command", command: "opaline hooks claude session-end" },
					],
				},
			],
		},
		permissions: { allow: ["Bash(ls)"] },
	});
	write(join(home, ".rudel", "auto-upload.json"), {
		version: 1,
		repositories: {
			app: {
				label: "app",
				sources: ["claude_code"],
				enabled: true,
				name: "app",
				paths: [project],
			},
		},
	});
	write(join(cwd, ".claude", "settings.json"), {
		hooks: {
			SessionStart: [
				{
					hooks: [
						{ type: "command", command: "rudel hooks claude session-start" },
					],
				},
			],
		},
	});
	runRetire(home, cwd);
	expect(readJson(join(project, ".claude", "settings.json"))).toEqual({
		permissions: { allow: ["Bash(ls)"] },
	});
	expect(readJson(join(cwd, ".claude", "settings.json"))).toEqual({});
});

test("is idempotent", () => {
	const configDir = join(home, ".rudel");
	seedState(configDir);
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(configDir, "session-end"),
						},
					],
				},
			],
		},
	});
	runRetire(home, cwd);
	const settings = read(join(home, ".claude", "settings.json"));
	const second = runRetire(home, cwd);
	expect(read(join(home, ".claude", "settings.json"))).toBe(settings);
	expect(second.changed).toEqual([]);
	expect(second.signedOut).toEqual([]);
	expect(second.stateRemoved).toEqual([]);
	expect(second.skipped).toEqual([]);
});

test("leaves files it cannot parse exactly as they are", () => {
	const settingsPath = join(home, ".claude", "settings.json");
	const configPath = join(home, ".codex", "config.toml");
	const badJson =
		'{ "hooks": { "SessionEnd": [ "opaline hooks claude session-end" ,, ] }';
	const badToml =
		'notify = ["opaline", "hooks", "codex", "turn-complete"\nmodel = ';
	write(settingsPath, badJson);
	write(configPath, badToml);
	const chain = join(home, "codex-chain", "config.toml");
	const badChain = `notify = ${JSON.stringify(["opaline", "hooks", "codex", "turn-complete", "--previous-notify", "not json"])}\n`;
	write(chain, badChain);

	const report = runRetire(home, cwd, {
		env: testEnv(home, { CODEX_HOME: join(home, "codex-chain") }),
	});

	expect(read(settingsPath)).toBe(badJson);
	expect(read(configPath)).toBe(badToml);
	expect(read(chain)).toBe(badChain);
	expect(report.skipped).toEqual([
		{ path: settingsPath, reason: "unparseable" },
		{ path: configPath, reason: "unparseable" },
		{ path: chain, reason: "unparseable" },
	]);
});

test("writes through a symlinked settings file instead of replacing the link", () => {
	const real = join(home, "dotfiles", "claude-settings.json");
	write(real, {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{ type: "command", command: "opaline hooks claude session-end" },
					],
				},
			],
		},
	});
	mkdirSync(join(home, ".claude"), { recursive: true });
	symlinkSync(real, join(home, ".claude", "settings.json"));
	runRetire(home, cwd);
	expect(
		lstatSync(join(home, ".claude", "settings.json")).isSymbolicLink(),
	).toBe(true);
	expect(readlinkSync(join(home, ".claude", "settings.json"))).toBe(real);
	expect(readJson(real)).toEqual({});
});

test("signs out first and leaves settings alone while another Opaline process holds the lock", () => {
	const configDir = join(home, ".rudel");
	seedState(configDir);
	const lock = join(configDir, ".auto-upload-lock");
	mkdirSync(lock);
	writeFileSync(join(lock, `${process.pid}-0000-aaaa`), "");
	const settings = {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{ type: "command", command: "opaline hooks claude session-end" },
					],
				},
			],
		},
	};
	write(join(home, ".claude", "settings.json"), settings);

	const report = runRetire(home, cwd);

	expect(report.busy).toBe(true);
	expect(existsSync(join(configDir, CREDENTIALS_FILE))).toBe(false);
	expect(readJson(join(home, ".claude", "settings.json"))).toEqual(settings);
	expect(existsSync(join(configDir, "failed-uploads.json"))).toBe(true);
});

test("a dead lock owner does not block cleanup", () => {
	const configDir = join(home, ".rudel");
	seedState(configDir);
	const lock = join(configDir, ".auto-upload-lock");
	mkdirSync(lock);
	writeFileSync(join(lock, "999999-0000-aaaa"), "");
	const report = runRetire(home, cwd);
	expect(report.busy).toBe(false);
	expect(existsSync(lock)).toBe(false);
	expect(existsSync(join(configDir, "failed-uploads.json"))).toBe(false);
});

test("forwards this turn's Codex notification to the command Opaline wrapped", async () => {
	const out = join(cwd, "forwarded.txt");
	const script = join(cwd, "notify.mjs");
	write(
		script,
		`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify({ arg: process.argv.at(-1), env: process.env.OPALINE_CODEX_NOTIFY_FORWARDED }));\n`,
	);
	const payload = JSON.stringify({
		type: "agent-turn-complete",
		"thread-id": "t1",
		cwd,
	});
	const stdout = await runInProcess(
		[
			"hooks",
			"codex",
			"turn-complete",
			"--previous-notify",
			JSON.stringify([process.execPath, script]),
			payload,
		],
		home,
		cwd,
	);
	expect(stdout).toBe("");
	expect(readJson(out)).toEqual({ arg: payload, env: "1" });
});

test("prints the version, explains itself on --help, and stays quiet when not interactive", async () => {
	const { version } = (
		await import("../../package.json", { with: { type: "json" } })
	).default;
	expect(await runInProcess(["--version"], home, cwd)).toBe(`${version}\n`);
	expect(await runInProcess(["upload"], home, cwd)).toBe("");
	expect(
		await runInProcess(["hooks", "claude", "session-start"], home, cwd, {
			interactive: true,
		}),
	).toBe("");
	const help = await runInProcess(["--help"], home, cwd);
	expect(help).toContain("Opaline's cloud has shut down");
	expect(help).toContain("https://opaline.evren.so");
	expect(process.exitCode).toBe(0);
});

test("reports what it removed in a terminal", async () => {
	const configDir = join(home, ".rudel");
	seedState(configDir);
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(configDir, "session-end"),
						},
					],
				},
			],
		},
	});
	const output = await runInProcess([], home, cwd, { interactive: true });
	expect(output).toContain(
		"✓ Signed out and removed the saved sign-in in ~/.rudel",
	);
	expect(output).toContain(
		"✓ Removed 1 automatic-upload hook from ~/.claude/settings.json",
	);
	expect(output).toContain("https://opaline.evren.so");
	expect(await runInProcess([], home, cwd, { interactive: true })).toContain(
		"Nothing from Opaline was left on this computer.",
	);
});
