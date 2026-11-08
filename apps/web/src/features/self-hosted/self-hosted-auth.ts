import { isValidAuthEmail } from "@/features/auth/email-code-auth";
import type { SelfHostInfo } from "./self-host-info";

export type SelfHostedAuthMode = "sign-in" | "sign-up";
export type SocialProvider = "github" | "google";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const LOGIN_LINK_INVALID = "LOGIN_LINK_INVALID";
export const INVITE_COOKIE = "opaline_invite";
export const INVITE_REQUIRED = "INVITE_REQUIRED";
const INVITE_COOKIE_MAX_AGE_SECONDS = 86_400;
const INVITE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const INVITE_PATHS = [
	/^\/team\/invite\/([^/]+)\/?$/u,
	/^\/[^/]+\/join\/([^/]+)\/?$/u,
	/^\/invitation\/([^/]+)\/?$/u,
];

const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["github", "google"];

export function selfHostedSocialProviders(
	info: SelfHostInfo,
): SocialProvider[] {
	return SOCIAL_PROVIDERS.filter((provider) =>
		info.auth.social.includes(provider),
	);
}

export function isInvitePath(pathname: string): boolean {
	return INVITE_PATHS.some((pattern) => pattern.test(pathname));
}

function inviteInPath(pathname: string): string | null {
	for (const pattern of INVITE_PATHS) {
		const raw = pattern.exec(pathname)?.[1];
		if (!raw) continue;
		try {
			const invite = decodeURIComponent(raw);
			return INVITE_PATTERN.test(invite) ? invite : null;
		} catch {
			return null;
		}
	}
	return null;
}

export function inviteFromLocation(
	pathname: string,
	search: string,
): string | null {
	const redirect = new URLSearchParams(search).get("redirect");
	return (
		inviteInPath(pathname) ??
		(redirect?.startsWith("/") && !redirect.startsWith("//")
			? inviteInPath(redirect.split(/[?#]/u)[0] ?? "")
			: null)
	);
}

function writeInviteCookie(value: string, maxAgeSeconds: number): void {
	const secure = window.location.protocol === "https:" ? "; Secure" : "";
	// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API does not exist on plain-http LAN origins, where self-hosted servers often run
	document.cookie = `${INVITE_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function rememberInvite(invite: string | null): void {
	if (!invite || !INVITE_PATTERN.test(invite)) return;
	writeInviteCookie(invite, INVITE_COOKIE_MAX_AGE_SECONDS);
}

export function forgetInvite(): void {
	writeInviteCookie("", 0);
}

export type SelfHostedSignUp =
	| "open"
	| "invite"
	| "needs-invite"
	| "needs-setup";

export function selfHostedSignUp(
	info: SelfHostInfo,
	invite: string | null,
): SelfHostedSignUp {
	if (info.auth.openSignup) return "open";
	if (!info.setupComplete) return "needs-setup";
	return invite ? "invite" : "needs-invite";
}

export function initialSelfHostedAuthMode(
	info: SelfHostInfo,
	pathname: string,
): SelfHostedAuthMode {
	return !info.setupComplete || isInvitePath(pathname) ? "sign-up" : "sign-in";
}

export function selfHostedAuthCopy(
	mode: SelfHostedAuthMode,
	{
		info,
		pathname,
		search,
	}: { info: SelfHostInfo; pathname: string; search: string },
): { title: string; description: string } {
	if (mode === "sign-up") {
		const signUp = selfHostedSignUp(info, inviteFromLocation(pathname, search));
		if (signUp === "needs-setup")
			return {
				title: "Finish setting up this server",
				description:
					"Run “opaline server” on the machine that runs it. That creates the owner account and prints a sign-in link.",
			};
		if (signUp === "needs-invite")
			return {
				title: "Ask for an invite",
				description: "This Opaline server is invite-only.",
			};
	}
	if (new URLSearchParams(search).has("user_code"))
		return mode === "sign-in"
			? {
					title: "Sign in to connect your terminal",
					description:
						"Then approve the request your terminal opened on this page.",
				}
			: {
					title: "Create your account",
					description:
						"Then approve the request your terminal opened on this page.",
				};
	if (mode === "sign-in")
		return {
			title: "Welcome back",
			description: "Sign in to this Opaline server.",
		};
	if (isInvitePath(pathname))
		return {
			title: "Join your team",
			description:
				"Create an account on this Opaline server to accept the invitation.",
		};
	if (!info.setupComplete)
		return {
			title: "Create the first account",
			description:
				"The first account on this Opaline server becomes its owner.",
		};
	return {
		title: "Create your account",
		description: "Create an account on this Opaline server.",
	};
}

export function readLoginLinkError(search: string): string | null {
	return new URLSearchParams(search).get("error") === LOGIN_LINK_INVALID
		? "This sign-in link expired or was already used. Run “opaline server open” on the server’s machine for a new one."
		: null;
}

export function validateCredentials(input: {
	mode: SelfHostedAuthMode;
	email: string;
	password: string;
}): string | null {
	if (!isValidAuthEmail(input.email)) return "Enter a valid email address.";
	if (input.password.length === 0) return "Enter your password.";
	if (input.mode === "sign-in") return null;
	if (input.password.length < MIN_PASSWORD_LENGTH)
		return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
	if (input.password.length > MAX_PASSWORD_LENGTH)
		return `Use a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
	return null;
}

function readField(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null && key in value
		? Reflect.get(value, key)
		: undefined;
}

export function describeAuthError(
	error: unknown,
	mode: SelfHostedAuthMode,
): string {
	if (!error)
		return "Could not reach the Opaline server. Check that it is running, then try again.";
	const rawCode = readField(error, "code");
	const code = typeof rawCode === "string" ? rawCode : "";
	if (
		code === "INVALID_EMAIL_OR_PASSWORD" ||
		code === "CREDENTIAL_ACCOUNT_NOT_FOUND"
	)
		return "That email and password do not match an account on this server.";
	if (code === INVITE_REQUIRED)
		return "This server is invite-only. Open the invite link a workspace owner or admin sent you, then create your account there.";
	if (code.startsWith("USER_ALREADY_EXISTS"))
		return "An account with this email already exists. Sign in instead.";
	if (code === "PASSWORD_TOO_SHORT")
		return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
	if (code === "PASSWORD_TOO_LONG")
		return `Use a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
	if (code === "INVALID_EMAIL") return "Enter a valid email address.";
	if (code === "INVALID_OTP" || code === "OTP_EXPIRED")
		return "That code is wrong or expired. Request a new one.";
	if (readField(error, "status") === 429)
		return "Too many attempts. Wait a minute, then try again.";
	const message = readField(error, "message");
	return (
		(typeof message === "string" ? message.trim() : "") ||
		(mode === "sign-in" ? "Sign in failed." : "Could not create your account.")
	);
}

export async function runAuthRequest(
	request: () => Promise<{ error: unknown }>,
	mode: SelfHostedAuthMode,
): Promise<string | null> {
	try {
		const { error } = await request();
		return error ? describeAuthError(error, mode) : null;
	} catch {
		return describeAuthError(null, mode);
	}
}
