import {
	type Icon,
	IconBook,
	IconBookFilled,
	IconChartAreaLine,
	IconChartAreaLineFilled,
	IconFolder,
	IconFolderFilled,
	IconMessages,
	IconMessagesFilled,
	IconRoute,
	IconSettings,
	IconSettingsFilled,
	IconUser,
	IconUserFilled,
} from "@tabler/icons-react";
import { appRoutes, getCanonicalAppPath } from "@/app/routes";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import type { ShellNavTone } from "@/features/shell/components/shell-nav-icon";

export type ShellRouteId =
	| "dashboard"
	| "sessions"
	| "skills"
	| "agentTraces"
	| "repos"
	| "team"
	| "settings";

// Section colours run down Opaline's sheen, blue to pink (opal-1…5 in
// preset-extensions.css). The active section's chip turns a pale tint with a
// 1px inner border in the section colour at 20%, and its glyph takes the
// colour. Classes stay literal so Tailwind can see them.
const tones = {
	opal1: {
		chip: "[--opal-fill:var(--color-opal-1-tint)] [--opal-ring:color-mix(in_oklch,var(--color-opal-1)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--color-opal-1)_25%,transparent)]",
		glyph: "text-opal-1",
	},
	opal2: {
		chip: "[--opal-fill:var(--color-opal-2-tint)] [--opal-ring:color-mix(in_oklch,var(--color-opal-2)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--color-opal-2)_25%,transparent)]",
		glyph: "text-opal-2",
	},
	opal3: {
		chip: "[--opal-fill:var(--color-opal-3-tint)] [--opal-ring:color-mix(in_oklch,var(--color-opal-3)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--color-opal-3)_25%,transparent)]",
		glyph: "text-opal-3",
	},
	opal4: {
		chip: "[--opal-fill:var(--color-opal-4-tint)] [--opal-ring:color-mix(in_oklch,var(--color-opal-4)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--color-opal-4)_25%,transparent)]",
		glyph: "text-opal-4",
	},
	opal5: {
		chip: "[--opal-fill:var(--color-opal-5-tint)] [--opal-ring:color-mix(in_oklch,var(--color-opal-5)_20%,transparent)] drop-shadow-[0_1.5px_2px_color-mix(in_oklch,var(--color-opal-5)_25%,transparent)]",
		glyph: "text-opal-5",
	},
} satisfies Record<string, ShellNavTone>;

/** The Sessions section's colour, for session views that wear its chip. */
export const sessionsTone = tones.opal2;

export type ShellRouteDefinition = {
	id: ShellRouteId;
	path: string;
	title: string;
	navLabel: string;
	shortcut: string;
	comingSoon: boolean;
	/** Outline icon, shown while the section is inactive. */
	icon: Icon;
	/** Filled icon, shown while the section is active. */
	activeIcon: Icon;
	/** Section colour for the active chip in the sidebar and page header. */
	tone?: ShellNavTone;
};

export const shellRoutes = [
	{
		id: "dashboard",
		comingSoon: false,
		path: appRoutes.dashboard(),
		title: "Dashboard",
		navLabel: "Dashboard",
		shortcut: "D",
		icon: IconChartAreaLine,
		activeIcon: IconChartAreaLineFilled,
		tone: tones.opal1,
	},
	{
		id: "sessions",
		comingSoon: false,
		path: appRoutes.session(),
		title: "Sessions",
		navLabel: "Sessions",
		shortcut: "H",
		icon: IconMessages,
		activeIcon: IconMessagesFilled,
		tone: sessionsTone,
	},
	{
		id: "skills",
		comingSoon: false,
		path: appRoutes.skills(),
		title: "Skills",
		navLabel: "Skills",
		shortcut: "K",
		icon: IconBook,
		activeIcon: IconBookFilled,
		tone: tones.opal3,
	},
	{
		id: "agentTraces",
		comingSoon: false,
		path: appRoutes.agentTraces(),
		title: "Agent traces",
		navLabel: "Agent traces",
		shortcut: "A",
		icon: IconRoute,
		activeIcon: IconRoute,
		tone: sessionsTone,
	},
	{
		id: "repos",
		comingSoon: false,
		path: appRoutes.repos(),
		title: "Repos",
		navLabel: "Repos",
		shortcut: "R",
		icon: IconFolder,
		activeIcon: IconFolderFilled,
		tone: tones.opal4,
	},
	{
		id: "team",
		comingSoon: false,
		path: appRoutes.team(),
		title: "Team",
		navLabel: "Team",
		shortcut: "T",
		icon: IconUser,
		activeIcon: IconUserFilled,
		tone: tones.opal5,
	},
	{
		id: "settings",
		comingSoon: false,
		path: appRoutes.settings(),
		title: "Settings",
		navLabel: "Settings",
		shortcut: "S",
		icon: IconSettings,
		activeIcon: IconSettingsFilled,
	},
] satisfies readonly ShellRouteDefinition[];

export const shellRouteMap = {
	dashboard: shellRoutes[0],
	sessions: shellRoutes[1],
	skills: shellRoutes[2],
	agentTraces: shellRoutes[3],
	repos: shellRoutes[4],
	team: shellRoutes[5],
	settings: shellRoutes[6],
} as const;

// The plugin app is read-only; settings stay on opaline.so.
export const shellNavigationRoutes = shellRoutes.filter(
	(route) =>
		!route.comingSoon &&
		!(
			import.meta.env.MODE === "plugin" &&
			(route.id === "settings" || route.id === "agentTraces")
		),
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
