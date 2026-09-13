import { describe, expect, test } from "bun:test";
import {
	getCurrentShellRoute,
	shellRouteMap,
} from "@/features/shell/config/shell-routes";
import {
	getCanonicalAppPath,
	getCenteredSidebarPreviewPath,
	isCenteredSidebarPreviewPath,
} from "./routes";

describe("Centered sidebar route namespace", () => {
	test("uses the sidebar root path for the dashboard", () => {
		expect(getCenteredSidebarPreviewPath("/home")).toBe("/centered-sidebar");
	});

	test("keeps nested shell destinations inside the preview", () => {
		expect(getCenteredSidebarPreviewPath("/session/session-123")).toBe(
			"/centered-sidebar/session/session-123",
		);
		expect(getCanonicalAppPath("/centered-sidebar/settings/account")).toBe(
			"/settings/account",
		);
	});

	test("only matches the centered-sidebar namespace", () => {
		expect(isCenteredSidebarPreviewPath("/centered-sidebar")).toBe(true);
		expect(isCenteredSidebarPreviewPath("/centered-sidebar/skills")).toBe(true);
		expect(isCenteredSidebarPreviewPath("/centered-sidebarish")).toBe(false);
	});

	test("resolves active icons from canonical shell destinations", () => {
		expect(getCurrentShellRoute("/centered-sidebar")).toBe(
			shellRouteMap.dashboard,
		);
		expect(getCurrentShellRoute("/centered-sidebar/session/session-123")).toBe(
			shellRouteMap.sessions,
		);
		expect(getCurrentShellRoute("/centered-sidebar/skills")).toBe(
			shellRouteMap.skills,
		);
	});
});
