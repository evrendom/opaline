const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIE_NAMES = new Set([
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
]);

export const CSRF_ORIGIN_FORBIDDEN_CODE = "CSRF_ORIGIN_FORBIDDEN";

export function enforceCookieCsrfOrigin(input: {
	allowedOrigins: readonly string[];
	request: Request;
}): Response | null {
	const { request } = input;
	if (
		SAFE_METHODS.has(request.method.toUpperCase()) ||
		!hasSessionCookie(request.headers) ||
		hasExplicitCliCredential(request.headers)
	) {
		return null;
	}

	const origin = request.headers.get("Origin");
	if (origin && input.allowedOrigins.includes(origin)) {
		return null;
	}

	return Response.json(
		{
			error: {
				code: CSRF_ORIGIN_FORBIDDEN_CODE,
				message:
					"Cookie-authenticated unsafe requests require an allowed Origin header.",
			},
		},
		{ status: 403 },
	);
}

function hasSessionCookie(headers: Headers): boolean {
	const cookieHeader = headers.get("Cookie");
	if (!cookieHeader) return false;

	return cookieHeader.split(";").some((cookie) => {
		const separatorIndex = cookie.indexOf("=");
		if (separatorIndex <= 0) return false;
		const name = cookie.slice(0, separatorIndex).trim();
		const value = cookie.slice(separatorIndex + 1).trim();
		return SESSION_COOKIE_NAMES.has(name) && value.length > 0;
	});
}

function hasExplicitCliCredential(headers: Headers): boolean {
	const apiKey = headers.get("X-API-Key")?.trim();
	if (apiKey) return true;

	const authorization = headers.get("Authorization")?.trim();
	return authorization ? /^Bearer\s+\S+/iu.test(authorization) : false;
}
