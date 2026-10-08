"use client";

import {
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
import { OpalineShape } from "@/features/shell/components/shell-nav-icon";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

// Where a project favicon tile would sit: the mark on a white
// Opaline pebble with the same hairline ring and soft drop shadow.
function OpalineMark() {
	return (
		<span
			aria-hidden="true"
			className="relative grid size-5 shrink-0 place-items-center"
		>
			<OpalineShape className="absolute inset-0 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.08)] [--opal-fill:var(--background)] [--opal-ring:rgb(0_0_0/0.1)]" />
			<span className="relative size-3 bg-[#292A2F] [-webkit-mask:url('/opaline-icon.svg')_center/contain_no-repeat] [mask:url('/opaline-icon.svg')_center/contain_no-repeat]" />
		</span>
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
						<OpalineMark />
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
