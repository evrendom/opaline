import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";

const HOME_PATH = "/home";
const ADMIN_PATH = "/admin";
const ADMIN_RUN_QUESTIONS_PATH = `${ADMIN_PATH}/run-questions`;
const ADMIN_FEATURES_PATH = `${ADMIN_PATH}/features`;
const LEGACY_DASHBOARD_PATH = "/dashboard";
const LEGACY_DASHBOARD_SESSIONS_PATH = `${LEGACY_DASHBOARD_PATH}/sessions`;
const SESSION_PATH = "/session";
const NEW_SESSION_PATH = "/newsesh";
const SKILLS_PATH = "/skills";
const AGENT_TRACES_PATH = "/agent-traces";
const COMPASS_PATH = "/compass";
const DASHBOARD_GET_STARTED_LEGACY_PATH = `${LEGACY_DASHBOARD_PATH}/get-started`;
const GET_STARTED_PATH = "/get-started";
const TEAM_PATH = "/team";
const TEAM_INVITE_PATH = `${TEAM_PATH}/invite`;
const SETTINGS_ROOT_PATH = "/settings";
const SETTINGS_WORKSPACE_PATH = `${SETTINGS_ROOT_PATH}/workspace`;
const SETTINGS_GITHUB_PATH = `${SETTINGS_ROOT_PATH}/github`;
const SETTINGS_COMPASS_PATH = `${SETTINGS_ROOT_PATH}/compass`;
const SETTINGS_SESSIONS_PATH = `${SETTINGS_ROOT_PATH}/sessions`;
const SETTINGS_MEMBERS_PATH = `${SETTINGS_ROOT_PATH}/members`;
const SETTINGS_INVITATIONS_PATH = `${SETTINGS_ROOT_PATH}/invitations`;
const SETTINGS_ACCOUNT_PATH = `${SETTINGS_ROOT_PATH}/account`;
const SETTINGS_CREATE_WORKSPACE_PATH = `${SETTINGS_ROOT_PATH}/create-workspace`;

// Canonical routes shared by navigation, authentication, and analytics.
export const appRoutes = {
	home: () => HOME_PATH,
	admin: () => ADMIN_PATH,
	adminRunQuestions: () => ADMIN_RUN_QUESTIONS_PATH,
	adminFeatures: () => ADMIN_FEATURES_PATH,
	dashboard: () => LEGACY_DASHBOARD_PATH,
	dashboardSessions: () => LEGACY_DASHBOARD_SESSIONS_PATH,
	legacyDashboard: () => LEGACY_DASHBOARD_PATH,
	session: () => SESSION_PATH,
	workspaceSessions: (workspaceSlug: string) =>
		`/${encodeURIComponent(workspaceSlug)}/sessions`,
	sessionDetail: (sessionId: string) =>
		`${SESSION_PATH}/${encodeURIComponent(sessionId)}`,
	newSession: () => NEW_SESSION_PATH,
	newSessionDetail: (sessionId: string) =>
		`${NEW_SESSION_PATH}/${encodeURIComponent(sessionId)}`,
	repos: () => "/repos",
	repoDetail: (repoKey: string, sessionId?: string) => {
		const params = new URLSearchParams({ repo: repoKey });
		if (sessionId) params.set("session", sessionId);
		return `/repos?${params}`;
	},
	skills: () => SKILLS_PATH,
	skillDetail: (name: string, sessionId?: string, turnId?: string) => {
		const params = new URLSearchParams({ skill: name });
		if (sessionId) params.set("session", sessionId);
		if (sessionId && turnId) params.set("turn", turnId);
		return `${SKILLS_PATH}?${params}`;
	},
	agentTraces: () => AGENT_TRACES_PATH,
	compass: () => COMPASS_PATH,
	getStarted: () => GET_STARTED_PATH,
	dashboardGetStartedLegacy: () => DASHBOARD_GET_STARTED_LEGACY_PATH,
	team: () => TEAM_PATH,
	teamInvite: (token: string, workspaceSlug?: string) =>
		workspaceSlug
			? `/${encodeURIComponent(workspaceSlug)}/join/${encodeURIComponent(token)}`
			: `${TEAM_INVITE_PATH}/${encodeURIComponent(token)}`,
	settings: () => SETTINGS_ROOT_PATH,
	settingsRoot: () => SETTINGS_ROOT_PATH,
	settingsWorkspace: () => SETTINGS_WORKSPACE_PATH,
	settingsGitHub: () => SETTINGS_GITHUB_PATH,
	settingsCompass: () => SETTINGS_COMPASS_PATH,
	settingsSessions: () => SETTINGS_SESSIONS_PATH,
	settingsMembers: () => SETTINGS_MEMBERS_PATH,
	settingsInvitations: () => SETTINGS_INVITATIONS_PATH,
	settingsAccount: () => SETTINGS_ACCOUNT_PATH,
	settingsCreateWorkspace: () => SETTINGS_CREATE_WORKSPACE_PATH,
};

