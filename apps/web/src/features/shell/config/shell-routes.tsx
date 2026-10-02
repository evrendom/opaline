import {
	BookOpen01Icon,
	ChartLineData01Icon,
	Clock03Icon,
	Folder01Icon,
	Settings01Icon,
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
	| "repos"
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
		comingSoon: false,
		path: appRoutes.dashboard(),
		title: "Dashboard",
		navLabel: "Dashboard",
		shortcut: "D",
		icon: <ShellHugeicon icon={ChartLineData01Icon} />,
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
		comingSoon: false,
		path: appRoutes.skills(),
		title: "Skills",
		navLabel: "Skills",
		shortcut: "K",
		icon: <ShellHugeicon icon={BookOpen01Icon} />,
	},
	{
		id: "repos",
		comingSoon: false,
		path: appRoutes.repos(),
		title: "Repos",
		navLabel: "Repos",
		shortcut: "R",
		icon: <ShellHugeicon icon={Folder01Icon} />,
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
	repos: shellRoutes[3],
	team: shellRoutes[4],
	settings: shellRoutes[5],
} as const;

// The plugin app is read-only; settings stay on opaline.so.
export const shellNavigationRoutes = shellRoutes.filter(
	(route) =>
		!route.comingSoon &&
		!(import.meta.env.MODE === "plugin" && route.id === "settings"),
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
