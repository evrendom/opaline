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

test("Codex PTY polls retain originating commands, agent scope and failure checks", () => {
	const input = parseInput(codexGitContinuationFixture());
	const rows = parseGitObservations({
		...input,
		records: [
			...input.records.filter((record) => record.kind !== "tool_result"),
			...input.records.filter((record) => record.kind === "tool_result"),
		],
	});
	expect(rows).toHaveLength(3);
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

test("MCP inner failure and explicit nonzero exit code never become PR observations", () => {
	const input = parseInput(claudeGitFixture());
	const rows = parseGitObservations({
		...input,
		records: input.records.map((record) =>
			record.kind === "tool_result"
				? { ...record, raw: undefined, exit_code: 1 }
				: record,
		),
	});
	expect(rows).toHaveLength(0);
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
		...splitSessionTranscript({ ...fixture, sessionDate: fixture.timestamp }),
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
