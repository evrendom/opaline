import { afterEach, describe, expect, it } from "vitest";
import { cancelSkulletAnimations } from "./skullet-animations";

interface FakeAnimation {
	readonly iterations: number;
	cancelled: boolean;
}

function animate(element: Element, iterations: number): FakeAnimation {
	const animation = { iterations, cancelled: false };
	const own =
		(element as Element & { animations?: FakeAnimation[] }).animations ?? [];
	own.push(animation);
	Object.assign(element, {
		animations: own,
		getAnimations: () =>
			element.isConnected
				? own
						.filter((item) => !item.cancelled)
						.map((item) => ({
							effect: { getTiming: () => ({ iterations: item.iterations }) },
							cancel: () => {
								item.cancelled = true;
							},
						}))
				: [],
	});
	element.setAttribute("style", `--frame: ${own.length}`);
	return animation;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("cancelSkulletAnimations", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("cancels the endless shimmer of a rect skullet removes from its layer", async () => {
		const host = document.createElement("div");
		const layer = document.createElement("div");
		layer.setAttribute("skullet-layer", "");
		host.append(layer);
		document.body.append(host);
		const root = layer.attachShadow({ mode: "open" });
		const stop = cancelSkulletAnimations(host);
		const rect = document.createElement("div");
		rect.setAttribute("skullet-rect", "");
		root.append(rect);
		const shimmer = animate(rect, Number.POSITIVE_INFINITY);
		const reveal = animate(rect, 1);
		await flush();
		rect.remove();
		await flush();
		expect(shimmer.cancelled).toBe(true);
		expect(reveal.cancelled).toBe(false);
		stop();
	});

	it("cancels every rect of a removed layer, and everything left when the skeleton unmounts", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const stop = cancelSkulletAnimations(host);
		const layer = document.createElement("div");
		layer.setAttribute("skullet-layer", "");
		host.append(layer);
		const root = layer.attachShadow({ mode: "open" });
		const rects = [0, 1].map(() => {
			const rect = document.createElement("div");
			rect.setAttribute("skullet-rect", "");
			root.append(rect);
			return rect;
		});
		await flush();
		const shimmers = rects.map((rect) =>
			animate(rect, Number.POSITIVE_INFINITY),
		);
		await flush();
		layer.remove();
		await flush();
		expect(shimmers.map((item) => item.cancelled)).toEqual([true, true]);

		const bar = document.createElement("span");
		bar.setAttribute("skullet-bar", "");
		host.append(bar);
		const pulse = animate(bar, Number.POSITIVE_INFINITY);
		await flush();
		stop();
		expect(pulse.cancelled).toBe(true);
	});

	it("leaves an element skullet moves within the page running", async () => {
		const host = document.createElement("div");
		const first = document.createElement("div");
		const second = document.createElement("div");
		host.append(first, second);
		document.body.append(host);
		const stop = cancelSkulletAnimations(host);
		const bar = document.createElement("span");
		bar.setAttribute("skullet-bar", "");
		first.append(bar);
		const shimmer = animate(bar, Number.POSITIVE_INFINITY);
		await flush();
		second.append(bar);
		await flush();
		expect(shimmer.cancelled).toBe(false);
		stop();
	});
});
