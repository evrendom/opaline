import type { ClickHouseStatement } from "../../clickhouse.js";
import { commandColumnsSql } from "../../services/analysis/command-identity.js";

/**
 * Command identity cases taken from real production commands (paths, names
 * and ids replaced), so a rule change shows which merges it gains or loses.
 */

/** A record as `rudel.transcript_records` stores it, reduced to what command identity reads. */
export interface CommandRecord {
	readonly kind?: "tool_call" | "file_change";
	readonly tool?: string;
	readonly subtype?: string;
	readonly filePath?: string;
	readonly text: string;
	/** Default 9. */
	readonly parserVersion?: number;
}

const bash = (text: string): CommandRecord => ({ tool: "Bash", text });
/** Windows paths in these cases live on a D: drive, never a real C: one. */
const WINDOWS = "D:";
const codeMode = (text: string, parserVersion = 4): CommandRecord => ({
	tool: "exec",
	text,
	parserVersion,
});

/** Groups of records that must share one fingerprint. */
export const MERGE: readonly (readonly [string, readonly CommandRecord[]])[] = [
	[
		"output trims, status lines and the working directory",
		[
			bash('npx tsc --noEmit 2>&1 | head -5 && echo "TSC DONE"'),
			bash('npx tsc --noEmit 2>&1 | head -20 && echo "TSC_OK"'),
			bash("cd /Users/alice/golf && npx tsc --noEmit"),
		],
	],
	[
		"a scratch script run with other numbers",
		[
			bash("zsh ~/.claude/scratch/w21/cr-request-at.sh 2112 1790811210"),
			bash(
				"zsh /Users/bob/.claude/scratch/w21/cr-request-at.sh 2122 1790803890",
			),
		],
	],
	[
		"a pull request number",
		[bash("gh pr checks 32 2>&1 | head -5"), bash("gh pr checks 140")],
	],
	[
		"an exit-status echo",
		[
			bash("hms 2>&1 | tail -40"),
			bash('hms 2>&1; echo "HMS_EXIT=$?"'),
			bash("hms"),
		],
	],
	[
		"a shell wrapper and a code-mode script that runs one command",
		[
			bash("bash -lc 'git status --short'"),
			bash("cd /Users/alice/repo\ngit status --short | head -20"),
			{ tool: "exec_command", text: "git status --short" },
			codeMode(
				'text(await tools.exec_command({cmd:"git status --short","max_output_tokens":1000}));',
			),
		],
	],
	[
		"temp worktrees",
		[
			bash("git worktree remove /private/tmp/superfunctions-docs-PR-206"),
			bash("git worktree remove /private/tmp/superfunctions-docs-PR-209"),
		],
	],
	[
		"a file in another home directory",
		[
			bash("cat /Users/alice/.agents/skills/linear-loop/SKILL.md"),
			bash("cat '/home/bob/.agents/skills/linear-loop/SKILL.md'"),
			bash("cat ~/.agents/skills/linear-loop/SKILL.md"),
		],
	],
	[
		"temp files",
		[
			bash("tail -3 /tmp/postgkyl-pytest.log"),
			bash("tail -4 /private/tmp/postgkyl-pytest.log"),
			bash("tail -3 $TMPDIR/postgkyl-pytest.log"),
		],
	],
	[
		"temp directories made per run",
		[
			bash("python3 /tmp/jev-live-cancellation-rnf8ffvx/verify.py"),
			bash("python3 /tmp/jev-live-cancellation-xt3zgnrp/verify.py"),
		],
	],
	[
		"mktemp directories",
		[
			bash("cat /tmp/tmp.AbC123XyZ9/out.json"),
			bash("cat /tmp/tmp.Qw9ErT5yUi/out.json"),
		],
	],
	[
		"an agent's per-session scratchpad",
		[
			bash(
				"bash /private/tmp/claude-501/-Users-alice-proj/43bce55b-7aa7-4002-97d7-3963c1eebb96/scratchpad/poll.sh",
			),
			bash(
				"bash /tmp/claude-1000/-home-bob-dev-proj/76e28998-3060-4d63-bc94-0799c80d0e50/scratchpad/poll.sh",
			),
		],
	],
	[
		"worktree roots",
		[
			bash("git -C /Users/alice/repo/.claude/worktrees/eng-2227-links status"),
			bash("git -C /home/bob/repo/.claude/worktrees/eng-2341-fix status"),
		],
	],
	[
		"a PowerShell script by Windows path",
		[
			{
				tool: "exec_command",
				text: `& '${WINDOWS}\\Users\\carol\\AIS-OS\\working\\2026-10-02\\publish-worker-status.ps1' -Checkpoint '${WINDOWS}\\Users\\carol\\AIS-OS\\working\\2026-10-02\\worker-status.md'`,
			},
			{
				tool: "exec_command",
				text: `& '${WINDOWS}\\Users\\dave\\AIS-OS\\working\\2026-10-03\\publish-worker-status.ps1' -Checkpoint '${WINDOWS}\\Users\\dave\\AIS-OS\\working\\2026-10-03\\worker-status.md'`,
			},
		],
	],
	[
		"line ranges",
		[bash("sed -n '1,200p' README.md"), bash("sed -n '340,365p' README.md")],
	],
	[
		"commit messages",
		[
			bash('git commit -m "docs: isolate brand research from site build"'),
			bash("git commit -m 'feat(home): make Helix the default editor'"),
		],
	],
	[
		"run ids",
		[
			bash("gh run view 18273645012 --log-failed"),
			bash("gh run view 99 --log-failed"),
		],
	],
	[
		"local URLs and ports",
		[
			bash("curl -s http://127.0.0.1:8841/fun/transport/"),
			bash("curl -s http://localhost:3000/"),
		],
	],
	[
		"SHAs, UUIDs and timestamps",
		[
			bash(
				"git show 8bca346e4 --stat; ls /tmp/claude-1000/e4326d15-50c9-45c4-b89e-42a575c674d2/tasks; date -d 2026-09-29T23:26:00Z",
			),
			bash(
				"git show 1de7b3785 --stat; ls /tmp/claude-1000/74829028-9017-4495-b6d8-8af5ee63f84a/tasks; date -d 2026-10-01T02:02:00Z",
			),
		],
	],
	[
		"code-mode polls of other sessions",
		[
			codeMode(
				'text(await tools.write_stdin({session_id:40518,chars:"",yield_time_ms:1000,max_output_tokens:500}));',
				9,
			),
			codeMode(
				'text(await tools.write_stdin({session_id:90266,chars:"",yield_time_ms:1000,max_output_tokens:5000}));',
				9,
			),
		],
	],
];

