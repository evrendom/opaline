import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { splitSessionTranscript } from "@rudel/api-routes/transcript-records";
import {
	claudeGitFixture,
	codexGitContinuationFixture,
	codexGitFixture,
	type GitTranscriptFixture,
} from "../__tests__/fixtures/git-observation-transcripts.js";
import {
	type GitObservationParseInput,
	type GitObservationRecord,
	parseGitObservations,
} from "./git-observation-parser.js";

test("Claude compound commits, truncated output, subagent, push, gh and MCP PRs; failed commit excluded", () => {
	const input = parseInput(claudeGitFixture());
	const compound = input.records.find(
		(record) =>
			record.call_id === "compound" &&
			record.kind === "tool_call" &&
			record.agent_id === "",
	);
	expect(compound?.text).toContain("bun test && git commit");
	const truncated = input.records.find(
		(record) => record.call_id === "truncated" && record.kind === "tool_result",
	);
	expect(truncated?.text.length).toBeLessThan(truncated?.text_chars ?? 0);
	const rows = parseGitObservations(input);
	expect(rows).toHaveLength(6);
	expect(
		rows
			.filter((row) => row.kind === "commit_created")
			.map((row) => row.short_sha)
			.sort(),
	).toEqual(["abc1234", "cafe123", "def5678"]);
	expect(rows.find((row) => row.short_sha === "cafe123")?.agent_id).toBe(
		"child-1",
	);
	expect(rows.find((row) => row.short_sha === "abc1234")?.subject_sha256).toBe(
		createHash("sha256").update("feat: record observations").digest("hex"),
	);
	expect(rows.find((row) => row.kind === "push_range")).toMatchObject({
		push_from_sha: "a1b2c3d",
		push_to_sha: "d4e5f6a",
		branch: "feat/observations",
	});
	expect(rows.find((row) => row.kind === "pr_url")).toMatchObject({
		pr_repo: "opalinehq/athena",
		pr_number: 133,
	});
	expect(rows.find((row) => row.kind === "mcp_pr_created")?.pr_number).toBe(
		134,
	);
	expect(JSON.stringify(rows)).not.toContain("feat: record observations");
	expect(rows.every((row) => row.label === "observed")).toBe(true);
});

test("Codex bodyless session_meta raw fallback, transport success and repository credential removal", () => {
	const input = parseInput(codexGitFixture());
	expect(
		input.records.find((record) => record.subtype === "session_meta")?.text,
	).toBe("");
	const rows = parseGitObservations(input);
	expect(rows).toHaveLength(3);
	expect(rows.find((row) => row.kind === "codex_session_meta")).toMatchObject({
		branch: "feat/codex",
		commit_hash: "a".repeat(40),
		repository_url: "https://github.com/opalinehq/athena.git",
	});
	expect(rows.find((row) => row.kind === "commit_created")?.short_sha).toBe(
		"123abcd",
	);
	expect(rows.find((row) => row.kind === "pr_url")?.pr_number).toBe(135);
	expect(JSON.stringify(rows)).not.toContain("password");
});

test("a Codex fork keeps its own session_meta git state and drops the replayed parent copy", () => {
	const timestamp = "2026-09-12T12:00:00.000Z";
	const meta = (id: string, git: Record<string, string>, extra = {}) =>
		JSON.stringify({
			type: "session_meta",
			timestamp,
			payload: { id, cwd: `/work/${id}`, git, ...extra },
		});
	const content = [
		meta(
			"fork-session",
			{ branch: "feat/fork", commit_hash: "b".repeat(40) },
			{ forked_from_id: "parent-session" },
		),
		meta("parent-session", {
			branch: "main",
			commit_hash: "c".repeat(40),
			repository_url: "https://github.com/opalinehq/parent.git",
		}),
	].join("\n");
	const rows = parseGitObservations(
		parseInput({ source: "codex", timestamp, subagents: {}, content }),
	);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		kind: "codex_session_meta",
		branch: "feat/fork",
		commit_hash: "b".repeat(40),
		repository_url: "",
	});
});

