import { expect, test } from "bun:test";
import { createSessionContinuousTurnViewportStore } from "./session-continuous-turn-viewport-store";

test("selection changes do not invalidate range and viewed subscribers", () => {
	const store = createSessionContinuousTurnViewportStore();
	store.publishViewport(
		{ index: 2, speaker: "member" },
		[2, 3],
		[{ index: 2, speaker: "model" }],
	);
	const before = store.getSnapshot();
	store.publishViewport(
		{ index: 2, speaker: "model" },
		[2, 3],
		[{ index: 2, speaker: "model" }],
	);
	expect(store.getSnapshot().activeSelection).not.toBe(before.activeSelection);
	expect(store.getSnapshot().visibleRange).toBe(before.visibleRange);
	expect(store.getSnapshot().viewedSelections).toBe(before.viewedSelections);
});

test("viewed changes preserve selection, range and fractional progress identities", () => {
	const store = createSessionContinuousTurnViewportStore();
	store.publishViewport(
		{ index: 2, speaker: "model" },
		[2, 3],
		[],
		[
			{ index: 2, progress: 0.2 },
			{ index: 3, progress: 0.6 },
		],
	);
	const before = store.getSnapshot();
	const progress = store.getViewportTurnRange();
	store.publishViewport(
		{ index: 2, speaker: "model" },
		[2, 3],
		[{ index: 2, speaker: "model" }],
		[
			{ index: 2, progress: 0.2 },
			{ index: 3, progress: 0.6 },
		],
	);
	expect(store.getSnapshot().viewedSelections).not.toBe(
		before.viewedSelections,
	);
	expect(store.getSnapshot().activeSelection).toBe(before.activeSelection);
	expect(store.getSnapshot().visibleRange).toBe(before.visibleRange);
	expect(store.getViewportTurnRange()).toBe(progress);
});

test("fractional scrolling leaves semantic subscribers unchanged", () => {
	const store = createSessionContinuousTurnViewportStore();
	store.publishViewport(
		{ index: 2, speaker: "model" },
		[2, 3],
		[],
		[
			{ index: 2, progress: 0.2 },
			{ index: 3, progress: 0.6 },
		],
	);
	const before = store.getSnapshot();
	const progress = store.getViewportTurnRange();
	store.publishViewport(
		{ index: 2, speaker: "model" },
		[2, 3],
		[],
		[
			{ index: 2, progress: 0.3 },
			{ index: 3, progress: 0.7 },
		],
	);
	expect(store.getSnapshot()).toBe(before);
	expect(store.getViewportTurnRange()).not.toBe(progress);
});
