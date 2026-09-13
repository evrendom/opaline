import { describe, expect, test } from "bun:test";
import {
	attachCodexCorrelation,
	classifySimpleShellCommand,
	extractCustomExecInvocation,
	getTranscriptToolFileActivities,
	isCodexToolFailure,
	parseCodexPatch,
	stripCodexInjectedBlocks,
	translateCodexToolCall,
} from "./codex-tool-translation.js";

describe("Codex custom exec extraction", () => {
	test("extracts one literal tools call from a generated cell", () => {
		const invocation = extractCustomExecInvocation(`
// @exec: {"yield_time_ms": 10000}
const result = await tools.exec_command({
  cmd: "sed -n '1,220p' src/app.ts",
  workdir: "/repo",
  yield_time_ms: 10000,
});
text(result.output);
`);

		expect(invocation).toEqual({
			input: {
				cmd: "sed -n '1,220p' src/app.ts",
				workdir: "/repo",
				yield_time_ms: 10000,
			},
			name: "exec_command",
		});
	});

	test("extracts raw apply_patch string arguments", () => {
		const invocation = extractCustomExecInvocation(
			"await tools.apply_patch('*** Begin Patch\\n*** Add File: src/a.ts\\n+ok\\n*** End Patch')",
		);

		expect(invocation).toEqual({
			input: {
				input: "*** Begin Patch\n*** Add File: src/a.ts\n+ok\n*** End Patch",
			},
			name: "apply_patch",
		});
	});

	test("refuses computed, looped, and multi-tool programs", () => {
		const scripts = [
			"for (const cmd of cmds) await tools.exec_command({ cmd })",
			"await Promise.all(cmds.map((cmd) => tools.exec_command({ cmd })))",
			"await tools.exec_command({ cmd: `rg $" + "{pattern}` })",
			"await tools.exec_command({ cmd: 'pwd' }); await tools.exec_command({ cmd: 'ls' })",
		];

		for (const script of scripts) {
			expect(extractCustomExecInvocation(script)).toBeUndefined();
			expect(
				translateCodexToolCall(
					"exec",
					attachCodexCorrelation({ input: script }, undefined),
				),
			).toMatchObject({
				activity: "executing",
				verb: "Ran script",
			});
		}
	});

	test("renders literal future tool names as scripts without weakening standalone fallback", () => {
		expect(
			translateCodexToolCall(
				"exec",
				attachCodexCorrelation(
					{ input: "await tools.future_tool({ value: 'x' })" },
					undefined,
				),
			),
		).toMatchObject({ mapped: true, verb: "Ran script" });
		expect(translateCodexToolCall("future_tool", { value: "x" })).toMatchObject(
			{ mapped: false, verb: "Used" },
		);
	});
});

describe("Codex shell classification", () => {
	test("classifies strict single-file reads and search commands", () => {
		expect(classifySimpleShellCommand("sed -n '1,220p' src/app.ts")).toEqual({
			activity: "reading",
			command: "sed -n '1,220p' src/app.ts",
			files: [
				{
					diff: undefined,
					movePath: undefined,
					operation: "update",
					path: "src/app.ts",
				},
			],
			primaryLabel: "app.ts (1–220)",
		});
		expect(classifySimpleShellCommand("cat README.md").activity).toBe(
			"reading",
		);
		expect(classifySimpleShellCommand("rg needle src").activity).toBe(
			"searching",
		);
	});

	test("keeps unsupported pipelines, redirects and compound input out of the single-command classifier", () => {
		const compoundCommands = [
			"sed -n '1,20p' a.ts | head",
			"sed -n '1,20p' a.ts && pwd",
			"sed -n '1,20p' a.ts; pwd",
			"sed -n '1,20p' a.ts > out",
			"sed -n '1,20p' a.ts\npwd",
			"sed -n '1,20p' a.ts b.ts",
			"rg needle src | head",
			"rg --pre 'cat' needle src",
		];

		for (const command of compoundCommands) {
			expect(classifySimpleShellCommand(command).activity).toBe("executing");
		}
	});

	test("refuses dynamic double-quoted expansions and unsupported operand counts", () => {
		const commands = [
			...["`", "$"].map((operator) => `rg "left${operator}right" src`),
			"rg needle apps packages",
			"grep needle apps packages",
			"ls apps packages",
		];

		for (const command of commands) {
			expect(classifySimpleShellCommand(command).activity).toBe("executing");
			expect(
				translateCodexToolCall(
					"exec_command",
					attachCodexCorrelation({ cmd: command }, undefined),
				),
			).toMatchObject({
				activity: "executing",
				command,
				mapped: true,
				primaryLabel: command,
				verb: "Ran",
			});
		}
	});

	test("find stays executing for every argument list", () => {
		for (const suffix of [
			". -name '*.ts'",
			". -delete",
			". -exec rm -rf {} +",
			". -ok rm {} \\;",
		]) {
			expect(classifySimpleShellCommand(`find ${suffix}`).activity).toBe(
				"executing",
			);
		}
	});
});

