import { getCanonicalAppPath } from "@/app/routes";
import { loadSessionsPage } from "@/app/session-page-loader";

function once<TModule>(load: () => Promise<TModule>) {
	let pending: Promise<TModule> | undefined;
	return () => {
		pending ??= load().catch((error: unknown) => {
			pending = undefined;
			throw error;
		});
		return pending;
	};
}

export const routeLoaders = {
	admin: once(() => import("@/features/admin/AdminDashboardPage")),
	adminRunQuestions: once(
		() => import("@/features/admin/RunQuestionsAdminPage"),
	),
	adminFeatures: once(
		() => import("@/features/admin/WorkspaceFeaturesAdminPage"),
	),
	welcome: once(() => import("@/features/self-hosted/SelfHostedWelcome")),
	compass: once(() => import("@/features/compass/CompassPage")),
	dashboard: once(() => import("@/features/dashboard/DashboardPage")),
	mcp: once(() => import("@/features/mcp/McpPage")),
	newSession: once(() => import("@/features/sessions/new-session-page")),
	repoDetail: once(() => import("@/features/repos/repo-detail-page")),
	repos: once(() => import("@/features/repos/repos-page")),
	report: once(() => import("@/features/reports/ReportPage")),
	sessions: loadSessionsPage,
	skillDetail: once(() => import("@/features/skills/skill-detail-page")),
	skills: once(() => import("@/features/skills/SkillsPage")),
	workspaceSetup: once(() => import("@/features/setup/workspace-setup-page")),
};

type RouteLoader = (typeof routeLoaders)[keyof typeof routeLoaders];

const ROUTE_PRELOADS: readonly (readonly [
	RegExp,
	(search: URLSearchParams) => readonly RouteLoader[],
])[] = [
	[/^\/$|^\/session(?:\/|$)/u, () => [routeLoaders.sessions]],
	[/^\/(?:dashboard|home)$/u, () => [routeLoaders.dashboard]],
	[
		/^\/repos$/u,
		(search) =>
			search.has("repo")
				? [routeLoaders.repos, routeLoaders.repoDetail]
				: [routeLoaders.repos],
	],
	[
		/^\/skills$/u,
		(search) => {
			if (!search.has("skill")) return [routeLoaders.skills];
			return search.has("session")
				? [routeLoaders.skills, routeLoaders.skillDetail]
				: [routeLoaders.skills, routeLoaders.workspaceSetup];
		},
	],
	[
		/^\/mcp$/u,
		(search) =>
			search.has("mcp")
				? [routeLoaders.mcp, routeLoaders.workspaceSetup]
				: [routeLoaders.mcp],
	],
	[/^\/compass$/u, () => [routeLoaders.compass]],
	[/^\/newsesh(?:\/|$)/u, () => [routeLoaders.newSession]],
	[/^\/reports\/[^/]+$/u, () => [routeLoaders.report]],
	[/^\/admin$/u, () => [routeLoaders.admin]],
	[/^\/admin\/run-questions$/u, () => [routeLoaders.adminRunQuestions]],
	[/^\/admin\/features$/u, () => [routeLoaders.adminFeatures]],
	[/^\/welcome$/u, () => [routeLoaders.welcome]],
];

export function preloadRoute(to: string) {
	const url = new URL(to, "http://route.local");
	const path = getCanonicalAppPath(url.pathname).replace(/(.)\/$/u, "$1");
	const loaders =
		ROUTE_PRELOADS.find(([pattern]) => pattern.test(path))?.[1](
			url.searchParams,
		) ?? [];
	for (const load of loaders) void load().catch(() => {});
}

export function routePreloadHandlers(to: string) {
	const preload = () => preloadRoute(to);
	return { onFocus: preload, onPointerEnter: preload };
}
