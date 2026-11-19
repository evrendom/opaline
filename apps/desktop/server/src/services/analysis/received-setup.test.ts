import { describe, expect, test } from "bun:test";
import {
	parseGitStatus,
	type ReceivedSetupInput,
	receivedSetupRows,
	repositoryKey,
	type SetupReception,
	setupFileIdentity,
} from "./received-setup.js";

const member = { source: "claude_code", memberId: "u1" } as const;
const repo = { ...member, repository: "github.com/acme/shop" };

describe("setup file identity", () => {
	test("the same file in two members' clones, a worktree and a subagent worktree is one setup file", () => {
		const identities = [
			setupFileIdentity(
				{
					kind: "skill_body",
					path: "/Users/ana/code/shop/.claude/skills/fix-tests/SKILL.md",
					name: "fix-tests",
					cwd: "/Users/ana/code/shop",
				},
				repo,
			),
			setupFileIdentity(
				{
					kind: "skill_body",
					path: "/home/ben/src/shop-wt-login/.claude/skills/fix-tests/SKILL.md",
					name: "fix-tests",
					cwd: "/home/ben/src/shop-wt-login",
				},
				{ ...repo, memberId: "u2" },
			),
			setupFileIdentity(
				{
					kind: "skill_body",
					path: "/Users/ana/code/shop/.claude/worktrees/login/.claude/skills/fix-tests/SKILL.md",
					name: "fix-tests",
					cwd: "/Users/ana/code/shop",
				},
				repo,
			),
		];
		for (const identity of identities)
			expect(identity).toEqual({
				setupFile:
					"repository:github.com/acme/shop:.claude/skills/fix-tests/SKILL.md",
				scope: "repository",
				owner: "github.com/acme/shop",
				path: ".claude/skills/fix-tests/SKILL.md",
			});
	});

	test("a plugin's file is named by plugin and marketplace across versions and machines", () => {
		const of = (path: string) =>
			setupFileIdentity(
				{ kind: "skill_body", path, name: "brainstorming", cwd: "/repo" },
				repo,
			).setupFile;
		expect(
			of(
				"/Users/ana/.claude/plugins/cache/tools-market/superpowers/5.1.0/skills/brainstorming/SKILL.md",
			),
		).toBe("plugin:superpowers@tools-market:skills/brainstorming/SKILL.md");
		expect(
			of(
				"D:\\Users\\ben\\.claude\\plugins\\cache\\tools-market\\superpowers\\6.2.0\\skills\\brainstorming\\SKILL.md",
			),
		).toBe("plugin:superpowers@tools-market:skills/brainstorming/SKILL.md");
		expect(
			of(
				"/home/ben/.claude/plugins/marketplaces/tools-market/plugins/superpowers/skills/brainstorming/SKILL.md",
			),
		).toBe("plugin:superpowers@tools-market:skills/brainstorming/SKILL.md");
	});

	test("personal setup is the member's, by its path in their home; elsewhere by its machine path", () => {
		expect(
			setupFileIdentity(
				{
					kind: "instructions",
					path: "/home/ana/.claude/CLAUDE.md",
					name: "",
					cwd: "/home/ana/shop",
				},
				repo,
			).setupFile,
		).toBe("member:u1:~/.claude/CLAUDE.md");
		// Without a repository the session's own files are personal too.
		expect(
			setupFileIdentity(
				{
					kind: "instructions",
					path: "/home/ana/shop/CLAUDE.md",
					name: "",
					cwd: "/home/ana/shop",
				},
				{ ...member, repository: null },
			).setupFile,
		).toBe("member:u1:~/shop/CLAUDE.md");
		expect(
			setupFileIdentity(
				{
					kind: "skill_body",
					path: "/nix/store/abc-skills/review/SKILL.md",
					name: "review",
					cwd: "/home/ana/shop",
				},
				repo,
			).setupFile,
		).toBe("member:u1:/nix/store/abc-skills/review/SKILL.md");
	});

	test("harness text and MCP instructions are named by the agent and the server", () => {
		expect(
			setupFileIdentity(
				{ kind: "system_prompt", path: "", name: "system_prompt", cwd: "/r" },
				repo,
			),
		).toEqual({
			setupFile: "harness:claude_code:system_prompt",
			scope: "harness",
			owner: "claude_code",
			path: "system_prompt",
		});
		expect(
			setupFileIdentity(
				{ kind: "mcp_instructions", path: "", name: "linear", cwd: "/r" },
				repo,
			).setupFile,
		).toBe("mcp:linear");
	});

	test("a repository is named by its remote, however it was cloned", () => {
		expect(repositoryKey("git@github.com:Acme/shop.git")).toBe(
			"github.com/Acme/shop",
		);
		expect(repositoryKey("https://GitHub.com/Acme/shop")).toBe(
			"github.com/Acme/shop",
		);
		expect(repositoryKey("")).toBeNull();
	});
});

