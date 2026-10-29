import { describe, expect, test } from "bun:test";
import {
	GRID,
	GRID_TRACK,
	GRID_UNTIMED,
	GRID_UNTIMED_TRACK,
} from "./session-reader-waterfall-layout";

function columns(grid: string) {
	const sizes: Record<string, [number, number]> = {};
	for (const [, prefix = "", label, totals] of grid.matchAll(
		/(@lg:)?grid-cols-\[([\d.]+)rem_minmax\(0,1fr\)_([\d.]+)rem\]/gu,
	))
		sizes[prefix] = [Number(label), Number(totals)];
	return sizes;
}

function insets(track: string) {
	const sizes: Record<string, { left?: number; right?: number }> = {};
	for (const [, prefix = "", side, steps] of track.matchAll(
		/(@lg:)?(left|right)-(\d+)/gu,
	)) {
		const size = sizes[prefix] ?? {};
		size[side as "left" | "right"] = Number(steps) / 4;
		sizes[prefix] = size;
	}
	return sizes;
}

describe("a waterfall's track overlays", () => {
	test("inset by the timed grid's label and totals columns", () => {
		const grid = columns(GRID);
		const track = insets(GRID_TRACK);
		expect(Object.keys(grid).sort()).toEqual(["", "@lg:"]);
		for (const [size, [label, totals]] of Object.entries(grid))
			expect(track[size]).toEqual({ left: label, right: totals });
	});

	test("inset by the untimed grid's label column and its end margin", () => {
		const grid = columns(GRID_UNTIMED);
		const track = insets(GRID_UNTIMED_TRACK);
		expect(track[""]).toEqual({
			left: grid[""]?.[0],
			right: grid[""]?.[1],
		});
		expect(grid["@lg:"]?.[1]).toBe(grid[""]?.[1]);
		expect(track["@lg:"]).toEqual({ left: grid["@lg:"]?.[0] });
	});
});