test("Codex PTY polls retain originating commands and agent scope; a failed command keeps the commit it printed", () => {
	const input = parseInput(codexGitContinuationFixture());
	const rows = parseGitObservations({
		...input,
		records: [
			...input.records.filter((record) => record.kind !== "tool_result"),
			...input.records.filter((record) => record.kind === "tool_result"),
		],
	});
	expect(rows).toHaveLength(4);
	// git prints `[branch sha]` only once the commit exists; the exit code is a later command's.
	expect(rows.find((row) => row.short_sha === "bad1234")?.call_id).toBe(
		"failed-done",
	);
	expect(rows.some((row) => row.short_sha === "bad5678")).toBe(false);
	expect(rows.find((row) => row.short_sha === "abc1234")).toMatchObject({
		agent_id: "",
		call_id: "done",
	});
	expect(rows.find((row) => row.short_sha === "cafe123")?.agent_id).toBe(
		"child-1",
	);
	expect(rows.find((row) => row.kind === "push_range")).toMatchObject({
		push_from_sha: "a1b2c3d",
		push_to_sha: "d4e5f6a",
	});
});

test.each([
	"--dry-run",
	"-n",
	"-nv",
	"-vn",
	"-fnu",
])("git push %s never creates push observations", (flag) => {
	const fixture = claudeGitFixture();
	const input = parseInput({
		...fixture,
		content: fixture.content.replace(
			"git push origin feat/observations",
			`git push ${flag} origin feat/observations`,
		),
	});
	const rows = parseGitObservations(input);
	expect(rows.filter((row) => row.kind === "push_range")).toHaveLength(0);
	expect(rows.filter((row) => row.kind === "commit_created")).toHaveLength(3);
});

test.each([
	"-v",
	"-u",
	"--no-verify",
	"-fu",
])("git push %s still creates push observations", (flag) => {
	const fixture = claudeGitFixture();
	const input = parseInput({
		...fixture,
		content: fixture.content.replace(
			"git push origin feat/observations",
			`git push ${flag} origin feat/observations`,
		),
	});
	expect(
		parseGitObservations(input).filter((row) => row.kind === "push_range"),
	).toHaveLength(1);
});

test("successful + forced updates are observed, rejected ! updates are not", () => {
	const fixture = claudeGitFixture();
	const input = parseInput({
		...fixture,
		content: fixture.content.replace(
			"a1b2c3d..d4e5f6a  feat/observations -> feat/observations",
			"+ a1b2c3d...d4e5f6a main -> main (forced update)\\n ! [rejected] main -> main (non-fast-forward)\\n ! a1b2c3d...bad1234 main -> main (rejected)",
		),
	});
	expect(
		parseGitObservations(input).filter((row) => row.kind === "push_range"),
	).toMatchObject([
		{ push_from_sha: "a1b2c3d", push_to_sha: "d4e5f6a", branch: "main" },
	]);
});

test("multiple commits in one tool output retain distinct replacing keys and CRLF subject hashes", () => {
	const input = parseInput(claudeGitFixture());
	const call = input.records.find(
		(record) =>
			record.kind === "tool_call" &&
			record.call_id === "compound" &&
			!record.agent_id,
	);
	const output = input.records.find(
		(record) =>
			record.kind === "tool_result" &&
			record.call_id === "compound" &&
			!record.agent_id,
	);
	assert(call);
	assert(output);
	const rows = parseGitObservations({
		...input,
		records: [
			{ ...call },
			{
				...output,
				raw: undefined,
				text: "[main abcd123] first\r\n[main def4567] second\r\n",
			},
		],
	});
	expect(rows).toHaveLength(2);
	expect(rows[0]?.block_idx).not.toBe(rows[1]?.block_idx);
	expect(rows[0]?.subject_sha256).toBe(
		createHash("sha256").update("first").digest("hex"),
	);
});

