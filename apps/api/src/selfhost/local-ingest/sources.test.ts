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

test("roots follow HOME, CLAUDE_CONFIG_DIR and CODEX_HOME", () => {
	expect(localIngestRoots({ HOME: "/h" })).toEqual({
		claudeProjects: "/h/.claude/projects",
		codexSessions: "/h/.codex/sessions",
		codexArchivedSessions: "/h/.codex/archived_sessions",
	});
	expect(
		localIngestRoots({ HOME: "/h", CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/x" }),
	).toEqual({
		claudeProjects: "/c/projects",
		codexSessions: "/x/sessions",
		codexArchivedSessions: "/x/archived_sessions",
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
