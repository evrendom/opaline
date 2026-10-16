import { describe, expect, test } from "bun:test";
import {
	extractScriptFileAccess,
	extractShellFileReads,
	parseShellCommand,
} from "./command-class.js";
import { readPythonFileAccess } from "./python-file-access.js";
import {
	isEmptyClaudeShellOutput,
	readShellExitFacts,
	readShellExitShape,
} from "./shell-exit.js";
import { splitSessionTranscript } from "./split-transcript.js";
import { TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS } from "./types.js";

/**
 * Parser 12: files a shell call reads and an inline Python script edits, the
 * failed edit a later call retries, which part of a compound command decided
 * its exit code, Claude's own Edit/Write diff, and Claude's interruptions.
 * The commands copy the shapes of real Claude Code calls with their content
 * replaced.
 */

function line(record: Record<string, unknown>): string {
	return JSON.stringify({
		cwd: "/repo",
		isSidechain: false,
		sessionId: "s12",
		version: "2.1.293",
		...record,
	});
}

let clock = 0;
function at(): string {
	clock++;
	return new Date(Date.UTC(2026, 9, 14, 5, 0, clock)).toISOString();
}

function call(id: string, input: Record<string, unknown>, name = "Bash") {
	return line({
		type: "assistant",
		timestamp: at(),
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name, input }],
		},
	});
}

function result(
	id: string,
	text: string,
	options: {
		isError?: boolean;
		toolUseResult?: unknown;
		denialKind?: string;
	} = {},
): string {
	return line({
		type: "user",
		timestamp: at(),
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: text,
					is_error: options.isError === true,
				},
			],
		},
		toolUseResult:
			options.toolUseResult ??
			(options.isError === true
				? `Error: ${text}`
				: { stdout: text, stderr: "", interrupted: false, isImage: false }),
		...(options.denialKind === undefined
			? {}
			: { toolDenialKind: options.denialKind }),
	});
}

function split(lines: readonly string[]) {
	return [
		...splitSessionTranscript({
			content: `${[
				line({
					type: "user",
					timestamp: at(),
					message: { role: "user", content: "go" },
				}),
				...lines,
			].join("\n")}\n`,
			sessionDate: "2026-10-14T05:00:00.000Z",
			source: "claude_code",
		}),
	];
}

function row(
	rows: ReturnType<typeof split>,
	callId: string,
	kind: string,
	subtype?: string,
) {
	const found = rows.find(
		(draft) =>
			draft.callId === callId &&
			draft.kind === kind &&
			(subtype === undefined || draft.subtype === subtype),
	);
	if (found === undefined) throw new Error(`no ${kind} of ${callId}`);
	return found;
}

const PY_EDIT = (path: string) =>
	[
		"cd /repo/web && python3 - <<'EOF'",
		`p='${path}'`,
		"s=open(p).read()",
		"old='''import { useMemo } from \"react\";'''",
		"new='''import { useEffect, useMemo } from \"react\";'''",
		"assert old in s; s=s.replace(old,new)",
		"open(p,'w').write(s)",
		"EOF",
	].join("\n");
const TRACEBACK =
	'Exit code 1\nTraceback (most recent call last):\n  File "<stdin>", line 6, in <module>\nAssertionError';

