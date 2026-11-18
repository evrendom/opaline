import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	buildClaudeSkillCorpus,
	buildCodexSkillCorpus,
} from "./fixtures/skill-transcript-corpus.js";
import {
	extractSessionSkills,
	hashSkillSourceContent,
	SKILL_PARSER_VERSION,
} from "./skill-extraction.js";

describe("extractSessionSkills", () => {
	test("records 100% Claude body recovery and preserves plugin names", () => {
		const result = extractSessionSkills({
			content: buildClaudeSkillCorpus(),
			sessionDate: "2026-08-01T00:00:00.000Z",
			source: "claude_code",
		});

		expect(result.agent).toBe("claude");
		expect(result.parserVersion).toBe(SKILL_PARSER_VERSION);
		expect(result.sourceContentSha256).toHaveLength(64);
		expect(result.uses.every((use) => use.content !== null)).toBe(true);
		expect(result.uses.some((use) => use.name === "atlas:humanizer")).toBe(
			true,
		);
	});

	test("meets the documented 60% Codex corpus recovery floor without hiding gaps", () => {
		const result = extractSessionSkills({
			content: buildCodexSkillCorpus(),
			sessionDate: "2026-08-02T00:00:00.000Z",
			source: "codex",
		});
		const recovered = result.uses.filter((use) => use.content !== null).length;
		const recoveryRate = recovered / result.uses.length;

		expect(result.uses).toHaveLength(5);
		expect(recovered).toBe(3);
		expect(recoveryRate).toBeGreaterThanOrEqual(0.6);
		expect(result.uses.filter((use) => use.content === null)).toHaveLength(2);
	});

	test("accepts an explicit parser version for controlled re-extraction", () => {
		const result = extractSessionSkills({
			content: "",
			parserVersion: SKILL_PARSER_VERSION + 1,
			sessionDate: "2026-08-02T00:00:00.000Z",
			source: "codex",
		});

		expect(result.parserVersion).toBe(SKILL_PARSER_VERSION + 1);
	});

	test("reads skills from bundled Claude subagent transcripts as well", () => {
		const invocation = (name: string, timestamp: string) =>
			JSON.stringify({
				message: {
					content: [
						{
							id: `t-${name}`,
							input: { skill: name },
							name: "Skill",
							type: "tool_use",
						},
					],
					role: "assistant",
				},
				timestamp,
				type: "assistant",
			});
		const body = (name: string, text: string) =>
			JSON.stringify({
				isMeta: true,
				message: {
					content: `Base directory for this skill: /Users/test/.claude/skills/${name}\n\n${text}`,
					role: "user",
				},
				timestamp: "2026-08-01T10:00:05.000Z",
				type: "user",
			});
		const main = invocation("shared", "2026-08-01T10:03:00.000Z");
		const child = [
			invocation("shared", "2026-08-01T10:01:00.000Z"),
			body("shared", "# Shared body\n"),
			invocation("child-only", "2026-08-01T10:02:00.000Z"),
			body("child-only", "# Child body\n"),
		].join("\n");

		const result = extractSessionSkills({
			content: main,
			sessionDate: "2026-08-01T00:00:00.000Z",
			source: "claude_code",
			subagents: { "agent-1": child },
		});

		expect(result.uses).toEqual([
			{
				content: "# Child body\n",
				name: "child-only",
				usedAt: "2026-08-01T10:02:00.000Z",
			},
			{
				content: "# Shared body\n",
				name: "shared",
				usedAt: "2026-08-01T10:01:00.000Z",
			},
		]);
		expect(result.sourceContentSha256).toBe(
			hashSkillSourceContent(main, { "agent-1": child }),
		);
	});

	test("without subagents the source hash is the main transcript's, so existing receipts stay current", () => {
		expect(hashSkillSourceContent("main")).toBe(
			createHash("sha256").update("main", "utf8").digest("hex"),
		);
		expect(hashSkillSourceContent("main", {})).toBe(
			hashSkillSourceContent("main"),
		);
	});
});
