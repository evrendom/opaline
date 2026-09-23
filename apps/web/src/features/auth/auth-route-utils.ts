import { CliConnectionIdSchema } from "@rudel/api-routes";
import { appRoutes } from "@/app/routes";
import type { authClient } from "@/lib/auth-client";

export type AppSession = ReturnType<typeof authClient.useSession>["data"];
const PENDING_SIGNUP_REDIRECT_PARAM = "signup_redirect";
const RELATIVE_URL_BASE = "https://rudel.local";
const RELATIVE_URL_ORIGIN = new URL(RELATIVE_URL_BASE).origin;
const REDIRECT_ENCODED_AMBIGUOUS_CHARACTER_PATTERN =
	/%(?:2f|5c|[01][0-9a-f]|7f)/i;
function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const characterCode = character.charCodeAt(0);
		if (characterCode <= 31 || characterCode === 127) {
			return true;
		}
	}

	return false;
}

function normalizeValidRelativeRedirect(
	redirect: string | null,
): string | null {
	if (!redirect) {
		return null;
	}

	if (!redirect.startsWith("/") || redirect.startsWith("//")) {
		return null;
	}

	if (
		redirect.includes("\\") ||
		containsControlCharacter(redirect) ||
		REDIRECT_ENCODED_AMBIGUOUS_CHARACTER_PATTERN.test(redirect)
	) {
		return null;
	}

	try {
		const resolvedRedirect = new URL(redirect, RELATIVE_URL_BASE);
		if (resolvedRedirect.origin !== RELATIVE_URL_ORIGIN) {
			return null;
		}
	} catch {
		return null;
	}

	return redirect;
}

export function getDeviceUserCode(search?: string): string | null {
	const params = new URLSearchParams(search ?? window.location.search);
	return params.get("user_code");
}

export function isResetPasswordPath(pathname?: string): boolean {
	return (pathname ?? window.location.pathname) === "/reset-password";
}

export function isGetStartedPath(pathname = window.location.pathname): boolean {
	return (
		pathname === appRoutes.getStarted() ||
		pathname === appRoutes.dashboardGetStartedLegacy()
	);
}

export function getValidRedirect(search?: string): string | null {
	const params = new URLSearchParams(search ?? window.location.search);
	const validRedirect = normalizeValidRelativeRedirect(params.get("redirect"));
	if (!validRedirect) {
		return null;
	}

	return validRedirect;
}

export function getPendingSignupRedirect(search?: string): string | null {
	const params = new URLSearchParams(search ?? window.location.search);
	return normalizeValidRelativeRedirect(
		params.get(PENDING_SIGNUP_REDIRECT_PARAM),
	);
}

function getDirectAuthDestination(
	pathname = window.location.pathname,
	search = window.location.search,
): string | null {
	const userCode = getDeviceUserCode(search);
	if (userCode) {
		const connectionId = getCliConnectionId(search);
		return `/welcome?user_code=${encodeURIComponent(userCode)}${connectionId ? `&connect=${encodeURIComponent(connectionId)}` : ""}`;
	}

	const redirect = getValidRedirect(search);
	if (redirect) {
		return redirect;
	}

	if (pathname !== "/" && pathname !== "") {
		return `${pathname}${search}`;
	}

	return null;
}

export function getCliConnectionId(
	search = window.location.search,
): string | null {
	const parsed = CliConnectionIdSchema.safeParse(
		new URLSearchParams(search).get("connect"),
	);
	return parsed.success ? parsed.data : null;
}

export function getEmailSignupSuccessDestination(
	pathname = window.location.pathname,
	search = window.location.search,
): string {
	return getDirectAuthDestination(pathname, search) ?? "/welcome";
}

export function getEmailLoginSuccessDestination(
	pathname = window.location.pathname,
	search = window.location.search,
): string {
	return getDirectAuthDestination(pathname, search) ?? "/";
}

export function getAuthCallbackURL(
	pathname = window.location.pathname,
	search = window.location.search,
): string {
	const directDestination = getDirectAuthDestination(pathname, search);

	if (!directDestination) {
		return "/";
	}

	if (directDestination.startsWith("/welcome?user_code=")) {
		return directDestination;
	}

	return `/?redirect=${encodeURIComponent(directDestination)}`;
}

export function getEmailSignupVerificationCallbackURL(
	pathname = window.location.pathname,
	search = window.location.search,
): string {
	return getEmailSignupSuccessDestination(pathname, search);
}

export function getSocialSignupRedirectOptions(
	pathname = window.location.pathname,
	search = window.location.search,
): {
	callbackURL: string;
	newUserCallbackURL?: string;
} {
	const directDestination = getDirectAuthDestination(pathname, search);
	if (directDestination) {
		return {
			callbackURL: directDestination,
			newUserCallbackURL: directDestination,
		};
	}

	return {
		callbackURL: "/",
		newUserCallbackURL: "/welcome",
	};
}

export function getSocialLoginRedirectOptions(
	pathname = window.location.pathname,
	search = window.location.search,
): {
	callbackURL: string;
	newUserCallbackURL?: string;
} {
	return {
		callbackURL: getAuthCallbackURL(pathname, search),
		newUserCallbackURL:
			getDirectAuthDestination(pathname, search) ?? "/welcome",
	};
}

export function primePendingSignupRedirect(
	destination: string,
	pathname = window.location.pathname,
	search = window.location.search,
) {
	if (
		pathname !== "/" ||
		getDeviceUserCode(search) ||
		getValidRedirect(search)
	) {
		return;
	}

	const redirect = normalizeValidRelativeRedirect(destination);
	if (!redirect) {
		return;
	}

	const url = new URL(window.location.href);
	url.searchParams.set(PENDING_SIGNUP_REDIRECT_PARAM, redirect);
	window.history.replaceState(
		window.history.state,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
}

export function clearPendingSignupRedirect() {
	const url = new URL(window.location.href);
	if (!url.searchParams.has(PENDING_SIGNUP_REDIRECT_PARAM)) {
		return;
	}

	url.searchParams.delete(PENDING_SIGNUP_REDIRECT_PARAM);
	window.history.replaceState(
		window.history.state,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
}

export function getSessionUserId(
	session: AppSession | null | undefined,
): string | null {
	return session?.user &&
		"id" in session.user &&
		typeof session.user.id === "string"
		? session.user.id
		: null;
}

export function getSessionUserEmail(
	session: AppSession | null | undefined,
): string | undefined {
	return session?.user &&
		"email" in session.user &&
		typeof session.user.email === "string"
		? session.user.email
		: undefined;
}

export function getSessionUserName(
	session: AppSession | null | undefined,
): string | undefined {
	return session?.user &&
		"name" in session.user &&
		typeof session.user.name === "string"
		? session.user.name
		: undefined;
}
