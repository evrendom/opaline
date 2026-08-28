import { describe, expect, it } from "vitest";
import {
	appRoutes,
	getWorkspacePathAfterOrganizationSwitch,
	getWorkspaceRouteSuffix,
	getWorkspaceSlugFromPath,
} from "@/app/routes";

describe("workspace routes", () => {
	it("builds canonical workspace-scoped application paths", () => {
		expect(appRoutes.dashboard("farmerville")).toBe("/farmerville");
		expect(appRoutes.dashboardSessions("farmerville")).toBe(
			"/farmerville/sessions",
		);
		expect(appRoutes.dashboardSession("farmerville", "session/id")).toBe(
			"/farmerville/sessions/session%2Fid",
		);
		expect(appRoutes.team("farmerville")).toBe("/farmerville/team");
		expect(appRoutes.settingsAccount("farmerville")).toBe(
			"/farmerville/settings/account",
		);
	});

	it("keeps system and public paths unscoped", () => {
		expect(appRoutes.teamInvite("token/id")).toBe("/team/invite/token%2Fid");
		expect(appRoutes.wrappedTeamCard()).toBe("/wrapped");
		expect(appRoutes.wrappedResume("token/id")).toBe("/resume/token%2Fid");
	});

	it("rejects reserved and malformed workspace slugs", () => {
		expect(() => appRoutes.dashboard("wrapped")).toThrow(
			"Invalid organization slug",
		);
		expect(() => appRoutes.dashboard("Farmerville")).toThrow(
			"Invalid organization slug",
		);
	});

	it("parses canonical workspace paths without claiming system routes", () => {
		expect(getWorkspaceSlugFromPath("/farmerville/sessions/123")).toBe(
			"farmerville",
		);
		expect(getWorkspaceRouteSuffix("/farmerville")).toBe("/");
		expect(getWorkspaceRouteSuffix("/farmerville/sessions/123")).toBe(
			"/sessions/123",
		);
		expect(getWorkspaceSlugFromPath("/wrapped/share-id")).toBeNull();
		expect(getWorkspaceSlugFromPath("/device")).toBeNull();
	});

	it("rejects encoded slug spellings instead of slicing suffixes ambiguously", () => {
		expect(getWorkspaceSlugFromPath("/%66armerville/sessions")).toBeNull();
		expect(getWorkspaceRouteSuffix("/%66armerville/sessions")).toBeNull();
	});

	it("keeps the workspace-relative route when switching organizations", () => {
		expect(
			getWorkspacePathAfterOrganizationSwitch(
				"/farmerville/settings/members",
				"opaline",
			),
		).toBe("/opaline/settings/members");
		expect(
			getWorkspacePathAfterOrganizationSwitch("/invitation/123", "opaline"),
		).toBe("/opaline");
		expect(
			getWorkspacePathAfterOrganizationSwitch("/farmerville", "wrapped"),
		).toBeNull();
	});
});
