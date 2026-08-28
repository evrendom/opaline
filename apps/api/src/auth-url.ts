export const AUTH_BASE_PATH = "/api/auth";
export type OAuthProvider = "github" | "google";

export function normalizeAuthBaseURL(appURL: string): string {
	const url = new URL(appURL);
	if (url.pathname !== "/" || url.search || url.hash) {
		throw new Error("APP_URL must be an origin without a path, query, or hash");
	}

	return url.origin;
}

/**
 * Better Auth builds social redirect URIs as
 * `{baseURL}{basePath}/callback/{provider}`. Keep this operations-facing helper
 * on the same constants used by createAuth so provider-console registrations
 * and runtime configuration cannot document different paths.
 */
export function getOAuthProviderCallbackURL(
	appURL: string,
	provider: OAuthProvider,
): string {
	return `${normalizeAuthBaseURL(appURL)}${AUTH_BASE_PATH}/callback/${provider}`;
}
