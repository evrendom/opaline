"use client";

import { IconCheck, IconCommand, IconSettings } from "@tabler/icons-react";
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
	getUtilityRailItemClassName,
	getUtilityRailLabelClassName,
} from "@/features/shell/components/shell-rail-utils";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { cn } from "@/lib/utils";

function OpalineMark({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-[calc(var(--sidebar-avatar-size)*0.92)] shrink-0 bg-current [-webkit-mask:url('/opaline-icon.svg')_center/contain_no-repeat] [mask:url('/opaline-icon.svg')_center/contain_no-repeat]",
				className,
			)}
		/>
	);
}

export function WorkspaceMenuButton({
	variant = "sidebar",
}: {
	variant?: "bottom-rail" | "header" | "sidebar";
}) {
	const navigate = useNavigate();
	const { pathname, search, hash } = useLocation();
	const getShellRoutePath = useShellRoutePath();
	const { state, actions } = useOrganization();
	const workspaceName = state.activeOrg?.name ?? "Workspace";
	const isHeaderVariant = variant === "header";
	const isBottomRailVariant = variant === "bottom-rail";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label={workspaceName}
						data-sidebar-interactive
						data-sidebar-workspace-row
						className={cn(
							isHeaderVariant
								? "relative flex size-7 shrink-0 items-center justify-center rounded-md text-[#292A2F] outline-none hover:bg-black/4 active:scale-95 dark:text-white/90 dark:hover:bg-white/6"
								: getUtilityRailItemClassName(),
							isBottomRailVariant &&
								"!size-9 !w-9 self-auto overflow-visible rounded-lg",
							!isHeaderVariant &&
								!isBottomRailVariant &&
								"hover:!bg-transparent active:!bg-transparent",
						)}
					/>
				}
			>
				{isHeaderVariant ? (
					<>
						<OpalineMark className="size-4" />
						<span
							className="pointer-events-none absolute top-1/2 left-1/2 size-12 -translate-1/2 pointer-fine:hidden"
							aria-hidden="true"
						/>
					</>
				) : (
					<>
						<div
							data-sidebar-workspace-icon-lane
							className="flex h-[var(--sidebar-icon-lane-size)] w-[var(--sidebar-icon-lane-size)] shrink-0 items-center justify-center"
						>
							<div className="relative flex h-[var(--sidebar-avatar-size)] min-h-[var(--sidebar-avatar-size)] w-[var(--sidebar-avatar-size)] min-w-[var(--sidebar-avatar-size)] shrink-0 items-center justify-center text-[#292A2F] dark:text-white/90">
								<OpalineMark />
							</div>
						</div>
						<span
							aria-hidden="true"
							data-sidebar-workspace-label
							className={getUtilityRailLabelClassName()}
						>
							{workspaceName}
						</span>
						{isBottomRailVariant ? (
							<span
								className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
								aria-hidden="true"
							/>
						) : null}
					</>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-56"
				side={
					isHeaderVariant ? "bottom" : isBottomRailVariant ? "top" : "right"
				}
				align="start"
				sideOffset={isHeaderVariant || isBottomRailVariant ? 8 : 4}
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
								<IconCheck aria-hidden="true" />
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
					<IconSettings aria-hidden="true" />
					Workspace settings
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() =>
						navigate(getShellRoutePath(appRoutes.settingsCreateWorkspace()))
					}
				>
					<IconCommand aria-hidden="true" />
					Create workspace
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
