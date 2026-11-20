import { describe, expect, test } from "bun:test";
import { getActiveSettingsRouteId } from "@/features/settings/config/settings-routes";
import { getCurrentShellRoute } from "@/features/shell/config/shell-routes";
import {
	appRoutes,
	getCanonicalAppPath,
	getWorkspaceAppPath,
	getWorkspacePathAfterSwitch,
	getWorkspaceRelativePath,
	getWorkspaceSlugFromPath,
} from "./routes";

describe("Workspace product URLs", () => {
	test("normalizes every product entry point and preserves deep-link state", () => {
		for (const [input, expected] of [
			["/", "/acme/dashboard"],
			[
				"/session/123/v2?from=2026-09-01#message-7",
				"/acme/sessions/123/v2?from=2026-09-01#message-7",
			],
			["/sessions?repo=cli", "/acme/sessions?repo=cli"],
			["/dashboard/sessions/123", "/acme/sessions/123"],
			["/session/full/123", "/acme/sessions/123"],
			["/session/split", "/acme/sessions"],
			["/home", "/acme/home"],
			["/dashboard", "/acme/dashboard"],
			["/skills", "/acme/skills"],
			["/repos", "/acme/repos"],
			["/newsesh/123", "/acme/newsesh/123"],
			["/team", "/acme/team"],
			["/settings?tab=members", "/acme/settings?tab=members"],
			[
				"/settings/workspace#new-workspace",
				"/acme/settings/workspace#new-workspace",
			],
			["/settings/reports", "/acme/settings/reports"],
			["/settings/members", "/acme/settings/members"],
			["/settings/account", "/acme/settings/account"],
			["/settings/create-workspace", "/acme/settings/create-workspace"],
		])
			expect(getWorkspaceAppPath("acme", input ?? "")).toBe(expected);
	});

	test("keeps public flows, previews and already scoped destinations intact", () => {
		for (const path of [
			"/welcome?connect=123",
			"/device",
			"/login",
			"/dev/left-sidebar/session",
			"/centered-sidebar/settings/account",
			"/beta/team",
			"//example.com/team",
		]) {
			expect(getWorkspaceRelativePath(path)).toBeNull();
			expect(getWorkspaceAppPath("acme", path)).toBe(path);
		}
	});

	test("does not mistake reserved routes or escaped path separators for workspaces", () => {
		for (const path of [
			"/home",
			"/skills",
			"/repos",
			"/newsesh",
			"/settings/account",
			"/dev/left-sidebar",
			"/centered-sidebar/session",
			"/welcome",
			"/bad%2fslug/sessions",
			"/bad%20slug/team",
		]) {
			expect(getWorkspaceSlugFromPath(path)).toBeNull();
		}
		expect(getWorkspaceSlugFromPath("/acme/team")).toBe("acme");
		expect(getWorkspaceSlugFromPath("/acme")).toBe("acme");
	});

	test("keeps the current page on workspace switch and clears the previous session ID", () => {
		expect(
			getWorkspacePathAfterSwitch("beta", "/acme/team?view=all#members"),
		).toBe("/beta/team?view=all#members");
		expect(
			getWorkspacePathAfterSwitch(
				"beta",
				"/acme/settings/account#delete-account",
			),
		).toBe("/beta/settings/account#delete-account");
		expect(
			getWorkspacePathAfterSwitch(
				"beta",
				"/acme/sessions/123/v2?from=2026-09-01",
			),
		).toBe("/beta/sessions?from=2026-09-01");
	});

	test("retains shell and settings active states inside the workspace", () => {
		expect(getCanonicalAppPath("/acme/sessions/123/v2")).toBe(
			"/session/123/v2",
		);
		expect(getCanonicalAppPath("/acme/dashboard")).toBe("/dashboard");
		expect(getCanonicalAppPath("/acme")).toBe("/dashboard");
		expect(getCanonicalAppPath("/acme/home")).toBe("/home");
		expect(getCurrentShellRoute("/acme/home").id).toBe("dashboard");
		expect(getCurrentShellRoute("/acme/dashboard").id).toBe("dashboard");
		expect(getCurrentShellRoute("/acme/sessions/123")?.id).toBe("sessions");
		expect(getCurrentShellRoute("/acme/mcp")?.id).toBe("mcp");
		expect(getActiveSettingsRouteId("/acme/settings/account")).toBe("account");
		expect(getActiveSettingsRouteId("/acme/settings/members")).toBe("members");
		expect(getActiveSettingsRouteId("/acme/settings/reports")).toBe("reports");
		expect(appRoutes.workspaceReport("acme", "a/1")).toBe(
			"/acme/reports/a%2F1",
		);
		expect(getActiveSettingsRouteId("/acme/settings/team")).toBe("members");
	});
});

test("skill links preserve the session and turn and safely encode skill names", () => {
	const path = appRoutes.skillDetail(
		"team:review / C++",
		"session-123",
		"turn-7",
	);
	const url = new URL(getWorkspaceAppPath("acme", path), "http://localhost");
	expect(url.pathname).toBe("/acme/skills");
	expect(url.searchParams.get("skill")).toBe("team:review / C++");
	expect(url.searchParams.get("session")).toBe("session-123");
	expect(url.searchParams.get("turn")).toBe("turn-7");
	expect(appRoutes.skillDetail("review")).toBe("/skills?skill=review");
	expect(
		getWorkspacePathAfterSwitch("other", `${url.pathname}${url.search}`),
	).toBe("/other/skills?skill=team%3Areview+%2F+C%2B%2B");
});

test("repository deep links stay scoped and drop the old workspace session", () => {
	const path = appRoutes.repoDetail("remote:github.com/acme/app", "session-1");
	expect(getWorkspaceAppPath("acme", path)).toBe(`/acme${path}`);
	expect(getCurrentShellRoute("/acme/repos").id).toBe("repos");
	expect(getWorkspacePathAfterSwitch("beta", `/acme${path}&turn=turn-1`)).toBe(
		"/beta/repos?repo=remote%3Agithub.com%2Facme%2Fapp",
	);
});
