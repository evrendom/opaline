import { expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { AnalysisFindInputSchema } from "@rudel/api-routes";
import {
	type CursorKey,
	type CursorOrder,
	readFindCursor,
	takePage,
	writeFindCursor,
} from "./find-cursor.js";

const ORDER: CursorOrder = ["desc", "asc"];
const input = AnalysisFindInputSchema.parse({
	source: "runs",
	from: "2026-09-01",
	to: "2026-10-04",
	sort: "costUsd",
});

test("pages follow the cursor key: ties break by identity, unpriced last, no duplicates", () => {
	const items: CursorKey[] = [
		[2, "b"],
		[null, "a"],
		[2, "a"],
		[5, "z"],
		[null, "b"],
		[2, "c"],
	];
	const keyOf = (key: CursorKey) => key;
	const first = takePage(items, keyOf, ORDER, undefined, 4);
	expect(first).toEqual({
		page: [
			[5, "z"],
			[2, "a"],
			[2, "b"],
			[2, "c"],
		],
		more: true,
	});
	const after = readFindCursor(
		{ ...input, cursor: writeFindCursor(input, [2, "c"]) },
		ORDER,
	);
	const second = takePage(items, keyOf, ORDER, after, 4);
	expect(second).toEqual({
		page: [
			[null, "a"],
			[null, "b"],
		],
		more: false,
	});
	expect([...first.page, ...second.page]).toHaveLength(items.length);
});

test("a cursor survives a new limit and trace ids but not other arguments", () => {
	const cursor = writeFindCursor(input, [2, "c"]);
	expect(
		readFindCursor({ ...input, cursor, limit: 200, analysis: "a_1" }, ORDER),
	).toEqual([2, "c"]);
	for (const other of [
		{ ...input, cursor, to: "2026-10-03" },
		{ ...input, cursor, sort: "minutes" as const },
		{ ...input, cursor, repository: "athena" },
	])
		expect(() => readFindCursor(other, ORDER)).toThrow(
			"cursor: returned by a find call with other arguments; repeat that call's arguments (only limit may change), or omit cursor to start from the first page",
		);
});

test("a cursor that find did not return is a BAD_REQUEST", () => {
	for (const cursor of [
		"not-a-cursor",
		Buffer.from("[1]").toString("base64url"),
		writeFindCursor(input, [2, "c", "extra"]),
	]) {
		const read = () => readFindCursor({ ...input, cursor }, ORDER);
		expect(read).toThrow(ORPCError);
		expect(read).toThrow("cursor: not a cursor returned by find");
	}
});

test("a first page without a draft id continues with the draft id its trace returned", () => {
	const cursor = writeFindCursor(input, [2, "c"]);
	expect(
		readFindCursor({ ...input, cursor, analysis: "a_draft" }, ORDER),
	).toEqual([2, "c"]);
	// A different window is still another call.
	expect(() =>
		readFindCursor(
			{ ...input, from: "2026-09-02", cursor, analysis: "a_draft" },
			ORDER,
		),
	).toThrow(ORPCError);
});
