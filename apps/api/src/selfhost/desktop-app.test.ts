import { describe, expect, test } from "bun:test";
import {
	createDesktopOpener,
	type DesktopOpenerOptions,
	desktopAppLink,
	hasDesktopApp,
} from "./desktop-app.js";

const ORIGIN = "http://localhost:4100";
const DESKTOP = { OPALINE_SELF_HOSTED: "1", OPALINE_DESKTOP_APP: "1" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function opener(overrides: DesktopOpenerOptions = {}) {
	const opened: string[] = [];
	let clock = 0;
	const desktop = createDesktopOpener({
		env: DESKTOP,
		platform: "darwin",
		origin: () => ORIGIN,
		open: (link) => opened.push(link),
		now: () => clock,
		settleMs: 5,
		repeatMs: 30_000,
		...overrides,
	});
	return {
		desktop,
		opened,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

describe("hasDesktopApp", () => {
	test("only a self-hosted server the desktop app started", () => {
		expect(hasDesktopApp(DESKTOP)).toBe(true);
		expect(hasDesktopApp({ OPALINE_SELF_HOSTED: "1" })).toBe(false);
		expect(hasDesktopApp({ OPALINE_DESKTOP_APP: "1" })).toBe(false);
		expect(hasDesktopApp({})).toBe(false);
	});
});

describe("desktopAppLink", () => {
	test("keeps the path, query and hash of a page on this server", () => {
		expect(desktopAppLink(`${ORIGIN}/acme/reports/a1`, ORIGIN)).toBe(
			"opaline://acme/reports/a1",
		);
		expect(
			desktopAppLink(
				`${ORIGIN}/acme/dashboard?from=2026-11-01&repo=a&repo=b`,
				ORIGIN,
			),
		).toBe("opaline://acme/dashboard?from=2026-11-01&repo=a&repo=b");
		expect(desktopAppLink(`${ORIGIN}/`, ORIGIN)).toBe("opaline://");
	});

	test("refuses pages on another origin", () => {
		expect(
			desktopAppLink("https://opaline.so/acme/reports/a1", ORIGIN),
		).toBeNull();
		expect(desktopAppLink("http://localhost:4101/acme", ORIGIN)).toBeNull();
		expect(desktopAppLink("not a url", ORIGIN)).toBeNull();
	});
});

describe("createDesktopOpener", () => {
	test("opens the latest page once calls settle", async () => {
		const { desktop, opened } = opener();
		expect(desktop.show(`${ORIGIN}/acme/dashboard?metric=cost`)).toBe(true);
		expect(desktop.show(`${ORIGIN}/acme/dashboard?metric=runs`)).toBe(true);
		expect(opened).toEqual([]);
		await settle();
		expect(opened).toEqual(["opaline://acme/dashboard?metric=runs"]);
	});

	test("does not reopen the same page within the repeat window", async () => {
		const { desktop, opened, advance } = opener();
		desktop.show(`${ORIGIN}/acme/reports/a1`);
		await settle();
		advance(10_000);
		desktop.show(`${ORIGIN}/acme/reports/a1`);
		await settle();
		expect(opened).toEqual(["opaline://acme/reports/a1"]);
		desktop.show(`${ORIGIN}/acme/reports/a2`);
		await settle();
		advance(31_000);
		desktop.show(`${ORIGIN}/acme/reports/a2`);
		await settle();
		expect(opened).toEqual([
			"opaline://acme/reports/a1",
			"opaline://acme/reports/a2",
			"opaline://acme/reports/a2",
		]);
	});

	test("does nothing in the cloud, without the app, off macOS or off-origin", async () => {
		for (const overrides of [
			{ env: {} },
			{ env: { OPALINE_SELF_HOSTED: "1" } },
			{ platform: "linux" as const },
		]) {
			const { desktop, opened } = opener(overrides);
			expect(desktop.show(`${ORIGIN}/acme/reports/a1`)).toBe(false);
			await settle();
			expect(opened).toEqual([]);
		}
		const { desktop, opened } = opener();
		expect(desktop.show("https://opaline.so/acme/reports/a1")).toBe(false);
		await settle();
		expect(opened).toEqual([]);
	});
});
