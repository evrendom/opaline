import { describe, expect, test } from "vitest";
import { isLocalDesktopApp } from "./local-app";

const DESKTOP = "Mozilla/5.0 Chrome/140 OpalineDesktop/0.1.0";

describe("isLocalDesktopApp", () => {
	test("only the desktop app on this Mac's own server", () => {
		expect(isLocalDesktopApp(true, DESKTOP, "localhost")).toBe(true);
		expect(isLocalDesktopApp(true, DESKTOP, "127.0.0.1")).toBe(true);
		expect(isLocalDesktopApp(true, DESKTOP, "opaline.example.com")).toBe(false);
		expect(isLocalDesktopApp(false, DESKTOP, "localhost")).toBe(false);
		expect(isLocalDesktopApp(true, "Mozilla/5.0 Chrome/140", "localhost")).toBe(
			false,
		);
	});
});
