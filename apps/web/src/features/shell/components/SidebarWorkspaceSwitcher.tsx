"use client";

import {
	IconBuilding,
	IconCheck,
	IconChevronDown,
	IconPlus,
	IconSettings,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	appRoutes,
	getWorkspacePathAfterSwitch,
	getWorkspaceSlugFromPath,
} from "@/app/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/app/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/app/ui/sidebar";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

// The workspace's logo, or a building on a grey tile when it has none
// (or the logo fails to load).
function WorkspaceMark({ logo }: { logo: string | null | undefined }) {
	return (
		<Avatar
			aria-hidden="true"
			className="size-5 rounded-[5px] after:rounded-[5px]"
		>
			{logo ? (
				<AvatarImage src={logo} alt="" className="rounded-[5px]" />
			) : null}
			<AvatarFallback className="rounded-[5px] bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300">
				<IconBuilding className="size-3!" />
			</AvatarFallback>
		</Avatar>
	);
}

// The workspace switcher.
export function SidebarWorkspaceSwitcher() {
	const navigate = useNavigate();
	const { pathname, search, hash } = useLocation();
	const getShellRoutePath = useShellRoutePath();
	const { state, actions } = useOrganization();
	const workspaceName = state.activeOrg?.name ?? "Workspace";

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								data-sidebar-interactive=""
								className="pr-2 pl-1.75 [&_svg]:size-3.5"
							/>
						}
					>
						<WorkspaceMark logo={state.activeOrg?.logo} />
						<span className="flex-1 truncate text-left font-medium">
							{workspaceName}
						</span>
						<IconChevronDown className="ml-auto opacity-15" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						side="right"
						sideOffset={8}
						className="min-w-(--anchor-width)"
					>
						{state.organizations.length > 0 ? (
							state.organizations.map((organization) => (
								<DropdownMenuItem
									key={organization.id}
									onClick={() => {
										if (getWorkspaceSlugFromPath(pathname))
											navigate(
												getWorkspacePathAfterSwitch(
													organization.slug,
													`${pathname}${search}${hash}`,
												),
											);
										else void actions.switchOrganization(organization.id);
									}}
								>
									<span className="flex-1 truncate">{organization.name}</span>
									{organization.id === state.activeOrg?.id ? (
										<IconCheck />
									) : null}
								</DropdownMenuItem>
							))
						) : (
							<DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() =>
								navigate(getShellRoutePath(appRoutes.settingsWorkspace()))
							}
						>
							<IconSettings />
							Workspace settings
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() =>
								navigate(getShellRoutePath(appRoutes.settingsCreateWorkspace()))
							}
						>
							<IconPlus />
							New workspace
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
