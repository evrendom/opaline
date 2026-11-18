import { describe, expect, test } from "bun:test";
import { shellReadRanges } from "./read-ranges.js";

const dir = "/r";
const a = "/r/src/a.ts";
const b = "/r/src/b.ts";

describe("the lines a shell command read", () => {
	test("sed -n ranges, a file read twice in one command having two", () => {
		expect(
			shellReadRanges(
				"sed -n 60,120p src/a.ts && echo ---- && sed -n '190,520p' src/a.ts",
				dir,
				[a],
			),
		).toEqual([
			{ from: 60, path: a, to: 120 },
			{ from: 190, path: a, to: 520 },
		]);
	});

	test("head, tail -n +, and cat whole; each file its own", () => {
		expect(
			shellReadRanges("head -n 40 src/a.ts; tail -n +300 src/b.ts", dir, [
				a,
				b,
			]),
		).toEqual([
			{ from: 1, path: a, to: 40 },
			{ from: 300, path: b, to: null },
		]);
		expect(
			shellReadRanges("cat src/a.ts src/b.ts 2>/dev/null", dir, [a, b]),
		).toEqual([
			{ from: 1, path: a, to: null },
			{ from: 1, path: b, to: null },
		]);
	});

	test("a pipe narrows what came through it", () => {
		expect(shellReadRanges("cat src/a.ts | head -40", dir, [a])).toEqual([
			{ from: 1, path: a, to: 40 },
		]);
		expect(
			shellReadRanges("nl -ba src/a.ts | sed -n 100,140p", dir, [a]),
		).toEqual([{ from: 100, path: a, to: 140 }]);
	});

	test("what it doesn't say, or doesn't read, it leaves out", () => {
		expect(shellReadRanges("grep -n foo src/a.ts", dir, [a])).toEqual([]);
		expect(shellReadRanges("tail -n 20 src/a.ts", dir, [a])).toEqual([]);
		expect(shellReadRanges("cat src/other.ts", dir, [a])).toEqual([]);
	});

	test("ranges the contract can't hold are dropped, not sent", () => {
		expect(shellReadRanges("sed -n 120,60p src/a.ts", dir, [a])).toEqual([]);
		expect(shellReadRanges("head -n 0 src/a.ts", dir, [a])).toEqual([]);
		expect(
			shellReadRanges(
				`sed -n ${"9".repeat(30)},${"9".repeat(31)}p src/a.ts`,
				dir,
				[a],
			),
		).toEqual([]);
		expect(shellReadRanges("sed -n 0,5p src/a.ts", dir, [a])).toEqual([]);
	});
});