test("MCP inner failure and explicit nonzero exit code never become PR observations; commits and pushes the call printed stay", () => {
	const input = parseInput(claudeGitFixture());
	const rows = parseGitObservations({
		...input,
		records: input.records.map((record) =>
			record.kind === "tool_result"
				? { ...record, raw: undefined, exit_code: 1 }
				: record,
		),
	});
	expect(
		rows.filter(
			(row) => row.kind === "pr_url" || row.kind === "mcp_pr_created",
		),
	).toHaveLength(0);
	expect(rows.map((row) => row.kind).sort()).toEqual([
		"commit_created",
		"commit_created",
		"commit_created",
		"push_range",
	]);
	const mcp = parseGitObservations({
		...input,
		records: input.records
			.filter((record) => record.call_id === "mcp-pr")
			.map((record) =>
				record.kind === "tool_result"
					? {
							...record,
							raw: undefined,
							text: '{"isError":true,"text":"https://github.com/opalinehq/athena/pull/134"}',
						}
					: record,
			),
	});
	expect(mcp).toHaveLength(0);
});

test("free-text branch values pass the secret filter before storage", () => {
	const input = parseInput(codexGitFixture());
	const record = input.records.find(
		(record) => record.subtype === "session_meta",
	);
	assert(record);
	const rows = parseGitObservations({
		...input,
		records: [
			{
				...record,
				raw: JSON.stringify({
					payload: { git: { branch: `feature/ghp_${"a".repeat(36)}` } },
				}),
			},
		],
	});
	expect(rows[0]?.branch).not.toContain(`ghp_${"a".repeat(36)}`);
});

function parseInput(fixture: GitTranscriptFixture): GitObservationParseInput {
	const records: GitObservationRecord[] = [
		...splitSessionTranscript({
			...fixture,
			sessionDate: fixture.timestamp,
			textMaxChars: 65_536,
		}),
	].map((draft) => {
		const raw = fixture.subagents[draft.agentId] ?? fixture.content;
		return {
			agent_id: draft.agentId,
			record_idx: draft.recordIdx,
			block_idx: draft.blockIdx,
			call_id: draft.callId,
			kind: draft.kind,
			subtype: draft.subtype,
			tool_name: draft.toolName,
			is_error: draft.isError,
			exit_code: draft.exitCode,
			ts: draft.ts,
			text: draft.text,
			text_chars: draft.textChars,
			byte_start: String(draft.byteStart),
			byte_len: draft.byteLen,
			raw:
				draft.kind === "meta" || draft.textChars > [...draft.text].length
					? Buffer.from(raw)
							.subarray(draft.byteStart, draft.byteStart + draft.byteLen)
							.toString("utf8")
					: undefined,
		};
	});
	return {
		organizationId: "org",
		userId: "user",
		sessionId: "session",
		source: fixture.source,
		revision: "100",
		transcriptParserVersion: 4,
		records,
	};
}

test("pushes carry the To remote, and a new branch is a push without a SHA range", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("push", "git push -u origin feat/links"),
			result(
				"push",
				[
					"To https://x-access-token:secret@github.com/opalinehq/athena.git",
					" * [new branch]      feat/links -> feat/links",
					"To github.com:opalinehq/cli.git",
					"   a1b2c3d..d4e5f6a  main -> main",
				].join("\n"),
			),
		]),
	);
	expect(rows.filter((row) => row.kind === "push_range")).toMatchObject([
		{
			push_from_sha: "",
			push_to_sha: "",
			push_source_branch: "feat/links",
			branch: "feat/links",
			repository_url: "https://github.com/opalinehq/athena.git",
		},
		{
			push_from_sha: "a1b2c3d",
			push_to_sha: "d4e5f6a",
			branch: "main",
			repository_url: "github.com:opalinehq/cli.git",
		},
	]);
	expect(JSON.stringify(rows)).not.toContain("secret");
});

