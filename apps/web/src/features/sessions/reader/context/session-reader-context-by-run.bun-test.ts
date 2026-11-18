import { expect, test } from "bun:test";
import { placeOf } from "./session-reader-context-by-run";
import type { ContextStep } from "./session-reader-context-map";

const DAY = Date.parse("2026-11-18T10:00:00.000Z");
const iso = (ms: number) => new Date(DAY + ms).toISOString();

const step = (
	id: string,
	key: string,
	items: string[],
	start: number,
): ContextStep => ({
	end: DAY + start + 100,
	id,
	items,
	key,
	start: DAY + start,
	tokens: 10,
	waited: DAY + start + 100,
	written: DAY + start,
});

const runs = [
	{ startedAt: iso(0), turnId: "run-a" },
	{ startedAt: iso(60_000), turnId: "run-b" },
];

const trail = [
	step("s1", "tools:bash", ["ls"], 1_000),
	step("s2", "tools:bash", ["bun test"], 70_000),
	step("s3", "tools:bash", ["bun test"], 80_000),
	step("s4", "thinking", [], 2_000),
];

test("a box opens the first step that used it, in the run it ran in", () => {
	expect(placeOf({ trail }, runs, { key: "tools:bash" }, "bun test")).toEqual({
		run: "run-b",
		step: "s2",
	});
	expect(placeOf({ trail }, runs, { key: "tools:bash" }, "ls")).toEqual({
		run: "run-a",
		step: "s1",
	});
});

test("a compacted box finds the steps of its own part", () => {
	expect(
		placeOf({ trail }, runs, { key: "compacted:tools:bash" }, "ls"),
	).toEqual({ run: "run-a", step: "s1" });
});

test("a box without a matching thing opens the part's first step", () => {
	expect(placeOf({ trail }, runs, { key: "thinking" }, null)).toEqual({
		run: "run-a",
		step: "s4",
	});
	expect(placeOf({ trail }, runs, { key: "tools:bash" }, "gone")).toEqual({
		run: "run-a",
		step: "s1",
	});
});

test("a run box opens the step behind the picked part, or the run", () => {
	const part = {
		key: "run:run-b",
		nested: [
			{
				key: "tools:bash",
				kind: "tools" as const,
				label: "Shell",
				things: [{ label: "bun test", steps: ["s2"], tokens: 10 }],
				tokens: 10,
			},
		],
	};
	expect(placeOf({ trail }, runs, part, "Shell")).toEqual({
		run: "run-b",
		step: "s2",
	});
	expect(placeOf({ trail }, runs, part, null)).toEqual({
		run: "run-b",
		step: null,
	});
});

test("without a trail there is no place to open", () => {
	expect(placeOf({ trail: [] }, runs, { key: "tools:bash" }, "ls")).toBeNull();
});