describe("files a shell call reads", () => {
	test("a compound read fills the call's file_path and lists every file it reads", () => {
		const rows = split([
			call("toolu_r", {
				command:
					'cd /repo && cat src/a.tsx; echo "=====b====="; cat src/b.tsx; sed -n 1,40p tools/c.ts; ls web/vitest.config.* 2>/dev/null',
			}),
			result("toolu_r", "a\n=====b=====\nb\n(eval):1: no matches found", {
				isError: true,
			}),
		]);
		const read = row(rows, "toolu_r", "tool_call");
		expect(read.filePath).toBe("/repo/src/a.tsx");
		expect(read.fileOp).toBe("read");
		expect(JSON.parse(read.facts.extra.shell_read_paths ?? "[]")).toEqual([
			"/repo/src/a.tsx",
			"/repo/src/b.tsx",
			"/repo/tools/c.ts",
		]);
		// No read is a file change.
		expect(rows.some((draft) => draft.kind === "file_change")).toBe(false);
	});

	test("printers, a printing sed and Python reads; never patterns, stdin or expansions", () => {
		expect(
			extractShellFileReads(
				[
					"cat a.ts b.ts | head -5",
					"tail -n 20 logs/x.log",
					"head -c 100 bin.dat",
					"tail +5 notes.md",
					"sed -n '1,40p' c.ts",
					"sed -e 's/a/b/' d.ts",
					"sed -i '' 's/a/b/' edited.ts",
					"cat src/*.ts",
					'cat "$HOME/x"',
					"cat - < input.txt",
					"cat <<EOF > out.txt\nnot a file\nEOF",
					"grep -n x e.ts",
				].join("\n"),
			),
		).toEqual([
			"a.ts",
			"b.ts",
			"logs/x.log",
			"bin.dat",
			"notes.md",
			"c.ts",
			"d.ts",
		]);
		// In command order, a script's reads among them.
		expect(
			extractShellFileReads(
				"cd /repo && python3 - <<'EOF'\ns=open('components/x.tsx').read()\nprint(s.index('y'))\nEOF\ncat components/y.tsx; python3 -c \"open('z.md','w').write(open('w.md').read())\"",
			),
		).toEqual([
			"/repo/components/x.tsx",
			"/repo/components/y.tsx",
			"/repo/w.md",
		]);
	});

	test("the list stops at its cap and counts the rest", () => {
		const paths = Array.from(
			{ length: 2_000 },
			(_, index) => `src/${"d".repeat(40)}/file-${index}.ts`,
		);
		const rows = split([
			call("toolu_many", { command: `cat ${paths.join(" ")}` }),
			result("toolu_many", "x"),
		]);
		const extra = row(rows, "toolu_many", "tool_call").facts.extra;
		const kept = JSON.parse(extra.shell_read_paths ?? "[]") as string[];
		expect(kept.length).toBeGreaterThan(0);
		expect(kept.length + Number(extra.shell_read_paths_more)).toBe(2_000);
		expect((extra.shell_read_paths ?? "").length).toBeLessThanOrEqual(
			TRANSCRIPT_RECORD_FACT_LIST_MAX_CHARS,
		);
		expect(extra.facts_clipped).toContain("shell_read_paths");
	});
});