test("CI status reads are ci_check observations whatever the checks returned", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("pending", "gh pr checks 133 --repo opalinehq/athena --watch"),
			result("pending", "build pending", { exit_code: 8, is_error: true }),
			call("failed", "gh run watch 42 --exit-status"),
			result("failed", "X build failed", { exit_code: 1, is_error: true }),
			call("passed", "gh run view 42"),
			result("passed", "✓ build"),
			call("denied", "gh pr checks 133"),
			result("denied", "Permission denied by rule", { is_error: true }),
			call("running", "gh run watch 43"),
			result("running", "Process running with session ID 7", {
				subtype: "running",
			}),
			call(
				"mcp",
				'{"owner":"opalinehq","repo":"athena","pullNumber":134}',
				"mcp__github__get_pull_request_status",
			),
			result("mcp", '{"state":"failure"}'),
			call("list", "gh pr list"),
			result("list", "#133 feat: links"),
		]),
	);
	expect(
		rows
			.filter((row) => row.kind === "ci_check")
			.map(({ call_id, pr_repo, pr_number }) => ({
				call_id,
				pr_repo,
				pr_number,
			})),
	).toEqual([
		{ call_id: "pending", pr_repo: "opalinehq/athena", pr_number: 133 },
		{ call_id: "failed", pr_repo: "", pr_number: 0 },
		{ call_id: "passed", pr_repo: "", pr_number: 0 },
		{ call_id: "mcp", pr_repo: "opalinehq/athena", pr_number: 134 },
	]);
});

test("only real gh invocations are CI checks; conditional ones are unconfirmed", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("echo", "echo gh pr checks 133"),
			result("echo", "gh pr checks 133"),
			call("guarded", "false && gh pr checks 133"),
			result("guarded", "", { exit_code: 1, is_error: true }),
			call(
				"chained",
				"cd repo && gh -R opalinehq/cli pr checks https://github.com/opalinehq/athena/pull/7",
			),
			result("chained", "build\tpass", { exit_code: 0 }),
			call("interval", "gh pr checks --watch --interval 10"),
			result("interval", "All checks were successful"),
			call("branch", "gh pr checks feat/links; echo done"),
			result("branch", "build\tpending", { exit_code: 8, is_error: true }),
			call("runs", "gh run list --branch main --limit 5"),
			result("runs", "completed\tsuccess\tCI"),
			call(
				"codex",
				JSON.stringify({ cmd: "gh run watch 42 --exit-status" }),
				"exec_command",
			),
			result("codex", "Process exited with code 1", {
				exit_code: 1,
				is_error: true,
			}),
		]),
	);
	expect(
		rows
			.filter((row) => row.kind === "ci_check")
			.map(({ call_id, label, pr_repo, pr_number, branch }) => ({
				call_id,
				label,
				pr_repo,
				pr_number,
				branch,
			})),
	).toEqual([
		{
			call_id: "guarded",
			label: "unconfirmed",
			pr_repo: "",
			pr_number: 133,
			branch: "",
		},
		{
			call_id: "chained",
			label: "observed",
			pr_repo: "opalinehq/athena",
			pr_number: 7,
			branch: "",
		},
		{
			call_id: "interval",
			label: "observed",
			pr_repo: "",
			pr_number: 0,
			branch: "",
		},
		{
			call_id: "branch",
			label: "observed",
			pr_repo: "",
			pr_number: 0,
			branch: "feat/links",
		},
		{
			call_id: "runs",
			label: "observed",
			pr_repo: "",
			pr_number: 0,
			branch: "main",
		},
		{
			call_id: "codex",
			label: "observed",
			pr_repo: "",
			pr_number: 0,
			branch: "",
		},
	]);
});

test("CI checks keep the run and commit they name; success after ; or || proves nothing", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("masked", "false && gh pr checks 133; true"),
			result("masked", "", { exit_code: 0 }),
			call("rescued", "false && gh pr checks 133 || true"),
			result("rescued", "", { exit_code: 0 }),
			call("view", "gh run view 42 --log-failed"),
			result("view", "X build failed"),
			call("list", "gh run list --commit ABC1234DEF --branch main"),
			result("list", "completed\tfailure\tCI"),
			call(
				"mcp",
				JSON.stringify({
					method: "get_workflow_run",
					owner: "opalinehq",
					repo: "athena",
					run_id: 7001,
				}),
				"mcp__github__actions_get",
			),
			result("mcp", JSON.stringify({ conclusion: "failure" })),
		]),
	);
	expect(
		rows.map(({ call_id, label, run_id, commit_hash, branch }) => ({
			call_id,
			label,
			run_id,
			commit_hash,
			branch,
		})),
	).toEqual([
		{
			call_id: "masked",
			label: "unconfirmed",
			run_id: "",
			commit_hash: "",
			branch: "",
		},
		{
			call_id: "rescued",
			label: "unconfirmed",
			run_id: "",
			commit_hash: "",
			branch: "",
		},
		{
			call_id: "view",
			label: "observed",
			run_id: "42",
			commit_hash: "",
			branch: "",
		},
		{
			call_id: "list",
			label: "observed",
			run_id: "",
			commit_hash: "abc1234def",
			branch: "main",
		},
		{
			call_id: "mcp",
			label: "observed",
			run_id: "7001",
			commit_hash: "",
			branch: "",
		},
	]);
});

