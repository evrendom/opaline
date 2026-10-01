import { expect, mock, test } from "bun:test";
import { GitHubRepositoryEvidenceStatusSchema } from "@rudel/api-routes";
import type { GitHubRepositoryConnectionStatus } from "./github-repository-binding.service.js";
import { resolveGitHubRepositoryEvidenceStatus } from "./github-repository-evidence-status.service.js";

const CONNECTION: GitHubRepositoryConnectionStatus = {
	accountLogin: "opalinehq",
	connected: true,
	installationId: "1234",
	manageUrl:
		"https://github.com/organizations/opalinehq/settings/installations/1234",
	repositories: [
		{
			defaultBranch: "main",
			installationId: "1234",
			isPrivate: true,
			name: "athena",
			nodeId: "R_athena",
			organizationId: "org-1",
			owner: "opalinehq",
			repositoryId: "55",
		},
	],
	repositorySelection: "selected",
};

test("reveals nothing and reads nothing while the GitHub evidence UI is hidden", async () => {
	const readSetup = mock(() => ({ configured: true as const }));
	const loadConnection = mock(async () => CONNECTION);

	const status = await resolveGitHubRepositoryEvidenceStatus({
		uiEnabled: false,
		isOrgAdmin: true,
		readSetup,
		loadConnection,
	});

	expect(status).toEqual({ visibility: "hidden" });
	expect(GitHubRepositoryEvidenceStatusSchema.parse(status)).toEqual(status);
	expect(readSetup).not.toHaveBeenCalled();
	expect(loadConnection).not.toHaveBeenCalled();
});

test("shows the workspace connection once the GitHub evidence UI is enabled", async () => {
	const status = await resolveGitHubRepositoryEvidenceStatus({
		uiEnabled: true,
		isOrgAdmin: true,
		readSetup: () => ({ configured: true }),
		loadConnection: async () => CONNECTION,
	});

	expect(GitHubRepositoryEvidenceStatusSchema.parse(status)).toEqual({
		visibility: "visible",
		dashboard: "syncing",
		connection: {
			accountLogin: "opalinehq",
			canManage: true,
			configurationError: null,
			configured: true,
			connected: true,
			installationId: "1234",
			manageUrl: CONNECTION.manageUrl,
			repositories: [
				{
					defaultBranch: "main",
					isPrivate: true,
					name: "athena",
					nodeId: "R_athena",
					owner: "opalinehq",
					repositoryId: "55",
				},
			],
			repositorySelection: "selected",
			dashboard: "syncing",
		},
	});
});

test("keeps management links admin-only when visible", async () => {
	const status = await resolveGitHubRepositoryEvidenceStatus({
		uiEnabled: true,
		isOrgAdmin: false,
		readSetup: () => ({ configured: true }),
		loadConnection: async () => CONNECTION,
	});

	expect(status).toMatchObject({
		visibility: "visible",
		dashboard: "syncing",
		connection: { canManage: false, manageUrl: null },
	});
});

test("reports an unconfigured deployment without loading the connection", async () => {
	const loadConnection = mock(async () => CONNECTION);

	const status = await resolveGitHubRepositoryEvidenceStatus({
		uiEnabled: true,
		isOrgAdmin: true,
		readSetup: () => ({
			configured: false,
			configurationError: "GitHub connection is not configured.",
		}),
		loadConnection,
	});

	expect(status).toMatchObject({
		visibility: "visible",
		dashboard: "notConnected",
		connection: {
			configured: false,
			configurationError: "GitHub connection is not configured.",
			connected: false,
			repositories: [],
		},
	});
	expect(loadConnection).not.toHaveBeenCalled();
});

test("ready workspaces expose the visible dashboard state", async () => {
	const status = await resolveGitHubRepositoryEvidenceStatus({
		uiEnabled: true,
		isOrgAdmin: false,
		readSetup: () => ({ configured: true }),
		loadConnection: async () => CONNECTION,
		loadDashboard: async () => "visible",
	});
	expect(GitHubRepositoryEvidenceStatusSchema.parse(status)).toMatchObject({
		visibility: "visible",
		dashboard: "visible",
		connection: { dashboard: "visible", canManage: false },
	});
});
