import { expect, mock, test } from "bun:test";
import { GitHubRepositoryEvidenceStatusSchema } from "@rudel/api-routes";
import type { GitHubRepositoryConnectionStatus } from "./github-repository-binding.service.js";
import {
	resolveGitHubRepositoryEvidenceStatus,
	resolveGitHubTokenRepositoryEvidenceStatus,
} from "./github-repository-evidence-status.service.js";

const CONNECTION: GitHubRepositoryConnectionStatus = {
	accountLogin: "opalinehq",
	accountType: "Organization",
	suspended: false,
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
			accountType: "Organization",
			suspended: false,
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

test("treats a suspended installation as connected but not syncing", async () => {
	const loadDashboard = mock(async () => "visible" as const);
	const status = await resolveGitHubRepositoryEvidenceStatus({
		uiEnabled: true,
		isOrgAdmin: true,
		readSetup: () => ({ configured: true }),
		loadConnection: async () => ({ ...CONNECTION, suspended: true }),
		loadDashboard,
	});

	expect(status).toMatchObject({
		visibility: "visible",
		dashboard: "notConnected",
		connection: { connected: true, suspended: true },
	});
	expect(loadDashboard).not.toHaveBeenCalled();
});

test("a self-hosted server describes its token instead of an App installation", async () => {
	const token = {
		state: "ready" as const,
		source: "gh" as const,
		host: "github.com",
		login: "octo",
		accountId: "42",
		scopes: ["repo", "workflow"],
		missingScopes: [],
		rateLimit: {
			limit: 5000,
			remaining: 4100,
			resetAt: "2026-11-09T13:00:00.000Z",
		},
		message: null,
		fix: null,
		checkedAt: "2026-11-09T12:00:00.000Z",
	};
	const collection = {
		repositories: 1,
		unreadable: ["someone/private"],
		discoveredAt: "2026-11-09T12:00:00.000Z",
		lastSweepAt: "2026-11-09T11:59:00.000Z",
		pausedUntil: null,
	};
	const status = await resolveGitHubTokenRepositoryEvidenceStatus({
		isOrgAdmin: false,
		historyDays: 90,
		readToken: async () => token,
		loadConnection: async () => ({
			...CONNECTION,
			accountLogin: "octo",
			accountType: "User",
			installationId: "token:org-1",
			manageUrl: null,
		}),
		loadCollection: async () => collection,
		loadDashboard: async () => "syncing",
	});
	expect(GitHubRepositoryEvidenceStatusSchema.parse(status)).toEqual(status);
	expect(status).toMatchObject({
		visibility: "visible",
		dashboard: "syncing",
		connection: {
			accountLogin: "octo",
			configured: true,
			connected: true,
			installationId: null,
			manageUrl: null,
			canManage: false,
			repositorySelection: "selected",
			token: {
				state: "ready",
				source: "gh",
				login: "octo",
				repositories: 1,
				unreadableRepositories: ["someone/private"],
				lastSweepAt: "2026-11-09T11:59:00.000Z",
				historyDays: 90,
			},
		},
	});
	expect(JSON.stringify(status)).not.toContain("accountId");

	const missing = await resolveGitHubTokenRepositoryEvidenceStatus({
		isOrgAdmin: true,
		historyDays: 90,
		readToken: async () => ({
			...token,
			state: "missing",
			source: null,
			login: null,
			accountId: null,
			scopes: null,
			rateLimit: null,
			message: "No GitHub token.",
			fix: "gh auth login --scopes repo",
		}),
		loadConnection: async () => ({
			...CONNECTION,
			connected: false,
			accountLogin: null,
			accountType: null,
			installationId: null,
			manageUrl: null,
			repositories: [],
			repositorySelection: null,
		}),
		loadCollection: async () => ({
			...collection,
			repositories: 0,
			unreadable: [],
		}),
		loadDashboard: async () => {
			throw new Error("no dashboard without repositories");
		},
	});
	expect(GitHubRepositoryEvidenceStatusSchema.parse(missing)).toEqual(missing);
	expect(missing).toMatchObject({
		dashboard: "notConnected",
		connection: {
			connected: false,
			configured: true,
			token: { state: "missing", fix: "gh auth login --scopes repo" },
		},
	});
});
