import { describe, expect, test } from "bun:test";
import { getActiveSettingsRouteId } from "@/features/settings/config/settings-routes";
import { getCurrentShellRoute } from "@/features/shell/config/shell-routes";
import {
	getCanonicalAppPath,
	getWorkspaceAppPath,
	getWorkspacePathAfterSwitch,
	getWorkspaceRelativePath,
	getWorkspaceSlugFromPath,
} from "./routes";

describe("Workspace product URLs", () => {
	test("normalizes every product entry point and preserves deep-link state", () => {
		for (const [input, expected] of [
			["/", "/acme/sessions"],
			[
				"/session/123/v2?from=2026-09-01#message-7",
				"/acme/sessions/123/v2?from=2026-09-01#message-7",
			],
			["/sessions?repo=cli", "/acme/sessions?repo=cli"],
			["/dashboard/sessions/123", "/acme/sessions/123"],
			["/session/full/123", "/acme/sessions/123"],
			["/session/split", "/acme/sessions"],
			["/home", "/acme/dashboard"],
			["/dashboard", "/acme/dashboard"],
			["/skills", "/acme/skills"],
			["/newsesh/123", "/acme/newsesh/123"],
			["/team", "/acme/team"],
			["/settings?tab=members", "/acme/settings?tab=members"],
			[
				"/settings/workspace#new-workspace",
				"/acme/settings/workspace#new-workspace",
			],
			["/settings/members", "/acme/settings/members"],
			["/settings/account", "/acme/settings/account"],
			["/settings/invitations", "/acme/settings/invitations"],
			["/settings/create-workspace", "/acme/settings/create-workspace"],
		])
			expect(getWorkspaceAppPath("acme", input ?? "")).toBe(expected);
	});

	test("keeps public flows, previews and already scoped destinations intact", () => {
		for (const path of [
			"/welcome?connect=123",
			"/wrapped/abc",
			"/team/invite/abc",
			"/acme/join/abc",
			"/invitation/abc",
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
				"/acme/settings/account#workspace-invitations",
			),
		).toBe("/beta/settings/account#workspace-invitations");
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
		expect(getCanonicalAppPath("/acme/dashboard")).toBe("/home");
		expect(getCurrentShellRoute("/acme/sessions/123")?.id).toBe("sessions");
		expect(getCurrentShellRoute("/acme/team")?.id).toBe("team");
		expect(getActiveSettingsRouteId("/acme/settings/account")).toBe("account");
		expect(getActiveSettingsRouteId("/acme/settings/members")).toBe("members");
	});
});
