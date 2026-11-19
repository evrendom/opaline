import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { argvToCommand } from "./codex-completed-items.js";
import {
	decodeTranscriptLine,
	splitSessionTranscript,
} from "./split-transcript.js";
import type { TranscriptRecordDraft } from "./types.js";

const SESSION_DATE = "2026-09-01T00:00:00.000Z";
const ITEMS_ERA = "codex-items-era-complete.jsonl";
const SCRIPT_ERA = "codex-script-era-commands.jsonl";

async function fixture(name: string): Promise<string> {
	return Bun.file(new URL(`../__fixtures__/${name}`, import.meta.url)).text();
}

function split(
	content: string,
	options: { textBudgetChars?: number; textMaxChars?: number } = {},
): TranscriptRecordDraft[] {
	return [
		...splitSessionTranscript({
			content,
			sessionDate: SESSION_DATE,
			source: "codex",
			...options,
		}),
	];
}

function rawLines(content: string): Record<string, unknown>[] {
	return content
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function item(record: Record<string, unknown>): Record<string, unknown> {
	const payload = record.payload as Record<string, unknown>;
	return (payload.item ?? {}) as Record<string, unknown>;
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("Codex prompts", () => {
	test("a prompt sent again after a turn with no reply is a prompt of its own", async () => {
		const rows = split(await fixture(ITEMS_ERA));
		const prompts = rows.filter((row) => row.kind === "user_prompt");
		expect(
			prompts.map((row) => [row.recordIdx, row.turnIdx, row.text]),
		).toEqual([
			[2, 1, "what took you so long"],
			[5, 1, "what took you so long"],
		]);
		expect(
			rows
				.filter((row) => row.subtype === "item_completed:UserMessage")
				.map((row) => row.recordIdx),
		).toEqual([3, 6]);
	});

	test("every UserMessage the rollout completed is one prompt", async () => {
		const content = await fixture(ITEMS_ERA);
		const userMessages = rawLines(content).filter(
			(record) => item(record).type === "UserMessage",
		);
		const prompts = split(content).filter((row) => row.kind === "user_prompt");
		expect(prompts).toHaveLength(userMessages.length);
	});

	test("a UserMessage with no response item copy is the prompt", async () => {
		const lines = (await fixture(ITEMS_ERA)).split("\n");
		const withoutCopy = lines.filter((_, index) => index !== 4).join("\n");
		const prompts = split(withoutCopy).filter(
			(row) => row.kind === "user_prompt",
		);
		expect(prompts.map((row) => [row.recordIdx, row.text])).toEqual([
			[2, "what took you so long"],
			[5, "what took you so long"],
		]);
	});

	test("a goal continuation is injected context, not a prompt", async () => {
		const rows = split(await fixture(ITEMS_ERA));
		const goal = rows.find((row) => row.recordIdx === 9);
		expect(goal).toMatchObject({
			kind: "injected_context",
			subtype: "internal_context",
		});
		expect(goal?.text).toStartWith('<codex_internal_context source="goal">');
	});
});

describe("Codex commands and outputs", () => {
	test("each command item keeps its whole command and output, past any session budget", async () => {
		const content = await fixture(ITEMS_ERA);
		const commands = rawLines(content)
			.map(item)
			.filter((completed) => completed.type === "CommandExecution");
		expect(commands.length).toBe(3);
		for (const textBudgetChars of [undefined, 0]) {
			const rows = split(content, { textBudgetChars });
			for (const command of commands) {
				const call = rows.find(
					(row) => row.kind === "tool_call" && row.callId === command.id,
				);
				const result = rows.find(
					(row) => row.kind === "tool_result" && row.callId === command.id,
				);
				expect(call?.text).toBe(argvToCommand(command.command));
				expect(call?.textChars).toBe(call?.text.length ?? -1);
				expect(result?.text).toBe(
					[command.stdout, command.stderr]
						.filter((part) => typeof part === "string" && part !== "")
						.join("\n"),
				);
			}
			const longest = rows.find(
				(row) =>
					row.callId === "exec-b6498ace-0410-4b29-8ada-19433a108ff1" &&
					row.kind === "tool_call",
			);
			expect(longest?.text.length).toBe(1_550);
			const missing = rows.find(
				(row) =>
					row.kind === "tool_result" &&
					row.callId === "exec-f05bb7eb-bc99-4845-90f9-8e0be6f0d30a",
			);
			expect(missing?.text).toContain("command not found: docker");
			expect(missing?.exitCode).toBe(127);
		}
	});

	test("the session budget cuts only injected context, and the cut record says so", async () => {
		const rows = split(await fixture(ITEMS_ERA), { textBudgetChars: 0 });
		const cut = rows.filter((row) => row.text.length < row.textChars);
		expect(cut.map((row) => [row.recordIdx, row.kind])).toEqual([
			[9, "injected_context"],
		]);
		const goal = cut[0];
		const [full] = decodeTranscriptLine({
			agentId: "",
			line: (await fixture(ITEMS_ERA)).split("\n")[8] ?? "",
			source: "codex",
		});
		expect(goal?.facts.extra).toMatchObject({
			body_sha256: sha256(full?.text ?? ""),
			text_cut: "budget",
		});
	});

	test("a record over its cap keeps the cap and names the hash of its whole text", async () => {
		const content = await fixture(ITEMS_ERA);
		const rows = split(content, { textMaxChars: 100 });
		const script = rows.find(
			(row) =>
				row.kind === "tool_result" &&
				row.callId === "call_EQaoOR2LnXh3OoPBEC3jVgRX",
		);
		expect(script?.text.length).toBe(100);
		expect(script?.textChars).toBe(2_001);
		const line = content.split("\n")[(script?.recordIdx ?? 0) - 1] ?? "";
		const full = decodeTranscriptLine({ agentId: "", line, source: "codex" });
		expect(script?.facts.extra).toMatchObject({
			body_sha256: sha256(full[0]?.text ?? ""),
			text_cut: "cap",
		});
		expect(full[0]?.text).toContain("command not found: docker");
		const whole = rows.filter((row) => row.text.length === row.textChars);
		for (const row of whole) expect(row.facts.extra.text_cut).toBeUndefined();
	});
});

describe("Codex code-mode scripts", () => {
	test("each command a script runs is a call of its own where Codex recorded no command item", async () => {
		const rows = split(await fixture(SCRIPT_ERA));
		const commands = rows.filter((row) => row.subtype === "script");
		expect(
			commands.map((row) => [
				row.recordIdx,
				row.blockIdx,
				row.callId,
				row.toolName,
				row.facts.extra.script_call_id,
			]),
		).toEqual([
			[
				1,
				1,
				"call_IrGZgx3YoqyINGGE51fGUUE0#1",
				"exec_command",
				"call_IrGZgx3YoqyINGGE51fGUUE0",
			],
			[
				1,
				2,
				"call_IrGZgx3YoqyINGGE51fGUUE0#2",
				"exec_command",
				"call_IrGZgx3YoqyINGGE51fGUUE0",
			],
			[
				1,
				3,
				"call_IrGZgx3YoqyINGGE51fGUUE0#3",
				"exec_command",
				"call_IrGZgx3YoqyINGGE51fGUUE0",
			],
			[
				1,
				4,
				"call_IrGZgx3YoqyINGGE51fGUUE0#4",
				"exec_command",
				"call_IrGZgx3YoqyINGGE51fGUUE0",
			],
			[
				1,
				5,
				"call_IrGZgx3YoqyINGGE51fGUUE0#5",
				"exec_command",
				"call_IrGZgx3YoqyINGGE51fGUUE0",
			],
			[
				3,
				1,
				"call_pJ3Rouz74vZJNN0AiZyHkoXP#1",
				"exec_command",
				"call_pJ3Rouz74vZJNN0AiZyHkoXP",
			],
		]);
		expect(commands[0]?.text).toBe(
			"pwd; git status --short; git branch --show-current; rg --files -g 'AGENTS.md' -g '*glossar*' -g '*GLOSSAR*' -g '*adr*' -g '*ADR*' -g 'package.json' -g 'bun.lock*' -g '!node_modules' | sed -n '1,240p'",
		);
		expect(commands[4]?.text).toBe(
			"sed -n '1,320p' .claude/skills/api-testing/SKILL.md",
		);
		expect(commands[5]?.text).toBe("gh pr view 438 --json body --jq .body");
		for (const command of commands)
			expect(command.textChars).toBe(command.text.length);
	});

	test("a command built at run time is counted on its script", async () => {
		const rows = split(await fixture(SCRIPT_ERA));
		const scripts = rows.filter(
			(row) => row.kind === "tool_call" && row.toolName === "exec",
		);
		expect(
			scripts.map((row) => row.facts.extra.script_commands_unresolved),
		).toEqual([undefined, "1"]);
	});

	test("a stream with command items gets no script calls: each command is counted once", async () => {
		const rows = split(await fixture(ITEMS_ERA));
		expect(rows.filter((row) => row.subtype === "script")).toEqual([]);
		expect(
			rows.filter(
				(row) => row.kind === "tool_call" && row.subtype === "nested",
			),
		).toHaveLength(3);
	});
});

describe("Codex file changes", () => {
	test("a patch row is the request; the FileChange that applied it names the path as applied", async () => {
		for (const factBudgetChars of [undefined, 0]) {
			const rows = [
				...splitSessionTranscript({
					content: await fixture(ITEMS_ERA),
					factBudgetChars,
					sessionDate: SESSION_DATE,
					source: "codex",
				}),
			];
			const path =
				"/Users/dev/conductor/workspaces/athena/tunis/apps/web/src/components/ui/fluid-menu-hover.css";
			const patch = rows.find((row) => row.kind === "file_change");
			expect(patch).toMatchObject({ filePath: path, subtype: "patch" });
			expect(patch?.facts.extra.file_change_basis).toBe("requested");
			const applied = rows.find(
				(row) => row.subtype === "item_completed:FileChange_mirror",
			);
			expect(JSON.parse(applied?.facts.extra.applied_changes ?? "[]")).toEqual([
				{ move_path: null, path, type: "update" },
			]);
		}
	});
});
