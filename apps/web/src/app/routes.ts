import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import { appendWebAcquisitionSearchParams } from "@/lib/acquisition-attribution";

const HOME_PATH = "/home";
const LEGACY_DASHBOARD_PATH = "/dashboard";
const LEGACY_DASHBOARD_SESSIONS_PATH = `${LEGACY_DASHBOARD_PATH}/sessions`;
const SESSION_PATH = "/session";
const NEW_SESSION_PATH = "/newsesh";
const SKILLS_PATH = "/skills";
const DASHBOARD_GET_STARTED_LEGACY_PATH = `${LEGACY_DASHBOARD_PATH}/get-started`;
const GET_STARTED_PATH = "/get-started";
const TEAM_PATH = "/team";
const TEAM_INVITE_PATH = `${TEAM_PATH}/invite`;
const SETTINGS_ROOT_PATH = "/settings";
const SETTINGS_WORKSPACE_PATH = `${SETTINGS_ROOT_PATH}/workspace`;
const SETTINGS_MEMBERS_PATH = `${SETTINGS_ROOT_PATH}/members`;
const SETTINGS_INVITATIONS_PATH = `${SETTINGS_ROOT_PATH}/invitations`;
const SETTINGS_ACCOUNT_PATH = `${SETTINGS_ROOT_PATH}/account`;
const SETTINGS_CREATE_WORKSPACE_PATH = `${SETTINGS_ROOT_PATH}/create-workspace`;
const WRAPPED_TEAM_CARD_PATH = "/wrapped";
const DEV_WRAPPED_PATH = "/dev/wrapped";
const WRAPPED_RESUME_PATH = "/resume";
const WRAPPED_TEAM_CARD_STEP_QUERY_PARAM = "step";
const WRAPPED_TEAM_CARD_FINAL_STEP = "card";
export const WRAPPED_TEAM_CARD_STAGE_QUERY_PARAM = "stage";
export const WRAPPED_TEAM_CARD_SHARE_STAGE = "share";
export const WRAPPED_ROUTE_FLOW_QUERY_PARAM = "flow";
export const WRAPPED_ROUTE_CARD_PROFILE_FLOW = "card-profile";
export const WRAPPED_ROUTE_DESKTOP_READY_FLOW = "desktop-ready";
export const WRAPPED_ROUTE_SESSIONS_LANDED_FLOW = "sessions-landed";
export const WRAPPED_ROUTE_STORY_FLOW = "story";
// Decimal claim links arrive as ?claim=<token> on /wrapped. The token redeems
// for server-side entitlement; the URL itself is not the permission.
export const WRAPPED_DECIMAL_CLAIM_QUERY_PARAM = "claim";
// /wrapped?variant=decimal selects the Decimal card for entitled users. The
// default (param absent or "normal") keeps the normal card for everyone, even
// for users who hold Decimal entitlement.
export const WRAPPED_VARIANT_QUERY_PARAM = "variant";
export const WRAPPED_VARIANT_NORMAL = "normal" as const;
export const WRAPPED_VARIANT_DECIMAL = "decimal" as const;
export type WrappedVariant =
	| typeof WRAPPED_VARIANT_NORMAL
	| typeof WRAPPED_VARIANT_DECIMAL;

