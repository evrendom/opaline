import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import type { GitHubRepositoryConnectionStatus } from "./github-repository-binding.service.js";

export type GitHubSetupState =
	| { readonly configured: true }
	| { readonly configured: false; readonly configurationError: string };

/**
 * Workspace GitHub status for settings and onboarding. While the GitHub
 * evidence UI is dark-launched for this workspace (global flag off and not a
 * forced preview organization) the answer is `hidden` and neither the
 * deployment's GitHub setup nor the workspace connection is read, so nothing
 * about it leaks into a surface that is not supposed to exist yet.
 */
export async function resolveGitHubRepositoryEvidenceStatus(input: {
	readonly uiEnabled: boolean;
	readonly isOrgAdmin: boolean;
	readonly readSetup: () => GitHubSetupState;
	readonly loadConnection: () => Promise<GitHubRepositoryConnectionStatus>;
	readonly loadDashboard?: () => Promise<
		"notConnected" | "syncing" | "visible"
	>;
}): Promise<GitHubRepositoryEvidenceStatus> {
	if (!input.uiEnabled) return { visibility: "hidden" };
	const setup = input.readSetup();
	if (!setup.configured) {
		return {
			visibility: "visible",
			dashboard: "notConnected",
			connection: {
				accountLogin: null,
				canManage: input.isOrgAdmin,
				configurationError: setup.configurationError,
				configured: false,
				connected: false,
				installationId: null,
				manageUrl: null,
				repositories: [],
				repositorySelection: null,
				dashboard: "notConnected",
			},
		};
	}
	const status = await input.loadConnection();
	const dashboard =
		status.connected && !status.suspended
			? ((await input.loadDashboard?.()) ?? "syncing")
			: "notConnected";
	return {
		visibility: "visible",
		dashboard,
		connection: {
			accountLogin: status.accountLogin,
			accountType: status.accountType,
			suspended: status.suspended,
			canManage: input.isOrgAdmin,
			configurationError: null,
			configured: true,
			connected: status.connected,
			installationId: status.installationId,
			manageUrl: input.isOrgAdmin ? status.manageUrl : null,
			repositories: status.repositories.map((repository) => ({
				defaultBranch: repository.defaultBranch,
				isPrivate: repository.isPrivate,
				name: repository.name,
				nodeId: repository.nodeId,
				owner: repository.owner,
				repositoryId: repository.repositoryId,
				sync: repository.sync,
			})),
			repositorySelection: status.repositorySelection,
			dashboard,
		},
	};
}
