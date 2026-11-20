import type {
	GitHubRepositoryEvidenceStatus,
	GitHubTokenStatus as GitHubTokenStatusBody,
} from "@rudel/api-routes";
import type { GitHubRepositoryConnectionStatus } from "./github-repository-binding.service.js";
import type { GitHubTokenStatus } from "./github-token.service.js";
import type { GitHubTokenCollection } from "./github-token-repositories.service.js";

export async function resolveGitHubTokenRepositoryEvidenceStatus(input: {
	readonly isOrgAdmin: boolean;
	readonly historyDays: number;
	readonly readToken: () => Promise<GitHubTokenStatus>;
	readonly loadConnection: () => Promise<GitHubRepositoryConnectionStatus>;
	readonly loadCollection: () => Promise<GitHubTokenCollection>;
	readonly loadDashboard: () => Promise<"syncing" | "visible">;
}): Promise<GitHubRepositoryEvidenceStatus> {
	const [token, connection, collection] = await Promise.all([
		input.readToken(),
		input.loadConnection(),
		input.loadCollection(),
	]);
	const dashboard =
		connection.repositories.length === 0
			? "notConnected"
			: await input.loadDashboard();
	return {
		visibility: "visible",
		dashboard,
		connection: {
			accountLogin: token.login ?? connection.accountLogin,
			accountType: "User",
			suspended: false,
			canManage: input.isOrgAdmin,
			configurationError: null,
			configured: true,
			connected: token.state === "ready",
			installationId: null,
			manageUrl: null,
			repositories: connection.repositories.map((repository) => ({
				defaultBranch: repository.defaultBranch,
				isPrivate: repository.isPrivate,
				name: repository.name,
				nodeId: repository.nodeId,
				owner: repository.owner,
				repositoryId: repository.repositoryId,
				sync: repository.sync,
			})),
			repositorySelection: "selected",
			dashboard,
			token: toGitHubTokenStatusBody(token, collection, input.historyDays),
		},
	};
}

export function toGitHubTokenStatusBody(
	token: GitHubTokenStatus,
	collection: GitHubTokenCollection,
	historyDays: number,
): GitHubTokenStatusBody {
	return {
		state: token.state,
		source: token.source,
		host: token.host,
		login: token.login,
		scopes: token.scopes ? [...token.scopes] : null,
		missingScopes: [...token.missingScopes],
		rateLimit: token.rateLimit,
		message: token.message,
		fix: token.fix,
		checkedAt: token.checkedAt,
		repositories: collection.repositories,
		unreadableRepositories: [...collection.unreadable],
		lastSweepAt: collection.lastSweepAt,
		pausedUntil: collection.pausedUntil,
		historyDays,
	};
}
