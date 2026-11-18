import { describe, expect, test } from "bun:test";
import type { SessionReaderStep } from "../../model/session-reader-model";
import {
	buildWaterfallRows,
	getFoldKeysAround,
	getWaterfallFilterOptions,
	nestWaterfallRows,
	summarizeSteps,
	type WaterfallRow,
} from "./session-reader-waterfall-rows";

function step(
	id: string,
	name: string,
	startMs: number,
	durationMs: number,
	overrides: Partial<SessionReaderStep> = {},
): SessionReaderStep {
	return {
		children: [],
		detail: null,
		endMs: startMs + durationMs,
		icon: null,
		id,
		isError: false,
		kind: "tool",
		nativeId: null,
		name,
		result: "ok",
		startMs,
		text: null,
		toolEvent: null,
		...overrides,
	};
}

/** A compact picture of the rows: `id@depth` for steps, `variant:n@depth`
 * (+ when open) for folds. */
function outline(rows: WaterfallRow[]): string[] {
	return rows.map((row) =>
		row.kind === "step"
			? `${row.step.id}@${row.depth}`
			: `${row.variant}:${row.steps.length}@${row.depth}${row.expanded ? "+" : ""}`,
	);
}

const none = () => false;

// A 14-step turn on a 1000ms clock: evenly short steps around one long Bash, a
// failure and the final answer.
const largeTurn = [
	...["a", "b", "c", "d", "e"].map((id, i) =>
		step(id, i % 2 ? "Read" : "Grep", i * 10, 10),
	),
	step("long", "Bash", 50, 400),
	...["f", "g", "h", "i"].map((id, i) =>
		step(id, i % 2 ? "Read" : "Edit", 450 + i * 10, 10),
	),
	step("err", "Bash", 490, 10, { isError: true }),
	step("j", "Read", 500, 5),
	step("k", "Read", 505, 5),
	step("answer", "Response", 510, 490, { kind: "message", text: "Done." }),
];

describe("turn waterfall rows", () => {
	test("small turns list every step", () => {
		const steps = largeTurn.slice(0, 5);
		expect(outline(buildWaterfallRows(steps, 1000, none))).toEqual([
			"a@1",
			"b@1",
			"c@1",
			"d@1",
			"e@1",
		]);
	});

	test("large turns fold quiet stretches and keep what stands out", () => {
		expect(outline(buildWaterfallRows(largeTurn, 1000, none))).toEqual([
			"quiet:5@1",
			"long@1",
			"quiet:4@1",
			"err@1",
			// Two quiet steps aren't worth a fold.
			"j@1",
			"k@1",
			"answer@1",
		]);
	});

	test("a step kept out stays a row, splitting the folds around it", () => {
		const keepOut = new Set(["g"]);
		expect(
			outline(buildWaterfallRows(largeTurn, 1000, none, new Set(), keepOut)),
		).toEqual([
			"quiet:5@1",
			"long@1",
			// What's left either side is too short to fold.
			"f@1",
			"g@1",
			"h@1",
			"i@1",
			"err@1",
			"j@1",
			"k@1",
			"answer@1",
		]);
		const reads = ["r1", "r2", "r3", "r4"].map((id, i) =>
			step(id, "Read", i * 10, 10),
		);
		expect(
			outline(
				buildWaterfallRows(reads, 1000, none, new Set(), new Set(["r3"])),
			),
		).toEqual(["r1@1", "r2@1", "r3@1", "r4@1"]);
	});

	test("an opened quiet stretch nests its steps one level deeper", () => {
		const rows = buildWaterfallRows(
			largeTurn,
			1000,
			(key) => key === "quiet:a",
		);
		expect(outline(rows).slice(0, 7)).toEqual([
			"quiet:5@1+",
			"a@2",
			"b@2",
			"c@2",
			"d@2",
			"e@2",
			"long@1",
		]);
	});

	test("a filter keeps the picked kinds and folds every run of the rest", () => {
		expect(
			outline(buildWaterfallRows(largeTurn, 1000, none, new Set(["Bash"]))),
		).toEqual([
			"filtered:5@1",
			"long@1",
			"filtered:4@1",
			"err@1",
			"filtered:3@1",
		]);
		expect(
			outline(buildWaterfallRows(largeTurn, 1000, none, new Set(["Messages"]))),
		).toEqual(["filtered:13@1", "answer@1"]);
	});

	test("selecting a hidden step finds the folds around it", () => {
		expect(getFoldKeysAround(largeTurn, 1000, "g", new Set())).toEqual([
			"quiet:f",
		]);
		expect(getFoldKeysAround(largeTurn, 1000, "long", new Set())).toEqual([]);
	});

	test("filter options list tools by use, then what the model wrote", () => {
		expect(
			getWaterfallFilterOptions(largeTurn).map((option) => [
				option.key,
				option.count,
				option.errorCount,
				option.sample.kind,
			]),
		).toEqual([
			["Read", 6, 0, "tool"],
			["Grep", 3, 0, "tool"],
			["Bash", 2, 1, "tool"],
			["Edit", 2, 0, "tool"],
			["Messages", 1, 0, "message"],
		]);
	});

	test("a subagent's steps sit one level under its call, and fold away", () => {
		const call = step("call", "spawn_agent", 0, 100, {
			children: [step("c1", "Read", 10, 10), step("c2", "Bash", 30, 10)],
			kind: "agent",
		});
		const open = (key: string) => key === "subtrace:call";
		expect(outline(buildWaterfallRows([call], 1000, open))).toEqual([
			"call@1",
			"c1@2",
			"c2@2",
		]);
		expect(outline(buildWaterfallRows([call], 1000, none))).toEqual(["call@1"]);
		expect(getFoldKeysAround([call], 1000, "c2", new Set())).toEqual([
			"subtrace:call",
		]);
	});

	test("open folds and subagent calls hold the deeper rows after them", () => {
		const agent = step("agent", "Explore", 100, 900, {
			children: [step("a1", "Read", 200, 10), step("a2", "Grep", 300, 10)],
			kind: "agent",
		});
		const steps = [
			step("s1", "Bash", 0, 50),
			agent,
			step("s2", "Edit", 1000, 10),
		];
		const shape = (nodes: ReturnType<typeof nestWaterfallRows>): unknown[] =>
			nodes.map((node) =>
				node.children.length > 0
					? {
							[node.row.kind === "step" ? node.row.step.id : "fold"]: shape(
								node.children,
							),
						}
					: node.row.kind === "step"
						? node.row.step.id
						: "fold",
			);
		const open = buildWaterfallRows(steps, 1010, () => true);
		expect(shape(nestWaterfallRows(open))).toEqual([
			"s1",
			{ agent: ["a1", "a2"] },
			"s2",
		]);
		const closed = buildWaterfallRows(steps, 1010, () => false);
		expect(shape(nestWaterfallRows(closed))).toEqual(["s1", "agent", "s2"]);
	});

	test("a fold summarises what it holds", () => {
		expect(summarizeSteps(largeTurn.slice(0, 5))).toBe("Grep ×3, Read ×2");
	});
});