describe("files an inline Python script edits", () => {
	test("a Python heredoc edit is a shell_script file change of the path it names", () => {
		const rows = split([
			call("toolu_e", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_e", TRACEBACK, { isError: true }),
		]);
		const change = row(rows, "toolu_e", "file_change");
		expect(change).toMatchObject({
			subtype: "shell_script",
			fileOp: "edit",
			filePath: "/repo/web/src/view.tsx",
		});
		expect(row(rows, "toolu_e", "tool_call").filePath).toBe(
			"/repo/web/src/view.tsx",
		);
		// The assert in the script's text is data, not a second file.
		expect(rows.filter((draft) => draft.kind === "file_change")).toHaveLength(
			1,
		);
	});

	test("the forms a script names a file in, and the ones it does not", () => {
		expect(
			readPythonFileAccess(
				[
					"from pathlib import Path",
					"import os",
					"p = 'a.ts'",
					"s = open(p).read()",
					"open(p, 'w').write(s)",
					"path = Path('b.ts')",
					"path.write_text(path.read_text().replace('x', 'y'))",
					"with open('c.md', mode='a') as f: f.write('z')",
					"for name in ['d.ts', \"e.ts\"]:",
					"    t = open(name).read()",
					"    open(name, 'w').write(t)",
					"q = os.path.join(root, 'guessed.ts')",
					"open(q, 'w').write('never')",
					"open(f'{root}/f.ts', 'w')",
					"text = '''open('inside-a-string.ts', 'w')'''",
					"print(open('README.md').read())",
				].join("\n"),
			),
		).toEqual({
			writes: ["a.ts", "b.ts", "c.md", "d.ts", "e.ts"],
			edits: ["a.ts", "b.ts", "d.ts", "e.ts"],
			reads: ["README.md"],
			changesDirectory: false,
		});
	});

	test("a helper that opens its parameter edits each literal it is called with", () => {
		const script = [
			"def patch(path, blocks):",
			"    s=open(path).read()",
			"    for old,new in blocks:",
			"        if old not in s:",
			"            return False",
			"        s=s.replace(old,new,1)",
			"    open(path,'w').write(s)",
			"    return True",
			"",
			"patch('components/x.tsx', [",
			"('''a''','''b'''),",
			"])",
			"patch(path='components/y.tsx', blocks=[])",
		].join("\n");
		expect(readPythonFileAccess(script)).toMatchObject({
			writes: ["components/x.tsx", "components/y.tsx"],
			edits: ["components/x.tsx", "components/y.tsx"],
		});
	});

	test("python -c, a script run by name, a conditional script and os.chdir", () => {
		expect(
			extractScriptFileAccess(
				`cd /repo && python3 -c "p='src/a.ts'; s=open(p).read(); open(p,'w').write(s.upper())"`,
			),
		).toEqual([
			{
				basis: "direct",
				key: "/repo/src/a.ts",
				operation: "edit",
				path: "/repo/src/a.ts",
			},
		]);
		expect(extractScriptFileAccess("python3 tools/fix.py src/a.ts")).toEqual(
			[],
		);
		expect(
			extractScriptFileAccess(
				`test -f a.ts || python3 -c "open('a.ts','w').write('x')"`,
			),
		).toMatchObject([{ basis: "conditional", operation: "write" }]);
		expect(
			extractScriptFileAccess(
				`cd /repo && python3 -c "import os; os.chdir('web'); open('a.ts','w')"`,
			),
		).toMatchObject([{ path: "a.ts", key: undefined }]);
	});
});

describe("retried edits", () => {
	test("a retried failed edit names the call it retries", () => {
		const rows = split([
			call("toolu_1", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_1", TRACEBACK, { isError: true }),
			// A read of the file in between is not an edit.
			call("toolu_peek", {
				command: "cd /repo/web && sed -n 118,132p src/view.tsx | cat -vet",
			}),
			result("toolu_peek", "x$"),
			call("toolu_2", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_2", TRACEBACK, { isError: true }),
			call("toolu_3", {
				command: `cd /repo/web && python3 -c "p='src/view.tsx'; s=open(p).read(); open(p,'w').write(s)"`,
			}),
			result("toolu_3", ""),
			// After a success the chain ends.
			call("toolu_4", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_4", TRACEBACK, { isError: true }),
			// Another file is another chain; a native Edit of an absolute path
			// keys the same as a script's resolved path.
			call(
				"toolu_5",
				{
					file_path: "/repo/web/src/view.tsx",
					old_string: "a",
					new_string: "b",
				},
				"Edit",
			),
			result(
				"toolu_5",
				"<tool_use_error>String to replace not found in file.</tool_use_error>",
				{ isError: true },
			),
			call(
				"toolu_6",
				{
					file_path: "/repo/web/src/other.tsx",
					old_string: "a",
					new_string: "b",
				},
				"Edit",
			),
			result("toolu_6", "The file has been updated."),
		]);
		const retryOf = (id: string) =>
			row(rows, id, "tool_call").facts.extra.retry_of;
		expect(retryOf("toolu_1")).toBeUndefined();
		expect(retryOf("toolu_peek")).toBeUndefined();
		expect(retryOf("toolu_2")).toBe("toolu_1");
		expect(retryOf("toolu_3")).toBe("toolu_2");
		expect(retryOf("toolu_4")).toBeUndefined();
		expect(retryOf("toolu_5")).toBe("toolu_4");
		expect(retryOf("toolu_6")).toBeUndefined();
	});

	test("a refused or interrupted edit is not a failed attempt", () => {
		const rows = split([
			call("toolu_a", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_a", "Error: permission denied by rule", {
				isError: true,
				denialKind: "permission-rule",
			}),
			call("toolu_b", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_b", "[Request interrupted by user for tool use]", {
				isError: true,
			}),
			call("toolu_c", { command: PY_EDIT("src/view.tsx") }),
			result("toolu_c", ""),
		]);
		expect(row(rows, "toolu_b", "tool_call").facts.extra.retry_of).toBe(
			undefined,
		);
		expect(row(rows, "toolu_c", "tool_call").facts.extra.retry_of).toBe(
			undefined,
		);
	});
});

describe("which part decided the exit code", () => {
	const facts = (command: string, succeeded: boolean, output = "") => {
		const shape = readShellExitShape(command);
		return shape === undefined
			? undefined
			: readShellExitFacts(shape, succeeded, output);
	};

	test("a list's last part decides its exit code; a trailing filter masks the pipeline", () => {
		const rows = split([
			call("toolu_glob", {
				command:
					"cd /repo && cat a.ts; echo ===; ls web/vitest.config.* 2>/dev/null",
			}),
			result(
				"toolu_glob",
				"Exit code 1\nx\n===\n(eval):1: no matches found: web/vitest.config.*",
				{ isError: true },
			),
			call("toolu_watch", {
				command:
					'cd /repo && sleep 90; gh pr checks 7 --watch 2>&1 | grep -v GraphQL | grep -E "verify" | tail -2; gh pr view 7 --json mergeable -q .mergeable',
			}),
			result("toolu_watch", "MERGEABLE\nShell cwd was reset to /home/me"),
			call("toolu_quiet", {
				command: "cd /repo && gh pr checks 7 --watch 2>&1 | tail -2",
			}),
			result("toolu_quiet", "Shell cwd was reset to /home/me"),
		]);
		expect(row(rows, "toolu_glob", "tool_result").facts.extra).toMatchObject({
			exit_decided_by: "ls web/vitest.config.* 2>/dev/null",
			exit_masked: "list",
			no_output: "false",
		});
		// The watch's pipeline is lost to the list; the last part printed.
		expect(row(rows, "toolu_watch", "tool_result").facts.extra).toMatchObject({
			exit_decided_by: "gh pr view 7 --json mergeable -q .mergeable",
			exit_masked: "list",
			no_output: "false",
		});
		expect(row(rows, "toolu_quiet", "tool_result").facts.extra).toMatchObject({
			exit_decided_by: "tail -2",
			exit_masked: "pipe",
			no_output: "true",
		});
	});

	test("and-or chains are known only when shell semantics or the output name the part", () => {
		expect(facts("cd /repo && bun test", true)).toEqual({
			decidedBy: "bun test",
		});
		expect(facts("cd /repo && bun test", false, "1 fail")).toEqual({});
		expect(
			facts(
				"cd /repo && ls src/*.zz && bun test",
				false,
				"(eval):1: no matches found: src/*.zz",
			),
		).toEqual({ decidedBy: "ls src/*.zz" });
		expect(
			facts("bunx vitest && bun test", false, "zsh: command not found: bunx"),
		).toEqual({ decidedBy: "bunx vitest" });
		// A named part inside a pipeline does not decide it.
		expect(
			facts(
				"ls src/*.zz | wc -l && bun test",
				false,
				"(eval):1: no matches found: src/*.zz",
			),
		).toEqual({});
		expect(facts("bun test || echo failed", false)).toEqual({
			decidedBy: "echo failed",
		});
		expect(facts("bun test || echo failed", true)).toEqual({});
	});

	test("pipefail, set -e and compound constructs", () => {
		expect(facts("set -o pipefail; bun test | tail -5", false)).toEqual({
			masked: "list",
		});
		expect(facts("set -o pipefail; bun test | tail -5", true)).toEqual({
			decidedBy: "tail -5",
			masked: "list",
		});
		expect(facts("set -e; bun lint; bun test", false)).toEqual({});
		expect(facts("set -euo pipefail; bun lint; bun test", true)).toEqual({
			decidedBy: "bun test",
		});
		expect(facts("if true; then ls; fi", true)).toBeUndefined();
		expect(facts("(cd web && bun test)", true)).toBeUndefined();
	});

	test("a grep Claude Code read as no match exited non-zero", () => {
		const rows = split([
			call("toolu_grep", { command: "cd /repo && grep -rn needle src" }),
			result("toolu_grep", "", {
				toolUseResult: {
					stdout: "",
					stderr: "",
					interrupted: false,
					returnCodeInterpretation: "No matches found",
				},
			}),
		]);
		const extra = row(rows, "toolu_grep", "tool_result").facts.extra;
		expect(extra.exit_decided_by).toBeUndefined();
		expect(extra.no_output).toBe("true");
	});

	test("without toolUseResult (sub-agent transcripts) a result that is not an error has no known exit code", () => {
		const bare = (id: string, text: string) =>
			line({
				type: "user",
				timestamp: at(),
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content: text,
							is_error: false,
						},
					],
				},
			});
		const rows = split([
			call("toolu_chain", { command: "cd /repo && grep -rn needle src" }),
			bare("toolu_chain", ""),
			call("toolu_list", {
				command: "cd /repo; grep -rn needle src | head -3",
			}),
			bare("toolu_list", "src/a.ts:1:needle"),
		]);
		expect(row(rows, "toolu_chain", "tool_result").facts.extra).toMatchObject({
			no_output: "true",
		});
		expect(
			row(rows, "toolu_chain", "tool_result").facts.extra.exit_decided_by,
		).toBeUndefined();
		// A list's last part decides whatever its status.
		expect(row(rows, "toolu_list", "tool_result").facts.extra).toMatchObject({
			exit_decided_by: "head -3",
			exit_masked: "list,pipe",
		});
	});

	test("no output means nothing once Claude Code's own lines are removed", () => {
		expect(isEmptyClaudeShellOutput("(Bash completed with no output)")).toBe(
			true,
		);
		expect(
			isEmptyClaudeShellOutput("Exit code 1\n\nShell cwd was reset to /x"),
		).toBe(true);
		expect(isEmptyClaudeShellOutput("Exit code 1\nfailed")).toBe(false);
		expect(isEmptyClaudeShellOutput("ok\nShell cwd was reset to /x")).toBe(
			false,
		);
	});

	test("background hand-offs, refusals and interruptions carry no exit facts", () => {
		const rows = split([
			call("toolu_bg", { command: "bun run dev", run_in_background: true }),
			result(
				"toolu_bg",
				"Command running in background with ID: b123. Output is being written to: /tmp/b123.output",
				{
					toolUseResult: {
						stdout: "",
						stderr: "",
						interrupted: false,
						backgroundTaskId: "b123",
					},
				},
			),
			call("toolu_rm", { command: "rm -rf dist; ls" }),
			result("toolu_rm", "Error: permission denied by rule", {
				isError: true,
				denialKind: "permission-rule",
			}),
		]);
		for (const id of ["toolu_bg", "toolu_rm"]) {
			const extra = row(rows, id, "tool_result").facts.extra;
			expect(extra.no_output).toBeUndefined();
			expect(extra.exit_decided_by).toBeUndefined();
		}
	});

	test("the shell splitter keeps each command's text and its here-documents", () => {
		const commands = parseShellCommand(
			"cd /repo && python3 - <<'EOF'\np = 'a'\nEOF\nls  x.*  2>/dev/null | wc -l",
		);
		expect(commands.map((simple) => simple.text)).toEqual([
			"cd /repo",
			"python3 - <<'EOF'",
			"ls  x.*  2>/dev/null",
			"wc -l",
		]);
		expect(commands[1]?.heredocs).toMatchObject([
			{ delimiter: "EOF", quoted: true, body: "p = 'a'" },
		]);
	});
});

