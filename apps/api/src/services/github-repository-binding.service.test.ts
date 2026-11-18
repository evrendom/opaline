import { expect, test } from "bun:test";
import { createGitHubInstallationManagementUrl } from "./github-repository-binding.service.js";

test("builds GitHub installation settings URLs for organization and user accounts", () => {
	expect(
		createGitHubInstallationManagementUrl({
			accountLogin: "opalinehq",
			accountType: "Organization",
			installationId: "123",
		}),
	).toBe(
		"https://github.com/organizations/opalinehq/settings/installations/123",
	);
	expect(
		createGitHubInstallationManagementUrl({
			accountLogin: "evrendombak",
			accountType: "User",
			installationId: "456",
		}),
	).toBe("https://github.com/settings/installations/456");
});