test("consolidated GitHub MCP tools are CI checks only for status, run and job methods", () => {
	const rows = parseGitObservations(
		recordsInput([
			call(
				"status",
				JSON.stringify({
					method: "get_status",
					owner: "opalinehq",
					repo: "athena",
					pullNumber: 9,
				}),
				"mcp__github__pull_request_read",
			),
			result("status", JSON.stringify({ state: "pending" })),
			call(
				"diff",
				JSON.stringify({
					method: "get_diff",
					owner: "opalinehq",
					repo: "athena",
					pullNumber: 9,
				}),
				"mcp__github__pull_request_read",
			),
			result("diff", "diff --git"),
			call(
				"definition",
				JSON.stringify({
					method: "get_workflow",
					owner: "opalinehq",
					repo: "athena",
				}),
				"mcp__github__actions_get",
			),
			result("definition", "name: CI"),
			call(
				"run",
				JSON.stringify({
					method: "get_workflow_run",
					owner: "opalinehq",
					repo: "athena",
				}),
				"mcp__github__actions_get",
			),
			result("run", JSON.stringify({ conclusion: "failure" })),
		]),
	);
	expect(
		rows
			.filter((row) => row.kind === "ci_check")
			.map((row) => [row.call_id, row.pr_repo, row.pr_number]),
	).toEqual([
		["status", "opalinehq/athena", 9],
		["run", "opalinehq/athena", 0],
	]);
});

test("a push that updates one ref and rejects another keeps the update; forced updates are labelled", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("push", "git push origin main feat/links"),
			result(
				"push",
				[
					"To github.com:opalinehq/athena.git",
					" + a1b2c3d...d4e5f6a feat/links -> feat/links (forced update)",
					" ! [rejected]        main -> main (fetch first)",
					"error: failed to push some refs",
				].join("\n"),
				{ exit_code: 1, is_error: true },
			),
		]),
	);
	expect(rows).toMatchObject([
		{
			kind: "push_range",
			label: "forced_update",
			push_to_sha: "d4e5f6a",
			branch: "feat/links",
			repository_url: "github.com:opalinehq/athena.git",
		},
	]);
});