describe("Claude's own diff of an edit", () => {
	/** The hunks Claude wrote, as parser 9 keeps them in the applied changes' components. */
	const hunks = (extra: Record<string, string | undefined>) =>
		(
			JSON.parse(extra.applied_file_changes_components ?? "[]") as {
				path: string;
				value: unknown;
			}[]
		)
			.filter((part) => part.path === "user.toolUseResult.structuredPatch[]")
			.map((part) => part.value);

	test("Edit and Write diffs are kept with their lines; the file before them is not", () => {
		const hunk = {
			oldStart: 3,
			oldLines: 2,
			newStart: 3,
			newLines: 3,
			lines: [
				" const a = 1;",
				"-const b = 2;",
				"+const b = 3;",
				"+const c = 4;",
			],
		};
		const rows = split([
			call(
				"toolu_edit",
				{ file_path: "/repo/a.ts", old_string: "b = 2", new_string: "b = 3" },
				"Edit",
			),
			result("toolu_edit", "The file /repo/a.ts has been updated.", {
				toolUseResult: {
					filePath: "/repo/a.ts",
					oldString: "b = 2",
					newString: "b = 3",
					structuredPatch: [hunk],
					originalFile: "const a = 1;\nconst b = 2;\nORIGINAL_ONLY\n",
					userModified: false,
				},
			}),
			call("toolu_secret", { file_path: "/repo/.env", content: "x" }, "Write"),
			result("toolu_secret", "The file /repo/.env has been updated.", {
				toolUseResult: {
					type: "update",
					filePath: "/repo/.env",
					content: "WRITTEN_CONTENT",
					structuredPatch: [
						{
							oldStart: 1,
							oldLines: 1,
							newStart: 1,
							newLines: 1,
							lines: [
								"-API_KEY=sk_live_abcdefghijklmnop1234",
								"+API_KEY=sk_live_qrstuvwxyzabcdef5678",
							],
						},
					],
					originalFile: "API_KEY=sk_live_abcdefghijklmnop1234\n",
				},
			}),
		]);
		const edit = row(rows, "toolu_edit", "tool_result").facts.extra;
		expect(hunks(edit)).toEqual([hunk]);
		// Before parser 12 the whole output, originalFile included, was also
		// copied into denial_reason_components.
		expect(JSON.stringify(edit)).not.toContain("ORIGINAL_ONLY");
		expect(edit.denial_reason_components).toBeUndefined();
		const secret = row(rows, "toolu_secret", "tool_result").facts.extra;
		expect(JSON.stringify(secret)).not.toContain("sk_live_");
		expect(JSON.stringify(secret)).not.toContain("WRITTEN_CONTENT");
		expect(hunks(secret)).toHaveLength(1);
		// The written content stays on the call's file change.
		expect(row(rows, "toolu_secret", "file_change").text).toContain('"x"');
	});

	test("a refused call's string result is still its denial reason", () => {
		const rows = split([
			call("toolu_rm", { command: "rm -rf dist" }),
			result("toolu_rm", "Error: permission denied by rule", {
				isError: true,
				toolUseResult: "Error: permission denied by rule",
				denialKind: "permission-rule",
			}),
		]);
		expect(
			JSON.parse(
				row(rows, "toolu_rm", "tool_result").facts.extra
					.denial_reason_components ?? "[]",
			),
		).toEqual([
			{
				path: "user.toolUseResult",
				ordinal: 0,
				value: "Error: permission denied by rule",
			},
		]);
	});
});

