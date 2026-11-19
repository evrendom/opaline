import { describe, expect, test } from "bun:test";
import { printedBlocks, printRange } from "./session-reader-printed-lines";

const sed = (raw: string) => printRange({ program: "sed", raw });

describe("printRange", () => {
	test("sed's numbered range", () => {
		expect(sed("sed -n 150,437p a.ts")).toEqual({ length: 288, start: 150 });
		expect(sed("sed -n '5p' a.ts")).toEqual({ length: 1, start: 5 });
	});

	test("sed's range from a name: its length, not its start", () => {
		expect(sed('sed -n "$n,$((n+30))p" a.ts')).toEqual({ length: 31 });
		expect(sed('sed -n "$n,$(( n + 4 ))p" a.ts')).toEqual({ length: 5 });
	});

	test("head, tail and cat", () => {
		expect(printRange({ program: "head", raw: "head -n 40 a.ts" })).toEqual({
			length: 40,
			start: 1,
		});
		expect(printRange({ program: "head", raw: "head a.ts" })).toEqual({
			length: 10,
			start: 1,
		});
		expect(printRange({ program: "tail", raw: "tail -n +80 a.ts" })).toEqual({
			start: 80,
		});
		expect(printRange({ program: "tail", raw: "tail -5 a.ts" })).toEqual({
			length: 5,
		});
		expect(printRange({ program: "cat", raw: "cat a.ts" })).toEqual({
			start: 1,
		});
	});

	test("a piped print says nothing", () => {
		expect(
			printRange({
				program: "sed",
				raw: "sed -n 1,9p a.ts | grep x",
				stages: [],
			}),
		).toEqual({});
	});
});

describe("printedBlocks", () => {
	const block = (name: string, count: number) =>
		Array.from({ length: count }, (_, index) => `${name} line ${index}`);

	test("one print alone takes every line, from its start", () => {
		expect(
			printedBlocks(["a", "b"], [{ length: 288, start: 150 }], []),
		).toEqual([{ length: 2, start: 150 }]);
	});

	test("prints cut the lines by their counts; one from a name is placed by a line numbered elsewhere", () => {
		expect(
			printedBlocks(
				[...block("renderMark", 3), ...block("LaneMark", 2)],
				[{ length: 3 }, { length: 2 }],
				[{ number: 1009, text: "renderMark line 0" }, null],
			),
		).toEqual([
			{ length: 3, start: 1009 },
			{ length: 2, start: undefined },
		]);
	});

	test("a line numbered twice, or too short, places nothing", () => {
		expect(
			printedBlocks(
				["}", "renderMark line 0"],
				[{ length: 2 }],
				[
					{ number: 4, text: "}" },
					{ number: 9, text: "renderMark line 0" },
					{ number: 20, text: "renderMark line 0" },
				],
			),
		).toEqual([{ length: 2, start: undefined }]);
	});

	test("prints whose counts don't add up to the lines: none", () => {
		expect(
			printedBlocks(
				block("x", 4),
				[
					{ length: 3, start: 1 },
					{ length: 3, start: 10 },
				],
				[],
			),
		).toBeNull();
	});
});
