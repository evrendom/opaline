import {
	BookOpen01Icon,
	Clock03Icon,
	Settings01Icon,
	StarIcon,
	UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { ReactElement } from "react";
import { appRoutes, getCanonicalAppPath } from "@/app/routes";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { ShellHugeicon } from "@/features/shell/components/shell-hugeicon";

export type ShellRouteId =
	| "dashboard"
	| "sessions"
	| "skills"
	| "team"
	| "settings";
export type ShellRouteIcon = ReactElement;

export type ShellRouteDefinition = {
	id: ShellRouteId;
	path: string;
	title: string;
	navLabel: string;
	shortcut: string;
	comingSoon: boolean;
	icon: ShellRouteIcon;
};

export const shellRoutes = [
	{
		id: "dashboard",
		comingSoon: true,
		path: appRoutes.dashboard(),
		title: "Dashboard",
		navLabel: "Dashboard",
		shortcut: "D",
		icon: <ShellHugeicon icon={StarIcon} />,
	},
	{
		id: "sessions",
		comingSoon: false,
		path: appRoutes.session(),
		title: "Sessions",
		navLabel: "Sessions",
		shortcut: "H",
		icon: <ShellHugeicon icon={Clock03Icon} />,
	},
	{
		id: "skills",
		comingSoon: true,
		path: appRoutes.skills(),
		title: "Skills",
		navLabel: "Skills",
		shortcut: "K",
		icon: <ShellHugeicon icon={BookOpen01Icon} />,
	},
	{
		id: "team",
		comingSoon: false,
		path: appRoutes.team(),
		title: "Team",
		navLabel: "Team",
		shortcut: "T",
		icon: <ShellHugeicon icon={UserGroupIcon} />,
	},
	{
		id: "settings",
		comingSoon: false,
		path: appRoutes.settings(),
		title: "Settings",
		navLabel: "Settings",
		shortcut: "S",
		icon: <ShellHugeicon icon={Settings01Icon} />,
	},
] satisfies readonly ShellRouteDefinition[];

export const shellRouteMap = {
	dashboard: shellRoutes[0],
	sessions: shellRoutes[1],
	skills: shellRoutes[2],
	team: shellRoutes[3],
	settings: shellRoutes[4],
} as const;

export const shellNavigationRoutes = shellRoutes.filter(
	(route) => !route.comingSoon,
);

export function getCurrentShellRoute(pathname: string): ShellRouteDefinition {
	const canonicalPathname = getCanonicalAppPath(pathname);

	if (
		canonicalPathname === CLI_SETUP_PATH ||
		canonicalPathname === appRoutes.session() ||
		canonicalPathname.startsWith(`${appRoutes.session()}/`) ||
		canonicalPathname === appRoutes.newSession() ||
		canonicalPathname.startsWith(`${appRoutes.newSession()}/`)
	) {
		return shellRouteMap.sessions;
	}

	return (
		[...shellRoutes]
			.sort(
				(leftRoute, rightRoute) =>
					rightRoute.path.length - leftRoute.path.length,
			)
			.find(
				(route) =>
					canonicalPathname === route.path ||
					canonicalPathname.startsWith(`${route.path}/`),
			) ?? shellRouteMap.dashboard
	);
}
