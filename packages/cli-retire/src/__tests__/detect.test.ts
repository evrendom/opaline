import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findLeftovers, hasLeftovers } from "../detect.js";

// Every path here lives in a throwaway home; nothing is copied from the
// machine running the tests.
let root: string;
let home: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "opaline-detect-")));
	home = join(root, "home");
	mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string | object): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		typeof content === "string"
			? content
			: `${JSON.stringify(content, null, 2)}\n`,
	);
}

function detect(env: Record<string, string> = {}) {
	return findLeftovers({ env: { HOME: home, ...env }, home });
}

const runtimeHook = (configDir: string) =>
	`'/usr/local/bin/node' '${join(configDir, "runtime", "cli.js")}' hooks claude session-end`;

const RELEASED_RUNTIME = `var package_default = {\n  name: "@opalinehq/cli",\n  version: "0.17.1",\n};\n`;

/** What the Mac app writes for itself: a local plugin with its own hooks and MCP. */
function seedAppPlugin(): void {
	write(join(home, ".claude", "settings.json"), {
		enabledPlugins: { "opaline@opaline-local": true },
		extraKnownMarketplaces: {
			"opaline-local": {
				source: { source: "directory", path: join(home, ".opaline") },
			},
		},
		hooks: {
			Stop: [
				{
					hooks: [
						{
							type: "command",
							command: `"${join(home, ".opaline", "hook.sh")}" claude`,
						},
					],
				},
			],
		},
	});
	write(
		join(
			home,
			".opaline",
			"marketplace",
			"opaline-claude",
			"hooks",
			"hooks.json",
		),
		{
			hooks: {
				SessionEnd: [
					{
						hooks: [
							{
								type: "command",
								command: `"${join(home, ".opaline", "hook.sh")}" claude`,
							},
						],
					},
				],
			},
		},
	);
	write(join(home, ".claude.json"), {
		mcpServers: {
			opaline: { type: "http", url: "http://127.0.0.1:4100/api/mcp" },
		},
	});
	write(
		join(home, ".codex", "config.toml"),
		'notify = ["/Applications/Opaline.app/hook", "codex"]\n\n[mcp_servers.opaline]\nurl = "http://127.0.0.1:4100/api/mcp"\n',
	);
	write(join(home, ".opaline", "server", "data.json"), "{}");
}

test("a Mac with only the app's own plugin, hooks and MCP has no leftovers", () => {
	seedAppPlugin();
	const leftovers = detect();
	expect(leftovers).toEqual({
		claudeHooks: [],
		codexNotify: [],
		cloudMcpServers: [],
		credentials: [],
	});
	expect(hasLeftovers(leftovers)).toBe(false);
});

test("finds the CLI's hooks in global Claude Code settings, current and legacy", () => {
	const settings = join(home, ".claude", "settings.json");
	write(settings, {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{ type: "command", command: runtimeHook(join(home, ".rudel")) },
					],
				},
			],
		},
	});
	const custom = join(root, "claude-config");
	write(join(custom, "settings.json"), {
		hooks: {
			SessionEnd: [
				{
					hooks: [
						{ type: "command", command: "rudel hooks claude session-end" },
					],
				},
			],
		},
	});
	const leftovers = detect({ CLAUDE_CONFIG_DIR: custom });
	expect(leftovers.claudeHooks).toEqual([
		settings,
		join(custom, "settings.json"),
	]);
	expect(hasLeftovers(leftovers)).toBe(true);
});

test("finds the CLI inside Codex's notify, also when Computer Use wraps it", () => {
	const codexHome = join(root, "codex");
	const cli = [
		"/usr/local/bin/node",
		join(home, ".rudel", "runtime", "cli.js"),
		"hooks",
		"codex",
		"turn-complete",
	];
	write(
		join(codexHome, "config.toml"),
		`notify = ${JSON.stringify([
			"/Applications/Codex.app/SkyComputerUseClient",
			"turn-ended",
			"--previous-notify",
			JSON.stringify(cli),
		])}\n`,
	);
	expect(detect({ CODEX_HOME: codexHome }).codexNotify).toEqual([
		join(codexHome, "config.toml"),
	]);
});

test("finds cloud MCP servers in Claude Code's state and Codex's config", () => {
	write(join(home, ".claude.json"), {
		projects: {
			"/work": {
				mcpServers: { opaline: { url: "https://app.opaline.so/api/mcp" } },
			},
		},
	});
	write(
		join(home, ".codex", "config.toml"),
		'[mcp_servers.rudel]\nurl = "https://rudel.ai/api/mcp"\n',
	);
	expect(detect().cloudMcpServers).toEqual([
		join(home, ".codex", "config.toml"),
		join(home, ".claude.json"),
	]);
});

test("finds the saved sign-in in the configured and the hook's config directory", () => {
	const configured = join(root, "opaline-config");
	write(join(configured, "credentials.json"), { token: "secret" });
	const elsewhere = join(root, "elsewhere");
	write(join(elsewhere, "credentials.json"), { token: "secret" });
	write(join(elsewhere, "runtime", "cli.js"), RELEASED_RUNTIME);
	const unrelated = join(root, "unrelated");
	write(join(unrelated, "credentials.json"), { token: "not the CLI's" });
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			Stop: [
				{
					hooks: [
						{ type: "command", command: runtimeHook(elsewhere) },
						{ type: "command", command: runtimeHook(unrelated) },
					],
				},
			],
		},
	});
	expect(detect({ OPALINE_CONFIG_DIR: configured }).credentials).toEqual([
		join(configured, "credentials.json"),
		join(elsewhere, "credentials.json"),
	]);
});

test("reads without writing, locking or creating anything", () => {
	const configDir = join(home, ".rudel");
	write(join(configDir, "credentials.json"), { token: "secret" });
	const settings = join(home, ".claude", "settings.json");
	write(settings, {
		hooks: {
			Stop: [{ hooks: [{ type: "command", command: runtimeHook(configDir) }] }],
		},
	});
	const before = readFileSync(settings, "utf8");
	expect(hasLeftovers(detect())).toBe(true);
	expect(readFileSync(settings, "utf8")).toBe(before);
	expect(readdirSync(configDir)).toEqual(["credentials.json"]);
	expect(readdirSync(join(home, ".claude"))).toEqual(["settings.json"]);
});
