import type { RepoIdentity } from "./schemas/analytics.js";

export type { RepoIdentity } from "./schemas/analytics.js";

type RepoPathMatch = {
	repoToken: string;
	worktree: string;
};

type RepoPathRule = {
	name: string;
	match: (normalizedPath: string) => RepoPathMatch | null;
};

const REPO_PATH_RULES: readonly RepoPathRule[] = [
	{
		name: "conductor",
		match(normalizedPath) {
			const match = normalizedPath.match(
				/(?:^|\/)conductor\/workspaces\/([^/]+)\/([^/]+)(?:\/|$)/,
			);
			const repoToken = match?.[1];
			const worktree = match?.[2];

			return repoToken && worktree ? { repoToken, worktree } : null;
		},
	},
	{
		name: "dot-worktrees",
		match(normalizedPath) {
			const match = normalizedPath.match(
				/(?:^|\/)([^/]+)\/\.worktrees\/([^/]+)(?:\/|$)/,
			);
			const repoToken = match?.[1];
			const worktree = match?.[2];

			return repoToken && worktree ? { repoToken, worktree } : null;
		},
	},
];

function normalizeSeparators(value: string) {
	return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function stripTerminalGit(value: string) {
	return value.replace(/\.git$/i, "");
}

function extractRepoName(value: string) {
	const normalizedValue = stripTerminalGit(normalizeSeparators(value));
	return normalizedValue.split("/").filter(Boolean).at(-1) ?? null;
}

function resolveRemoteIdentity(gitRemote: string): RepoIdentity {
	const normalizedRemote = stripTerminalGit(
		normalizeSeparators(gitRemote.trim()),
	);
	const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(normalizedRemote);
	let canonicalRemote = normalizedRemote.replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
	canonicalRemote = canonicalRemote.replace(/^[^/@]+@/, "");
	if (!hasProtocol) {
		canonicalRemote = canonicalRemote.replace(/^([^/:]+):/, "$1/");
	}

	const [remoteHost = "", ...remotePathSegments] = canonicalRemote
		.split("/")
		.filter(Boolean);
	const normalizedHost = remoteHost.toLowerCase();
	const remotePath = remotePathSegments.join("/");
	const canonicalKey = [normalizedHost, remotePath].filter(Boolean).join("/");

	return {
		repoKey: `remote:${canonicalKey}`,
		repoLabel:
			remotePathSegments.slice(-2).join("/") || normalizedHost || gitRemote,
		repoName: remotePathSegments.at(-1) ?? null,
		source: "remote",
		worktree: null,
	};
}

export function resolveRepoIdentity(input: {
	projectPath: string;
	gitRemote: string | null;
	packageName: string | null;
}): RepoIdentity {
	const normalizedPath = normalizeSeparators(input.projectPath);

	for (const rule of REPO_PATH_RULES) {
		const pathMatch = rule.match(normalizedPath);
		if (pathMatch) {
			const repoName = extractRepoName(pathMatch.repoToken);
			return {
				repoKey: `path:${repoName ?? pathMatch.repoToken}`,
				repoLabel: repoName ?? pathMatch.repoToken,
				repoName,
				source: "worktree",
				worktree: pathMatch.worktree,
			};
		}
	}

	if (input.gitRemote) {
		return resolveRemoteIdentity(input.gitRemote);
	}

	if (input.packageName) {
		return {
			repoKey: `pkg:${input.packageName}`,
			repoLabel: input.packageName,
			repoName: extractRepoName(input.packageName),
			source: "package",
			worktree: null,
		};
	}

	const pathSegments = normalizedPath.split("/").filter(Boolean);
	return {
		repoKey: `path-raw:${input.projectPath}`,
		repoLabel: pathSegments.slice(-2).join("/") || "Untitled project",
		repoName: null,
		source: "unresolved",
		worktree: null,
	};
}
