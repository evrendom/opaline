import { describe, expect, test } from "bun:test";
import { changedHunks, diffLines } from "./diff-lines.js";
import { findPythonEdits } from "./python-edits.js";

describe("edits an inline Python script makes", () => {
	test("a literal replacement in one file, checked first", () => {
		const script = [
			"p='apps/web/a.tsx'",
			"s=open(p).read()",
			"old='''\tconst a = 1;\n\tconst b = 2;'''",
			"new='''\tconst a = 1;\n\tconst c = 3;\n\tconst b = 2;'''",
			"assert old in s; open(p,'w').write(s.replace(old,new,1)); print(\"ok\")",
		].join("\n");
		expect(findPythonEdits(script)).toEqual({
			checksFirst: true,
			edits: [
				{
					after: "\tconst a = 1;\n\tconst c = 3;\n\tconst b = 2;",
					before: "\tconst a = 1;\n\tconst b = 2;",
					file: "apps/web/a.tsx",
				},
			],
		});
	});

	test("several replacements, inline literals and escapes", () => {
		const script = `from pathlib import Path\np = Path("a.py")\ns = p.read_text()\ns = s.replace("x = 1\\n", "x = 2\\n").replace('y', "z")\np.write_text(s)`;
		expect(
			findPythonEdits(script)?.edits.map((edit) => [edit.before, edit.after]),
		).toEqual([
			["x = 1\n", "x = 2\n"],
			["y", "z"],
		]);
	});

	test("anything not literal is not an edit to show", () => {
		expect(
			findPythonEdits(
				"import re\np='a'\ns=open(p).read()\ns=re.sub(r'a+', 'b', s)\nopen(p,'w').write(s)",
			),
		).toBeNull();
		expect(
			findPythonEdits(
				"for p in ['a','b']:\n  s=open(p).read(); open(p,'w').write(s.replace('x','y'))",
			),
		).toBeNull();
		expect(
			findPythonEdits("print(open('a').read().replace('x','y'))"),
		).toBeNull();
		expect(
			findPythonEdits(
				"old=f'{x}'\np='a'\ns=open(p).read()\nopen(p,'w').write(s.replace(old,'y'))",
			),
		).toBeNull();
	});
});

describe("line diff", () => {
	test("keeps what's shared and marks what changed", () => {
		expect(diffLines("a\nb\nc\nd", "a\nc\nd\ne")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "deletion", text: "b" },
			{ kind: "same", text: "c" },
			{ kind: "same", text: "d" },
			{ kind: "addition", text: "e" },
		]);
	});

	test("only the changes with a line of context, the rest folded", () => {
		const lines = diffLines("1\n2\n3\n4\n5\n6\n7", "1\n2\n3\nx\n5\n6\n7");
		expect(
			changedHunks(lines).map((line) =>
				line ? `${line.kind[0]}${line.text}` : "…",
			),
		).toEqual(["…", "s3", "d4", "ax", "s5", "…"]);
	});
});
