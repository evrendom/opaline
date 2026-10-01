import { expect, test } from "bun:test";
import { createGitHubSettingsRedirect } from "./github-repository-evidence-http.js";

test("returns GitHub setup results to the GitHub settings page without caching", () => {
	const response = createGitHubSettingsRedirect({
		frontendOrigin: "https://opaline.so",
		result: "connected",
		workspaceSlug: "acme",
	});

	expect(response.status).toBe(302);
	expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	expect(response.headers.get("Location")).toBe(
		"https://opaline.so/acme/settings/github?github=connected",
	);
});

test("returns onboarding setup results to the welcome flow", () => {
	const response = createGitHubSettingsRedirect({
		frontendOrigin: "https://opaline.so",
		result: "already-connected",
		returnTo: "onboarding",
		workspaceSlug: "acme",
	});

	expect(response.headers.get("Location")).toBe(
		"https://opaline.so/welcome?github=already-connected",
	);
});
