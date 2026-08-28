"use client";

import { CheckIcon, CommandIcon, Settings2Icon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { appRoutes } from "@/app/routes";
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
	type SidebarRowMode,
} from "@/features/shell/components/shell-rail-utils";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { useWorkspaceSlug } from "@/features/workspace/routing/workspace-routes";
import { cn } from "@/lib/utils";

function WorkspaceMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 1049 1042"
			fill="none"
			aria-hidden="true"
			className={cn(
				"h-[calc(var(--sidebar-avatar-size)*0.92)] w-auto",
				className,
			)}
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M524.532 0C661.725 4.52425 793.956 20.3892 890.19 103.494C986.746 183.313 1047.24 330.329 1049 520.65C1047.24 710.913 986.746 857.99 890.19 937.817C793.956 1020.92 661.79 1036.79 524.532 1041.3C387.274 1036.79 255.1 1020.92 158.866 937.817C62.3182 857.99 1.76716 711.006 0 520.684L0.00200081 520.672L0.010004 520.66L0.0200081 520.654L0.0320129 520.65L0.0560226 520.64L0.0640259 520.616C1.75876 330.245 62.3185 183.245 158.866 103.494C255.1 20.3892 387.274 4.52426 524.532 0ZM524.518 229.469C447.847 231.997 374.015 240.862 320.259 287.3C266.328 331.864 232.5 414.007 231.554 520.384L231.548 520.396L231.536 520.402L231.53 520.404L231.524 520.408L231.52 520.414L231.518 520.42C232.505 626.77 266.328 708.904 320.259 753.511C374.015 799.948 447.847 808.813 524.518 811.336C601.189 808.813 675.017 799.948 728.773 753.511C782.708 708.904 816.5 626.719 817.482 520.402C816.5 414.053 782.708 331.902 728.773 287.3C675.017 240.862 601.153 231.997 524.518 229.469Z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function WorkspaceMenuButton({
	mode = "expanded",
}: {
	mode?: SidebarRowMode;
}) {
	const orgSlug = useWorkspaceSlug();
	const navigate = useNavigate();
	const { state, actions } = useOrganization();
	const workspaceName = state.activeOrg?.name ?? "Workspace";

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
							getUtilityRailItemClassName(mode),
							mode === "collapsed" &&
								"hover:!bg-transparent active:!bg-transparent",
						)}
					/>
				}
			>
				<div
					data-sidebar-workspace-icon-lane
					className="flex h-[var(--sidebar-icon-lane-size)] w-[var(--sidebar-icon-lane-size)] shrink-0 items-center justify-center"
				>
					<div className="relative flex h-[var(--sidebar-avatar-size)] min-h-[var(--sidebar-avatar-size)] w-[var(--sidebar-avatar-size)] min-w-[var(--sidebar-avatar-size)] shrink-0 items-center justify-center text-[#292A2F] dark:text-white/90">
						<WorkspaceMark />
					</div>
				</div>
				<span
					aria-hidden="true"
					data-sidebar-workspace-label
					className={getUtilityRailLabelClassName(mode)}
				>
					{workspaceName}
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="min-w-56" side="right" align="start">
				{state.organizations.length > 0 ? (
					state.organizations.map((organization) => (
						<DropdownMenuItem
							key={organization.id}
							onClick={() => void actions.switchOrganization(organization.id)}
						>
							<span className="flex-1 truncate">{organization.name}</span>
							{organization.id === state.activeOrg?.id ? <CheckIcon /> : null}
						</DropdownMenuItem>
					))
				) : (
					<DropdownMenuItem disabled>No workspaces yet</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => navigate(appRoutes.settingsWorkspace(orgSlug))}
				>
					<Settings2Icon />
					Workspace settings
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() =>
						navigate(`${appRoutes.settingsWorkspace(orgSlug)}#new-workspace`)
					}
				>
					<CommandIcon />
					Create workspace
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
