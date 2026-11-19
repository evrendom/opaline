import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RailTagsState } from "./session-reader-rail-tags";
import {
	createActiveTurnStore,
	TurnRailList,
} from "./session-reader-turn-rail";

vi.mock("../detail/session-reader-jump-pill", async (original) => ({
	...(await original<typeof import("../detail/session-reader-jump-pill")>()),
	scrollToCenter: vi.fn(),
}));

vi.mock("@/lib/reveal-in-list", async (original) => ({
	...(await original<typeof import("@/lib/reveal-in-list")>()),
	centerInList: vi.fn(),
}));

vi.mock("@/hooks/use-scroll-fade", () => ({
	useScrollFade: () => ({ fade: {}, ref: () => {} }),
}));

const { scrollToCenter } = await import("../detail/session-reader-jump-pill");
const { centerInList } = await import("@/lib/reveal-in-list");

const watched = { observed: [] as Element[], observers: new Set<object>() };

class CountingResizeObserver implements ResizeObserver {
	observe(target: Element) {
		if (!(target instanceof HTMLButtonElement)) return;
		watched.observers.add(this);
		watched.observed.push(target);
	}
	unobserve() {}
	disconnect() {}
}

const savedResizeObserver = globalThis.ResizeObserver;
const savedRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
	watched.observed = [];
	watched.observers = new Set();
	vi.mocked(scrollToCenter).mockClear();
	vi.mocked(centerInList).mockClear();
	globalThis.ResizeObserver = CountingResizeObserver;
	HTMLElement.prototype.getBoundingClientRect = function rect(
		this: HTMLElement,
	) {
		const list = this.hasAttribute("data-fluid-menu-root");
		return DOMRect.fromRect(
			list
				? { height: 100, width: 200, x: 0, y: 0 }
				: { height: 34, width: 200, x: 0, y: 500 },
		);
	};
});

afterEach(() => {
	globalThis.ResizeObserver = savedResizeObserver;
	HTMLElement.prototype.getBoundingClientRect = savedRect;
});

function turn(turnId: string): SessionDetailTurnSummary {
	const summary: Partial<SessionDetailTurnSummary> = {
		durationSeconds: 1,
		errorCount: 0,
		estimatedCost: null,
		inputTokens: 0,
		outputTokens: 0,
		startedAt: null,
		subagentEvents: [],
		toolCallCount: 0,
		turnId,
		usageCalls: [],
		userPreview: turnId,
	};
	return summary as SessionDetailTurnSummary;
}

const TAGS: RailTagsState = {
	allRunsFolded: false,
	allRunsOpen: true,
	filters: [],
	hidden: new Set(),
	keeps: () => true,
	picked: [],
	setAllRunsOpen: () => {},
	setFilters: () => {},
	setHidden: () => {},
	setPicked: () => {},
};

const activeTurn = createActiveTurnStore();
const onSelect = () => {};
const costThresholds: readonly number[] = [];

function rail(
	turns: readonly SessionDetailTurnSummary[],
	currentTurnId: string,
) {
	return (
		<TurnRailList
			activeTurn={activeTurn}
			costThresholds={costThresholds}
			currentTurnId={currentTurnId}
			model={null}
			onSelect={onSelect}
			tags={TAGS}
			turns={turns}
		/>
	);
}

const list = (container: HTMLElement) =>
	container.querySelector<HTMLElement>("[data-fluid-menu-root]");

describe("TurnRailList", () => {
	it("centres the turn in view once as it opens, where it left the list", () => {
		const turns = [turn("a1"), turn("a2"), turn("a3")];
		const first = render(rail(turns, "a3"));
		expect(centerInList).toHaveBeenCalledTimes(1);
		const scroller = list(first.container) as HTMLElement;
		scroller.scrollTop = 120;
		fireEvent.scroll(scroller);
		first.rerender(rail(turns, "a3"));
		first.rerender(rail([...turns], "a3"));
		expect(centerInList).toHaveBeenCalledTimes(1);
		first.unmount();

		const again = render(rail(turns, "a1"));
		expect(list(again.container)?.scrollTop).toBe(120);
		expect(centerInList).toHaveBeenCalledTimes(2);
	});

	it("watches the rows again when the turns or the turn in view change, not otherwise", () => {
		const turns = [turn("b1"), turn("b2")];
		const view = render(rail(turns, "b1"));
		expect(watched.observers.size).toBe(1);
		expect(watched.observed).toHaveLength(2);

		view.rerender(rail(turns, "b1"));
		expect(watched.observers.size).toBe(1);

		const more = [...turns, turn("b3")];
		view.rerender(rail(more, "b1"));
		expect(watched.observers.size).toBe(2);
		expect(watched.observed).toHaveLength(5);

		view.rerender(rail(more, "b2"));
		expect(watched.observers.size).toBe(3);
	});

	it("scrolls a picked turn out of view to the middle, once per pick", () => {
		const turns = [turn("c1"), turn("c2"), turn("c3")];
		const view = render(rail(turns, "c1"));
		expect(scrollToCenter).not.toHaveBeenCalled();

		view.rerender(rail(turns, "c3"));
		expect(scrollToCenter).toHaveBeenCalledTimes(1);
		const [scroller, row] = vi.mocked(scrollToCenter).mock.calls[0] ?? [];
		expect(scroller).toBe(list(view.container));
		expect(row?.textContent).toContain("c3");

		view.rerender(rail(turns, "c3"));
		view.rerender(rail([...turns], "c3"));
		expect(scrollToCenter).toHaveBeenCalledTimes(1);
	});
});
