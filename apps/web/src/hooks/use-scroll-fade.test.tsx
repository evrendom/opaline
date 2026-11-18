import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScrollFade } from "./use-scroll-fade";

function Scroller() {
	const { fade, ref } = useScrollFade<HTMLDivElement>("x");
	return <div ref={ref} {...fade} data-testid="scroller" />;
}

const size = (element: HTMLElement, sizes: Record<string, number>) => {
	for (const [key, value] of Object.entries(sizes))
		Object.defineProperty(element, key, { configurable: true, value });
};

const frame = () =>
	act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

describe("useScrollFade on the x axis", () => {
	it("fades the right edge while more lies to the right", async () => {
		render(<Scroller />);
		const scroller = screen.getByTestId("scroller");
		size(scroller, { clientWidth: 200, scrollLeft: 0, scrollWidth: 600 });
		scroller.dispatchEvent(new Event("scroll"));
		await frame();
		expect(scroller).toHaveAttribute("data-fade-right");
		expect(scroller).not.toHaveAttribute("data-fade-bottom");

		size(scroller, { scrollLeft: 400 });
		scroller.dispatchEvent(new Event("scroll"));
		await frame();
		expect(scroller).not.toHaveAttribute("data-fade-right");
	});
});
