import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { DateRangeProvider, useDateRange } from "./DateRangeProvider";

const {
	JSDOM,
}: {
	JSDOM: new (
		html: string,
		options: { url: string },
	) => {
		window: Window & typeof globalThis;
	};
} = createRequire(import.meta.url)("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "https://opaline.so/product-demo/demo.html",
});
const globals = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
	for (const [key, value] of Object.entries({
		window: dom.window,
		document: dom.window.document,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
});
afterAll(() => {
	for (const [key, descriptor] of globals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
	dom.window.close();
});

function NavigationProbe() {
	const { state, actions } = useDateRange();
	const navigate = useNavigate();
	return (
		<>
			<output>
				{state.startDate}/{state.endDate}
			</output>
			<button type="button" onClick={() => navigate("/session/example")}>
				Open session
			</button>
			<button
				type="button"
				onClick={() => actions.setDateRange("2026-08-10", "2026-08-20")}
			>
				Change range
			</button>
			<button type="button" onClick={() => navigate("/session")}>
				Close session
			</button>
		</>
	);
}

test("demo dates survive session navigation without replacing the signed-in app range", async () => {
	const appRange = JSON.stringify({ start: "2026-09-10", end: "2026-09-17" });
	dom.window.localStorage.clear();
	dom.window.localStorage.setItem("dateRange", appRange);
	const container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<MemoryRouter initialEntries={["/session?from=2026-08-01&to=2026-08-31"]}>
				<DateRangeProvider storageKey="demoDateRange">
					<NavigationProbe />
				</DateRangeProvider>
			</MemoryRouter>,
		),
	);
	const buttons = container.querySelectorAll("button");
	assert(buttons[0] && buttons[1] && buttons[2]);
	await act(async () => buttons[0]?.click());
	expect(container.querySelector("output")?.textContent).toBe(
		"2026-08-01/2026-08-31",
	);
	await act(async () => buttons[1]?.click());
	await act(async () => buttons[2]?.click());
	expect(container.querySelector("output")?.textContent).toBe(
		"2026-08-10/2026-08-20",
	);
	expect(dom.window.localStorage.getItem("dateRange")).toBe(appRange);
	expect(
		JSON.parse(dom.window.localStorage.getItem("demoDateRange") ?? "null"),
	).toEqual({ start: "2026-08-10", end: "2026-08-20" });
	await act(async () => root.unmount());
	container.remove();
});

test("the normal app retains its stored date range", async () => {
	dom.window.localStorage.clear();
	dom.window.localStorage.setItem(
		"dateRange",
		JSON.stringify({ start: "2026-09-01", end: "2026-09-17" }),
	);
	const container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<MemoryRouter initialEntries={["/session"]}>
				<DateRangeProvider>
					<NavigationProbe />
				</DateRangeProvider>
			</MemoryRouter>,
		),
	);
	expect(container.querySelector("output")?.textContent).toBe(
		"2026-09-01/2026-09-17",
	);
	await act(async () => root.unmount());
	container.remove();
});
