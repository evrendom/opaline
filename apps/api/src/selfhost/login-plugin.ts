import { getLogger } from "@logtape/logtape";
import { BASE_ERROR_CODES, type BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { isSelfHosted } from "../lib/self-hosted.js";

export const SELF_HOSTED_LOGIN_PATH = "/selfhost/login";
export const SELF_HOSTED_PASSWORD_PATH = "/selfhost/password";
export const SELF_HOSTED_PASSWORD_STATUS_PATH = "/selfhost/password-status";
export const LOGIN_LINK_INVALID = "/login?error=LOGIN_LINK_INVALID";
export const LINK_SESSION_TTL_SECONDS = 3600;
export const CURRENT_PASSWORD_REQUIRED = "CURRENT_PASSWORD_REQUIRED";

const LINK_SESSION_PREFIX = "selfhost-link-session:";
const logger = getLogger(["rudel", "api", "selfhost"]);

export function linkSessionIdentifier(sessionId: string): string {
	return `${LINK_SESSION_PREFIX}${sessionId}`;
}

type LinkSessionLookup = {
	internalAdapter: {
		findVerificationValue(
			identifier: string,
		): Promise<{ value: string; expiresAt: Date } | null>;
	};
};

async function openedByLinkRecently(
	context: LinkSessionLookup,
	session: { id: string; userId: string },
): Promise<boolean> {
	const marker = await context.internalAdapter.findVerificationValue(
		linkSessionIdentifier(session.id),
	);
	return (
		marker !== null &&
		marker.value === session.userId &&
		new Date(marker.expiresAt).getTime() > Date.now()
	);
}

export function selfHostedLoginPlugin(
	consume: (token: string) => Promise<string | null>,
) {
	return {
		id: "self-hosted-login",
		endpoints: {
			selfHostedLogin: createAuthEndpoint(
				SELF_HOSTED_LOGIN_PATH,
				{
					method: "GET",
					query: z.object({ token: z.string().max(256).optional() }),
				},
				async (ctx) => {
					if (!isSelfHosted()) throw new APIError("NOT_FOUND");
					const userId = ctx.query.token
						? await consume(ctx.query.token)
						: null;
					const user = userId
						? await ctx.context.internalAdapter.findUserById(userId)
						: null;
					if (!user) throw ctx.redirect(LOGIN_LINK_INVALID);
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					if (!session) throw ctx.redirect(LOGIN_LINK_INVALID);
					await ctx.context.internalAdapter.createVerificationValue({
						identifier: linkSessionIdentifier(session.id),
						value: user.id,
						expiresAt: new Date(Date.now() + LINK_SESSION_TTL_SECONDS * 1000),
					});
					logger.info("User {userId} signed in with a sign-in link", {
						userId: user.id,
					});
					await setSessionCookie(ctx, { session, user });
					throw ctx.redirect("/");
				},
			),
			selfHostedPasswordStatus: createAuthEndpoint(
				SELF_HOSTED_PASSWORD_STATUS_PATH,
				{ method: "GET", use: [sessionMiddleware] },
				async (ctx) => {
					if (!isSelfHosted()) throw new APIError("NOT_FOUND");
					const { session } = ctx.context.session;
					return ctx.json({
						currentPasswordRequired: !(await openedByLinkRecently(
							ctx.context,
							session,
						)),
					});
				},
			),
			selfHostedPassword: createAuthEndpoint(
				SELF_HOSTED_PASSWORD_PATH,
				{
					method: "POST",
					use: [sessionMiddleware],
					body: z.object({
						newPassword: z.string(),
						currentPassword: z.string().optional(),
					}),
				},
				async (ctx) => {
					if (!isSelfHosted()) throw new APIError("NOT_FOUND");
					const { newPassword, currentPassword } = ctx.body;
					const { session, user } = ctx.context.session;
					const { minPasswordLength, maxPasswordLength } =
						ctx.context.password.config;
					if (newPassword.length < minPasswordLength)
						throw APIError.from(
							"BAD_REQUEST",
							BASE_ERROR_CODES.PASSWORD_TOO_SHORT,
						);
					if (newPassword.length > maxPasswordLength)
						throw APIError.from(
							"BAD_REQUEST",
							BASE_ERROR_CODES.PASSWORD_TOO_LONG,
						);
					const credential = (
						await ctx.context.internalAdapter.findAccounts(user.id)
					).find((account) => account.providerId === "credential");
					const byLink = await openedByLinkRecently(ctx.context, session);
					if (currentPassword) {
						const matches = credential?.password
							? await ctx.context.password.verify({
									hash: credential.password,
									password: currentPassword,
								})
							: false;
						if (!matches)
							throw APIError.from(
								"BAD_REQUEST",
								BASE_ERROR_CODES.INVALID_PASSWORD,
							);
					} else if (!byLink) {
						throw new APIError("BAD_REQUEST", {
							code: CURRENT_PASSWORD_REQUIRED,
							message:
								"Enter your current password, or open a new sign-in link and set the password within an hour.",
						});
					}
					const hash = await ctx.context.password.hash(newPassword);
					if (credential)
						await ctx.context.internalAdapter.updateAccount(credential.id, {
							password: hash,
						});
					else
						await ctx.context.internalAdapter.linkAccount({
							userId: user.id,
							providerId: "credential",
							accountId: user.id,
							password: hash,
						});
					await ctx.context.internalAdapter.deleteVerificationByIdentifier(
						linkSessionIdentifier(session.id),
					);
					await ctx.context.internalAdapter.deleteSessions(user.id);
					const { activeOrganizationId } = session as {
						activeOrganizationId?: string | null;
					};
					const fresh = await ctx.context.internalAdapter.createSession(
						user.id,
						false,
						activeOrganizationId ? { activeOrganizationId } : undefined,
						true,
					);
					if (!fresh)
						throw APIError.from(
							"INTERNAL_SERVER_ERROR",
							BASE_ERROR_CODES.FAILED_TO_GET_SESSION,
						);
					await setSessionCookie(ctx, { session: fresh, user });
					logger.info(
						"User {userId} changed their password ({how}); other sessions signed out",
						{
							userId: user.id,
							how: currentPassword
								? "with the current password"
								: "after a sign-in link",
						},
					);
					return ctx.json({ status: true });
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
