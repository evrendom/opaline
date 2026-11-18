import { describe, expect, test } from "bun:test";
import { readGuardRefusal } from "./guard-refusal.js";
import { splitSessionTranscript, splitTranscript } from "./split-transcript.js";
import type { TranscriptRecordDraft, TranscriptSource } from "./types.js";

const RUNNER = ["bun", "x"].join("");
const STOP = `STOP: Do not use ${RUNNER}.\n\nReplace ${RUNNER} with safe-run.\nKeep the package and all arguments.\n\nYou entered:\n  ${RUNNER} tsc --noEmit\n`;

async function fixture(): Promise<TranscriptRecordDraft[]> {
	const content = await Bun.file(
		new URL(
			"../__fixtures__/l1-facts/codex-inner-calls-0.153.jsonl",
			import.meta.url,
		),
	).text();
	return [
		...splitSessionTranscript({
			content,
			sessionDate: "2026-09-06T07:20:00.000Z",
			source: "codex",
		}),
	];
}

let second = 0;
function line(type: string, payload: Record<string, unknown>): string {
	second++;
	return JSON.stringify({
		payload,
		timestamp: `2026-09-01T10:00:${String(second % 60).padStart(2, "0")}.000Z`,
		type,
	});
}

function split(
	lines: readonly string[],
	source: TranscriptSource = "codex",
): TranscriptRecordDraft[] {
	return [
		...splitTranscript({
			content: lines.join("\n"),
			fallbackTs: "2026-09-01T10:00:00.000Z",
			source,
		}),
	];
}

function row(
	rows: readonly TranscriptRecordDraft[],
	callId: string,
	kind: string,
): TranscriptRecordDraft {
	const found = rows.find((r) => r.callId === callId && r.kind === kind);
	if (found === undefined) throw new Error(`no ${kind} ${callId}`);
	return found;
}

describe("Codex inner calls", () => {
	test("a script failure an inner MCP call threw stays on that call", async () => {
		const rows = await fixture();
		const inner = row(
			rows,
			"exec-11111111-1111-4111-8111-111111111111",
			"tool_result",
		);
		const script = row(rows, "call_script_mcp", "tool_result");
		expect(inner.isError).toBe(true);
		expect(script.isError).toBe(false);
		expect(script.exitCode).toBeNull();
		expect(script.facts.extra.error_from_call_id).toBe(inner.callId);
		expect(
			row(rows, inner.callId, "tool_call").facts.extra.script_call_id,
		).toBe("call_script_mcp");
	});

	test("a refusal an inner command printed stays on that command", async () => {
		const rows = await fixture();
		const inner = row(
			rows,
			"exec-22222222-2222-4222-8222-222222222222",
			"tool_result",
		);
		expect(inner).toMatchObject({ isError: true, exitCode: 1 });
		expect(inner.facts.denialKind).toBe("guard");
		expect(inner.facts.extra.denial_reason).toBe(`STOP: Do not use ${RUNNER}.`);
		const script = row(rows, "call_script_guard", "tool_result");
		expect(script).toMatchObject({ isError: false, exitCode: null });
		expect(script.facts.denialKind).toBe("");
		expect(script.facts.extra.error_from_call_id).toBe(inner.callId);
	});

	test("a top-level js call's failure is on its completed item", async () => {
		const rows = await fixture();
		const mirror = rows.find(
			(r) => r.callId === "call_js_top" && r.kind === "meta",
		);
		expect(mirror?.subtype).toBe("item_completed:McpToolCall_mirror");
		expect(mirror?.isError).toBe(true);
		expect(row(rows, "call_js_top", "tool_result").isError).toBe(false);
	});

	test("a Codex prompt carries its turn's working directory", async () => {
		const prompt = (await fixture()).find((r) => r.kind === "user_prompt");
		expect(prompt?.facts.extra.turn_cwd).toBe("/Users/dev/work/app-feature");
	});

	test("patches a script ran are file changes once, on the script or its patch item", async () => {
		const changes = (await fixture())
			.filter((r) => r.kind === "file_change")
			.map((r) => [r.callId, r.fileOp, r.filePath.split("/").at(-1)]);
		expect(changes).toEqual([
			["call_script_patch", "edit", "page.ts"],
			["call_script_patch", "write", "new.ts"],
			["exec-33333333-3333-4333-8333-333333333333", "edit", "extra.ts"],
		]);
	});

	test("a script command names the directory it asked to run in", () => {
		const rows = split([
			line("response_item", {
				content: [{ text: "typecheck", type: "input_text" }],
				role: "user",
				type: "message",
			}),
			line("response_item", {
				call_id: "call_old",
				input: `const r = await tools.exec_command({cmd:"${RUNNER} tsc --noEmit",workdir:"/repo/packages/api"});\ntext(r.output);\n`,
				name: "exec",
				status: "completed",
				type: "custom_tool_call",
			}),
			line("response_item", {
				call_id: "call_old",
				output: [
					{
						text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
						type: "input_text",
					},
					{ text: STOP, type: "input_text" },
				],
				type: "custom_tool_call_output",
			}),
		]);
		const command = row(rows, "call_old#1", "tool_call");
		expect(command.facts.extra.workdir).toBe("/repo/packages/api");
		expect(command.facts.extra.script_call_id).toBe("call_old");
		const script = row(rows, "call_old", "tool_result");
		expect(script.isError).toBe(true);
		expect(script.facts.denialKind).toBe("guard");
		expect(script.facts.extra.denial_reason).toBe(
			`STOP: Do not use ${RUNNER}.`,
		);
	});

	test("a script failure of its own stays on the script", () => {
		const rows = split([
			line("response_item", {
				call_id: "call_ref",
				input: "text(p);\n",
				name: "exec",
				status: "completed",
				type: "custom_tool_call",
			}),
			line("response_item", {
				call_id: "call_ref",
				output: [
					{
						text: "Script failed\nWall time 0.0 seconds\nOutput:\n",
						type: "input_text",
					},
					{
						text: "Script error:\nReferenceError: p is not defined",
						type: "input_text",
					},
				],
				type: "custom_tool_call_output",
			}),
		]);
		const script = row(rows, "call_ref", "tool_result");
		expect(script.isError).toBe(true);
		expect(script.facts.extra.error_from_call_id).toBeUndefined();
	});
});

