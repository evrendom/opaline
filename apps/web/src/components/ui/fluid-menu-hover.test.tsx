import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluidMenuHover } from "./fluid-menu-hover";

// Three 32px rows: a 4px gap between the first two, a wide gap to the third.
const rows = [
	{ top: 0, bottom: 32 },
	{ top: 36, bottom: 68 },
	{ top: 400, bottom: 432 },
];

function renderMenu(bridgeGap?: number) {
	const view = render(
		<div data-fluid-menu-root="">
			<FluidMenuHover items="[data-row]" bridgeGap={bridgeGap} />
			{rows.map((row, index) => (
				<button key={row.top} type="button" data-row="">
					Row {index}
				</button>
			))}
		</div>,
	);
	const root = view.container.querySelector<HTMLElement>(
		"[data-fluid-menu-root]",
	);
	const buttons = Array.from(
		view.container.querySelectorAll<HTMLElement>("[data-row]"),
	);
	buttons.forEach((button, index) => {
		const { top, bottom } = rows[index];
		button.getBoundingClientRect = () =>
			DOMRect.fromRect({ x: 0, y: top, width: 200, height: bottom - top });
	});
	if (!root) throw new Error("menu root missing");
	return { root, buttons };
}

function pointer(
	type: "pointerMove" | "pointerOver",
	target: HTMLElement,
	clientY: number,
) {
	fireEvent[type](target, { pointerType: "mouse", clientX: 40, clientY });
}

function highlighted(buttons: HTMLElement[]) {
	return buttons.findIndex((button) =>
		button.hasAttribute("data-fluid-hover-active"),
	);
}

// jsdom has no PointerEvent; without one, fireEvent drops clientX/clientY.
class TestPointerEvent extends MouseEvent {
	readonly pointerType: string;

	constructor(type: string, init: PointerEventInit = {}) {
		super(type, init);
		this.pointerType = init.pointerType ?? "mouse";
	}
}

describe("FluidMenuHover", () => {
	beforeEach(() => {
		vi.stubGlobal("PointerEvent", TestPointerEvent);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			setTimeout(() => callback(performance.now()), 0),
		);
		vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the nearest row lit while the pointer crosses a bridged gap", async () => {
		const { root, buttons } = renderMenu(12);

		pointer("pointerMove", buttons[0], 16);
		await waitFor(() => expect(highlighted(buttons)).toBe(0));

		// The 4px gap between rows 0 and 1, over the container itself.
		pointer("pointerMove", root, 33);
		await waitFor(() => expect(highlighted(buttons)).toBe(0));
		pointer("pointerMove", root, 35);
		await waitFor(() => expect(highlighted(buttons)).toBe(1));
	});

	it("lets the highlight go in empty space wider than the bridge", async () => {
		const { root, buttons } = renderMenu(12);

		pointer("pointerMove", buttons[1], 50);
		await waitFor(() => expect(highlighted(buttons)).toBe(1));

		pointer("pointerMove", root, 200);
		await waitFor(() => expect(highlighted(buttons)).toBe(-1));
	});

	it("still clears in a gap when bridging is off", async () => {
		const { root, buttons } = renderMenu();

		pointer("pointerOver", buttons[0], 16);
		await waitFor(() => expect(highlighted(buttons)).toBe(0));

		pointer("pointerOver", root, 34);
		await waitFor(() => expect(highlighted(buttons)).toBe(-1));
	});
});
