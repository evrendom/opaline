import { describe, expect, test } from "bun:test";
import {
	getCurrentShellRoute,
	shellRouteMap,
} from "@/features/shell/config/shell-routes";
import {
	getCanonicalAppPath,
	getOlivettiRailPreviewPath,
	isOlivettiRailPreviewPath,
} from "./routes";

describe("Olivetti rail route namespace", () => {
	test("uses the requested root path for the dashboard", () => {
		expect(getOlivettiRailPreviewPath("/home")).toBe("/olivetti-rail");
	});

	test("keeps nested shell destinations inside the preview", () => {
		expect(getOlivettiRailPreviewPath("/session/session-123")).toBe(
			"/olivetti-rail/session/session-123",
		);
		expect(getCanonicalAppPath("/olivetti-rail/settings/account")).toBe(
			"/settings/account",
		);
	});

	test("only matches the Olivetti namespace", () => {
		expect(isOlivettiRailPreviewPath("/olivetti-rail")).toBe(true);
		expect(isOlivettiRailPreviewPath("/olivetti-rail/skills")).toBe(true);
		expect(isOlivettiRailPreviewPath("/olivetti-railroad")).toBe(false);
	});

	test("resolves active icons from canonical shell destinations", () => {
		expect(getCurrentShellRoute("/olivetti-rail")).toBe(
			shellRouteMap.dashboard,
		);
		expect(getCurrentShellRoute("/olivetti-rail/session/session-123")).toBe(
			shellRouteMap.sessions,
		);
		expect(getCurrentShellRoute("/olivetti-rail/skills")).toBe(
			shellRouteMap.skills,
		);
	});
});