export function isSessionDetailPath(pathname: string) {
	const canonicalPathname = getCanonicalAppPath(pathname);
	const normalizedPathname =
		canonicalPathname.length > 1 && canonicalPathname.endsWith("/")
			? canonicalPathname.slice(0, -1)
			: canonicalPathname;
	if (normalizedPathname === NEW_SESSION_PATH) {
		return true;
	}

	const match = normalizedPathname.match(
		/^\/(?:session|newsesh)\/([^/]+)(?:\/v2)?$/u,
	);
	const sessionId = match?.[1];
	return (
		sessionId !== undefined && sessionId !== "full" && sessionId !== "split"
	);
}

// The open session on a /session/:id page (not /newsesh), for chrome that
// renders outside the route element, like the shell header's breadcrumb.
export function getSessionDetailId(pathname: string) {
	const match = getCanonicalAppPath(pathname).match(
		/^\/session\/([^/]+)(?:\/v2)?\/?$/u,
	);
	const sessionId = match?.[1];
	if (!sessionId || sessionId === "full" || sessionId === "split") {
		return null;
	}
	try {
		return decodeURIComponent(sessionId);
	} catch {
		return sessionId;
	}
}

export function isNewSessionPath(pathname: string) {
	const canonicalPathname = getCanonicalAppPath(pathname);
	const normalizedPathname =
		canonicalPathname.length > 1 && canonicalPathname.endsWith("/")
			? canonicalPathname.slice(0, -1)
			: canonicalPathname;

	return (
		normalizedPathname === NEW_SESSION_PATH ||
		normalizedPathname.startsWith(`${NEW_SESSION_PATH}/`)
	);
}

export function getCanonicalAppPath(pathname: string) {
	const workspaceSlug = getWorkspaceSlugFromPath(pathname);
	if (workspaceSlug) {
		const suffix = pathname.slice(workspaceSlug.length + 1) || "/";
		if (suffix === "/") return LEGACY_DASHBOARD_PATH;
		if (/^\/sessions(?:\/|$)/u.test(suffix))
			return SESSION_PATH + suffix.slice("/sessions".length);
		return suffix;
	}

	return pathname;
}

// Route definitions use workspace-independent paths; navigation resolves them
// through this helper (or useShellRoutePath for the demo).
export function getWorkspaceAppPath(
	workspaceSlug: string,
	path: string,
): string {
	const relativePath = getWorkspaceRelativePath(path);
	if (relativePath === null) return path;
	return `/${encodeURIComponent(workspaceSlug)}${relativePath}`;
}

export function getWorkspaceSlugFromPath(pathname: string): string | null {
	const segment = /^\/([^/?#]+)(?:\/|[?#]|$)/u.exec(pathname)?.[1];
	return segment && validateOrgSlug(segment) ? segment : null;
}

export function getWorkspacePathAfterSwitch(
	workspaceSlug: string,
	path: string,
): string {
	const previousSlug = getWorkspaceSlugFromPath(path);
	const destination = previousSlug
		? `/${encodeURIComponent(workspaceSlug)}${path.slice(previousSlug.length + 1)}`
		: getWorkspaceAppPath(workspaceSlug, path);
	// Session IDs belong to the previous workspace. Keep filters, reset selection.
	if (/^\/[^/]+\/(?:skills|repos|agent-traces)(?:[?#]|$)/u.test(destination)) {
		const url = new URL(destination, "http://workspace.local");
		url.searchParams.delete("session");
		url.searchParams.delete("turn");
		return `${url.pathname}${url.search}${url.hash}`;
	}
	return destination.replace(/^(\/[^/]+\/(?:sessions|newsesh))\/[^?#]+/u, "$1");
}

export function getWorkspaceRelativePath(path: string): string | null {
	const pathname = path.split(/[?#]/u, 1)[0] ?? path;
	const suffix = path.slice(pathname.length);
	if (pathname === "/" || pathname === "/dashboardy")
		return `/dashboard${suffix}`;
	if ([HOME_PATH, LEGACY_DASHBOARD_PATH].includes(pathname)) return path;
	if (/^\/(?:dashboard\/)?developers(?:\/|$)/u.test(pathname))
		return `/team${suffix}`;
	if (
		/^\/(?:dashboard\/)?(?:projects|errors|roi|analytics)(?:\/|$)/u.test(
			pathname,
		)
	)
		return `/sessions${suffix}`;
	if (/^\/dashboard\/sessions(?:\/|$)/u.test(pathname))
		return `${pathname.slice("/dashboard".length)}${suffix}`;
	if (/^\/session\/(?:full|split)(?:\/|$)/u.test(pathname))
		return `${pathname.replace(/^\/session\/(?:full|split)/u, "/sessions")}${suffix}`;
	if (/^\/(?:session|sessions)(?:\/|$)/u.test(pathname))
		return `${pathname.replace(/^\/session(?=\/|$)/u, "/sessions")}${suffix}`;
	if (pathname === TEAM_PATH || pathname === `${TEAM_PATH}/`) return path;
	if (
		/^\/(?:settings|skills|repos|agent-traces|newsesh)(?:\/|$)/u.test(pathname)
	)
		return path;
	return null;
}
