"use client";

import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { appRoutes } from "@/app/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { SidebarMenuButton, SidebarMenuItem } from "@/app/ui/sidebar";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { getInitials } from "@/features/shell/components/shell-rail-utils";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { authClient } from "@/lib/auth-client";

// NavUser: avatar, name and a chevron at the bottom of the sidebar.
// Links straight to account settings, which also holds log out.
export function SidebarUserMenu() {
	const getShellRoutePath = useShellRoutePath();
	const { data: session } = authClient.useSession();
	const demo = useDemoRuntime();

	// The demo holds auth requests until Explore; until then show the showcase
	// account from the seed, as the live session will.
	const viewer = demo?.seed.members.find(
		(member) => member.userId === demo.seed.viewerUserId,
	);
	const name = session?.user.name || viewer?.name || undefined;
	const email = session?.user.email || undefined;
	const image = session?.user.image || undefined;
	const accountLabel = name ?? email ?? (demo ? "Demo" : "Account");
	const initials = getInitials(name ?? (demo ? "Demo" : undefined), email);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				data-sidebar-interactive=""
				className="pr-s"
				render={<Link to={getShellRoutePath(appRoutes.settingsAccount())} />}
			>
				<Avatar
					size="sm"
					className="size-4.5 after:edge-none after:shadow-(--shadow-card)"
				>
					{viewer ? (
						// Bundled demo portraits must be present in the prerendered HTML.
						// The interactive AvatarImage waits for a client-side load.
						<img
							src={viewer.image}
							alt=""
							width={18}
							height={18}
							className="aspect-square size-full corner-full object-cover"
						/>
					) : (
						<>
							<AvatarImage src={image} alt="" />
							<AvatarFallback className="text-body-xxs">
								{initials}
							</AvatarFallback>
						</>
					)}
				</Avatar>
				<span className="min-w-0 flex-1 truncate text-left">
					{accountLabel}
				</span>
				<IconChevronRight className="ml-auto size-3.5! opacity-15" />
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
