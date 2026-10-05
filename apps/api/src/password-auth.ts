import { BASE_ERROR_CODES, type BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
} from "better-auth/api";
import { z } from "zod";

/**
 * Email+password sign-in and sign-up are limited to the emails listed in
 * PASSWORD_AUTH_EMAILS (comma-separated, case-insensitive, `*` for everyone).
 * Everyone else signs in with an email code or a social provider.
 */
export type PasswordAuthAllowlist =
	| { kind: "everyone" }
	| { kind: "emails"; emails: ReadonlySet<string> };

export const PASSWORD_SIGN_IN_AVAILABLE_PATH = "/password-sign-in/available";

const PASSWORD_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

export function parsePasswordAuthEmails(
	value: string | undefined,
	extraEmails: ReadonlyArray<string | undefined> = [],
): PasswordAuthAllowlist {
	const entries = [...(value ?? "").split(","), ...extraEmails]
		.map((entry) => entry?.trim().toLowerCase() ?? "")
		.filter((entry) => entry.length > 0);
	if (entries.includes("*")) return { kind: "everyone" };
	return { kind: "emails", emails: new Set(entries) };
}

export function isPasswordAuthAllowed(
	allowlist: PasswordAuthAllowlist,
	email: unknown,
): boolean {
	if (typeof email !== "string") return false;
	const normalized = email.trim().toLowerCase();
	if (normalized.length === 0) return false;
	return allowlist.kind === "everyone" || allowlist.emails.has(normalized);
}

export function passwordAuthAllowlistPlugin(allowlist: PasswordAuthAllowlist) {
	return {
		id: "password-auth-allowlist",
		endpoints: {
			passwordSignInAvailable: createAuthEndpoint(
				PASSWORD_SIGN_IN_AVAILABLE_PATH,
				{
					method: "POST",
					body: z.object({ email: z.string().max(320) }),
				},
				async (ctx) =>
					ctx.json({
						available: isPasswordAuthAllowed(allowlist, ctx.body.email),
					}),
			),
		},
		hooks: {
			before: [
				{
					matcher: (ctx) => PASSWORD_PATHS.has(ctx.path ?? ""),
					handler: createAuthMiddleware(async (ctx) => {
						if (isPasswordAuthAllowed(allowlist, ctx.body?.email)) return;
						// Same work and error as an unknown email or a wrong password,
						// so the response does not reveal the allowlist.
						const password = ctx.body?.password;
						await ctx.context.password.hash(
							typeof password === "string" ? password : "",
						);
						throw APIError.from(
							"UNAUTHORIZED",
							BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD,
						);
					}),
				},
			],
		},
		rateLimit: [
			{
				pathMatcher: (path) => path === PASSWORD_SIGN_IN_AVAILABLE_PATH,
				window: 60,
				max: 20,
			},
		],
	} satisfies BetterAuthPlugin;
}