/** Records that must each keep a fingerprint of their own. */
export const SEPARATE: readonly (readonly [
	string,
	readonly CommandRecord[],
])[] = [
	[
		"inline programs are code",
		[
			bash(`python3 -c "import json; print(json.load(open('a.json'))['x'])"`),
			bash('python3 -c "import sys; print(sys.version)"'),
			bash("node -e 'console.log(require(\"./package.json\").version)'"),
			bash("node -e 'process.exit(2)'"),
			{
				tool: "exec_command",
				text: "powershell.exe -NoProfile -Command 'Get-Process Obsidian'",
			},
			{
				tool: "exec_command",
				text: "powershell.exe -NoProfile -Command '$payload = @{ schemaVersion=1 }'",
			},
		],
	],
	[
		"the command ssh runs remotely",
		[
			bash("ssh -o BatchMode=yes zo 'cd /w && git diff --stat'"),
			bash("ssh -o BatchMode=yes zo 'cd /w && cat .tmp/out.json'"),
		],
	],
	[
		"API routes are relative paths",
		[
			bash("gh api repos/acme/web/actions/jobs/111207969387 --jq .status"),
			bash("gh api repos/acme/web/pulls/comments/4119374226 --jq .body"),
		],
	],
	[
		"different scripts",
		[
			bash("bash /private/tmp/claude-501/scratchpad/run_spec_review.sh 1"),
			bash("bash /private/tmp/claude-501/scratchpad/probe.sh 1"),
		],
	],
	[
		"flags and subcommands",
		[
			bash("git push origin main"),
			bash("git push --force origin main"),
			bash("bun test"),
			bash("bun run test"),
			bash("npx tsc --noEmit"),
			bash("npx tsc --noEmit -p tsconfig.json"),
		],
	],
	[
		"a command substitution runs a command",
		[
			bash("jq -c .paths openapi.json"),
			bash(
				"CODE=$(curl -sS -o openapi.json -w '%{http_code}' $API/openapi.json)\njq -c .paths openapi.json",
			),
		],
	],
	[
		"the same file name in different folders",
		[
			bash("cat /Users/alice/.agents/skills/linear-loop/SKILL.md"),
			bash("cat /Users/alice/.agents/skills/finalizer/SKILL.md"),
			bash("tail -3 /tmp/a/out.log"),
			bash("tail -3 /tmp/b/out.log"),
		],
	],
	["files in the same directory", [bash("cat src/a.ts"), bash("cat src/b.ts")]],
	[
		"string literals of a code-mode script",
		[
			codeMode(
				'const patch = "*** Begin Patch\\n*** Update File: docs/voice.md\\n@@\\n-old\\n+new\\n*** End Patch";\ntext(await tools.apply_patch(patch));',
				9,
			),
			codeMode(
				'const patch = "*** Begin Patch\\n*** Update File: CHANGELOG.md\\n@@\\n+## [3.2.3]\\n*** End Patch";\ntext(await tools.apply_patch(patch));',
				9,
			),
		],
	],
];

