import { expect, test } from "bun:test";
import {
	resolveHighlightSource,
	resolveHighlightTransition,
} from "../components/fluid-hover-highlight";
import { type PickNearestInput, pickNearest } from "./use-fluid-hover";

const layout: PickNearestInput = {
	axis: "y",
	point: { x: 40, y: 40 },
	rects: [
		{ top: 0, left: 0, width: 300, height: 36 },
		{ top: 40, left: 0, width: 300, height: 36 },
	],
	containerRect: { top: 0, left: 0, width: 300, height: 100 },
	layoutSize: { width: 300, height: 100 },
	border: { x: 0, y: 0 },
	scroll: { x: 0, y: 0 },
};

test("keeps the nearest row lit across gaps", () => {
	expect(pickNearest({ ...layout, point: { x: 40, y: 37 } })).toBe(0);
	expect(pickNearest({ ...layout, point: { x: 40, y: 39 } })).toBe(1);
});

test("skips disabled sessions and handles an empty list", () => {
	expect(pickNearest({ ...layout, isDisabled: (index) => index === 1 })).toBe(
		0,
	);
	expect(pickNearest({ ...layout, isDisabled: () => true })).toBeNull();
	expect(pickNearest({ ...layout, rects: [] })).toBeNull();
});

test("tracks rows inside scaled and scrolled containers", () => {
	expect(
		pickNearest({
			...layout,
			containerRect: { top: 100, left: 0, width: 150, height: 50 },
			scroll: { x: 0, y: 40 },
			point: { x: 20, y: 109 },
		}),
	).toBe(1);
});

test("honors reduced motion and explicit snapping", () => {
	expect(resolveHighlightTransition(undefined, true).duration).toBe(0);
	expect(resolveHighlightTransition(false, false).duration).toBe(0);
	expect(resolveHighlightTransition(undefined, false).type).toBe("spring");
});

test("hides stale measurements until the current rows are measured", () => {
	const hover = {
		activeIndex: 0,
		itemRects: [{ top: 0, left: 0, width: 300, height: 36 }],
		isMeasured: false,
		sessionRef: { current: 1 },
	};
	expect(resolveHighlightSource({ hover }).rect).toBeNull();
	expect(
		resolveHighlightSource({ hover: { ...hover, isMeasured: true } }).rect,
	).toEqual(hover.itemRects[0]);
});
