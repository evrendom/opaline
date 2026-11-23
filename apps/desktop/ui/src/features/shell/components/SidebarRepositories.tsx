import { IconFolders, IconFoldersFilled } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { routePreloadHandlers } from "@/app/route-loaders";
import { appRoutes } from "@/app/routes";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/app/ui/sidebar";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useWelcomeSelection } from "@/features/desktop/welcome-selection";
import {
	RepoNavIcon,
	type RepoUploadStatus,
	useRepositoryClock,
} from "@/features/shell/components/repo-nav-icon";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { orpc } from "@/lib/orpc";
import {
	hasMoreRepositories,
	REPOSITORY_HUES,
	SIDEBAR_REPOSITORIES_SHOWN,
	topRepositories,
} from "./sidebar-repositories-model";
import { useRepositoryUploadStatus } from "./use-repository-upload-status";

export function SidebarRepositories({ reposActive }: { reposActive: boolean }) {
	const [params] = useSearchParams();
	const query = useAnalyticsQuery(
		orpc.analytics.repositories.navigation.queryOptions({}),
	);
	const now = useRepositoryClock();
	const welcome = useWelcomeSelection();
	const workspaceRepos = useMemo(
		() => topRepositories(query.data ?? [], now),
		[query.data, now],
	);
	const repos = welcome.length
		? welcome.slice(0, SIDEBAR_REPOSITORIES_SHOWN).map((repo) => ({
				key: repo.key,
				label: repo.name,
				title: `${repo.name} · ${repo.sessionCount} sessions`,
			}))
		: workspaceRepos;
	const uploadStatus = useRepositoryUploadStatus();
	const openRepo = reposActive ? params.get("repo") : null;
	const allActive = reposActive && openRepo === null;
	if (repos.length === 0) return null;
	const more =
		!welcome.length && hasMoreRepositories(query.data ?? [], repos.length);
	return (
		<SidebarGroup>
			<SidebarGroupLabel
				className={"h-6 text-body-s font-regular text-ink-chrome"}
			>
				Repositories
			</SidebarGroupLabel>
			<SidebarGroupContent>
				<nav aria-label="Most used repositories">
					<SidebarMenu>
						{repos.map((repo, index) => {
							const active = openRepo === repo.key;
							return (
								<SidebarRepositoryRow
									key={repo.key}
									repo={repo}
									hue={REPOSITORY_HUES[index] ?? null}
									active={active}
									status={uploadStatus(repo.key)}
								/>
							);
						})}
						{more ? <SidebarAllReposRow active={allActive} /> : null}
					</SidebarMenu>
				</nav>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

/** One of the sidebar's most used repositories: its coloured folder, with
 *  the upload dot while sessions upload or run, and its name. */
export function SidebarRepositoryRow({
	repo,
	hue,
	active,
	status,
}: {
	repo: { key: string; label: string; title: string };
	hue: number | null;
	active: boolean;
	status: RepoUploadStatus;
}) {
	const getShellRoutePath = useShellRoutePath();
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				data-sidebar-interactive=""
				isActive={active}
				title={repo.title}
				render={
					<Link
						to={getShellRoutePath(appRoutes.repoDetail(repo.key))}
						aria-current={active ? "page" : undefined}
						{...routePreloadHandlers(
							getShellRoutePath(appRoutes.repoDetail(repo.key)),
						)}
					/>
				}
			>
				<RepoNavIcon hue={hue} active={active} status={status} />
				<span className="truncate">{repo.label}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

/** The row under the most used repositories when the workspace has more. */
export function SidebarAllReposRow({ active }: { active: boolean }) {
	const getShellRoutePath = useShellRoutePath();
	const route = shellRouteMap.repos;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				data-sidebar-interactive=""
				isActive={active}
				render={
					<Link
						to={getShellRoutePath(appRoutes.repos())}
						aria-current={active ? "page" : undefined}
						{...routePreloadHandlers(getShellRoutePath(appRoutes.repos()))}
					/>
				}
			>
				<ShellNavIcon
					icon={IconFolders}
					activeIcon={IconFoldersFilled}
					active={active}
					tone={route.tone}
				/>
				<span>All repos</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
