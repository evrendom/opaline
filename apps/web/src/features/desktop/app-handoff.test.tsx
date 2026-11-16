import { act, fireEvent, screen } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handOffToDesktopApp } from "./AppHandoff";
import {
	desktopAppLink,
	type HandoffPage,
	isDesktopAppWindow,
	mayHandOff,
	serverHasDesktopApp,
	staysInBrowser,
} from "./app-handoff";

const BROWSER = "Mozilla/5.0 (Macintosh) Chrome/141 Safari/537.36";
const DESKTOP = `${BROWSER} OpalineDesktop/0.1.0`;

function page(overrides: Partial<HandoffPage> = {}): HandoffPage {
	return {
		userAgent: BROWSER,
		hasDesktopBridge: false,
		hostname: "localhost",
		pathname: "/acme/reports/a1",
		search: "",
		hash: "",
		continued: false,
		...overrides,
	};
}

describe("mayHandOff", () => {
	it("hands a local page in a normal browser to the app", () => {
		expect(mayHandOff(page())).toBe(true);
		expect(mayHandOff(page({ hostname: "127.0.0.1" }))).toBe(true);
	});

	it("never redirects the app's own window", () => {
		expect(mayHandOff(page({ userAgent: DESKTOP }))).toBe(false);
		expect(mayHandOff(page({ hasDesktopBridge: true }))).toBe(false);
		expect(
			isDesktopAppWindow({ userAgent: DESKTOP, hasDesktopBridge: false }),
		).toBe(true);
	});

	it("stays in the browser once chosen, and off this Mac", () => {
		expect(mayHandOff(page({ continued: true }))).toBe(false);
		expect(mayHandOff(page({ hostname: "opaline.example.com" }))).toBe(false);
		expect(mayHandOff(page({ hostname: "192.168.1.20" }))).toBe(false);
	});

	it("leaves sign-in, device and invitation flows in the browser", () => {
		for (const [pathname, search] of [
			["/login", "?redirect=%2Fapi%2Fauth%2Fmcp%2Fauthorize"],
			["/login", ""],
			["/welcome", "?user_code=ABCD"],
			["/device", ""],
			["/reset-password", "?token=x"],
			["/get-started", ""],
			["/invitation/inv1", ""],
			["/team/invite/t1", ""],
			["/acme/join/t1", ""],
			["/", "?redirect=%2Facme"],
		] as const) {
			expect(staysInBrowser(pathname, search)).toBe(true);
			expect(mayHandOff(page({ pathname, search }))).toBe(false);
		}
		expect(staysInBrowser("/acme/dashboard", "?from=2026-11-01")).toBe(false);
		expect(staysInBrowser("/", "")).toBe(false);
	});
});

describe("desktopAppLink", () => {
	it("keeps the path, query and hash", () => {
		expect(
			desktopAppLink({
				pathname: "/acme/dashboard",
				search: "?from=2026-11-01&repo=a",
				hash: "#top",
			}),
		).toBe("opaline://acme/dashboard?from=2026-11-01&repo=a#top");
		expect(desktopAppLink({ pathname: "/", search: "", hash: "" })).toBe(
			"opaline://",
		);
	});
});

describe("serverHasDesktopApp", () => {
	it("reads the server's desktopApp flag", async () => {
		const answer =
			(body: unknown, status = 200) =>
			async () =>
				new Response(JSON.stringify(body), { status });
		expect(
			await serverHasDesktopApp(
				answer({ selfHosted: true, desktopApp: true }),
				"http://localhost:4100",
			),
		).toBe(true);
		expect(
			await serverHasDesktopApp(
				answer({ selfHosted: true }),
				"http://localhost:4100",
			),
		).toBe(false);
		expect(
			await serverHasDesktopApp(
				answer({ desktopApp: true }, 404),
				"http://localhost:4100",
			),
		).toBe(false);
		expect(
			await serverHasDesktopApp(async () => {
				throw new Error("offline");
			}, "http://localhost:4100"),
		).toBe(false);
	});
});

describe("handOffToDesktopApp", () => {
	let root: Root | undefined;
	afterEach(() => {
		act(() => root?.unmount());
		root = undefined;
		document.body.innerHTML = "";
		window.sessionStorage.clear();
	});

	function mount() {
		const container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		return root;
	}

	it("renders the app directly when the server has no desktop app", async () => {
		const proceed = vi.fn();
		const open = vi.fn();
		const handed = await handOffToDesktopApp(
			mount(),
			proceed,
			async () => false,
			open,
		);
		expect(handed).toBe(false);
		expect(proceed).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();
	});

	it("opens the page in the app and offers the browser", async () => {
		window.history.replaceState(null, "", "/acme/reports/a1?x=1");
		const proceed = vi.fn();
		const open = vi.fn();
		await act(() =>
			handOffToDesktopApp(mount(), proceed, async () => true, open),
		);
		expect(open).toHaveBeenCalledWith("opaline://acme/reports/a1?x=1");
		expect(
			screen
				.getByRole("link", { name: "Open in the Opaline app" })
				.getAttribute("href"),
		).toBe("opaline://acme/reports/a1?x=1");
		expect(proceed).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Continue in browser" }),
		);
		expect(proceed).toHaveBeenCalledOnce();
		expect(window.sessionStorage.getItem("opaline:continue-in-browser")).toBe(
			"1",
		);
	});
});
