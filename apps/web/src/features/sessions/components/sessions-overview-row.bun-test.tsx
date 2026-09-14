import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { SessionAnalytics } from "@rudel/api-routes";
import type { ComponentProps } from "react";
import seed from "@/features/demo/seed.json";

const {
	JSDOM,
}: {
	JSDOM: new (
		markup: string,
		options: { pretendToBeVisual: boolean; url: string },
	) => { window: Window & typeof globalThis };
} = createRequire(import.meta.url)("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost:4011",
});
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let SessionsOverviewFluidList: typeof import("./sessions-overview-fluid-list").SessionsOverviewFluidList;
let SessionsOverviewRow: typeof import("./sessions-overview-row").SessionsOverviewRow;
let TooltipProvider: typeof import("@/app/ui/tooltip").TooltipProvider;

beforeAll(async () => {
	const globals = {
		window: dom.window,
		document: dom.window.document,
		navigator: dom.window.navigator,
		HTMLElement: dom.window.HTMLElement,
		Element: dom.window.Element,
		Node: dom.window.Node,
		MutationObserver: dom.window.MutationObserver,
		getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
		requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
		cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(globals)) {
		originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			value,
			configurable: true,
			writable: true,
		});
	}
	// These modules inspect browser globals during initialization.
	({ act } = await import("react"));
	({ createRoot } = await import("react-dom/client"));
	({ SessionsOverviewFluidList } = await import(
		"./sessions-overview-fluid-list"
	));
	({ SessionsOverviewRow } = await import("./sessions-overview-row"));
	({ TooltipProvider } = await import("@/app/ui/tooltip"));
});

afterAll(() => {
	dom.window.close();
	for (const [key, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
});

test("hover leaves unchanged rows alone while session data and permissions stay reactive", async () => {
	const { DemoSeedSchema } = await import("@/features/demo/demo-runtime");
	const base = DemoSeedSchema.parse(seed).sessions[0];
	assert.ok(base);
	const sessions = Array.from({ length: 100 }, (_, index) => ({
		...base,
		session_id: `hover-regression-${index}`,
	}));
	let rowEvaluations = 0;
	let selectedSessionId: string | undefined;
	const canOpenSession = () => {
		rowEvaluations++;
		return true;
	};
	const onSessionClick = (session: SessionAnalytics) => {
		selectedSessionId = session.session_id;
	};
	let activate: ((index: number) => void) | undefined;
	const mount = document.createElement("div");
	document.body.append(mount);
	const root = createRoot(mount);
	function view(
		rows: typeof sessions,
		permission: ComponentProps<typeof SessionsOverviewRow>["canOpenSession"],
	) {
		return (
			<TooltipProvider>
				<SessionsOverviewFluidList>
					{({ registerItem, setActiveIndex }) => {
						activate = setActiveIndex;
						return rows.map((session, index) => (
							<SessionsOverviewRow
								key={session.session_id}
								index={index}
								registerItem={registerItem}
								setHoverActiveIndex={setActiveIndex}
								activeSessionId={undefined}
								avatarUrl={undefined}
								canOpenSession={permission}
								getSessionHref={undefined}
								getSessionLinkState={undefined}
								maximumSessionCost={50}
								memberProfile={undefined}
								onSessionClick={onSessionClick}
								session={session}
								userLabel="Test member"
							/>
						));
					}}
				</SessionsOverviewFluidList>
			</TooltipProvider>
		);
	}
	try {
		await act(async () => {
			root.render(view(sessions, canOpenSession));
		});
		assert.ok(activate);
		const setActiveIndex = activate;
		rowEvaluations = 0;
		await act(async () => {
			setActiveIndex(0);
		});
		await act(async () => {
			setActiveIndex(1);
		});
		expect(rowEvaluations).toBe(0);
		expect(
			mount
				.querySelector("[data-fluid-hover-active-index]")
				?.getAttribute("data-fluid-hover-active-index"),
		).toBe("1");

		const updated = sessions.map((session, index) =>
			index === 1 ? { ...session, estimated_cost: 12 } : session,
		);
		await act(async () => {
			root.render(view(updated, canOpenSession));
		});
		expect(rowEvaluations).toBe(1);
		expect(
			mount.querySelectorAll("[data-session-overview-metric-value='cost']")[1]
				?.textContent,
		).toContain("$12");
		const row = mount.querySelectorAll<HTMLButtonElement>(
			"button[data-dashboard-grid-row-scope='session']",
		)[1];
		assert.ok(row);
		await act(async () => {
			row.click();
		});
		expect(selectedSessionId).toBe(sessions[1]?.session_id);

		await act(async () => {
			root.render(view(updated, () => false));
		});
		expect(
			mount.querySelectorAll("button[data-dashboard-grid-row-scope='session']"),
		).toHaveLength(0);
		expect(
			mount.querySelectorAll("[data-session-disabled='true']"),
		).toHaveLength(100);
	} finally {
		await act(async () => {
			root.unmount();
		});
		mount.remove();
	}
});
