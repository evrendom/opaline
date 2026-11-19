import { describe, expect, test } from "bun:test";
import { dedent, outputParts as parts } from "./session-reader-output";

const outputParts = (output: string) =>
	parts(output).map(({ kind, text }) => ({ kind, text }));

describe("outputParts", () => {
	test("a line of JSON among plain lines, pretty-printed", () => {
		expect(
			outputParts('{"a":1,"b":[2]}\nok\nShell cwd was reset to /x'),
		).toEqual([
			{ kind: "json", text: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}' },
			{ kind: "text", text: "ok" },
			{ kind: "note", text: "Shell cwd was reset to /x" },
		]);
	});

	test("an object spread over lines, between plain lines", () => {
		expect(outputParts('before\n{\n"a": 1\n}\nafter')).toEqual([
			{ kind: "text", text: "before" },
			{ kind: "json", text: '{\n  "a": 1\n}' },
			{ kind: "text", text: "after" },
		]);
	});

	test("a JSON run keeps the value it is", () => {
		expect(parts('x\n{"a":[1,null]}')[1]).toEqual({
			kind: "json",
			text: '{\n  "a": [\n    1,\n    null\n  ]\n}',
			value: { a: [1, null] },
		});
	});

	test("no JSON, or what only looks like it, stays one plain run", () => {
		expect(outputParts("509 pass\n0 fail")).toEqual([
			{ kind: "text", text: "509 pass\n0 fail" },
		]);
		expect(outputParts("[ok] built\n{not json")).toEqual([
			{ kind: "text", text: "[ok] built\n{not json" },
		]);
	});
});

describe("outputParts: numbered lines, counts and the shell's note", () => {
	const kinds = (output: string) => parts(output).map((part) => part.kind);

	test("wc counts, then grep -n lines, then the note", () => {
		const output =
			"     465 runtime.ts\n     154 parser.ts\n     619 total\n24:const specSet = {};\n26:const ignored = [];\nShell cwd was reset to /Users/me/repo";
		const [counts, numbered, note] = parts(output);
		expect(kinds(output)).toEqual(["counts", "numbered", "note"]);
		expect(counts?.kind === "counts" && counts.rows).toEqual([
			{ count: "465", name: "runtime.ts" },
			{ count: "154", name: "parser.ts" },
			{ count: "619", name: "total" },
		]);
		expect(numbered?.kind === "numbered" && numbered.lines).toEqual([
			{ number: 24, text: "const specSet = {};" },
			{ number: 26, text: "const ignored = [];" },
		]);
		expect(note?.kind === "note" && note.folder).toBe("/Users/me/repo");
	});

	test("grep -rn grouped by file, grep's -- a gap, cat -n numbered", () => {
		const output =
			"src/a.ts:3:x\nsrc/a.ts:9:y\n--\nsrc/a.ts:20:z\nsrc/b.ts:1:w\nsrc/b.ts:2:v";
		const found = parts(output);
		expect(
			found.map((part) => (part.kind === "numbered" ? part.file : part.kind)),
		).toEqual(["src/a.ts", "src/b.ts"]);
		expect(found[0]?.kind === "numbered" && found[0].lines[2]).toBeNull();
		expect(kinds("     1\tconst a = 1;\n     2\tconst b = 2;")).toEqual([
			"numbered",
		]);
	});

	test("what only looks like them stays text", () => {
		expect(kinds("509 pass\n0 fail")).toEqual(["text"]);
		expect(kinds("24:only one numbered line")).toEqual(["text"]);
		expect(kinds("3 apples\n4 pears")).toEqual(["text"]);
	});
});

describe("dedent", () => {
	test("drops the indent every line shares, keeping the nesting", () => {
		expect(
			dedent(["        const a = {", "            b,", "", "        };"]),
		).toEqual(["const a = {", "    b,", "", "};"]);
	});

	test("leaves lines with no shared indent as they are", () => {
		expect(dedent(["a", "  b"])).toEqual(["a", "  b"]);
		expect(dedent(["\tx", "  y"])).toEqual(["\tx", "  y"]);
	});
});

describe("outputParts: tables", () => {
	test("rows split by ` | ` under a header, the lines around as text", () => {
		const found = parts(
			"sql result=sr_1 rows=2\nrun_id | turn_idx | usd\nr/1 | 2 | 1.49\nr/2 |  | 0.32",
		);
		expect(found.map((part) => part.kind)).toEqual(["text", "table"]);
		const table = found[1];
		expect(table?.kind === "table" && table.header).toEqual([
			"run_id",
			"turn_idx",
			"usd",
		]);
		expect(table?.kind === "table" && table.rows).toEqual([
			["r/1", "2", "1.49"],
			["r/2", "", "0.32"],
		]);
	});

	test("a Markdown table, its rule under the header dropped", () => {
		const found = parts("| Name | Runs |\n|---|---:|\n| a | 3 |");
		expect(found[0]?.kind === "table" && found[0].rows).toEqual([["a", "3"]]);
	});

	test("code with pipes stays text", () => {
		expect(
			parts('type A = "a" | "b";\ntype B = "c" | "d";').map(
				(part) => part.kind,
			),
		).toEqual(["text"]);
		expect(parts("a || b\nc || d").map((part) => part.kind)).toEqual(["text"]);
	});
});