/** [record, command_from, command_argv0, command_prefix]. */
export const PROGRAMS: readonly (readonly [
	CommandRecord,
	string,
	string | null,
	string | null,
])[] = [
	[bash("cd /x && FOO=1 sudo -E bun test src"), "command", "bun", "bun test"],
	[
		bash(
			'RID=$(gh run list --limit 1 --json databaseId --jq ".[0].databaseId"); gh run watch "$RID"',
		),
		"command",
		"gh",
		"gh run",
	],
	[
		bash("timeout 1800 bash /tmp/review.sh 2>&1 | tail -20"),
		"command",
		"bash",
		"bash",
	],
	[bash("env -u GITHUB_TOKEN gh label list"), "command", "gh", "gh label"],
	[bash("bash -lc 'git -C /repo status'"), "command", "git", "git status"],
	[bash("pnpm --filter web test"), "command", "pnpm", "pnpm test"],
	[
		bash("./tests/steam-env.sh 2>&1 | grep -v x"),
		"command",
		"steam-env.sh",
		"steam-env.sh",
	],
	[bash('echo "=== diff ==="; git diff --stat'), "command", "git", "git diff"],
	[bash("env | grep FOO"), "command", "env", "env"],
	[bash("rtk proxy git push origin master"), "command", "git", "git push"],
	[bash("rtk git status --short"), "command", "git", "git status"],
	[bash("rtk entire status --detailed"), "command", "entire", "entire status"],
	[bash("rtk --version"), "command", "rtk", "rtk"],
	[
		bash("timeout 30 rtk proxy ssh gpu-l4 'tail -8 run.log'"),
		"command",
		"ssh",
		"ssh gpu-l4",
	],
	[bash("npx tsc --noEmit"), "command", "tsc", "tsc"],
	[
		bash("npx --yes agent-browser --session s click @e18"),
		"command",
		"agent-browser",
		"agent-browser",
	],
	[
		bash("pnpm exec vitest run tests/a.test.ts"),
		"command",
		"vitest",
		"vitest run",
	],
	[
		bash("uv run python -m mgraph status"),
		"command",
		"python",
		"python -m mgraph",
	],
	[
		bash("conda run -n dq python -m pytest -q"),
		"command",
		"python",
		"python -m pytest",
	],
	[
		bash(
			"mise exec node@20.1.0 -- npx --yes --package renovate@41 -- renovate-config-validator --strict",
		),
		"command",
		"renovate-config-validator",
		"renovate-config-validator",
	],
	[bash("nohup bun run dev > dev.log 2>&1 &"), "command", "bun", "bun run"],
	[bash("caffeinate -i make build"), "command", "make", "make build"],
	[bash("npm run build"), "command", "npm", "npm run"],
	[bash("(time node --test x.mjs) > out.txt 2>&1"), "command", "node", "node"],
	[bash('python3 -c "print(1)"'), "command", "python3", "python3"],
	[
		bash("python3 -m pytest -q tests"),
		"command",
		"python3",
		"python3 -m pytest",
	],
	[bash("rg -n foo src"), "command", "rg", "rg"],
	[bash("for f in a b; do echo $f; done"), "command", "for", "for f"],
	[
		bash("$(conda run -n dq which python) -m pytest -q"),
		"command",
		"$(conda run -n dq which python)",
		"$(conda run -n dq which python) -m pytest",
	],
	[
		{
			tool: "exec_command",
			text: `& '${WINDOWS}\\w\\publish.ps1' -Checkpoint x`,
		},
		"command",
		"publish.ps1",
		"publish.ps1",
	],
	[
		{ tool: "PowerShell", text: '{"command":"Get-ChildItem -Force"}' },
		"command",
		"Get-ChildItem",
		"Get-ChildItem",
	],
	[
		codeMode(
			'text(await tools.exec_command({cmd:"rg -n foo src","max_output_tokens":1000}));',
		),
		"command",
		"rg",
		"rg",
	],
	[
		codeMode(
			'text(await tools.exec_command({cmd:"rg -n foo src","max_output_tokens":1000}));',
			9,
		),
		"script",
		null,
		null,
	],
	[
		{
			kind: "file_change",
			tool: "Write",
			subtype: "native",
			filePath: "/tmp/poll.sh",
			text: JSON.stringify({
				file_path: "/tmp/poll.sh",
				content: "gh pr checks 1\n",
			}),
		},
		"written",
		null,
		null,
	],
	[
		{
			kind: "file_change",
			tool: "Write",
			subtype: "native",
			filePath: "/repo/README.md",
			text: JSON.stringify({ file_path: "/repo/README.md", content: "# x\n" }),
		},
		"",
		null,
		null,
	],
	[{ tool: "write_stdin", text: '{"chars":""}' }, "", null, null],
];

