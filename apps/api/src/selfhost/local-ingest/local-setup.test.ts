import { expect, test } from "bun:test";
import { RepositoryEvidenceIndexRowSchema } from "../../services/repository-evidence-index.service.js";
import {
	LOCAL_SETUP_CAPTURE_REASON,
	localSetupRow,
	readLocalSetupManifest,
} from "./local-setup.js";

const paths = {
	home: "/Users/dev",
	codexHome: "/Users/dev/.codex",
	managedSettings:
		"/Library/Application Support/ClaudeCode/managed-settings.json",
};

const files: Record<string, string> = {
	"/Users/dev/.claude/settings.json": JSON.stringify({
		model: "opus",
		autoCompactEnabled: false,
		env: {
			ANTHROPIC_AUTH_TOKEN: "sk-ant-api03-secret",
			BASH_MAX_TIMEOUT_MS: "600000",
		},
		hooks: {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [{ type: "command", command: "guard.sh", timeout: 5 }],
				},
			],
		},
		permissions: { allow: ["Bash(git status:*)"], defaultMode: "acceptEdits" },
		enabledPlugins: { "opaline@opaline": true },
	}),
	"/Users/dev/code/shop/.claude/settings.json": JSON.stringify({
		model: "sonnet",
	}),
	"/Users/dev/.claude.json": JSON.stringify({
		mcpServers: {
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: { Authorization: "Bearer x" },
			},
		},
		projects: {
			"/Users/dev/code/shop": {
				mcpServers: {
					db: { command: "pg-mcp", env: { PGPASSWORD: "hunter2" } },
				},
			},
			"/Users/dev/other": { mcpServers: { elsewhere: { command: "x" } } },
		},
	}),
	"/Users/dev/.codex/config.toml": [
		'model = "gpt-5.1"',
		'approval_policy = "never"',
		'openai_base_url = "https://proxy.example.com"',
		"[features]",
		"web_search = true",
		"[mcp_servers.figma]",
		'command = "figma-mcp"',
		'env = { FIGMA_TOKEN = "figd_secret" }',
		'[plugins."github@openai-curated"]',
		"enabled = false",
	].join("\n"),
};

const read = async (path: string) => files[path] ?? null;

test("the settings files on this machine become the setup of an imported session, read at import time", async () => {
	const manifest = await readLocalSetupManifest(
		"/Users/dev/code/shop",
		paths,
		read,
	);
	const row = RepositoryEvidenceIndexRowSchema.parse(
		localSetupRow(
			{
				organizationId: "ws-1",
				userId: "u-1",
				sessionId: "s-1",
				source: "claude_code",
				projectPath: "/Users/dev/code/shop",
				repository: "github.com/acme/shop",
			},
			manifest,
			new Date("2026-11-16T10:00:00.000Z"),
		),
	);
	expect(row.capture_reason).toBe(LOCAL_SETUP_CAPTURE_REASON);
	expect(row.setup_files).toEqual([]);
	expect(row.context_roots.map((root) => root[0])).toEqual([
		"claude-user-home",
		"codex-user-home",
		"repository",
	]);
	const items = row.setup_settings.map(
		([agent, scope, path, kind, name, value]) =>
			`${agent} ${scope} ${path} ${kind} ${name} = ${value}`,
	);
	expect(items).toEqual(
		expect.arrayContaining([
			"claude_code user ~/.claude/settings.json setting model = opus",
			"claude_code user ~/.claude/settings.json setting autoCompactEnabled = false",
			"claude_code user ~/.claude/settings.json setting env.ANTHROPIC_AUTH_TOKEN = [REDACTED]",
			"claude_code user ~/.claude/settings.json setting env.BASH_MAX_TIMEOUT_MS = 600000",
			"claude_code user ~/.claude/settings.json setting permissions.defaultMode = acceptEdits",
			"claude_code user ~/.claude/settings.json permission allow = Bash(git status:*)",
			"claude_code user ~/.claude/settings.json plugin opaline@opaline = true",
			'claude_code user ~/.claude/settings.json hook PreToolUse = {"matcher":"Bash","type":"command","command":"guard.sh","timeoutSeconds":5,"async":null}',
			"claude_code project .claude/settings.json setting model = sonnet",
			"codex user $CODEX_HOME/config.toml setting approvalPolicy = never",
			"codex user $CODEX_HOME/config.toml setting model = gpt-5.1",
			"codex user $CODEX_HOME/config.toml setting features.web_search = true",
			"codex user $CODEX_HOME/config.toml plugin github@openai-curated = false",
		]),
	);
	const text = JSON.stringify(row.setup_settings);
	for (const secret of [
		"sk-ant-api03-secret",
		"hunter2",
		"figd_secret",
		"Bearer x",
	])
		expect(text).not.toContain(secret);
	expect(text).toContain('"db"');
	expect(text).not.toContain("elsewhere");
});

test("a session imported again replaces its capture: the capture id depends on the session only", async () => {
	const manifest = await readLocalSetupManifest("", paths, async () => null);
	const session = {
		organizationId: "ws-1",
		userId: "u-1",
		sessionId: "s-1",
		source: "codex" as const,
		projectPath: "",
		repository: "",
	};
	const first = localSetupRow(session, manifest, new Date(1_000));
	const later = localSetupRow(session, manifest, new Date(2_000));
	expect(first.context_id).toBe(later.context_id);
	expect(first.context_id).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
	);
	expect(Number(later.index_version)).toBeGreaterThan(
		Number(first.index_version),
	);
	expect(first.setup_settings).toEqual([]);
	expect(first.context_roots).toEqual([
		[
			"claude-user-home",
			"user",
			"agent-config",
			"collected",
			"/Users/dev/.claude",
		],
	]);
});
