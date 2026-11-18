import { describe, expect, test } from "bun:test";
import {
	extractShellFileMutations,
	extractShellFileReads,
} from "./command-class.js";
import { splitTranscript } from "./split-transcript.js";
import type { TranscriptRecordDraft, TranscriptSource } from "./types.js";

async function split(
	name: string,
	source: TranscriptSource,
): Promise<TranscriptRecordDraft[]> {
	const content = await Bun.file(
		new URL(`../__fixtures__/l1-facts/${name}`, import.meta.url),
	).text();
	return [
		...splitTranscript({
			agentId: "",
			content,
			fallbackTs: "2026-11-01T00:00:00.000Z",
			source,
		}),
	];
}

const claude = () => split("claude-capture-2.1.jsonl", "claude_code");
const codex = () => split("codex-capture-0.162.jsonl", "codex");

function row(
	drafts: readonly TranscriptRecordDraft[],
	callId: string,
	kind: string,
): TranscriptRecordDraft {
	const found = drafts.find(
		(draft) => draft.callId === callId && draft.kind === kind,
	);
	if (found === undefined) throw new Error(`no ${kind} of ${callId}`);
	return found;
}

function list(draft: TranscriptRecordDraft, key: "files_read"): string[] {
	return JSON.parse(draft.facts.extra[key] ?? "[]") as string[];
}

function shellLine(callId: string, command: string, cwd: string): string {
	return JSON.stringify({
		type: "assistant",
		cwd,
		timestamp: "2026-11-01T10:00:00.000Z",
		message: {
			role: "assistant",
			content: [
				{ type: "tool_use", id: callId, name: "Bash", input: { command } },
			],
		},
	});
}

describe("capture facts", () => {
	test("a call lists every file it reads, resolved against its working directory and home", async () => {
		const drafts = await claude();
		const docs = row(drafts, "toolu_docs", "tool_call");
		expect(list(docs, "files_read")).toEqual([
			"/Users/dev/work/app/docs/CLAUDE.md",
			"/Users/dev/work/app/AGENTS.md",
			"/Users/dev/work/app/docs/notes.md",
			"/Users/dev/work/app/README.md",
		]);
		expect(docs.filePath).toBe("/Users/dev/work/app/docs/CLAUDE.md");
		expect(list(row(drafts, "toolu_skill", "tool_call"), "files_read")).toEqual(
			["/Users/dev/work/app/.claude/skills/testing/SKILL.md"],
		);
		const write = row(drafts, "toolu_write", "file_change");
		expect([write.filePath, write.fileOp]).toEqual([
			"/Users/dev/work/app/docs/notes.md",
			"write",
		]);
		expect(list(row(drafts, "toolu_write", "tool_call"), "files_read")).toEqual(
			["/Users/dev/work/app/package.json"],
		);
	});

	test("a cd inside a subshell ends with it; one in a group does not", () => {
		const context = { cwd: "/w", home: "/Users/dev" };
		expect(
			extractShellFileReads(
				"(cd a && cat x); (cd b && cat y); { cd c; cat z; }; cat q",
				context,
			),
		).toEqual(["/w/a/x", "/w/b/y", "/w/c/z", "/w/c/q"]);
		expect(
			extractShellFileMutations(
				"cd ~/r && (cd pkg && bun test) && cd apps/api && echo x > t.json",
				context,
			).map((mutation) => mutation.path),
		).toEqual(["/Users/dev/r/apps/api/t.json"]);
	});

	test("paths stay as written where the working directory is unknown", () => {
		const content = shellLine("toolu_x", "cd ~/repo && cat a.md", "relative");
		const [call] = [
			...splitTranscript({
				agentId: "",
				content,
				fallbackTs: "2026-11-01T00:00:00.000Z",
				source: "claude_code",
			}),
		].filter((draft) => draft.kind === "tool_call");
		expect(call?.filePath).toBe("a.md");
	});

	test("files_read keeps its first entries and counts the rest", () => {
		const files = Array.from(
			{ length: 2_000 },
			(_, index) => `${"d".repeat(40)}/f${index}.md`,
		);
		const content = shellLine(
			"toolu_many",
			`cat ${files.join(" ")}`,
			"/Users/dev/work/app",
		);
		const [call] = [
			...splitTranscript({
				agentId: "",
				content,
				fallbackTs: "2026-11-01T00:00:00.000Z",
				source: "claude_code",
			}),
		].filter((draft) => draft.kind === "tool_call");
		const extra = call?.facts.extra ?? {};
		const kept = JSON.parse(extra.files_read ?? "[]") as string[];
		expect(kept[0]).toBe(`/Users/dev/work/app/${"d".repeat(40)}/f0.md`);
		expect(kept.length + Number(extra.files_read_more)).toBe(2_000);
		expect(extra.facts_clipped).toContain("files_read");
	});

	test("a Codex command's reads resolve against its workdir", async () => {
		const call = row(await codex(), "call_read", "tool_call");
		expect(list(call, "files_read")).toEqual([
			"/Users/dev/work/app/pkg/AGENTS.md",
			"/Users/dev/notes.md",
		]);
		expect(JSON.parse(call.facts.extra.command_classes ?? "[]")).toEqual([
			"other",
			"typecheck",
		]);
		const patch = row(await codex(), "call_patch", "file_change");
		expect([patch.filePath, patch.fileOp]).toEqual([
			"/Users/dev/work/app/src/a.ts",
			"edit",
		]);
	});

	test("a compound command keeps the class of each program it runs", async () => {
		const call = row(await claude(), "toolu_checks", "tool_call");
		expect(call.commandClass).toBe("test");
		expect(JSON.parse(call.facts.extra.command_classes ?? "[]")).toEqual([
			"test",
			"typecheck",
			"other",
		]);
		const docs = row(await claude(), "toolu_docs", "tool_call");
		expect(JSON.parse(docs.facts.extra.command_classes ?? "[]")).toEqual([
			"other",
		]);
	});

	test("a compaction's summary after its boundary is counted once", async () => {
		const compactions = (await claude()).filter(
			(draft) => draft.kind === "compaction",
		);
		expect(
			compactions.map((draft) => [
				draft.subtype,
				draft.facts.extra.compaction_of ?? "",
			]),
		).toEqual([
			["compact_boundary", ""],
			["compact_summary", String(compactions[0]?.recordIdx)],
		]);
	});

	test("a Codex compaction event next to its compacted record is counted once", async () => {
		const compactions = (await codex()).filter(
			(draft) => draft.kind === "compaction",
		);
		expect(
			compactions.map((draft) => draft.facts.extra.compaction_of ?? ""),
		).toEqual(["", String(compactions[0]?.recordIdx)]);
	});

	test("a PreToolUse hook block Claude Code records as permission-rule is a hook refusal", async () => {
		const result = row(await claude(), "toolu_hook", "tool_result");
		expect(result.facts.denialKind).toBe("hook");
		expect(result.facts.extra.denial_reason).toBe(
			"STOP: This command cannot install or download packages.",
		);
		const rule = row(
			await split("claude-2.1.jsonl", "claude_code"),
			"toolu_rm",
			"tool_result",
		);
		expect(rule.facts.denialKind).toBe("permission-rule");
	});
});