describe("guard refusals", () => {
	test("Claude Code: a shim's refusal in a Bash result is a guard denial", () => {
		const rows = split(
			[
				JSON.stringify({
					type: "user",
					uuid: "u1",
					timestamp: "2026-09-01T10:00:00.000Z",
					message: { role: "user", content: "typecheck" },
				}),
				JSON.stringify({
					type: "assistant",
					uuid: "a1",
					timestamp: "2026-09-01T10:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_guard",
								name: "Bash",
								input: { command: `${RUNNER} tsc --noEmit` },
							},
						],
					},
				}),
				JSON.stringify({
					type: "user",
					uuid: "u2",
					timestamp: "2026-09-01T10:00:02.000Z",
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "toolu_guard",
								is_error: true,
								content: `Exit code 1\n${STOP}`,
							},
						],
					},
				}),
			],
			"claude_code",
		);
		const result = row(rows, "toolu_guard", "tool_result");
		expect(result.isError).toBe(true);
		expect(result.facts.denialKind).toBe("guard");
		expect(result.facts.extra.denial_reason).toBe(
			`STOP: Do not use ${RUNNER}.`,
		);
	});

	test("Claude Code: a PreToolUse hook block stays a hook denial", () => {
		const rows = split(
			[
				JSON.stringify({
					type: "assistant",
					uuid: "a1",
					timestamp: "2026-09-01T10:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_hook",
								name: "Bash",
								input: { command: "npm install" },
							},
						],
					},
				}),
				JSON.stringify({
					type: "user",
					uuid: "u2",
					timestamp: "2026-09-01T10:00:02.000Z",
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "toolu_hook",
								is_error: true,
								content:
									"PreToolUse:Bash hook error: [/home/me/bin/policy]: STOP: This command cannot install packages.",
							},
						],
					},
				}),
			],
			"claude_code",
		);
		expect(row(rows, "toolu_hook", "tool_result").facts.denialKind).toBe(
			"hook",
		);
	});

	test("generic shapes from any repository's guards", () => {
		expect(
			readGuardRefusal(["BLOCKED: force pushes to main are disabled"]),
		).toBe("BLOCKED: force pushes to main are disabled");
		expect(
			readGuardRefusal(["Exit code 2\nDenied: rm -rf outside the repo"]),
		).toBe("Denied: rm -rf outside the repo");
		expect(
			readGuardRefusal(["Command not allowed here: use make deploy instead."]),
		).toBe("Command not allowed here: use make deploy instead.");
		expect(
			readGuardRefusal([
				"$ bun run check\nBlocked: secrets must never be committed.",
			]),
		).toBe("Blocked: secrets must never be committed.");
		expect(
			readGuardRefusal([
				'--- 2 ---\n{"chunk_id":"x","exit_code":1,"output":"STOP: Do not use npx.\\n"}',
			]),
		).toBe("STOP: Do not use npx.");
		expect(
			readGuardRefusal([
				JSON.stringify(
					[{ exit_code: 1, output: "STOP: Do not use pnpx.\n" }],
					null,
					2,
				),
			]),
		).toBe("STOP: Do not use pnpx.");
	});

	test("output that only mentions a refusal is none", () => {
		expect(
			readGuardRefusal(["tests passed\nnot allowed: none"]),
		).toBeUndefined();
		expect(
			readGuardRefusal(["HTTP/1.1 405 Method Not Allowed"]),
		).toBeUndefined();
		expect(
			readGuardRefusal(['rg: the literal "\\n" is not allowed in a regex']),
		).toBeUndefined();
		expect(
			readGuardRefusal([
				"src/a.ts(1,3): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.",
			]),
		).toBeUndefined();
		expect(readGuardRefusal(["     1→STOP: a line of a file"])).toBeUndefined();
		expect(
			readGuardRefusal([`STOP: Do not use ${"$"}{runner_name}.`]),
		).toBeUndefined();
	});
});
