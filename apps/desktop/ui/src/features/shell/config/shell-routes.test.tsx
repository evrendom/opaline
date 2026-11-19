import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getCurrentShellRoute,
	reportsShellRoute,
	shellRouteMap,
	shellRoutes,
} from "@/features/shell/config/shell-routes";

describe("getCurrentShellRoute", () => {
	it("matches the home route for /home", () => {
		expect(getCurrentShellRoute("/home")).toBe(shellRouteMap.dashboard);
	});

	it("prefers the sessions route for /session", () => {
		expect(getCurrentShellRoute("/session")).toBe(shellRouteMap.sessions);
	});

	it("prefers the sessions route for nested session detail paths", () => {
		expect(getCurrentShellRoute("/session/session-123")).toBe(
			shellRouteMap.sessions,
		);
	});

	it("keeps the newsesh experiment in the sessions shell", () => {
		expect(getCurrentShellRoute("/newsesh")).toBe(shellRouteMap.sessions);
		expect(getCurrentShellRoute("/newsesh/session-123")).toBe(
			shellRouteMap.sessions,
		);
	});

	it("titles a saved analysis report as a report, not the dashboard", () => {
		expect(getCurrentShellRoute("/acme/reports/a_123")).toBe(reportsShellRoute);
		expect(reportsShellRoute.title).toBe("Report");
		expect(shellRoutes).not.toContain(reportsShellRoute);
	});

	it("matches the MCP route without a workspace prefix, as the demo serves it", () => {
		expect(getCurrentShellRoute("/mcp")).toBe(shellRouteMap.mcp);
		expect(getCurrentShellRoute("/acme/mcp")).toBe(shellRouteMap.mcp);
	});

	it("uses history as the sessions shortcut", () => {
		expect(shellRouteMap.sessions.shortcut).toBe("H");
	});

	it("matches the skills route and uses its unique shortcut", () => {
		expect(getCurrentShellRoute("/skills")).toBe(shellRouteMap.skills);
		expect(shellRouteMap.skills.shortcut).toBe("K");
		expect(shellRoutes.findIndex((route) => route.id === "skills")).toBe(
			shellRoutes.findIndex((route) => route.id === "sessions") + 1,
		);
	});

	it("keeps primary shell shortcuts unique", () => {
		const shortcuts = shellRoutes.map((route) => route.shortcut);

		expect(new Set(shortcuts).size).toBe(shortcuts.length);
	});
});

describe("Home navigation availability", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it.each([
		false,
		true,
	])("hides Home with production mode %s", async (production) => {
		vi.stubEnv("PROD", production);
		vi.resetModules();
		const { shellNavigationRoutes } = await import("./shell-routes");
		expect(shellNavigationRoutes.some((route) => route.path === "/home")).toBe(
			false,
		);
		expect(shellNavigationRoutes.some((route) => route.id === "sessions")).toBe(
			true,
		);
	});
});
