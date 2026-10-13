import { ORPCError } from "@orpc/server";
import {
	authMiddleware,
	os,
	settingsMutationMiddleware,
} from "../middleware.js";
import {
	listUsageDigestPreferences,
	setUsageDigestPreference,
} from "../services/usage-digest/usage-digest.service.js";

export const usageDigestRouter = {
	preferences: os.usageDigest.preferences
		.use(authMiddleware)
		.handler(async ({ context }) => ({
			workspaces: await listUsageDigestPreferences(context.user.id),
		})),
	setPreference: os.usageDigest.setPreference
		.use(authMiddleware)
		.use(settingsMutationMiddleware)
		.handler(async ({ context, input }) => {
			const changed = await setUsageDigestPreference({
				userId: context.user.id,
				...input,
			});
			if (!changed)
				throw new ORPCError("NOT_FOUND", {
					message: "You are not a member of this workspace",
				});
			return { success: true as const };
		}),
};
