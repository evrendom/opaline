import { expect, test } from "bun:test";
import { continuesDrawn, spanMapping } from "./session-reader-minimap-hold";
import { packAttempts, unpackAttempts } from "./session-reader-minimap-store";

test("a held map places the view through the turns as drawn", () => {
	const drawn = { edges: [0, 100, 116, 216, 232, 332], end: 340, ids: "a b c" };
	const now = { edges: [0, 100, 116, 416, 432, 532], end: 540, ids: "a b c" };
	const mapping = spanMapping(drawn, now);
	expect(mapping).not.toBeNull();
	expect(mapping?.toDrawn(50)).toBe(50);
	expect(mapping?.toDrawn(266)).toBe(166);
	expect(mapping?.toDrawn(482)).toBe(282);
	expect(mapping?.toNow(166)).toBe(266);
});

test("a map drawn of the page as it is, or of other turns, maps nothing", () => {
	const spans = { edges: [0, 100], end: 120, ids: "a" };
	expect(spanMapping(spans, { ...spans, edges: [0, 100] })).toBeNull();
	expect(
		spanMapping(spans, { edges: [0, 100], end: 120, ids: "b" }),
	).toBeNull();
	expect(spanMapping(null, spans)).toBeNull();
});

test("a held map places turns come since through the room it had for them", () => {
	const drawn = { edges: [0, 100, 116, 216], end: 432, ids: "a b" };
	const now = { edges: [0, 100, 116, 216, 248, 448], end: 448, ids: "a b c" };
	expect(continuesDrawn(drawn, now)).toBe(true);
	const mapping = spanMapping(drawn, now);
	expect(mapping?.toDrawn(50)).toBe(50);
	expect(mapping?.toDrawn(448)).toBe(432);
	expect(continuesDrawn(drawn, { ...now, ids: "a c b" })).toBe(false);
	expect(continuesDrawn(drawn, { ...now, ids: "a bc" })).toBe(false);
	expect(continuesDrawn(null, now)).toBe(false);
});

test("attempts' shapes kept for the tab come back as they were measured", () => {
	const shapes = new Map([
		[
			"attempt-1",
			{
				height: 412.25,
				rows: [
					{ failed: true, height: 42, id: "s1", startMs: "10", top: 0 },
					{ height: 42.5, id: "s2", startMs: "20", tags: "git", top: 46.123 },
				],
				subagents: [
					{ endMs: "90", height: 42, id: "sub", top: 92, until: "s3" },
				],
				talks: [{ height: 42, id: "sub", top: 138 }],
			},
		],
	]);
	const back = unpackAttempts(
		JSON.parse(JSON.stringify(packAttempts(shapes))),
	).get("attempt-1");
	expect(back?.height).toBe(412.25);
	expect(back?.rows).toEqual([
		{ failed: true, height: 42, id: "s1", startMs: "10", top: 0 },
		{ height: 42.5, id: "s2", startMs: "20", tags: "git", top: 46.12 },
	]);
	expect(back?.subagents).toEqual([
		{ endMs: "90", height: 42, id: "sub", top: 92, until: "s3" },
	]);
	expect(back?.talks).toEqual([{ height: 42, id: "sub", top: 138 }]);
});