test("a shell CI check records each Actions run its output links to", () => {
	const command =
		'cd ~/x && sleep 60; for n in 301 303; do gh pr view $n --json mergeable,mergeStateStatus -q "..."; done; gh pr checks 301 --watch --fail-fast 2>&1 | grep -v GraphQL | grep -E "verify|integration" | tail -2';
	const output = [
		"#301 MERGEABLE UNSTABLE",
		"#303 MERGEABLE UNSTABLE",
		"verify\tfail\t57s\thttps://github.com/opalinehq/athena/actions/runs/38537619754/job/115764252835\t",
		"integration\tpending\t0\thttps://github.com/opalinehq/athena/actions/runs/38537619754/job/115764366945",
	].join("\n");
	const rows = parseGitObservations(
		recordsInput([
			call("real", command),
			result("real", output),
			call("two", "gh pr checks 7"),
			result(
				"two",
				[
					"verify\tpass\t1m\thttps://github.com/opalinehq/athena/actions/runs/101/job/1",
					"deploy\tfail\t2m\thttps://github.com/opalinehq/deploys/actions/runs/202/attempts/2",
				].join("\n"),
				{ exit_code: 1, is_error: true },
			),
			call("view", "gh run view 42 --log-failed"),
			result(
				"view",
				"X build failed\nView this run on GitHub: https://github.com/opalinehq/athena/actions/runs/42\nhttps://github.com/opalinehq/athena/actions/runs/42/job/9",
			),
			call("guarded", "false && gh pr checks 9"),
			result("guarded", "", { exit_code: 1, is_error: true }),
			call("notes", "cat notes.md"),
			result(
				"notes",
				"See https://github.com/opalinehq/athena/actions/runs/555/job/1",
			),
		]),
	);
	expect(
		rows
			.filter((row) => row.kind === "ci_check")
			.map(({ call_id, label, pr_repo, pr_number, run_id }) => ({
				call_id,
				label,
				pr_repo,
				pr_number,
				run_id,
			})),
	).toEqual([
		{
			call_id: "real",
			label: "observed",
			pr_repo: "",
			pr_number: 301,
			run_id: "",
		},
		{
			call_id: "real",
			label: "observed",
			pr_repo: "opalinehq/athena",
			pr_number: 0,
			run_id: "38537619754",
		},
		{
			call_id: "two",
			label: "observed",
			pr_repo: "",
			pr_number: 7,
			run_id: "",
		},
		{
			call_id: "two",
			label: "observed",
			pr_repo: "opalinehq/athena",
			pr_number: 0,
			run_id: "101",
		},
		{
			call_id: "two",
			label: "observed",
			pr_repo: "opalinehq/deploys",
			pr_number: 0,
			run_id: "202",
		},
		{
			call_id: "view",
			label: "observed",
			pr_repo: "opalinehq/athena",
			pr_number: 0,
			run_id: "42",
		},
		{
			call_id: "guarded",
			label: "unconfirmed",
			pr_repo: "",
			pr_number: 9,
			run_id: "",
		},
	]);
	const real = rows.filter((row) => row.call_id === "real");
	expect(new Set(real.map((row) => row.block_idx)).size).toBe(real.length);
});

test("check rows without a URL confirm a lone check; several checks keep their own labels", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("rows", "cd repo && gh pr checks 7; true"),
			result("rows", "verify\tpass\t57s\t\nlint\tskipping\t0\t"),
			call("both", "false && gh pr checks 7; gh run watch 42"),
			result("both", "https://github.com/opalinehq/athena/actions/runs/42"),
			call("text", "false && gh pr checks 7; true"),
			result("text", "no checks reported on the 'main' branch"),
		]),
	);
	expect(
		rows.map(({ call_id, label, run_id, pr_repo }) => ({
			call_id,
			label,
			run_id,
			pr_repo,
		})),
	).toEqual([
		{ call_id: "rows", label: "observed", run_id: "", pr_repo: "" },
		{ call_id: "both", label: "unconfirmed", run_id: "", pr_repo: "" },
		{
			call_id: "both",
			label: "observed",
			run_id: "42",
			pr_repo: "opalinehq/athena",
		},
		{ call_id: "text", label: "unconfirmed", run_id: "", pr_repo: "" },
	]);
});

test("a push its output does not show is recognised from its command", () => {
	const pushes = parseGitObservations(
		recordsInput([
			call("quiet", "git push -q origin HEAD:feature/docs 2>&1 | tail -3"),
			result("quiet", "remote: Create a pull request for 'feature/docs'"),
			call("shown", "git push origin fix/a"),
			result(
				"shown",
				"To github.com:acme/app.git\n   1a2b3c4..5d6e7f8  fix/a -> fix/a",
			),
			call("dry", "git push --dry-run origin main"),
			result("dry", ""),
			call("fallback", "git push || git push --force-with-lease"),
			result("fallback", ""),
			call("loop", "for b in a b; do git push -q -u origin $b; done"),
			result("loop", "error: script exited with code 1"),
			call("rejected", "git push -q 2>&1 | tail -2"),
			result("rejected", " ! [rejected]        main -> main (fetch first)"),
			call("failed", "cd app && git push -u origin x"),
			result("failed", "fatal: no remote", { is_error: true, exit_code: 128 }),
		]),
	)
		.filter((row) => row.kind === "push_range")
		.map((row) => [row.call_id, row.label, row.branch, row.push_to_sha]);
	expect(pushes).toEqual([
		["quiet", "command", "feature/docs", ""],
		["shown", "observed", "fix/a", "5d6e7f8"],
		["fallback", "command", "", ""],
		["loop", "command", "", ""],
	]);
});

