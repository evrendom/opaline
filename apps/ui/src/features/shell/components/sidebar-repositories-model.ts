import {
	isLiveSessionActive,
	type LiveSessionSummary,
	type RepositoryNavigationItem,
	type RepositorySettings,
	resolveRepoIdentity,
} from "@rudel/api-routes";

export const SIDEBAR_REPOSITORIES_SHOWN = 10;
const RECENT_DAYS = 60;

function isRecent(repo: RepositoryNavigationItem, now: number) {
	if (!repo.lastActiveAt) return true;
	return now - Date.parse(repo.lastActiveAt) <= RECENT_DAYS * 86_400_000;
}

export function topRepositories(
	repos: readonly RepositoryNavigationItem[],
	now = Date.now(),
) {
	const top = [...repos]
		.filter((repo) => repo.sessionCount > 0 && isRecent(repo, now))
		.sort((a, b) => b.sessionCount - a.sessionCount)
		.slice(0, SIDEBAR_REPOSITORIES_SHOWN);
	const names = new Map<string, number>();
	for (const repo of top) {
		const name = repo.identity.repoName ?? repo.identity.repoLabel;
		names.set(name, (names.get(name) ?? 0) + 1);
	}
	return top.map((repo) => {
		const name = repo.identity.repoName ?? repo.identity.repoLabel;
		return {
			key: repo.identity.repoKey,
			label: (names.get(name) ?? 0) > 1 ? repo.identity.repoLabel : name,
			title: `${repo.identity.repoLabel} · ${repo.sessionCount} sessions`,
		};
	});
}

export const REPOSITORY_HUES = [
	10, 35, 60, 85, 110, 135, 160, 185, 210, 235,
] as const;

export function repositoryHue(
	repos: readonly RepositoryNavigationItem[],
	repoKey: string,
	now = Date.now(),
) {
	const index = topRepositories(repos, now).findIndex(
		(repo) => repo.key === repoKey,
	);
	return index === -1 ? null : REPOSITORY_HUES[index];
}

export function hasMoreRepositories(
	repos: readonly RepositoryNavigationItem[],
	shown: number,
) {
	return repos.filter((repo) => repo.sessionCount > 0).length > shown;
}

export function autoUploadRepositoryKeys(
	settings: RepositorySettings | undefined,
) {
	return new Set(
		(settings?.repositories ?? [])
			.filter((repo) =>
				repo.reports.some((report) => report.state === "enabled"),
			)
			.map((repo) => repo.key),
	);
}

export function liveRepositoryKeys(
	sessions: readonly LiveSessionSummary[],
	repos: readonly RepositoryNavigationItem[],
	now: number,
) {
	const remotesByName = new Map<string, string>();
	for (const { identity } of repos) {
		const name = identity.repoName?.toLowerCase();
		if (name && identity.source === "remote")
			remotesByName.set(name, identity.repoKey);
	}
	const keys = new Set<string>();
	for (const session of sessions) {
		if (!isLiveSessionActive(session, now)) continue;
		const identity = resolveRepoIdentity({
			projectPath: session.projectPath,
			gitRemote: session.gitRemote,
			packageName: null,
		});
		const remote =
			identity.source === "worktree"
				? remotesByName.get(identity.repoName?.toLowerCase() ?? "")
				: undefined;
		keys.add(remote ?? identity.repoKey);
	}
	return keys;
}
