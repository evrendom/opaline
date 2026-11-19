import { afterEach, beforeEach, expect, test } from "bun:test";
import { createReaderLayout } from "./reader-layout";

let now = 0;
const realNow = performance.now.bind(performance);
beforeEach(() => {
	now = 1_000;
	performance.now = () => now;
});
afterEach(() => {
	performance.now = realNow;
});

function layOut(layout: ReturnType<typeof createReaderLayout>, turnId: string) {
	layout.start(turnId);
	layout.done(turnId);
	layout.finish(turnId);
}

test("a turn not yet whole is waited for a while, then laid out as it is", () => {
	const layout = createReaderLayout();
	layout.setWhole("t1", false);
	expect(layout.waitsForWhole("t1")).toBe(true);
	now += 5_000;
	expect(layout.waitsForWhole("t1")).toBe(true);
	now += 1_000;
	expect(layout.waitsForWhole("t1")).toBe(false);
	layout.start("t1");
	expect(layout.defer("t1")).toBe(false);
});

test("a whole turn, or one not yet known, isn't waited for", () => {
	const layout = createReaderLayout();
	expect(layout.waitsForWhole("t1")).toBe(false);
	layout.setWhole("t1", true);
	expect(layout.waitsForWhole("t1")).toBe(false);
});

test("a laid-out turn changing again and again is laid out once they stop", () => {
	const layout = createReaderLayout();
	layOut(layout, "t1");
	layout.setSettled(true);
	expect(layout.isLaidOut("t1")).toBe(true);
	layout.invalidate("t1");
	expect(layout.getSettled()).toBe(false);
	expect(layout.isLaidOut("t1")).toBe(false);
	expect(layout.isDeferred("t1")).toBe(true);
	now += 800;
	layout.invalidate("t1");
	now += 800;
	expect(layout.isDeferred("t1")).toBe(true);
	now += 300;
	expect(layout.isDeferred("t1")).toBe(false);
});

test("a turn never laid out isn't held by a change", () => {
	const layout = createReaderLayout();
	layout.invalidate("t1");
	expect(layout.isDeferred("t1")).toBe(false);
});

test("turns laid out together are let go together, a deferred one not counted", () => {
	const layout = createReaderLayout();
	layout.setWhole("t2", false);
	layout.start("t1", "t2");
	expect(layout.isMeasuring("t1")).toBe(true);
	expect(layout.isMeasuring("t2")).toBe(true);
	layout.done("t1");
	expect(layout.defer("t2")).toBe(true);
	expect(layout.isDone("t1")).toBe(true);
	expect(layout.wasDeferred("t2")).toBe(true);
	layout.finish("t1", "t2");
	expect(layout.isLaidOut("t1")).toBe(true);
	expect(layout.isLaidOut("t2")).toBe(false);
	expect(layout.getMeasuring().size).toBe(0);
});

test("a turn not yet whole holds the page from settling far longer than it's waited for", () => {
	const layout = createReaderLayout();
	layout.setWhole("t1", false);
	expect(layout.holdsSettle("t1")).toBe(true);
	now += 6_000;
	expect(layout.waitsForWhole("t1")).toBe(false);
	expect(layout.holdsSettle("t1")).toBe(true);
	now += 54_000;
	expect(layout.holdsSettle("t1")).toBe(false);
	layout.setWhole("t2", true);
	expect(layout.holdsSettle("t2")).toBe(false);
	expect(layout.holdsSettle("t3")).toBe(false);
});

test("a turn laid out before it was whole is laid out again once it is", () => {
	const layout = createReaderLayout();
	layout.setWhole("t1", false);
	layOut(layout, "t1");
	layout.setSettled(true);
	layout.setWhole("t1", false);
	expect(layout.isLaidOut("t1")).toBe(true);
	layout.setWhole("t1", true);
	expect(layout.isLaidOut("t1")).toBe(false);
	expect(layout.getSettled()).toBe(false);
	expect(layout.isDeferred("t1")).toBe(true);
	layOut(layout, "t2");
	layout.setWhole("t2", true);
	layout.setWhole("t2", true);
	expect(layout.isLaidOut("t2")).toBe(true);
});

test("a turn the tab kept the shape of isn't laid out again, until it changes", () => {
	const layout = createReaderLayout(undefined, ["t1"]);
	expect(layout.isKept("t1")).toBe(true);
	expect(layout.isKept("t2")).toBe(false);
	layout.invalidate("t1");
	expect(layout.isKept("t1")).toBe(false);
	expect(layout.isDeferred("t1")).toBe(true);
	now += 1_001;
	expect(layout.isDeferred("t1")).toBe(false);
});
