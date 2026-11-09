import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { isSelfHosted } from "../lib/self-hosted.js";

export const SELF_HOSTED_LOGIN_PATH = "/selfhost/login";
export const LOGIN_LINK_INVALID = "/login?error=LOGIN_LINK_INVALID";

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
					query: z.object({ token: z.unknown().optional() }),
				},
				async (ctx) => {
					if (!isSelfHosted()) throw new APIError("NOT_FOUND");
					const token = ctx.query.token;
					const userId =
						typeof token === "string" && token !== "" && token.length <= 256
							? await consume(token)
							: null;
					const user = userId
						? await ctx.context.internalAdapter.findUserById(userId)
						: null;
					if (!user) throw ctx.redirect(LOGIN_LINK_INVALID);
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					if (!session) throw ctx.redirect(LOGIN_LINK_INVALID);
					await setSessionCookie(ctx, { session, user });
					throw ctx.redirect("/");
				},
			),
		},
	} satisfies BetterAuthPlugin;
}
