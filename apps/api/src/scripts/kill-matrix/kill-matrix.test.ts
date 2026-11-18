import { expect, test } from "bun:test";
import { summarizeKillMatrix } from "./matrix.js";
import { generateMutants } from "./mutants.js";
import { findTests } from "./test-names.js";

test("mutants change runtime code only: never types, imports, keys or tagged templates", () => {
	const source = [
		'import { log } from "./log.js";',
		'type Size = { unit: "kb" };',
		"export function size(bytes: number, exact: boolean): string {",
		'\tif (bytes < 1024 && !exact) throw new Error("too small");',
		'\tlog({ "unit": bytes });',
		`\treturn exact ? sql\`kb \${bytes / 1024}\` : undefined;`,
		"}",
	].join("\n");
	expect(
		generateMutants("size.ts", source).map(
			(mutant) =>
				`L${mutant.line} ${mutant.operator} ${mutant.original} -> ${mutant.replacement}`,
		),
	).toEqual([
		"L4 conditional bytes < 1024 && !exact -> !(bytes < 1024 && !exact)",
		"L4 comparison < -> <=",
		"L4 comparison < -> >=",
		"L4 literal 1024 -> 1025",
		"L4 logical && -> ||",
		"L4 boolean !exact -> exact",
		'L4 statement throw new Error("too small"); -> ;',
		'L4 literal "too small" -> ""',
		'L5 statement log({ "unit": bytes }); -> ;',
		`L6 return return exact ? sql\`kb \${bytes / 1024}\` : undefined; -> return undefined;`,
		"L6 conditional exact -> !(exact)",
		"L6 arithmetic / -> *",
		"L6 literal 1024 -> 1025",
	]);
});

test("tests are named as Bun runs them; skipped tests are left out and names decided at run time refused", () => {
	const source = [
		'describe("cursor", () => {',
		'\ttest("reads (once)", () => {});',
		'\ttest.skip("later", () => {});',
		'\tdescribe("git", () => { it.only("rejects", () => {}); });',
		"});",
		'describe.skip("old", () => { test("gone", () => {}); });',
	].join("\n");
	expect(findTests("a.test.ts", source)).toEqual([
		{
			name: "cursor reads (once)",
			line: 2,
			pattern: "^cursor reads \\(once\\)$",
		},
		{ name: "cursor git rejects", line: 4, pattern: "^cursor git rejects$" },
	]);
	expect(() =>
		findTests("b.test.ts", 'test.each([1])("n %d", () => {});'),
	).toThrow("b.test.ts:1: test.each decides its tests at run time");
	expect(() =>
		findTests("c.test.ts", 'const name = "n";\ntest(name, () => {});'),
	).toThrow("c.test.ts:2: test name is computed at run time");
	expect(() =>
		findTests("d.test.ts", 'test("n", () => {});\ntest("n", () => {});'),
	).toThrow('d.test.ts:2: a second test is named "n"');
});

test("a test that kills only what others kill is redundant, but of two twins only one can go", () => {
	// T1 alone kills M1; T2 and T3 both kill M2 and nothing else; T4 kills M3,
	// which T1 kills too.
	const summary = summarizeKillMatrix({
		modules: ["a.ts"],
		tests: ["T1", "T2", "T3", "T4"],
		mutants: generateMutants("a.ts", "const a = 1 + 2;").map((mutant) => ({
			...mutant,
			module: "a.ts",
		})),
		outcomes: [
			["killed", "survived", "survived", "survived"],
			["survived", "killed", "timeout", "survived"],
			["killed", "survived", "survived", "killed"],
		],
		invalid: 0,
	});
	expect(summary.uniqueKills).toEqual([1, 0, 0, 0]);
	expect(summary.withoutUniqueKills).toEqual([1, 2, 3]);
	expect(summary.removable).toEqual([1, 3]);
});
