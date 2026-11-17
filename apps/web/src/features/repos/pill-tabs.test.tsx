import { IconFile } from "@tabler/icons-react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PillTabs } from "./pill-tabs";

const TABS = [
	{ icon: IconFile, id: "a", label: "A" },
	{ icon: IconFile, id: "b", label: "B" },
	{ icon: IconFile, id: "c", label: "C" },
] as const;
const BOXES: Record<string, { left: number; width: number }> = {
	a: { left: 0, width: 100 },
	b: { left: 100, width: 50 },
	c: { left: 150, width: 80 },
};

const boxOf = (element: HTMLElement) =>
	BOXES[element.dataset.pillTab ?? ""] ?? { left: 0, width: 0 };

let progress: number | null = null;
const animate = vi.fn(
	(_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({
		cancel() {},
		effect: { getComputedTiming: () => ({ progress }) },
	}),
);

beforeEach(() => {
	progress = null;
	animate.mockClear();
	vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
		function (this: HTMLElement) {
			return boxOf(this).left;
		},
	);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
		function (this: HTMLElement) {
			return boxOf(this).width;
		},
	);
	Object.defineProperty(HTMLElement.prototype, "animate", {
		configurable: true,
		value: animate,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

const tabs = (value: "a" | "b" | "c") => (
	<PillTabs label="Tabs" onChange={() => {}} tabs={TABS} value={value} />
);

const pillOf = (container: HTMLElement) =>
	container.querySelector<HTMLElement>("span[aria-hidden='true']");

describe("PillTabs", () => {
	it("places its pill without sliding", () => {
		const view = render(tabs("a"));
		expect(pillOf(view.container)?.style.width).toBe("100px");
		expect(animate).not.toHaveBeenCalled();
	});

	it("jumps to the new tab's box and slides there with transform only", () => {
		const view = render(tabs("a"));
		view.rerender(tabs("b"));
		expect(pillOf(view.container)?.style.width).toBe("50px");
		expect(animate).toHaveBeenCalledTimes(1);
		expect(animate.mock.calls[0]?.[0]).toEqual([
			{ transform: "translate(0px, -50%) scaleX(2)" },
			{ transform: "translate(100px, -50%) scaleX(1)" },
		]);
	});

	it("starts a mid-slide change from where the pill is on screen", () => {
		const view = render(tabs("a"));
		view.rerender(tabs("b"));
		progress = 0.5;
		view.rerender(tabs("c"));
		expect(animate.mock.calls[1]?.[0]).toEqual([
			{ transform: "translate(50px, -50%) scaleX(0.9375)" },
			{ transform: "translate(150px, -50%) scaleX(1)" },
		]);
	});

	it("does not slide under reduced motion", () => {
		const matchMedia = vi.spyOn(window, "matchMedia");
		matchMedia.mockImplementation(
			(query) => ({ matches: true, media: query }) as MediaQueryList,
		);
		const view = render(tabs("a"));
		view.rerender(tabs("b"));
		expect(pillOf(view.container)?.style.width).toBe("50px");
		expect(animate).not.toHaveBeenCalled();
	});
});
