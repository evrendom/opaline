import { describe, expect, test } from "bun:test";
import {
	getCurrentShellRoute,
	shellRouteMap,
} from "@/features/shell/config/shell-routes";
import {
	getCanonicalAppPath,
	getFloatingRowPreviewPath,
	isFloatingRowPreviewPath,
} from "./routes";

describe("Floating row route namespace", () => {
	test("uses the requested root path for the dashboard", () => {
		expect(getFloatingRowPreviewPath("/home")).toBe("/floating-row");
	});

	test("keeps nested shell destinations inside the preview", () => {
		expect(getFloatingRowPreviewPath("/session/session-123")).toBe(
			"/floating-row/session/session-123",
		);
		expect(getCanonicalAppPath("/floating-row/settings/account")).toBe(
			"/settings/account",
		);
	});

	test("only matches the floating-row namespace", () => {
		expect(isFloatingRowPreviewPath("/floating-row")).toBe(true);
		expect(isFloatingRowPreviewPath("/floating-row/skills")).toBe(true);
		expect(isFloatingRowPreviewPath("/floating-rower")).toBe(false);
	});

	test("resolves active icons from canonical shell destinations", () => {
		expect(getCurrentShellRoute("/floating-row")).toBe(shellRouteMap.dashboard);
		expect(getCurrentShellRoute("/floating-row/session/session-123")).toBe(
			shellRouteMap.sessions,
		);
		expect(getCurrentShellRoute("/floating-row/skills")).toBe(
			shellRouteMap.skills,
		);
	});
});
