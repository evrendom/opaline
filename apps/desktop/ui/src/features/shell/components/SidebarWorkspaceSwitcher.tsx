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
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useLocalDesktopApp } from "@/features/desktop/local-app";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { cn } from "@/lib/utils";

// --custom-shadow (the account avatar's edge) as drop-shadows, which follow
// the Opaline mask where a box-shadow would draw a square.
const WORKSPACE_MARK_SHADOW_CLASS_NAME =
	"[filter:drop-shadow(0_0_0.5px_rgb(0_0_0_/_14%))_drop-shadow(0_0.5px_1px_rgb(0_0_0_/_6%))_drop-shadow(0_1px_2px_rgb(0_0_0_/_4%))] dark:[filter:drop-shadow(0_0_0.75px_rgb(0_0_0_/_20%))_drop-shadow(0_2px_2px_rgb(0_0_0_/_10%))_drop-shadow(0_4px_4px_rgb(0_0_0_/_10%))]";

// The workspace's logo, or a building on a tile like the account avatar's
// when it has none (or the logo fails to load), cut to the Opaline outline.
function WorkspaceMark({ logo }: { logo: string | null | undefined }) {
	const demo = useDemoRuntime();
	// The bundled demo logo must be present in the prerendered HTML. The
	// interactive AvatarImage waits for a client-side image load.
	if (demo && logo)
		return (
			<img
				src={logo}
				alt=""
				width={20}
				height={20}
				aria-hidden="true"
				className={cn(
					"size-5 shrink-0 object-contain",
					WORKSPACE_MARK_SHADOW_CLASS_NAME,
				)}
			/>
		);
	// The shadow sits on a wrapper because the mask clips the avatar's own.
	return (
		<span
			aria-hidden="true"
			className={cn("flex size-5 shrink-0", WORKSPACE_MARK_SHADOW_CLASS_NAME)}
		>
			<Avatar
				skullet-own=""
				data-workspace-mark=""
				className="size-5 corner-zero after:hidden [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]"
			>
				{logo ? (
					<AvatarImage src={logo} alt="" className="corner-zero" />
				) : null}
				<AvatarFallback className="corner-zero">
					<IconBuilding className="size-3!" />
				</AvatarFallback>
			</Avatar>
		</span>
	);
}

// The workspace switcher.
export function SidebarWorkspaceSwitcher() {
	const navigate = useNavigate();
	const { pathname, search, hash } = useLocation();
	const getShellRoutePath = useShellRoutePath();
	const { state, actions } = useOrganization();
	const localApp = useLocalDesktopApp();
	const workspaceName = state.activeOrg?.name ?? "Workspace";

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								data-sidebar-interactive=""
								className="pr-m pl-m [&_svg]:size-3.5"
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
								navigate(
									getShellRoutePath(
										localApp
											? appRoutes.settings()
											: appRoutes.settingsWorkspace(),
									),
								)
							}
						>
							<IconSettings />
							{localApp ? "Settings" : "Workspace settings"}
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