describe("Codex patch translation", () => {
	test("decomposes add, update, delete, and move facts with bare hunks", () => {
		const files = parseCodexPatch(`*** Begin Patch
*** Add File: src/new.ts
+new
*** Update File: src/old.ts
*** Move to: src/moved.ts
@@
-old
+new
*** Delete File: src/gone.ts
-gone
*** End Patch`);

		expect(files).toEqual([
			{
				diff: "+new",
				movePath: undefined,
				operation: "add",
				path: "src/new.ts",
			},
			{
				diff: "@@\n-old\n+new",
				movePath: "src/moved.ts",
				operation: "update",
				path: "src/old.ts",
			},
			{
				diff: "-gone",
				movePath: undefined,
				operation: "delete",
				path: "src/gone.ts",
			},
		]);
	});

	test("prefers structured end-event paths and diffs and gates failed writes", () => {
		const input = attachCodexCorrelation(
			{
				input: "*** Begin Patch\n*** Add File: guessed.ts\n+x\n*** End Patch",
			},
			{
				changes: {
					"/repo/real.ts": {
						move_path: "/repo/moved.ts",
						type: "update",
						unified_diff: "@@ -1 +1 @@\n-old\n+new",
					},
				},
				success: false,
				type: "patch_apply_end",
			},
		);

		expect(translateCodexToolCall("apply_patch", input)).toMatchObject({
			activity: "editing",
			files: [
				{
					diff: "@@ -1 +1 @@\n-old\n+new",
					movePath: "/repo/moved.ts",
					operation: "update",
					path: "/repo/real.ts",
				},
			],
			success: false,
		});
		expect(
			getTranscriptToolFileActivities("apply_patch", input, "codex"),
		).toEqual([]);
	});
});

describe("Codex event fidelity", () => {
	test("uses parsed_cmd before fallback shell guesses", () => {
		const input = attachCodexCorrelation(
			{ cmd: "printf source" },
			{
				exit_code: 0,
				parsed_cmd: [{ path: "/repo/src/app.ts", type: "read" }],
				type: "exec_command_end",
			},
		);

		expect(translateCodexToolCall("exec_command", input)).toMatchObject({
			activity: "reading",
			exitCode: 0,
			primaryLabel: "app.ts",
		});
	});

	test("applies exit-code precedence and catches command-not-found fallbacks", () => {
		expect(
			isCodexToolFailure(
				"Process exited with code 127\ncommand not found",
				undefined,
			),
		).toBe(true);
		expect(isCodexToolFailure("Error: stale text", { exit_code: 0 })).toBe(
			false,
		);
		expect(isCodexToolFailure("zsh: command not found: rg", undefined)).toBe(
			true,
		);
	});

	test("strips recognized injection blocks and keeps the genuine prompt", () => {
		const text = `<recommended_plugins>plugins</recommended_plugins>
# AGENTS.md instructions for /repo
<INSTRUCTIONS>rules</INSTRUCTIONS>
<system_instruction>conductor</system_instruction>

what is the run command?`;

		expect(stripCodexInjectedBlocks(text)).toBe("what is the run command?");
		expect(
			stripCodexInjectedBlocks(
				"<environment_context><cwd>/repo</cwd></environment_context>",
			),
		).toBe("");
	});
});

describe("shared activity derivation", () => {
	test("keeps image viewing separate from file reads for both agents", () => {
		expect(
			getTranscriptToolFileActivities(
				"view_image",
				attachCodexCorrelation({ path: "shot.png" }, undefined),
				"codex",
			),
		).toEqual([{ operation: "viewed", path: "shot.png" }]);
		expect(
			getTranscriptToolFileActivities("Read", { file_path: "shot.png" }),
		).toEqual([{ operation: "viewed", path: "shot.png" }]);
		expect(
			getTranscriptToolFileActivities("Read", { file_path: "source.ts" }),
		).toEqual([{ operation: "read", path: "source.ts" }]);
	});

	test("covered names always resolve to semantic presentations", () => {
		const coveredCalls: Array<[string, Record<string, unknown>]> = [
			["exec_command", { cmd: "pwd" }],
			["exec", { input: "const x = 1" }],
			["apply_patch", { input: "*** Begin Patch\n*** End Patch" }],
			["write_stdin", { chars: "" }],
			["wait", { cell_id: "cell" }],
			["view_image", { path: "x.png" }],
			["update_plan", { plan: [] }],
			["web_search_call", { action: { query: "docs" } }],
			["spawn_agent", { task_name: "review" }],
			["send_message", { message: "status" }],
			["wait_agent", {}],
			["followup_task", { task_name: "tests" }],
			["list_agents", {}],
			["interrupt_agent", {}],
			["resume_agent", {}],
			["close_agent", {}],
		];

		for (const [name, input] of coveredCalls) {
			expect(
				translateCodexToolCall(
					name,
					name === "exec" ? attachCodexCorrelation(input, undefined) : input,
				).mapped,
			).toBe(true);
		}
	});
});