describe("git status", () => {
	test("reads the changed paths, renames and untracked directories, and whether it was cut", () => {
		const status = parseGitStatus(
			'This is the git status at the start of the conversation.\n\nCurrent branch: main\n\nStatus:\n M CLAUDE.md\nR  old.md -> docs/new.md\n?? .claude/skills/draft/\n M "docs/r\\303\\251sum\\303\\251 notes.md"\n\nRecent commits:\nabc fix',
		);
		expect(status).toEqual({
			paths: [
				"CLAUDE.md",
				"docs/new.md",
				".claude/skills/draft/",
				"docs/résumé notes.md",
			],
			complete: true,
		});
		expect(
			parseGitStatus(
				'Status:\n M a.md\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)',
			)?.complete,
		).toBe(false);
		expect(parseGitStatus("Status:\n(clean)\n\nRecent commits:\nabc")).toEqual({
			paths: [],
			complete: true,
		});
		expect(parseGitStatus("Current branch: main")).toBeNull();
	});
});

const RUNS: ReceivedSetupInput["runs"] = [
	{
		agentId: "",
		turnIdx: 1,
		startRecord: 10,
		endRecord: 20,
		runId: "run-1",
		startedMs: 1_000,
	},
	{
		agentId: "",
		turnIdx: 2,
		startRecord: 20,
		endRecord: 40,
		runId: "run-2",
		startedMs: 2_000,
	},
];

function reception(
	record: number,
	entries: SetupReception["entries"],
	options: { agentId?: string; replayed?: boolean } = {},
): SetupReception {
	return {
		agentId: options.agentId ?? "",
		record,
		block: 0,
		atMs: record * 10,
		replayed: options.replayed ?? false,
		entries,
	};
}

const claudeMd = (sha256: string) => ({
	kind: "instructions" as const,
	path: "/home/ana/shop/CLAUDE.md",
	name: "",
	cwd: "/home/ana/shop",
	sha256,
	chars: 10,
});

describe("received setup of each run", () => {
	test("setup received before a run stays with every later run of its stream until a newer version replaces it", () => {
		const rows = receivedSetupRows({
			runs: RUNS,
			receptions: [
				reception(2, [claudeMd("a".repeat(64))]),
				reception(25, [claudeMd("b".repeat(64))]),
				// Another stream's setup is not this stream's, and setup a forked
				// session replays from its parent is its parent's.
				reception(3, [claudeMd("c".repeat(64))], { agentId: "agent-1" }),
				reception(4, [claudeMd("d".repeat(64))], { replayed: true }),
			],
			compactions: [{ agentId: "", record: 22 }],
			edits: [],
			gitStatus: null,
			context: repo,
		});
		expect(
			rows.map((row) => [
				row.runId,
				row.version.slice(0, 1),
				row.carried,
				row.compactedSince,
			]),
		).toEqual([
			["run-1", "a", true, false],
			["run-2", "a", true, true],
			["run-2", "b", false, false],
		]);
		expect(rows[0]).toMatchObject({
			setupFile: "repository:github.com/acme/shop:CLAUDE.md",
			recordedPath: "/home/ana/shop/CLAUDE.md",
			record: 2,
			atMs: 20,
			uncommitted: null,
			versionName: "aaaaaaaaaaaa",
		});
	});

	test("a version the session's git status lists as changed, or the session edited first, is uncommitted and named after the member", () => {
		const input = (
			gitStatus: string | null,
			edits: ReceivedSetupInput["edits"] = [],
		) =>
			receivedSetupRows({
				runs: RUNS.slice(0, 1),
				receptions: [reception(12, [claudeMd("e".repeat(64))])],
				compactions: [],
				edits,
				gitStatus: gitStatus === null ? null : parseGitStatus(gitStatus),
				context: repo,
			})[0];
		expect(input("Status:\n M CLAUDE.md\n")).toMatchObject({
			uncommitted: true,
			versionName: "eeeeeeeeeeee uncommitted by u1",
		});
		expect(input("Status:\n M src/app.ts\n")).toMatchObject({
			uncommitted: false,
			versionName: "eeeeeeeeeeee",
		});
		expect(
			input(
				"Status:\n M src/app.ts\n... (truncated because it exceeds 2k characters)",
			)?.uncommitted,
		).toBeNull();
		expect(
			input(null, [{ path: "/home/ana/shop/CLAUDE.md", atMs: 100 }])
				?.uncommitted,
		).toBe(true);
		expect(
			input(null, [{ path: "/home/ana/shop/CLAUDE.md", atMs: 500 }])
				?.uncommitted,
		).toBeNull();
	});
});