test("parser version 6 starts a new observation generation", () => {
	const [row] = parseGitObservations(
		recordsInput([call("c", "gh run view 1"), result("c", "ok")]),
	);
	expect(row?.parser_version).toBe(6 * 256 + 4);
});

test("recorded gitOperation and pr-link facts add what the output text did not show", async () => {
	const content = await Bun.file(
		new URL(
			"../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/claude-2.1.jsonl",
			import.meta.url,
		),
	).text();
	const records: GitObservationRecord[] = [
		...splitSessionTranscript({
			content,
			sessionDate: "2026-10-01T09:00:00.000Z",
			source: "claude_code",
		}),
	].map((draft) => ({
		agent_id: draft.agentId,
		record_idx: draft.recordIdx,
		block_idx: draft.blockIdx,
		call_id: draft.callId,
		kind: draft.kind,
		subtype: draft.subtype,
		tool_name: draft.toolName,
		is_error: draft.isError,
		exit_code: draft.exitCode,
		ts: draft.ts,
		text: draft.text,
		text_chars: draft.textChars,
		byte_start: String(draft.byteStart),
		byte_len: draft.byteLen,
		facts: { ...draft.facts.extra } as Record<string, string>,
		git_operation: draft.facts.gitOperation,
	}));
	const rows = parseGitObservations({
		organizationId: "org",
		userId: "user",
		sessionId: "session",
		source: "claude_code",
		revision: "100",
		transcriptParserVersion: 8,
		records,
	}).map((row) => ({
		call_id: row.call_id,
		kind: row.kind,
		label: row.label,
		branch: row.branch,
		short_sha: row.short_sha,
		pr: row.pr_number ? `${row.pr_repo}#${row.pr_number}` : "",
	}));
	expect(rows).toEqual([
		// The push's output has no commit or push lines; Claude recorded both.
		{
			call_id: "toolu_push",
			kind: "push_range",
			label: "git_operation",
			branch: "fix/login",
			short_sha: "",
			pr: "",
		},
		{
			call_id: "toolu_push",
			kind: "commit_created",
			label: "git_operation",
			branch: "",
			short_sha: "4f2a9c1",
			pr: "",
		},
		// gh pr create printed the URL; the recorded PR adds nothing.
		{
			call_id: "toolu_pr",
			kind: "pr_url",
			label: "observed",
			branch: "",
			short_sha: "",
			pr: "acme/app#42",
		},
		// The pr-link record names the PR on its own.
		{
			call_id: "",
			kind: "pr_url",
			label: "pr_link",
			branch: "",
			short_sha: "",
			pr: "acme/app#42",
		},
	]);
});

test("a recorded PR number with no URL anywhere keeps its repository unknown", () => {
	// Real shape: `gh pr ready 148` records {pr: {number: 148, action: "ready"}}.
	const rows = parseGitObservations(
		recordsInput([
			call("ready", "gh pr ready 148"),
			result("ready", "", {
				facts: { "git.pr.action": "ready", "git.pr.number": "148" },
				git_operation: ["pr"],
			}),
		]),
	);
	expect(
		rows.map((row) => [row.kind, row.label, row.pr_repo, row.pr_number]),
	).toEqual([["pr_url", "git_operation", "", 148]]);
});

