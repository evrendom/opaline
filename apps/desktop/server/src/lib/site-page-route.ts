import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";

export type SitePageRoute =
	| { kind: "app" }
	| { kind: "workspace"; slug: string }
	| { kind: "not-found" };

// Keep these paths aligned with AppRouter and the legacy navigation aliases.
// Unlike a blanket SPA fallback, this cannot turn arbitrary public URLs into
// successful login pages. Workspace existence is checked at the HTTP boundary.
const SETTINGS_PATH =
	/^\/settings(?:\/(?:account|workspace|github|sessions|reports|members|team|create-workspace))?$/u;
const SESSION_PATH = /^\/(?:session|sessions|newsesh)(?:\/[^/]+(?:\/v2)?)?$/u;
const LEGACY_PATH =
	/^\/(?:dashboard(?:\/(?:sessions(?:\/[^/]+)?|developers(?:\/[^/]+)?|projects|errors|roi|analytics))?|dashboardy|developers(?:\/[^/]+)?|projects|errors|roi|analytics|session\/full\/[^/]+)$/u;
const AUTH_PATH =
	/^\/(?:login|signup|sign-up|register|reset-password|device|welcome)$/u;

export function getSitePageRoute(pathname: string): SitePageRoute {
	let path: string;
	try {
		path = decodeURIComponent(pathname).replace(/\/$/u, "");
	} catch {
		return { kind: "not-found" };
	}
	if (/[\\\p{Cc}]/u.test(path)) return { kind: "not-found" };
	if (
		AUTH_PATH.test(path) ||
		SETTINGS_PATH.test(path) ||
		SESSION_PATH.test(path) ||
		LEGACY_PATH.test(path) ||
		/^\/(?:admin(?:\/(?:run-questions|features))?|announcement|home|compass|skills|repos|mcp|team)$/u.test(
			path,
		)
	)
		return { kind: "app" };

	const match = /^\/([^/]+)(\/.*)?$/u.exec(path);
	const slug = match?.[1];
	const suffix = match?.[2] ?? "";
	if (!slug || !validateOrgSlug(slug)) return { kind: "not-found" };
	if (
		suffix === "" ||
		/^\/(?:home|dashboard|compass|skills|repos|mcp|team)$/u.test(suffix) ||
		/^\/reports\/[^/]+$/u.test(suffix) ||
		/^\/(?:sessions|newsesh)(?:\/[^/]+(?:\/v2)?)?$/u.test(suffix) ||
		SETTINGS_PATH.test(suffix)
	)
		return { kind: "workspace", slug };
	return { kind: "not-found" };
}
