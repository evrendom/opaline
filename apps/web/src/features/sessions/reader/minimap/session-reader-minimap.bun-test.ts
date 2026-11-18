import { expect, test } from "bun:test";
import { minimapLine, withLanes } from "./session-reader-minimap-line";

test("the rail runs the session; messages and subagents branch off it", () => {
	const line = minimapLine(
		[
			{ height: 10, kind: "member", top: 0 },
			{ height: 60, kind: "agent", top: 10 },
			{ height: 30, kind: "subagent", top: 20 },
			{ height: 30, kind: "member", top: 70 },
			{ height: 40, kind: "agent", top: 100 },
		],
		1,
		100,
	);
	expect(line.rail).toBe("M 28 0 V 140");
	expect(line.branches).toBe("M 28 0 H 12 M 28 70 H 12 V 100 H 28");
	expect(line.subagents.map((each) => each.d).join(" ")).toBe(
		"M 28 20 H 50 V 50 H 28",
	);
	expect(line.nodes).toEqual([
		{ kind: "member", x: 12, y: 0 },
		{ kind: "agent", x: 28, y: 10 },
		{ kind: "agent", x: 28, y: 70 },
		{ kind: "subagent", x: 50, y: 20 },
		{ kind: "subagent", x: 50, y: 50 },
		{ kind: "member", x: 12, y: 70 },
		{ kind: "agent", x: 28, y: 100 },
		{ kind: "agent", x: 28, y: 140 },
	]);
});

test("a subagent runs down its lane until it was done, however short", () => {
	const line = minimapLine(
		[
			{ height: 10, kind: "member", top: 0 },
			{ height: 60, kind: "agent", top: 10 },
			{ height: 4, kind: "subagent", top: 20 },
			{ height: 8, kind: "subagent", top: 21 },
		],
		1,
		100,
	);
	expect(line.subagents.map((each) => each.d).join(" ")).toBe(
		["M 28 20 H 50 V 24 H 28", "M 28 21 H 50 V 29 H 28"].join(" "),
	);
	expect(line.nodes).toEqual([
		{ kind: "member", x: 12, y: 0 },
		{ kind: "agent", x: 28, y: 10 },
		{ kind: "agent", x: 28, y: 70 },
		{ kind: "subagent", x: 50, y: 20 },
		{ kind: "subagent", x: 50, y: 24 },
		{ kind: "subagent", x: 50, y: 21 },
		{ kind: "subagent", x: 50, y: 29 },
	]);
});

test("parts too close to tell apart share a branch", () => {
	const line = minimapLine(
		[
			{ height: 1, kind: "member", top: 0 },
			{ height: 1, kind: "agent", top: 1 },
			{ height: 1, kind: "member", top: 2 },
		],
		1,
		100,
	);
	expect(line.nodes).toEqual([{ kind: "member", x: 34, y: 0 }]);
	expect(minimapLine([], 1, 100).rail).toBe("");
});

test("a run's reasoning ends where its reply begins", () => {
	const line = minimapLine(
		[
			{ height: 10, kind: "member", top: 0 },
			{ height: 60, kind: "agent", reply: 50, top: 10 },
		],
		1,
		100,
	);
	expect(line.nodes).toEqual([
		{ kind: "member", x: 34, y: 0 },
		{ kind: "agent", x: 66, y: 10 },
		{ kind: "agent", x: 66, y: 50 },
	]);
});

test("subagents that never ran at once share a rail", () => {
	const lanes = withLanes([
		{ height: 100, kind: "agent", top: 0 },
		{ height: 30, id: "a", kind: "subagent", top: 10 },
		{ height: 30, id: "b", kind: "subagent", top: 20 },
		{ height: 10, id: "c", kind: "subagent", top: 50 },
	]).flatMap((part) => (part.id ? [[part.id, part.lane]] : []));
	expect(lanes).toEqual([
		["a", 0],
		["b", 1],
		["c", 0],
	]);
});

test("the run's talks with a subagent still working dot across to its rail", () => {
	const line = minimapLine(
		withLanes([
			{ height: 10, kind: "member", top: 0 },
			{ height: 90, kind: "agent", top: 10 },
			{ height: 40, id: "a", kind: "subagent", top: 20 },
			{ height: 0, id: "a", kind: "talk", top: 35 },
			{ height: 0, id: "a", kind: "talk", top: 80 },
		]),
		1,
		100,
	);
	expect(line.talks).toEqual([{ d: "M 28 35 H 50", id: "a", y: 35 }]);
});
