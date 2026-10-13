import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { splitTranscript } from "./split-transcript.js";
import type { TranscriptRecordDraft } from "./types.js";

/**
 * Received setup (CONTEXT.md): the setup text the agent received in a run, as
 * its transcript records it. The splitter names each piece on its record
 * (`received_setup`: kind, recorded path, name, working directory, content
 * hash and length) and hands its whole text to the writer (`setupTexts`),
 * which stores each distinct text once.
 */

const SESSION_DATE = "2026-08-01T10:00:00.000Z";

function rows(source: "claude_code" | "codex", lines: readonly unknown[]) {
	return [
		...splitTranscript({
			content: lines.map((line) => JSON.stringify(line)).join("\n"),
			fallbackTs: SESSION_DATE,
			source,
		}),
	];
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

interface Piece {
	kind: string;
	path: string;
	name: string;
	cwd: string;
	sha256: string;
	chars: number;
}

function pieces(drafts: readonly TranscriptRecordDraft[]): Piece[] {
	return drafts.flatMap((draft) => {
		const value = draft.facts.extra.received_setup;
		return value === undefined ? [] : (JSON.parse(value) as Piece[]);
	});
}

function texts(drafts: readonly TranscriptRecordDraft[]): string[] {
	return drafts.flatMap((draft) =>
		(draft.setupTexts ?? []).map((entry) => entry.text),
	);
}

const claudeAttachment = (attachment: Record<string, unknown>) => ({
	attachment,
	cwd: "/home/dev/repo",
	timestamp: "2026-08-01T10:00:01.000Z",
	type: "attachment",
});

describe("Claude Code received setup", () => {
	test("instruction files, nested memory and MCP instructions are named by recorded path with their exact text", () => {
		const drafts = rows("claude_code", [
			claudeAttachment({
				files: [
					{
						content: "Personal rules.",
						path: "/home/dev/.claude/CLAUDE.md",
						type: "User",
					},
					{
						content: "Always run the tests.",
						path: "/home/dev/repo/CLAUDE.md",
						type: "Project",
					},
				],
				type: "instructions",
			}),
			claudeAttachment({
				content: {
					content: "Use bun.",
					path: "/home/dev/repo/apps/api/CLAUDE.md",
					type: "Project",
				},
				path: "/home/dev/repo/apps/api/CLAUDE.md",
				type: "nested_memory",
			}),
			claudeAttachment({
				addedBlocks: ["## linear\nUse the issue tools."],
				addedNames: ["linear"],
				type: "mcp_instructions_delta",
			}),
		]);
		const cwd = "/home/dev/repo";
		expect(pieces(drafts)).toEqual([
			{
				kind: "instructions",
				path: "/home/dev/.claude/CLAUDE.md",
				name: "",
				cwd,
				sha256: sha256("Personal rules."),
				chars: 15,
			},
			{
				kind: "instructions",
				path: "/home/dev/repo/CLAUDE.md",
				name: "",
				cwd,
				sha256: sha256("Always run the tests."),
				chars: 21,
			},
			{
				kind: "nested_memory",
				path: "/home/dev/repo/apps/api/CLAUDE.md",
				name: "",
				cwd,
				sha256: sha256("Use bun."),
				chars: 8,
			},
			{
				kind: "mcp_instructions",
				path: "",
				name: "linear",
				cwd,
				sha256: sha256("## linear\nUse the issue tools."),
				chars: 30,
			},
		]);
		expect(texts(drafts)).toEqual([
			"Personal rules.",
			"Always run the tests.",
			"Use bun.",
			"## linear\nUse the issue tools.",
		]);
	});

	test("the system prompt is kept whole, however long, split at the harness's dynamic boundary", () => {
		const long = "Follow the rules. ".repeat(10_000);
		const drafts = rows("claude_code", [
			claudeAttachment({
				systemPrompt: [
					"You are Claude Code.",
					long,
					"__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__",
					"# Environment",
					"Working directory: /home/dev/repo",
				],
				type: "prompt_snapshot",
			}),
		]);
		const fixed = `You are Claude Code.\n\n${long}`;
		const dynamic = "# Environment\n\nWorking directory: /home/dev/repo";
		expect(
			pieces(drafts).map(({ kind, name, sha256: hash, chars }) => ({
				kind,
				name,
				hash,
				chars,
			})),
		).toEqual([
			{
				kind: "system_prompt",
				name: "system_prompt",
				hash: sha256(fixed),
				chars: fixed.length,
			},
			{
				kind: "system_prompt",
				name: "system_prompt_dynamic",
				hash: sha256(dynamic),
				chars: dynamic.length,
			},
		]);
		expect(texts(drafts)).toEqual([fixed, dynamic]);
		// The fact that lists the prompt's parts no longer cuts it either.
		const [snapshot] = drafts;
		expect(snapshot?.facts.extra.facts_clipped ?? "").not.toContain(
			"instruction_text_components",
		);
		expect(snapshot?.facts.extra.instruction_text_components).toContain(
			long.trim(),
		);
	});

	test("a skill body is the skill's text without the machine path line or the invocation's arguments", () => {
		const drafts = rows("claude_code", [
			{
				cwd: "/home/dev/repo",
				isMeta: true,
				message: {
					content: [
						{
							text: "Base directory for this skill: /home/dev/.claude/skills/commit\n\n# Commit\nWrite small commits.\n\n\nARGUMENTS: fix the login test",
							type: "text",
						},
					],
					role: "user",
				},
				timestamp: "2026-08-01T10:00:02.000Z",
				type: "user",
			},
		]);
		expect(pieces(drafts)).toEqual([
			{
				kind: "skill_body",
				path: "/home/dev/.claude/skills/commit/SKILL.md",
				name: "commit",
				cwd: "/home/dev/repo",
				sha256: sha256("# Commit\nWrite small commits."),
				chars: 29,
			},
		]);
		expect(texts(drafts)).toEqual(["# Commit\nWrite small commits."]);
	});
});

describe("Codex received setup", () => {
	const cwd = "/home/dev/repo";
	const sessionMeta = {
		payload: {
			base_instructions: { text: "You are Codex." },
			cli_version: "0.162.0",
			cwd,
			id: "thread-1",
		},
		timestamp: "2026-08-01T10:00:00.000Z",
		type: "session_meta",
	};

	test("base instructions, developer messages and AGENTS.md are received setup; the skill listing is not", () => {
		const drafts = rows("codex", [
			sessionMeta,
			{
				payload: {
					content: [
						{
							text: "<skills_instructions>\n## Skills\n- commit\n</skills_instructions>",
							type: "input_text",
						},
						{
							text: "<permissions instructions>\nThe sandbox is workspace-write.\n</permissions instructions>",
							type: "input_text",
						},
					],
					role: "developer",
					type: "message",
				},
				timestamp: "2026-08-01T10:00:00.100Z",
				type: "response_item",
			},
			{
				payload: {
					content: [
						{
							text: `# AGENTS.md instructions for ${cwd}\n\n<INSTRUCTIONS>\nRun bun test.\n</INSTRUCTIONS>`,
							type: "input_text",
						},
						{
							text: `<environment_context>\n  <cwd>${cwd}</cwd>\n</environment_context>`,
							type: "input_text",
						},
					],
					role: "user",
					type: "message",
				},
				timestamp: "2026-08-01T10:00:00.200Z",
				type: "response_item",
			},
		]);
		const permissions =
			"<permissions instructions>\nThe sandbox is workspace-write.\n</permissions instructions>";
		expect(pieces(drafts)).toEqual([
			{
				kind: "system_prompt",
				path: "",
				name: "base_instructions",
				cwd,
				sha256: sha256("You are Codex."),
				chars: 14,
			},
			{
				kind: "developer",
				path: "",
				name: "permissions instructions",
				cwd,
				sha256: sha256(permissions),
				chars: permissions.length,
			},
			{
				kind: "agents_md",
				path: `${cwd}/AGENTS.md`,
				name: "",
				cwd,
				sha256: sha256("Run bun test."),
				chars: 13,
			},
		]);
		expect(texts(drafts)).toEqual([
			"You are Codex.",
			permissions,
			"Run bun test.",
		]);
	});

	test("a whole SKILL.md the agent read with cat is a skill body; a partial or mixed read is not", () => {
		const completed = (id: string, command: string, stdout: string) => ({
			payload: {
				item: {
					command: ["/bin/zsh", "-lc", command],
					cwd: `file://${cwd}`,
					exit_code: 0,
					id,
					status: "completed",
					stdout,
					type: "CommandExecution",
				},
				type: "item_completed",
			},
			timestamp: "2026-08-01T10:00:03.000Z",
			type: "event_msg",
		});
		const drafts = rows("codex", [
			sessionMeta,
			completed(
				"exec-1",
				"cat .agents/skills/design/SKILL.md",
				"---\nname: design\n---\nKeep it local.\n",
			),
			completed(
				"exec-2",
				"sed -n '1,5p' .agents/skills/data/SKILL.md",
				"---\nname: data\n",
			),
			completed("exec-3", "cat .agents/skills/{a,b}/SKILL.md", "one\ntwo\n"),
		]);
		expect(
			pieces(drafts).filter((piece) => piece.kind === "skill_body"),
		).toEqual([
			{
				kind: "skill_body",
				path: `${cwd}/.agents/skills/design/SKILL.md`,
				name: "design",
				cwd,
				sha256: sha256("---\nname: design\n---\nKeep it local.\n"),
				chars: 36,
			},
		]);
	});
});