describe("interruptions Claude recorded", () => {
	test("an interrupted call is interrupted; a user rejection stays a refusal", () => {
		const rows = split([
			call("toolu_stop", { command: "bun run serve" }),
			result("toolu_stop", "[Request interrupted by user for tool use]", {
				isError: true,
				toolUseResult: "Error: [Request interrupted by user for tool use]",
			}),
			call("toolu_ended", { command: "bun test" }),
			result(
				"toolu_ended",
				"[Tool call interrupted: the session ended before this call's result was recorded]",
				{ isError: true, denialKind: "interrupted" },
			),
			call("toolu_no", { command: "rm -rf dist" }),
			result(
				"toolu_no",
				"The user doesn't want to proceed with this tool use. The tool use was rejected.",
				{
					isError: true,
					toolUseResult: "User rejected tool use",
					denialKind: "user-rejected",
				},
			),
		]);
		expect(row(rows, "toolu_stop", "tool_result").facts).toMatchObject({
			interrupted: true,
			denialKind: "",
		});
		expect(row(rows, "toolu_ended", "tool_result").facts).toMatchObject({
			interrupted: true,
			denialKind: "interrupted",
		});
		expect(row(rows, "toolu_no", "tool_result").facts).toMatchObject({
			interrupted: null,
			denialKind: "user-rejected",
		});
		for (const id of ["toolu_stop", "toolu_ended", "toolu_no"])
			expect(
				row(rows, id, "tool_result").facts.extra.no_output,
			).toBeUndefined();
	});
});
