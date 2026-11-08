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

	test("opens a self-hosted owner's workspace before any upload, since the server already logged in the CLI", () => {
		expect(
			getAuthenticatedRootPath({
				hasUploadedSessions: false,
				hasCliLogin: true,
				selfHosted: true,
				workspaceSlug: "acme",
			}),
		).toBe("/acme/sessions");
	});

	test("keeps sending a cloud account with only a CLI login to welcome", () => {
		expect(
			getAuthenticatedRootPath({
				hasUploadedSessions: false,
				hasCliLogin: true,
				workspaceSlug: "acme",
			}),
		).toBe("/welcome");
	});

	test("sends a self-hosted teammate without a CLI login to welcome", () => {
		expect(
			getAuthenticatedRootPath({
				hasUploadedSessions: false,
				hasCliLogin: false,
				selfHosted: true,
				workspaceSlug: "acme",
			}),
		).toBe("/welcome");
	});
});
