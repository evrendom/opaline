import { IconFolders, IconFoldersFilled } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import {
	RepoNavIcon,
	useRepositoryClock,
} from "@/features/shell/components/repo-nav-icon";
import { ShellNavIcon } from "@/features/shell/components/shell-nav-icon";
import { shellRouteMap } from "@/features/shell/config/shell-routes";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { orpc } from "@/lib/orpc";
import {
	hasMoreRepositories,
	REPOSITORY_HUES,
	topRepositories,
} from "./sidebar-repositories-model";
import { useRepositoryUploadStatus } from "./use-repository-upload-status";

export function SidebarRepositories({ reposActive }: { reposActive: boolean }) {
	const getShellRoutePath = useShellRoutePath();
	const [params] = useSearchParams();
	const query = useAnalyticsQuery(
		orpc.analytics.repositories.list.queryOptions({}),
	);
	const now = useRepositoryClock();
	const repos = useMemo(
		() => topRepositories(query.data ?? [], now),
		[query.data, now],
	);
	const uploadStatus = useRepositoryUploadStatus();
	const openRepo = reposActive ? params.get("repo") : null;
	const allActive = reposActive && openRepo === null;
	if (repos.length === 0) return null;
	const more = hasMoreRepositories(query.data ?? [], repos.length);
	const route = shellRouteMap.repos;
	return (
		<SidebarGroup>
			<SidebarGroupLabel className="h-6 text-[0.6875rem] font-normal text-sidebar-foreground/50">
				Repositories
			</SidebarGroupLabel>
			<SidebarGroupContent>
				<nav aria-label="Most used repositories">
					<SidebarMenu>
						{repos.map((repo, index) => {
							const active = openRepo === repo.key;
							return (
								<SidebarMenuItem key={repo.key}>
									<SidebarMenuButton
										data-sidebar-interactive=""
										isActive={active}
										title={repo.title}
										render={
											<Link
												to={getShellRoutePath(appRoutes.repoDetail(repo.key))}
												aria-current={active ? "page" : undefined}
											/>
										}
									>
										<RepoNavIcon
											hue={REPOSITORY_HUES[index] ?? null}
											active={active}
											status={uploadStatus(repo.key)}
										/>
										<span className="truncate">{repo.label}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
						{more ? (
							<SidebarMenuItem>
								<SidebarMenuButton
									data-sidebar-interactive=""
									isActive={allActive}
									render={
										<Link
											to={getShellRoutePath(appRoutes.repos())}
											aria-current={allActive ? "page" : undefined}
										/>
									}
								>
									<ShellNavIcon
										icon={IconFolders}
										activeIcon={IconFoldersFilled}
										active={allActive}
										tone={route.tone}
									/>
									<span>All repos</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						) : null}
					</SidebarMenu>
				</nav>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
