import { describe, expect, test } from "bun:test";
import { countChanges, type DiffLine, diffLines } from "./line-diff";

const lines = (count: number, prefix = "line") =>
	Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const text = (items: readonly string[]) => `${items.join("\n")}\n`;
const shape = (diffLine: DiffLine) =>
	`${diffLine.kind[0]} ${diffLine.oldNumber ?? "-"} ${diffLine.newNumber ?? "-"} ${diffLine.text}`;

describe("diffLines", () => {
	test("identical input has no hunks", () => {
		expect(diffLines("", "")).toEqual([]);
		expect(diffLines("a\nb\n", "a\nb\n")).toEqual([]);
		expect(countChanges([])).toEqual({ added: 0, removed: 0 });
	});

	test("a pure insert adds lines between context", () => {
		const hunks = diffLines("a\nb\nc\n", "a\nb\nnew\nc\n");
		expect(hunks).toHaveLength(1);
		expect(hunks[0]).toMatchObject({
			oldStart: 1,
			oldLines: 3,
			newStart: 1,
			newLines: 4,
		});
		expect(hunks[0].lines.map(shape)).toEqual([
			"c 1 1 a",
			"c 2 2 b",
			"a - 3 new",
			"c 3 4 c",
		]);
		expect(hunks[0].lines[2].marks).toBeUndefined();
		expect(countChanges(hunks)).toEqual({ added: 1, removed: 0 });
	});

	test("an insert into an empty file starts the old side at 0, as git does", () => {
		const [hunk] = diffLines("", "x\ny\n");
		expect(hunk).toMatchObject({
			oldStart: 0,
			oldLines: 0,
			newStart: 1,
			newLines: 2,
		});
	});

	test("a pure delete removes lines", () => {
		const hunks = diffLines("a\nb\nc\n", "a\nc\n");
		expect(hunks[0].lines.map(shape)).toEqual([
			"c 1 1 a",
			"r 2 - b",
			"c 3 2 c",
		]);
		expect(countChanges(hunks)).toEqual({ added: 0, removed: 1 });
	});

	test("a replaced line pairs with its counterpart for word marks", () => {
		const [hunk] = diffLines(
			"const total = price * count;\n",
			"const total = price * quantity;\n",
		);
		expect(hunk.lines.map(shape)).toEqual([
			"r 1 - const total = price * count;",
			"a - 1 const total = price * quantity;",
		]);
		const [removed, added] = hunk.lines;
		expect(removed.marks).toEqual([[22, 27]]);
		expect(added.marks).toEqual([[22, 30]]);
		expect(removed.text.slice(22, 27)).toBe("count");
		expect(added.text.slice(22, 30)).toBe("quantity");
	});

	test("removed lines come before added ones and pair in order", () => {
		const [hunk] = diffLines("x = 1\ny = 2\n", "x = 10\ny = 20\nz = 30\n");
		expect(hunk.lines.map((line) => line.kind)).toEqual([
			"removed",
			"removed",
			"added",
			"added",
			"added",
		]);
		expect(hunk.lines[0].marks).toEqual([[4, 5]]);
		expect(hunk.lines[2].marks).toEqual([[4, 6]]);
		expect(hunk.lines[4].marks).toBeUndefined();
	});

	test("a single space between two changes joins them into one mark", () => {
		const [hunk] = diffLines("let alpha beta;\n", "let gamma delta;\n");
		expect(hunk.lines[0].marks).toEqual([[4, 14]]);
		expect(hunk.lines[1].marks).toEqual([[4, 15]]);
	});

	test("a fully rewritten line has no marks", () => {
		const [hunk] = diffLines("foo\n", "bar\n");
		expect(hunk.lines[0].marks).toBeUndefined();
		expect(hunk.lines[1].marks).toBeUndefined();
	});

	test("context is trimmed and distant changes split into hunks", () => {
		const before = lines(30);
		const after = [...before];
		after[4] = "changed 5";
		after[24] = "changed 25";
		const hunks = diffLines(text(before), text(after));
		expect(hunks).toHaveLength(2);
		expect(hunks[0]).toMatchObject({
			oldStart: 2,
			oldLines: 7,
			newStart: 2,
			newLines: 7,
		});
		expect(hunks[0].lines[0].text).toBe("line 2");
		expect(hunks[0].lines.at(-1)?.text).toBe("line 8");
		expect(hunks[1]).toMatchObject({ oldStart: 22, newStart: 22 });

		const narrow = diffLines(text(before), text(after), { context: 1 });
		expect(narrow.map((hunk) => hunk.lines.length)).toEqual([4, 4]);
		const none = diffLines(text(before), text(after), { context: 0 });
		expect(none[0]).toMatchObject({ oldStart: 5, oldLines: 1 });
	});

	test("changes whose context touches share one hunk", () => {
		const before = lines(20);
		const after = [...before];
		after[4] = "changed 5";
		after[11] = "changed 12";
		expect(diffLines(text(before), text(after))).toHaveLength(1);
		after[11] = before[11];
		after[12] = "changed 13";
		expect(diffLines(text(before), text(after))).toHaveLength(2);
	});

	test("lineOffset shifts both sides' numbers", () => {
		const [hunk] = diffLines("a\nb\n", "a\nc\n", { lineOffset: 120 });
		expect(hunk).toMatchObject({ oldStart: 120, newStart: 120 });
		expect(hunk.lines.map(shape)).toEqual([
			"c 120 120 a",
			"r 121 - b",
			"a - 121 c",
		]);
		const [insert] = diffLines("", "x\n", { lineOffset: 40 });
		expect(insert).toMatchObject({ oldStart: 39, oldLines: 0, newStart: 40 });
	});

	test("CRLF and a missing final newline are not changes", () => {
		expect(diffLines("a\r\nb\r\n", "a\nb\n")).toEqual([]);
		expect(diffLines("a\nb", "a\nb\n")).toEqual([]);
		const [hunk] = diffLines("a\r\nb\r\n", "a\nc");
		expect(hunk.lines.map(shape)).toEqual(["c 1 1 a", "r 2 - b", "a - 2 c"]);
		expect(hunk.lines.every((line) => !line.text.includes("\r"))).toBe(true);
	});

	test("an empty line in the middle is kept", () => {
		const [hunk] = diffLines("a\n\nb\n", "a\n\nc\n");
		expect(hunk.lines.map(shape)).toEqual([
			"c 1 1 a",
			"c 2 2 ",
			"r 3 - b",
			"a - 3 c",
		]);
	});

	test("large files diff quickly and agree with their counts", () => {
		const before = lines(5_000);
		const after = before.map((line, index) =>
			index % 50 === 0 ? `${line} edited` : line,
		);
		after.splice(2_500, 0, "inserted");
		const startedAt = performance.now();
		const hunks = diffLines(text(before), text(after));
		expect(performance.now() - startedAt).toBeLessThan(1_000);
		expect(countChanges(hunks)).toEqual({ added: 101, removed: 100 });
	});

	test("a total rewrite falls back to a whole replace", () => {
		const before = lines(4_000, "old");
		const after = lines(4_000, "new");
		const startedAt = performance.now();
		const hunks = diffLines(text(before), text(after));
		expect(performance.now() - startedAt).toBeLessThan(2_000);
		expect(countChanges(hunks)).toEqual({ added: 4_000, removed: 4_000 });
		expect(hunks).toHaveLength(1);
		expect(hunks[0].lines[0].kind).toBe("removed");
		expect(hunks[0].lines[4_000].kind).toBe("added");
	});
});
