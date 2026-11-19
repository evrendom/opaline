import { describe, expect, test } from "bun:test";
import { createSessionContinuousTurnViewportStore } from "./session-continuous-turn-viewport-store";
import { getTranscriptViewportTurnRange } from "./session-transcript-list";

describe("transcript viewport turn range", () => {
	test("measures partial boundary turns from the visible transcript pixels", () => {
		const turnItems = [
			{
				item: { end: 200, start: 0 },
				speaker: "member" as const,
				turnIndex: 0,
			},
			{
				item: { end: 400, start: 200 },
				speaker: "model" as const,
				turnIndex: 0,
			},
			{
				item: { end: 1_000, start: 400 },
				speaker: "model" as const,
				turnIndex: 1,
			},
		];

		expect(
			getTranscriptViewportTurnRange({
				clientHeight: 400,
				scrollTop: 300,
				turnItems,
				visibleRange: [0, 1],
			}),
		).toEqual([
			{ index: 0, progress: 0.75 },
			{ index: 1, progress: 0.5 },
		]);

		expect(
			getTranscriptViewportTurnRange({
				clientHeight: 700,
				scrollTop: 300,
				turnItems,
				visibleRange: [0, 1],
			}),
		).toEqual([
			{ index: 0, progress: 0.75 },
			{ index: 1, progress: 1 },
		]);
	});

	test("publishes fractional turn changes to viewport subscribers", () => {
		const store = createSessionContinuousTurnViewportStore();
		let notificationCount = 0;
		store.subscribe(() => {
			notificationCount += 1;
		});
		const activeSelection = { index: 2, speaker: "model" as const };
		const viewedSelections = [activeSelection];

		store.publishViewport(activeSelection, [2, 2], viewedSelections, [
			{ index: 2, progress: 0.2 },
			{ index: 2, progress: 0.4 },
		]);
		expect(store.getViewportTurnRange()).toEqual([
			{ index: 2, progress: 0.2 },
			{ index: 2, progress: 0.4 },
		]);
		expect(notificationCount).toBe(1);
		const turnSnapshot = store.getSnapshot();

		store.publishViewport(activeSelection, [2, 2], viewedSelections, [
			{ index: 2, progress: 0.25 },
			{ index: 2, progress: 0.45 },
		]);
		expect(store.getViewportTurnRange()).toEqual([
			{ index: 2, progress: 0.25 },
			{ index: 2, progress: 0.45 },
		]);
		expect(store.getSnapshot()).toBe(turnSnapshot);
		expect(notificationCount).toBe(2);
	});
});
