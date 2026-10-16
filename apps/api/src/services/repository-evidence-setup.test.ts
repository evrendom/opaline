import { describe, expect, test } from "bun:test";
import { setupManifest } from "../__tests__/helpers/setup-manifest.js";
import { readRepositoryEvidenceSetup } from "./repository-evidence-setup.js";

describe("repository evidence setup", () => {
	test("keeps the setup files of every root, and the repository's agent files only", () => {
		const setup = readRepositoryEvidenceSetup(setupManifest());

		expect(setup.capture_reason).toBe("");
		expect(setup.context_roots.map((root) => root[0])).toEqual([
			"repository",
			"claude-user-home",
			"claude-plugins",
			"claude-project-memory",
			"claude-tool-results",
		]);
		expect(setup.context_roots[0]).toEqual([
			"repository",
			"repository",
			"repository",
			"collected",
			"/Users/dev/code/shop",
		]);
		expect(
			setup.setup_files.map(([root, path, , kind, hash]) => [
				root,
				path,
				kind,
				hash.slice(0, 4),
			]),
		).toEqual([
			["repository", "CLAUDE.md", "sha256-source", "dddd"],
			["repository", ".claude/skills/deploy/SKILL.md", "git-sha1", "eeee"],
			["claude-user-home", "settings.json", "sha256-source", "dddd"],
			["claude-user-home", "commands/ship.md", "sha256-source", "dddd"],
			[
				"claude-plugins",
				"acme/review/1.0.0/skills/review/SKILL.md",
				"omitted",
				"",
			],
			["claude-project-memory", "MEMORY.md", "sha256-source", "dddd"],
		]);
		expect(setup.setup_files[0]?.[5]).toBe(10);
		expect(setup.setup_files[0]?.[6]).toBe("2026-10-15 08:00:00.000");
	});

	test("flattens hooks, permission rules, plugins, MCP servers and settings of each layer", () => {
		const setup = readRepositoryEvidenceSetup(setupManifest());

		expect(setup.setup_settings).toEqual([
			// The user layer: its hooks come from the per-hook summary below.
			[
				"claude_code",
				"user",
				"~/.claude/settings.json",
				"plugin",
				"review@acme",
				"true",
			],
			[
				"claude_code",
				"user",
				"~/.claude/settings.json",
				"setting",
				"model",
				"opus",
			],
			[
				"claude_code",
				"user-local",
				"~/.claude/settings.local.json",
				"permission",
				"allow",
				"Bash(git status:*)",
			],
			[
				"claude_code",
				"project",
				".claude/settings.json",
				"hook",
				"Stop",
				'{"matcher":"","type":"command","command":"bun run check","timeoutSeconds":60,"async":null}',
			],
			[
				"claude_code",
				"project",
				".claude/settings.json",
				"permission",
				"deny",
				"Bash(rm -rf:*)",
			],
			[
				"claude_code",
				"project",
				".claude/settings.json",
				"setting",
				"permissions.defaultMode",
				"acceptEdits",
			],
			[
				"claude_code",
				"user",
				"~/.claude/settings.json",
				"hook",
				"PreToolUse",
				'{"matcher":"Bash","type":"command","command":"guard.sh","timeoutSeconds":30,"async":null}',
			],
			[
				"claude_code",
				"user",
				"~/.claude.json",
				"mcp_server",
				"linear",
				'{"name":"linear","transport":"http","command":null,"args":[],"url":"https://mcp.linear.app/mcp","enabled":null,"envKeys":[],"headerKeys":[],"bearerTokenEnvVar":null}',
			],
			[
				"codex",
				"user",
				"$CODEX_HOME/config.toml",
				"plugin",
				"github@openai-curated",
				"false",
			],
			[
				"codex",
				"user",
				"$CODEX_HOME/config.toml",
				"setting",
				"approvalPolicy",
				"on-request",
			],
			[
				"codex",
				"user",
				"$CODEX_HOME/config.toml",
				"setting",
				"features.web_search",
				"true",
			],
		]);
	});

	test("records runtime versions the CLI found and the capture reason", () => {
		const setup = readRepositoryEvidenceSetup(
			setupManifest({ captureReason: "task-output-sweep" }),
		);

		expect(setup.capture_reason).toBe("task-output-sweep");
		expect(setup.runtime_versions).toEqual([
			["os.platform", "darwin"],
			["os.release", "25.3.0"],
			["os.arch", "arm64"],
			["cli.runtime", "node"],
			["cli.version", "24.14.1"],
			["tools.node", "24.14.1"],
			["tools.bun", "1.3.1"],
			["tools.git", "2.51.0"],
			["agentHost.name", "claude-code"],
			["agentHost.version", "2.1.296"],
		]);
	});

	test("an older manifest or an unexpected shape records nothing, and never throws", () => {
		expect(readRepositoryEvidenceSetup({ contextIndex: {} })).toEqual({
			capture_reason: "",
			context_roots: [],
			setup_files: [],
			setup_settings: [],
			runtime_versions: [],
		});
		const odd = readRepositoryEvidenceSetup({
			roots: [null, { id: "repository" }],
			entries: [{ kind: "file", rootId: "repository", path: "AGENTS.md" }],
			userConfiguration: {
				claude: { settingsLayers: "x", hooks: [{}], mcpServers: [1] },
				codex: [],
			},
			runtime: { os: "linux" },
		});
		expect(odd.context_roots).toEqual([["repository", "", "", "", ""]]);
		// No categories: not a repository setup file.
		expect(odd.setup_files).toEqual([]);
		expect(odd.setup_settings).toEqual([]);
		expect(odd.runtime_versions).toEqual([]);
	});
});
