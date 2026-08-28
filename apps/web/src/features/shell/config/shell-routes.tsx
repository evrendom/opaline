import { Clock3Icon, Settings2Icon, StarIcon, UsersIcon } from "lucide-react";
import type { ReactElement } from "react";
import { appRoutes } from "@/app/routes";

export type ShellRouteId = "dashboard" | "sessions" | "team" | "settings";
export type ShellRouteIcon = ReactElement<{ size?: number }>;

export type ShellRouteDefinition = {
	id: ShellRouteId;
	path: string;
	title: string;
	navLabel: string;
	shortcut: string;
	icon: ShellRouteIcon;
};

export function getShellRoutes(orgSlug: string) {
	return [
		{
			id: "dashboard",
			path: appRoutes.dashboard(orgSlug),
			title: "Dashboard",
			navLabel: "Dashboard",
			shortcut: "D",
			icon: <StarIcon />,
		},
		{
			id: "sessions",
			path: appRoutes.dashboardSessions(orgSlug),
			title: "Sessions",
			navLabel: "Sessions",
			shortcut: "H",
			icon: <Clock3Icon />,
		},
		{
			id: "team",
			path: appRoutes.team(orgSlug),
			title: "Team",
			navLabel: "Team",
			shortcut: "T",
			icon: <UsersIcon />,
		},
		{
			id: "settings",
			path: appRoutes.settings(orgSlug),
			title: "Settings",
			navLabel: "Settings",
			shortcut: "S",
			icon: <Settings2Icon />,
		},
	] as const satisfies readonly ShellRouteDefinition[];
}

export function getShellRouteMap(orgSlug: string) {
	const shellRoutes = getShellRoutes(orgSlug);

	return {
		dashboard: shellRoutes[0],
		sessions: shellRoutes[1],
		team: shellRoutes[2],
		settings: shellRoutes[3],
	} as const;
}

export function getCurrentShellRoute(
	pathname: string,
	orgSlug: string,
): ShellRouteDefinition {
	const shellRoutes = getShellRoutes(orgSlug);

	return (
		[...shellRoutes]
			.sort(
				(leftRoute, rightRoute) =>
					rightRoute.path.length - leftRoute.path.length,
			)
			.find(
				(route) =>
					pathname === route.path || pathname.startsWith(`${route.path}/`),
			) ?? shellRoutes[0]
	);
}
