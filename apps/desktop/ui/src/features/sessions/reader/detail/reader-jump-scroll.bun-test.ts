import { afterEach, beforeEach, expect, test } from "bun:test";
import { jumpNearThenEase } from "./reader-jump-scroll";

let frames: FrameRequestCallback[] = [];
let now = 0;
let reducedMotion = false;
const saved = {
	cancelAnimationFrame: globalThis.cancelAnimationFrame,
	matchMedia: globalThis.matchMedia,
	now: performance.now,
	requestAnimationFrame: globalThis.requestAnimationFrame,
};

beforeEach(() => {
	frames = [];
	now = 0;
	reducedMotion = false;
	globalThis.requestAnimationFrame = (callback) => frames.push(callback);
	globalThis.cancelAnimationFrame = () => {};
	globalThis.matchMedia = ((query: string) => ({
		matches: reducedMotion && query.includes("reduce"),
	})) as typeof matchMedia;
	performance.now = () => now;
});

afterEach(() => {
	globalThis.requestAnimationFrame = saved.requestAnimationFrame;
	globalThis.cancelAnimationFrame = saved.cancelAnimationFrame;
	globalThis.matchMedia = saved.matchMedia;
	performance.now = saved.now;
});

function scroller(scrollTop: number) {
	const listeners = new Set<string>();
	return {
		addEventListener: (type: string) => listeners.add(type),
		clientHeight: 1_000,
		listeners,
		removeEventListener: (type: string) => listeners.delete(type),
		scrollHeight: 100_000,
		scrollTop,
	};
}

function runFrames(at: number) {
	now = at;
	const due = frames;
	frames = [];
	for (const frame of due) frame(now);
}

test("a far target is jumped to a view short of it, then eased the rest of the way", () => {
	const element = scroller(0);
	let done = 0;
	jumpNearThenEase(
		element as unknown as HTMLElement,
		() => 20_000,
		() => done++,
	);
	expect(element.scrollTop).toBe(19_000);
	runFrames(110);
	expect(element.scrollTop).toBeGreaterThan(19_000);
	expect(element.scrollTop).toBeLessThan(20_000);
	runFrames(220);
	expect(element.scrollTop).toBe(20_000);
	expect(done).toBe(1);
	expect(element.listeners.size).toBe(0);
});

test("a near target is eased to from where the page is", () => {
	const element = scroller(0);
	jumpNearThenEase(element as unknown as HTMLElement, () => 1_200);
	expect(element.scrollTop).toBe(0);
	runFrames(220);
	expect(element.scrollTop).toBe(1_200);
});

test("the reader taking over the scroll stops the ease where it is", () => {
	const element = scroller(0);
	jumpNearThenEase(element as unknown as HTMLElement, () => 1_200);
	expect([...element.listeners].sort()).toEqual([
		"keydown",
		"pointerdown",
		"touchstart",
		"wheel",
	]);
});

test("with reduced motion it lands at once", () => {
	reducedMotion = true;
	const element = scroller(0);
	jumpNearThenEase(element as unknown as HTMLElement, () => 20_000);
	expect(element.scrollTop).toBe(20_000);
});
