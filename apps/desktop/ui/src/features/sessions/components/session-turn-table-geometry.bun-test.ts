import { expect, test } from "bun:test";
import {
	getSessionTurnViewedDirection,
	getSessionTurnViewedGroups,
	type SessionTurnRowGeometry,
	type SessionTurnTableGeometry,
} from "./session-turn-table-geometry";

const rows: readonly SessionTurnRowGeometry[] = [
	{ key: "a", visibleIndex: 0, top: 0, bottom: 36, adjacentToPrevious: false },
	{ key: "b", visibleIndex: 1, top: 36, bottom: 72, adjacentToPrevious: true },
	// A compaction/episode separator splits the otherwise adjacent data rows.
	{
		key: "c",
		visibleIndex: 2,
		top: 100,
		bottom: 136,
		adjacentToPrevious: false,
	},
	{
		key: "d",
		visibleIndex: 3,
		top: 136,
		bottom: 172,
		adjacentToPrevious: true,
	},
];

test("viewed groups use cached positions and stop at episode separators", () => {
	expect(
		getSessionTurnViewedGroups(rows, new Set(["a", "b", "c", "d"])),
	).toEqual([
		{
			firstVisibleIndex: 0,
			lastVisibleIndex: 1,
			top: 0,
			height: 72,
			rowCount: 2,
		},
		{
			firstVisibleIndex: 2,
			lastVisibleIndex: 3,
			top: 100,
			height: 72,
			rowCount: 2,
		},
	]);
	expect(getSessionTurnViewedGroups(rows, new Set(["a", "c"]))).toEqual([
		{
			firstVisibleIndex: 0,
			lastVisibleIndex: 0,
			top: 0,
			height: 36,
			rowCount: 1,
		},
		{
			firstVisibleIndex: 2,
			lastVisibleIndex: 2,
			top: 100,
			height: 36,
			rowCount: 1,
		},
	]);
});

test("filtering and sorting use row keys rather than previous visible indices", () => {
	const reordered: readonly SessionTurnRowGeometry[] = [
		{
			key: "d",
			visibleIndex: 0,
			top: 0,
			bottom: 36,
			adjacentToPrevious: false,
		},
		{
			key: "b",
			visibleIndex: 1,
			top: 36,
			bottom: 72,
			adjacentToPrevious: true,
		},
	];
	expect(getSessionTurnViewedGroups(reordered, new Set(["a", "b"]))).toEqual([
		{
			firstVisibleIndex: 1,
			lastVisibleIndex: 1,
			top: 36,
			height: 36,
			rowCount: 1,
		},
	]);
});

test("offscreen direction accounts for sticky header and scroll-content origin", () => {
	const geometry: SessionTurnTableGeometry = {
		bodyTop: 44,
		headerHeight: 44,
		viewportHeight: 120,
		rows,
	};
	const early = getSessionTurnViewedGroups(rows, new Set(["a", "b"]));
	const late = getSessionTurnViewedGroups(rows, new Set(["d"]));
	expect(getSessionTurnViewedDirection(geometry, early, 0)).toBeUndefined();
	expect(getSessionTurnViewedDirection(geometry, early, 80)).toBe("above");
	expect(getSessionTurnViewedDirection(geometry, late, 0)).toBe("below");
	expect(getSessionTurnViewedDirection(geometry, late, 100)).toBeUndefined();
	expect(getSessionTurnViewedDirection(geometry, [], 100)).toBeUndefined();
});
