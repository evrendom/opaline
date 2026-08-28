import { describe, expect, it } from "vitest";
import {
	getCurrentShellRoute,
	getShellRouteMap,
	getShellRoutes,
} from "@/features/shell/config/shell-routes";

describe("getCurrentShellRoute", () => {
	const orgSlug = "farmerville";
	const shellRouteMap = getShellRouteMap(orgSlug);
	const shellRoutes = getShellRoutes(orgSlug);

	it("matches the dashboard route for the workspace root", () => {
		expect(getCurrentShellRoute("/farmerville", orgSlug)).toStrictEqual(
			shellRouteMap.dashboard,
		);
	});

	it("prefers the workspace sessions route", () => {
		expect(
			getCurrentShellRoute("/farmerville/sessions", orgSlug),
		).toStrictEqual(shellRouteMap.sessions);
	});

	it("prefers the sessions route for nested session detail paths", () => {
		expect(
			getCurrentShellRoute("/farmerville/sessions/session-123", orgSlug),
		).toStrictEqual(shellRouteMap.sessions);
	});

	it("uses history as the sessions shortcut", () => {
		expect(shellRouteMap.sessions.shortcut).toBe("H");
	});

	it("keeps primary shell shortcuts unique", () => {
		const shortcuts = shellRoutes.map((route) => route.shortcut);

		expect(new Set(shortcuts).size).toBe(shortcuts.length);
	});
});