test("a recorded PR number takes the repository its command names, never a guess", () => {
	const ready = (command: string) =>
		parseGitObservations(
			recordsInput([
				call("ready", command),
				result("ready", "", {
					facts: { "git.pr.action": "ready", "git.pr.number": "148" },
					git_operation: ["pr"],
				}),
			]),
		).map((row) => [row.kind, row.pr_repo, row.pr_number]);
	expect(ready("gh pr ready 148 --repo other/app")).toEqual([
		["pr_url", "other/app", 148],
	]);
	expect(ready("gh pr ready -R https://github.com/Other/App.git 148")).toEqual([
		["pr_url", "other/app", 148],
	]);
	expect(ready("gh pr ready https://github.com/other/app/pull/148")).toEqual([
		["pr_url", "other/app", 148],
	]);
	expect(ready("gh pr ready -Rother/app 148")).toEqual([
		["pr_url", "other/app", 148],
	]);
	expect(ready("gh pr ready -R=other/app 148")).toEqual([
		["pr_url", "other/app", 148],
	]);
	expect(ready("gh pr ready 148 --repo github.com/other/app")).toEqual([
		["pr_url", "other/app", 148],
	]);
	// Only the gh pr invocation for this PR names its repository.
	expect(
		ready("gh pr ready 148 --repo a/one && gh pr view 3 --repo b/two"),
	).toEqual([["pr_url", "a/one", 148]]);
	expect(ready('printf "%s" "--repo other/app" && gh pr ready 148')).toEqual([
		["pr_url", "", 148],
	]);
	expect(ready("grep -r foo src && gh pr ready 148")).toEqual([
		["pr_url", "", 148],
	]);
	expect(ready("gh pr ready 148 && gh pr view 3 --repo other/app")).toEqual([
		["pr_url", "", 148],
	]);
	expect(ready("gh --repo other/app pr ready 148")).toEqual([
		["pr_url", "other/app", 148],
	]);
	// An unnumbered invocation may be the same PR in another repository.
	expect(
		ready("gh pr ready --repo a/one && gh pr view 148 --repo b/two"),
	).toEqual([]);
	// Listing PRs elsewhere names no repository for this one.
	expect(ready("gh pr ready 148; gh pr list --repo opalinehq/athena")).toEqual([
		["pr_url", "", 148],
	]);
	// One invocation for it names a repository and another names none.
	expect(ready("gh pr view 148 && gh pr ready --repo b/two")).toEqual([]);
	// The PR's own invocations disagree: ambiguous, so nothing is linked.
	expect(
		ready("gh pr ready 148 --repo a/one || gh pr ready 148 --repo b/two"),
	).toEqual([]);
});

test("a recorded PR whose URL the output lacks becomes a pr_url observation", () => {
	const rows = parseGitObservations(
		recordsInput([
			call("pr", "gh pr ready 7"),
			result("pr", "✓ Pull request #7 is marked as ready for review", {
				facts: {
					"git.pr.action": "ready",
					"git.pr.number": "7",
					"git.pr.url": "https://github.com/acme/app/pull/7",
				},
				git_operation: ["pr"],
			}),
		]),
	);
	expect(
		rows.map((row) => [row.kind, row.label, row.pr_repo, row.pr_number]),
	).toEqual([["pr_url", "git_operation", "acme/app", 7]]);
});

function recordsInput(
	records: GitObservationRecord[],
): GitObservationParseInput {
	return {
		organizationId: "org",
		userId: "user",
		sessionId: "session",
		source: "claude_code",
		revision: "100",
		transcriptParserVersion: 4,
		records: records.map((record, index) => ({
			...record,
			record_idx: index + 1,
		})),
	};
}

function call(
	callId: string,
	text: string,
	toolName = "Bash",
): GitObservationRecord {
	return record(callId, "tool_call", text, { tool_name: toolName });
}

function result(
	callId: string,
	text: string,
	fields: Partial<GitObservationRecord> = {},
): GitObservationRecord {
	return record(callId, "tool_result", text, fields);
}

function record(
	callId: string,
	kind: string,
	text: string,
	fields: Partial<GitObservationRecord>,
): GitObservationRecord {
	return {
		agent_id: "",
		record_idx: 0,
		block_idx: 0,
		call_id: callId,
		kind,
		subtype: "",
		tool_name: "",
		is_error: false,
		exit_code: null,
		ts: "2026-10-07T12:00:00.000Z",
		text,
		text_chars: [...text].length,
		byte_start: "0",
		byte_len: 0,
		...fields,
	};
}