/**
 * A CI-polling script written twice, the second run list also naming the
 * workflow: near-duplicates by simhash, apart by fingerprint.
 */
export const NEAR_DUPLICATES: readonly CommandRecord[] = [
	pollScript("--limit 1"),
	pollScript("--limit 1 --workflow ci.yml"),
];

function pollScript(runListFlags: string): CommandRecord {
	const content = [
		"#!/usr/bin/env bash",
		"# Wait for the newest CI run of the branch and print its failed logs.",
		"set -euo pipefail",
		"repo=acme/web",
		"branch=main",
		`run=$(gh run list --repo "$repo" --branch "$branch" ${runListFlags} --json databaseId --jq ".[0].databaseId")`,
		"while true; do",
		'  status=$(gh run view "$run" --repo "$repo" --json status --jq .status)',
		'  if [ "$status" = completed ]; then break; fi',
		"  sleep 30",
		"done",
		'conclusion=$(gh run view "$run" --repo "$repo" --json conclusion --jq .conclusion)',
		'if [ "$conclusion" != success ]; then gh run view "$run" --repo "$repo" --log-failed | tail -100; exit 1; fi',
		'echo "CI passed"',
		"",
	].join("\n");
	return {
		kind: "file_change",
		tool: "Write",
		subtype: "native",
		filePath: "/tmp/scratchpad/ci-poll.sh",
		text: JSON.stringify({ file_path: "/tmp/scratchpad/ci-poll.sh", content }),
	};
}

/** The command columns of `records`, in order, computed by ClickHouse. */
export function buildCommandRecordsStatement(
	records: readonly CommandRecord[],
): ClickHouseStatement {
	return {
		query: `SELECT command_from, command_argv0, command_prefix, command_normalized,
				toString(command_fingerprint) AS command_fingerprint, toString(command_simhash) AS command_simhash
			FROM (
				SELECT r.1 AS position, r.2 AS kind, r.3 AS subtype, r.4 AS tool_name, if(r.2 = 'file_change', 'write', '') AS file_op,
					r.5 AS file_path, r.6 AS text, r.6 AS head, lengthUTF8(r.6) AS text_chars, r.7 AS parser_version,
					${commandColumnsSql()}
				FROM (SELECT arrayJoin(arrayZip({positions:Array(UInt32)}, {kinds:Array(String)}, {subtypes:Array(String)}, {tools:Array(String)}, {paths:Array(String)}, {texts:Array(String)}, {parserVersions:Array(UInt16)})) AS r)
			)
			ORDER BY position`,
		query_params: {
			positions: records.map((_, index) => index),
			kinds: records.map((record) => record.kind ?? "tool_call"),
			subtypes: records.map((record) => record.subtype ?? ""),
			tools: records.map((record) => record.tool ?? "Bash"),
			paths: records.map((record) => record.filePath ?? ""),
			texts: records.map((record) => record.text),
			parserVersions: records.map((record) => record.parserVersion ?? 9),
		},
	};
}

export interface CommandColumns {
	command_from: string;
	command_argv0: string | null;
	command_prefix: string | null;
	command_normalized: string | null;
	command_fingerprint: string | null;
	command_simhash: string | null;
}