// These helpers are the canonical route surface for the Saturday wrapped loop.
// We keep them centralized so design, auth, analytics, and public sharing all
// talk about the same URLs instead of rebuilding strings in multiple places.
export const appRoutes = {
	home: () => HOME_PATH,
	dashboard: () => HOME_PATH,
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
	skills: () => SKILLS_PATH,
	getStarted: () => GET_STARTED_PATH,
	dashboardGetStartedLegacy: () => DASHBOARD_GET_STARTED_LEGACY_PATH,
	team: () => TEAM_PATH,
	teamInvite: (token: string, workspaceSlug?: string) =>
		workspaceSlug
			? `/${encodeURIComponent(workspaceSlug)}/join/${encodeURIComponent(token)}`
			: `${TEAM_INVITE_PATH}/${encodeURIComponent(token)}`,
	settings: () => SETTINGS_ROOT_PATH,
	settingsRoot: () => SETTINGS_ROOT_PATH,
	wrappedTeamCard: () => WRAPPED_TEAM_CARD_PATH,
	wrappedTeamCardShare: () => getWrappedTeamCardSharePath(),
	wrappedCardProfile: (search?: string) => getWrappedCardProfilePath(search),
	wrappedDesktopReady: (search?: string) => getWrappedDesktopReadyPath(search),
	wrappedSessionsLanded: (search?: string) =>
		getWrappedSessionsLandedPath(search),
	wrappedStory: (search?: string) => getWrappedStoryPath(search),
	devWrapped: () => DEV_WRAPPED_PATH,
	wrappedPublic: (publicId: string) =>
		`${WRAPPED_TEAM_CARD_PATH}/${encodeURIComponent(publicId)}`,
	wrappedResume: (token: string) =>
		`${WRAPPED_RESUME_PATH}/${encodeURIComponent(token)}`,
	wrappedTeamCardFromShare: (
		shareId: string,
		sourceSearch?: string,
		referrerDomain?: string | null,
	) => getWrappedTeamCardFromSharePath(shareId, sourceSearch, referrerDomain),
	settingsWorkspace: () => SETTINGS_WORKSPACE_PATH,
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
		if (suffix === "/") return SESSION_PATH;
		if (suffix === "/dashboard") return HOME_PATH;
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
	return destination.replace(/^(\/[^/]+\/(?:sessions|newsesh))\/[^?#]+/u, "$1");
}

export function getWorkspaceRelativePath(path: string): string | null {
	const pathname = path.split(/[?#]/u, 1)[0] ?? path;
	const suffix = path.slice(pathname.length);
	if (pathname === "/" || pathname === "/dashboardy")
		return `/sessions${suffix}`;
	if ([HOME_PATH, LEGACY_DASHBOARD_PATH].includes(pathname))
		return `/dashboard${suffix}`;
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
	if (/^\/(?:settings|skills|newsesh)(?:\/|$)/u.test(pathname)) return path;
	return null;
}

function getWrappedTeamCardFromSharePath(
	shareId: string,
	sourceSearch?: string,
	referrerDomain?: string | null,
) {
	const searchParams = new URLSearchParams();
	searchParams.set("share_id", shareId);
	appendWebAcquisitionSearchParams(searchParams, sourceSearch, referrerDomain);

	return `${WRAPPED_TEAM_CARD_PATH}?${searchParams.toString()}`;
}

export function getWrappedCardProfilePath(search?: string) {
	return getWrappedFlowPath(WRAPPED_ROUTE_CARD_PROFILE_FLOW, search);
}

export function getWrappedDesktopReadyPath(search?: string) {
	return getWrappedFlowPath(WRAPPED_ROUTE_DESKTOP_READY_FLOW, search);
}

export function getWrappedSessionsLandedPath(search?: string) {
	return getWrappedFlowPath(WRAPPED_ROUTE_SESSIONS_LANDED_FLOW, search);
}

export function getWrappedStoryPath(search?: string) {
	return getWrappedFlowPath(WRAPPED_ROUTE_STORY_FLOW, search);
}

function getWrappedFlowPath(flow: string, search?: string) {
	const searchParams = new URLSearchParams(search);
	searchParams.set(WRAPPED_ROUTE_FLOW_QUERY_PARAM, flow);

	return `${WRAPPED_TEAM_CARD_PATH}?${searchParams.toString()}`;
}

function getWrappedTeamCardSharePath() {
	const searchParams = new URLSearchParams();
	searchParams.set(WRAPPED_ROUTE_FLOW_QUERY_PARAM, "story");
	searchParams.set(
		WRAPPED_TEAM_CARD_STEP_QUERY_PARAM,
		WRAPPED_TEAM_CARD_FINAL_STEP,
	);
	searchParams.set(
		WRAPPED_TEAM_CARD_STAGE_QUERY_PARAM,
		WRAPPED_TEAM_CARD_SHARE_STAGE,
	);

	return `${WRAPPED_TEAM_CARD_PATH}?${searchParams.toString()}`;
}

export function isWrappedTeamCardShareTarget(search: string | URLSearchParams) {
	const searchParams =
		search instanceof URLSearchParams ? search : new URLSearchParams(search);

	return (
		searchParams.get(WRAPPED_TEAM_CARD_STEP_QUERY_PARAM) ===
			WRAPPED_TEAM_CARD_FINAL_STEP &&
		searchParams.get(WRAPPED_TEAM_CARD_STAGE_QUERY_PARAM) ===
			WRAPPED_TEAM_CARD_SHARE_STAGE
	);
}

// Public wrapped pages live at /wrapped/:id. New links use username-style ids,
// while older UUID ids still resolve because the backend key is plain text.
export function getWrappedPublicIdFromPath(pathname: string) {
	const routeMatch = pathname.match(/^\/wrapped\/([^/]+)\/?$/u);
	const encodedPublicId = routeMatch?.[1];

	if (!encodedPublicId) {
		return null;
	}

	try {
		return decodeURIComponent(encodedPublicId);
	} catch {
		return null;
	}
}

// Legacy launch links used /wrapped/share/:id. Keep that parser separate so
// App.tsx can redirect old links to the canonical /wrapped/:id route without
// mixing legacy compatibility into the main public-route matcher.
export function getLegacyWrappedPublicIdFromPath(pathname: string) {
	const routeMatch = pathname.match(/^\/wrapped\/share\/([^/]+)\/?$/u);
	const encodedPublicId = routeMatch?.[1];

	if (!encodedPublicId) {
		return null;
	}

	try {
		return decodeURIComponent(encodedPublicId);
	} catch {
		return null;
	}
}

// Post-auth attribution stays in a query param on /wrapped. We parse it
// separately from the public route because it is for analytics and continuation,
// not for rendering the public page itself.
export function getWrappedShareIdFromSearch(search: string) {
	const searchParams = new URLSearchParams(search);
	const shareId = searchParams.get("share_id");

	if (!shareId) {
		return null;
	}

	return shareId;
}

export function getWrappedDecimalClaimTokenFromSearch(
	search: string | URLSearchParams,
): string | null {
	const searchParams =
		search instanceof URLSearchParams ? search : new URLSearchParams(search);
	const token = searchParams.get(WRAPPED_DECIMAL_CLAIM_QUERY_PARAM);

	if (typeof token !== "string") {
		return null;
	}

	const trimmed = token.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function getWrappedVariantFromSearch(
	search: string | URLSearchParams,
): WrappedVariant {
	const searchParams =
		search instanceof URLSearchParams ? search : new URLSearchParams(search);
	const raw = searchParams.get(WRAPPED_VARIANT_QUERY_PARAM);

	return raw === WRAPPED_VARIANT_DECIMAL
		? WRAPPED_VARIANT_DECIMAL
		: WRAPPED_VARIANT_NORMAL;
}

// Resume links stay outside /wrapped because they are not a replay surface.
// They are a small auth-and-continue route whose only job is to return the
// signed-in user to the upload step on desktop.
export function getWrappedResumeTokenFromPath(pathname: string) {
	const routeMatch = pathname.match(/^\/resume\/([^/]+)\/?$/u);
	const encodedToken = routeMatch?.[1];

	if (!encodedToken) {
		return null;
	}

	try {
		return decodeURIComponent(encodedToken);
	} catch {
		return null;
	}
}
