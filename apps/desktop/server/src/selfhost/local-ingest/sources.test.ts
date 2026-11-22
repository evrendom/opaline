import { describe, expect, test } from "bun:test";
import { classifyTranscriptPath, localIngestRoots } from "./sources.js";

const roots = {
	claudeProjects: "/home/u/.claude/projects",
	codexSessions: "/home/u/.codex/sessions",
	codexArchivedSessions: "/home/u/.codex/archived_sessions",
};

describe("classifyTranscriptPath", () => {
	test("a Claude Code session file is its own session", () => {
		expect(
			classifyTranscriptPath(
				roots,
				"/home/u/.claude/projects/-repo/abc-123.jsonl",
			),
		).toEqual({
			path: "/home/u/.claude/projects/-repo/abc-123.jsonl",
			source: "claude_code",
			role: "session",
			sessionPath: "/home/u/.claude/projects/-repo/abc-123.jsonl",
		});
	});

	test("a nested subagent belongs to its parent session", () => {
		expect(
			classifyTranscriptPath(
				roots,
				"/home/u/.claude/projects/-repo/abc-123/subagents/agent-a1b2.jsonl",
			),
		).toEqual({
			path: "/home/u/.claude/projects/-repo/abc-123/subagents/agent-a1b2.jsonl",
			source: "claude_code",
			role: "subagent",
			sessionPath: "/home/u/.claude/projects/-repo/abc-123.jsonl",
		});
	});

	test("Codex rollouts are sessions; other files are not transcripts", () => {
		expect(
			classifyTranscriptPath(
				roots,
				"/home/u/.codex/sessions/2026/11/09/rollout-2026-11-09T10-00-00-abc.jsonl",
			)?.source,
		).toBe("codex");
		for (const path of [
			"/home/u/.claude/projects/-repo/agent-old.jsonl",
			"/home/u/.claude/projects/-repo/abc.jsonl.superseded-1",
			"/home/u/.claude/projects/-repo/abc.orphaned-2.jsonl.tmp",
			"/home/u/.claude/projects/abc.jsonl",
			"/home/u/.claude/projects/-repo/abc/tool-results/x.jsonl",
			"/home/u/.claude/settings.json",
			"/home/u/elsewhere/a.jsonl",
			"/home/u/.codex/sessions/.hidden.jsonl",
		])
			expect(classifyTranscriptPath(roots, path)).toBeNull();
	});
});

test("Codex sessions it has compressed are read too; Claude Code files are never .zst", () => {
	const compressed =
		"/home/u/.codex/sessions/2026/10/26/rollout-2026-10-26T12-08-57-abc.jsonl.zst";
	expect(classifyTranscriptPath(roots, compressed)).toEqual({
		path: compressed,
		source: "codex",
		role: "session",
		sessionPath: compressed,
	});
	expect(
		classifyTranscriptPath(
			roots,
			"/home/u/.claude/projects/-repo/abc-123.jsonl.zst",
		),
	).toBeNull();
});

test("roots follow HOME, CLAUDE_CONFIG_DIR, CODEX_HOME and GEMINI_CLI_HOME", () => {
	expect(localIngestRoots({ HOME: "/h" })).toEqual({
		claudeProjects: "/h/.claude/projects",
		codexSessions: "/h/.codex/sessions",
		codexArchivedSessions: "/h/.codex/archived_sessions",
		geminiTmp: "/h/.gemini/tmp",
		antigravityBrains: [
			"/h/.gemini/antigravity-cli/brain",
			"/h/.gemini/antigravity/brain",
		],
		antigravityProviders: "/h/.t3/userdata/providers/antigravity",
	});
	expect(
		localIngestRoots({
			HOME: "/h",
			CLAUDE_CONFIG_DIR: "/c",
			CODEX_HOME: "/x",
			GEMINI_CLI_HOME: "/g",
		}),
	).toMatchObject({
		claudeProjects: "/c/projects",
		codexSessions: "/x/sessions",
		codexArchivedSessions: "/x/archived_sessions",
		geminiTmp: "/g/.gemini/tmp",
	});
});

describe("Gemini", () => {
	const gemini = localIngestRoots({ HOME: "/home/u" });

	test("Gemini CLI chats, new and old format, are sessions", () => {
		for (const name of [
			"session-2026-11-20T10-00-8d1f6a6e.jsonl",
			"session-2025-07-01T10-00-8d1f6a6e.json",
		]) {
			const path = `/home/u/.gemini/tmp/opaline/chats/${name}`;
			expect(classifyTranscriptPath(gemini, path)).toEqual({
				path,
				source: "gemini",
				role: "session",
				sessionPath: path,
			});
		}
	});

	test("an Antigravity conversation's compact transcript is its session", () => {
		for (const app of ["antigravity-cli", "antigravity"]) {
			const path = `/home/u/.gemini/${app}/brain/9945766e-fe6b-4cba-bae8-63fee85f1f20/.system_generated/logs/transcript.jsonl`;
			expect(classifyTranscriptPath(gemini, path)).toEqual({
				path,
				source: "gemini",
				role: "session",
				sessionPath: path,
			});
		}
	});

	test("an Antigravity conversation T3 Code ran is a session, in any of its workspaces", () => {
		const path =
			"/home/u/.t3/userdata/providers/antigravity/ac0a3d/antigravity-acp/brain/56af79ec-df93-4ced-8c36-006a7eaadff8/.system_generated/logs/transcript.jsonl";
		expect(classifyTranscriptPath(gemini, path)).toEqual({
			path,
			source: "gemini",
			role: "session",
			sessionPath: path,
		});
		expect(
			classifyTranscriptPath(
				gemini,
				"/home/u/.t3/userdata/providers/antigravity/ac0a3d/antigravity-acp/conversations/56af79ec.pb",
			),
		).toBeNull();
	});

	test("subagent chats, logs and other files are not sessions of their own", () => {
		for (const path of [
			"/home/u/.gemini/tmp/opaline/chats/8d1f6a6e-5b0c-4e45-9a0e-1f3f0c7e2b11/sub-1.jsonl",
			"/home/u/.gemini/tmp/opaline/logs.json",
			"/home/u/.gemini/tmp/opaline/chats/notes.jsonl",
			"/home/u/.gemini/tmp/opaline/chats/session-a.jsonl.unreadable-1",
			"/home/u/.gemini/antigravity-cli/brain/abc/.system_generated/logs/transcript_full.jsonl",
			"/home/u/.gemini/antigravity-cli/brain/abc/task.md",
			"/home/u/.gemini/antigravity/conversations/abc.pb",
		])
			expect(classifyTranscriptPath(gemini, path)).toBeNull();
	});
});

test("an archived Codex rollout is a Codex session, compressed or not", () => {
	for (const name of [
		"rollout-2026-03-01T10-00-00-a.jsonl",
		"rollout-2026-03-01T10-00-00-a.jsonl.zst",
	]) {
		const path = `/home/u/.codex/archived_sessions/${name}`;
		expect(classifyTranscriptPath(roots, path)).toEqual({
			path,
			source: "codex",
			role: "session",
			sessionPath: path,
		});
	}
});
