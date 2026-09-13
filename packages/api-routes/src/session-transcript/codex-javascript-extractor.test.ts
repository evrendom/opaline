import { describe, expect, test } from "bun:test";
import { extractCustomExecInvocations } from "./codex-javascript-extractor.js";

function createDeterministicGenerator(seed: number) {
	let state = seed >>> 0;
	return (limit: number) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state % limit;
	};
}

describe("Codex JavaScript tool extraction", () => {
	test("keeps a node-repl call when a later loop only forwards result blocks", () => {
		const source = `
const result = await tools.mcp__node_repl__js({
  code: "const { sky } = require('@oai/sky'); await sky.get_app_state({ app: 'chrome' });",
});
for (const block of result.content ?? []) {
  if (block.type === "input_image") image(block.image_url);
  else if (block.type === "input_text") text(block.text);
}`;

		expect(extractCustomExecInvocations(source)).toMatchObject([
			{
				expansionIndex: 0,
				input: {
					code: "const { sky } = require('@oai/sky'); await sky.get_app_state({ app: 'chrome' });",
				},
				name: "mcp__node_repl__js",
				resolvedInput: true,
			},
		]);
	});

	test("ignores control-flow-looking text inside a command string", () => {
		const source = `const result = await tools.exec_command({
			cmd: "node -e \\"items.map(value => value.trim())\\"",
		});`;

		expect(extractCustomExecInvocations(source)).toMatchObject([
			{
				input: { cmd: 'node -e "items.map(value => value.trim())"' },
				name: "exec_command",
				resolvedInput: true,
			},
		]);
	});

	test("resolves a quoted prompt assembled through replaceAll and a template", () => {
		const source = `
const prompt = "Plan parent's task";
const quoted = \`'\${prompt.replaceAll("'", "'\\\\''")}'\`;
await tools.exec_command({ cmd: \`claude -p \${quoted}\`, workdir: "/repo" });`;

		expect(extractCustomExecInvocations(source)).toMatchObject([
			{
				input: {
					cmd: "claude -p 'Plan parent'\\''s task'",
					workdir: "/repo",
				},
				name: "exec_command",
				resolvedInput: true,
			},
		]);
	});

	test("emits every tool call in a multi-operation cell", () => {
		const invocations = extractCustomExecInvocations(`
await tools.exec_command({ cmd: "pwd" });
await tools.view_image({ path: "shot.png" });
`);

		expect(invocations.map((invocation) => invocation.name)).toEqual([
			"exec_command",
			"view_image",
		]);
	});

	test("expands a literal command array into stable invocation instances", () => {
		const source = `
const commands = ["pwd", "rg --files", "bun test"];
const results = await Promise.all(
  commands.map((cmd) => tools.exec_command({ cmd, workdir: "/repo" })),
);`;
		const invocations = extractCustomExecInvocations(source);

		expect(invocations).toHaveLength(3);
		expect(invocations.map((invocation) => invocation.expansionIndex)).toEqual([
			0, 1, 2,
		]);
		expect(invocations.map((invocation) => invocation.input.cmd)).toEqual([
			"pwd",
			"rg --files",
			"bun test",
		]);
	});

	test("does not leak a completed loop expansion into a later tool call", () => {
		const invocations = extractCustomExecInvocations(`
const commands = ["pwd", "ls"];
const results = await Promise.all(commands.map((cmd) => tools.exec_command({ cmd })));
await tools.apply_patch("*** Begin Patch\\n*** Add File: a.ts\\n+x\\n*** End Patch");
`);

		expect(invocations.map((invocation) => invocation.name)).toEqual([
			"exec_command",
			"exec_command",
			"apply_patch",
		]);
	});

	test("conserves multiplicity when literal array entries contain dynamic fields", () => {
		const invocations = extractCustomExecInvocations(`
const cwd = "/repo";
const commands = [
  { cmd: "pwd", workdir: cwd + "/one" },
  { cmd: "rg --files", workdir: cwd + "/two" },
];
await Promise.all(commands.map((command) => tools.exec_command(command)));
`);

		expect(invocations).toHaveLength(2);
		expect(invocations).toMatchObject([
			{
				expansionIndex: 0,
				input: { cmd: "pwd" },
				name: "exec_command",
				resolvedInput: true,
			},
			{
				expansionIndex: 1,
				input: { cmd: "rg --files" },
				name: "exec_command",
				resolvedInput: true,
			},
		]);
	});

	test("conserves multiplicity for a loop over mixed literal and concatenated paths", () => {
		const invocations = extractCustomExecInvocations(`
const prefix = "/repo";
const files = ["/fixed", prefix + "/one", prefix + "/two", prefix + "/three"];
for (const file of files) {
  await tools.exec_command({ cmd: \`sed -n '1,20p' \${file}\` });
}
`);

		expect(invocations).toHaveLength(4);
	});

	test("expands destructured literal tuples and objects", () => {
		const invocations = extractCustomExecInvocations(`
const commands = [["pwd", "/one"], ["rg --files", "/two"]];
for (const [cmd, workdir] of commands) {
  await tools.exec_command({ cmd, workdir });
}
const writes = [{ chars: "a", session: 1 }, { chars: "b", session: 2 }];
await Promise.all(writes.map(({ chars, session }) => tools.write_stdin({ chars, session_id: session })));
`);

		expect(invocations.map((invocation) => invocation.input)).toEqual([
			{ cmd: "pwd", workdir: "/one" },
			{ cmd: "rg --files", workdir: "/two" },
			{ chars: "a", session_id: 1 },
			{ chars: "b", session_id: 2 },
		]);
	});

	test("does not erase a tool target inside a loop over a dynamically populated array", () => {
		const invocations = extractCustomExecInvocations(`
const sessions = [];
sessions.push(runtimeSession);
for (const session of sessions) {
  await tools.write_stdin({ session_id: session.id, chars: "" });
}
`);

		expect(invocations).toMatchObject([
			{
				name: "write_stdin",
				resolvedInput: false,
			},
		]);
	});

	test("expands indexed iteration over a literal array", () => {
		const invocations = extractCustomExecInvocations(`
const commands = ["pwd", "rg --files"];
for (const [index, cmd] of commands.entries()) {
  await tools.exec_command({ cmd, max_output_tokens: index });
}
`);

		expect(invocations.map((invocation) => invocation.input)).toEqual([
			{ cmd: "pwd", max_output_tokens: 0 },
			{ cmd: "rg --files", max_output_tokens: 1 },
		]);
	});

	test.each([
		"{ cmd, workdir }",
		"{ cmd: cmd, options: { cwd: workdir } }",
	])("keeps missing destructured values unresolved: %s", (argument) => {
		const invocations = extractCustomExecInvocations(`
const commands = [{ label: "first" }, { cmd: "pwd" }];
for (const { cmd, workdir } of commands) {
  await tools.exec_command(${argument});
}
`);
		expect(invocations).toHaveLength(2);
		for (const invocation of invocations) {
			expect(invocation.resolvedInput).toBe(false);
			expect(invocation.input).toEqual({ unresolved_argument: argument });
		}
	});

	test("retains a known tool target when its arguments are dynamic", () => {
		expect(
			extractCustomExecInvocations(
				"await tools.exec_command(buildOptions(runtimeValue))",
			),
		).toMatchObject([
			{
				input: { unresolved_argument: "buildOptions(runtimeValue)" },
				name: "exec_command",
				resolvedInput: false,
			},
		]);
	});

	test("preserves tool-call offsets when an earlier literal contains non-BMP characters", () => {
		const source = `const marker = "🧭";
await tools.exec_command({ cmd: "printf '😀'" });`;

		expect(extractCustomExecInvocations(source)).toMatchObject([
			{
				input: { cmd: "printf '😀'" },
				name: "exec_command",
				resolvedInput: true,
				sourceOffset: source.indexOf("tools.exec_command"),
			},
		]);
	});

	test("computes Cartesian multiplicity and records every nested expansion path", () => {
		for (let outerSize = 1; outerSize <= 3; outerSize += 1) {
			for (let innerSize = 1; innerSize <= 3; innerSize += 1) {
				const outer = Array.from(
					{ length: outerSize },
					(_, index) => `o${index}`,
				);
				const inner = Array.from(
					{ length: innerSize },
					(_, index) => index + 1,
				);
				const invocations = extractCustomExecInvocations(`
const outer = ${JSON.stringify(outer)};
const inner = ${JSON.stringify(inner)};
for (const cmd of outer) {
  for (const delay of inner) {
    await tools.exec_command({ cmd, max_output_tokens: delay });
  }
}`);
				const expectedPaths = outer.flatMap((_, outerIndex) =>
					inner.map((__, innerIndex) => [outerIndex, innerIndex]),
				);

				expect(invocations).toHaveLength(outerSize * innerSize);
				expect(
					invocations.map((invocation) => invocation.expansionPath),
				).toEqual(expectedPaths);
				expect(invocations.map((invocation) => invocation.input)).toEqual(
					outer.flatMap((cmd) =>
						inner.map((max_output_tokens) => ({ cmd, max_output_tokens })),
					),
				);
			}
		}
	});

	test("uses seeded generated values within fixed syntax templates for dependent nested expansions", () => {
		const random = createDeterministicGenerator(0x5eed_c0de);
		for (let sample = 0; sample < 80; sample += 1) {
			const groupCount = random(5) + 1;
			const groups = Array.from({ length: groupCount }, (_, groupIndex) =>
				Array.from(
					{ length: random(4) + 1 },
					(_, commandIndex) => `cmd-${sample}-${groupIndex}-${commandIndex}`,
				),
			);
			const invocations = extractCustomExecInvocations(`
const groups = ${JSON.stringify(groups)};
await Promise.all(groups.map(group => group.map(cmd => tools.exec_command({ cmd }))));
`);
			const expectedPaths = groups.flatMap((group, groupIndex) =>
				group.map((_, commandIndex) => [groupIndex, commandIndex]),
			);

			expect(invocations.map((invocation) => invocation.input.cmd)).toEqual(
				groups.flat(),
			);
			expect(invocations.map((invocation) => invocation.expansionPath)).toEqual(
				expectedPaths,
			);
		}
	});

	test("recovers tool calls from template interpolations while lexing false-positive literals", () => {
		const literalVariants = [
			"\"tools.fake({ cmd: 'string' })\"",
			"'tools.fake({ cmd: \"string\" })'",
			"/tools\\.fake\\([^)]*\\)/gu",
			"`tools.fake({ cmd: 'template text' })`",
		] as const;

		for (const literal of literalVariants) {
			const invocations = extractCustomExecInvocations(`
const ignored = ${literal};
// tools.fake({ cmd: "line comment" });
/* tools.fake({ cmd: "block comment" }); */
const visible = \`result: \${await tools.exec_command({ cmd: "pwd" })}\`;
`);

			expect(invocations).toMatchObject([
				{
					expansionPath: [],
					input: { cmd: "pwd" },
					name: "exec_command",
					resolvedInput: true,
				},
			]);
		}
	});

	test("masks statement-position regex literals after control-flow conditions", () => {
		expect(
			extractCustomExecInvocations(
				"if (ok) /tools.exec_command(foo)/.test(text);",
			),
		).toEqual([]);
	});

	test("uses seeded generated values within fixed syntax templates for string, comment, and regex decoys", () => {
		const random = createDeterministicGenerator(0xdec0_1ced);
		for (let sample = 0; sample < 120; sample += 1) {
			const name = `tool_${random(10_000)}`;
			const spacing = " ".repeat(random(4));
			const decoy = `tools.${name}${spacing}({ value: ${sample} })`;
			const source = [
				`const note = ${JSON.stringify(decoy)};`,
				`// ${decoy}`,
				`/* ${decoy} */`,
				`if (ready) /${decoy.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/.test(text);`,
			].join("\n");

			expect(extractCustomExecInvocations(source)).toEqual([]);
		}
	});

	test("uses seeded generated values within fixed syntax templates for malformed cells", () => {
		const random = createDeterministicGenerator(0xbad_c0de);
		for (let sample = 0; sample < 100; sample += 1) {
			const name = `generated_${random(10_000)}`;
			const complete = `await tools.${name}({ cmd: ${JSON.stringify(`cmd-${sample}`)} })`;
			const closingParenthesis = complete.lastIndexOf(")");
			const cutOffset = Math.max(
				complete.indexOf("(") + 1,
				closingParenthesis - random(8),
			);
			const source = complete.slice(0, cutOffset);
			expect(extractCustomExecInvocations(source)).toEqual([]);
		}
	});
});
