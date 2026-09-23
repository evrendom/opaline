import { describe, expect, test } from "bun:test";
import { getAuthenticatedRootPath } from "./authenticated-root-path";

describe("getAuthenticatedRootPath", () => {
	test("sends an account without a completed upload to welcome", () => {
		expect(
			getAuthenticatedRootPath({
				hasUploadedSessions: false,
				workspaceSlug: "new-workspace",
			}),
		).toBe("/welcome");
	});

	test("opens the workspace sessions after an upload completes", () => {
		expect(
			getAuthenticatedRootPath({
				hasUploadedSessions: true,
				workspaceSlug: "opaline",
			}),
		).toBe("/opaline/sessions");
	});

	test("sends an account without a workspace to welcome", () => {
		expect(
			getAuthenticatedRootPath({
				hasUploadedSessions: true,
				workspaceSlug: null,
			}),
		).toBe("/welcome");
	});
});
