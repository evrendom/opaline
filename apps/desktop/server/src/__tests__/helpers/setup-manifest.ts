/**
 * A session evidence manifest as the CLI writes it (CLI
 * local-context-source/types.ts), trimmed to what the evidence index reads:
 * its context index and its setup.
 */
const HASH = "d".repeat(64);

export function setupManifest(overrides: Record<string, unknown> = {}) {
	const file = (
		rootId: string,
		path: string,
		categories: string[],
		hash: unknown = {
			status: "available",
			algorithm: "sha256",
			value: HASH,
			bytesHashed: 10,
			scope: "source",
		},
	) => ({
		rootId,
		path,
		name: path.split("/").at(-1),
		parentPath: null,
		kind: "file",
		mode: 0o644,
		modifiedAtMs: Date.UTC(2026, 9, 15, 8, 0, 0),
		categories,
		gitProvenance: "tracked",
		evidenceReason: null,
		size: 10,
		hash,
		content: { status: "omitted", reason: "metadata-only", detail: null },
	});
	return {
		roots: [
			{
				id: "repository",
				origin: "repository",
				scope: "repository",
				status: "collected",
				absolutePath: "/Users/dev/code/shop",
			},
			{
				id: "claude-user-home",
				origin: "user",
				scope: "agent-config",
				status: "collected",
				absolutePath: "/Users/dev/.claude",
			},
			{
				id: "claude-plugins",
				origin: "user",
				scope: "skills",
				status: "collected",
				absolutePath: "/Users/dev/.claude/plugins/cache",
			},
			{
				id: "claude-project-memory",
				origin: "user",
				scope: "custom",
				status: "collected",
				absolutePath: "/Users/dev/.claude/projects/-Users-dev-code-shop/memory",
			},
			{
				id: "claude-tool-results",
				origin: "user",
				scope: "custom",
				status: "collected",
				absolutePath: "/Users/dev/.claude/projects/x/session/tool-results",
			},
		],
		entries: [
			file("repository", "CLAUDE.md", [
				"agent-config",
				"document",
				"instruction",
				"markdown",
			]),
			file("repository", "src/index.ts", ["source"]),
			file("repository", "docs/plan.md", ["markdown", "plan-candidate"]),
			file(
				"repository",
				".claude/skills/deploy/SKILL.md",
				["agent-config", "markdown", "skill-definition", "skill-resource"],
				{
					status: "git-object",
					algorithm: "git-sha1",
					value: "e".repeat(40),
					bytesHashed: 10,
				},
			),
			file("repository", ".claude/skills/deploy/notes.md", [
				"agent-config",
				"markdown",
				"skill-resource",
			]),
			file("claude-user-home", "settings.json", [
				"agent-config",
				"config",
				"hook-config",
			]),
			file("claude-user-home", "commands/ship.md", ["document", "markdown"]),
			file(
				"claude-plugins",
				"acme/review/1.0.0/skills/review/SKILL.md",
				["markdown", "skill-definition", "skill-resource"],
				{ status: "omitted", reason: "hash-total-cap" },
			),
			file("claude-project-memory", "MEMORY.md", ["document", "markdown"]),
			file("claude-tool-results", "toolu_1.txt", ["other"]),
			{ ...file("repository", ".claude", []), kind: "directory" },
		],
		userConfiguration: {
			claude: {
				settings: { path: "~/.claude/settings.json", status: "parsed" },
				hooks: [
					{
						event: "PreToolUse",
						matcher: "Bash",
						type: "command",
						command: "guard.sh",
						timeoutSeconds: 30,
						async: null,
					},
				],
				enabledPlugins: { "review@acme": true },
				permissions: {
					defaultMode: null,
					allow: [],
					deny: [],
					ask: [],
					additionalDirectories: [],
				},
				installedPlugins: ["review@acme"],
				settingsLayers: [
					{
						scope: "user",
						path: "~/.claude/settings.json",
						status: "parsed",
						settings: {
							model: "opus",
							hooks: { PreToolUse: "[REDACTED]" },
							enabledPlugins: { "review@acme": true },
						},
					},
					{
						scope: "user-local",
						path: "~/.claude/settings.local.json",
						status: "parsed",
						settings: { permissions: { allow: ["Bash(git status:*)"] } },
					},
					{
						scope: "project",
						path: ".claude/settings.json",
						status: "parsed",
						settings: {
							permissions: {
								deny: ["Bash(rm -rf:*)"],
								defaultMode: "acceptEdits",
							},
							hooks: {
								Stop: [
									{
										matcher: "",
										hooks: [
											{
												type: "command",
												command: "bun run check",
												timeout: 60,
											},
										],
									},
								],
							},
						},
					},
					{
						scope: "project-local",
						path: ".claude/settings.local.json",
						status: "absent",
						settings: null,
					},
				],
				mcpServers: [
					{
						name: "linear",
						transport: "http",
						command: null,
						args: [],
						url: "https://mcp.linear.app/mcp",
						enabled: null,
						envKeys: [],
						headerKeys: [],
						bearerTokenEnvVar: null,
						scope: "user",
					},
				],
				stateFile: { path: "~/.claude.json", status: "parsed" },
			},
			codex: {
				config: { path: "$CODEX_HOME/config.toml", status: "parsed" },
				hooksFile: { path: "$CODEX_HOME/hooks.json", status: "absent" },
				mcpServers: [],
				notify: [],
				hooks: [],
				plugins: { "github@openai-curated": false },
				features: { web_search: true },
				apps: {},
				connectors: {},
				tools: {},
				approvalPolicy: "on-request",
				sandboxMode: null,
			},
			truncated: false,
		},
		runtime: {
			os: { platform: "darwin", release: "25.3.0", arch: "arm64" },
			cli: { runtime: "node", version: "24.14.1" },
			tools: { node: "24.14.1", bun: "1.3.1", git: "2.51.0", python: null },
			agentHost: { name: "claude-code", version: "2.1.296", originator: null },
		},
		contextIndex: { facets: [], skills: [] },
		...overrides,
	};
}
