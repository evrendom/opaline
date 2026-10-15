import { ORPCError } from "@orpc/server";
import { sqlClient } from "../../db.js";
import { adminMiddleware, os } from "../../middleware.js";
import {
	listWorkspaceFeatures,
	setWorkspaceFeature,
	WorkspaceNotFoundError,
} from "../../services/workspace-features.js";

/**
 * The admin features page: members of Opaline's admin organization see every
 * workspace's feature states and set or remove a workspace's switch.
 */
const procedures = os.admin.workspaceFeatures;

export const workspaceFeaturesAdminRouter = {
	list: procedures.list
		.use(adminMiddleware)
		.handler(({ input }) => listWorkspaceFeatures(sqlClient, input)),
	set: procedures.set
		.use(adminMiddleware)
		.handler(async ({ input, context }) => {
			try {
				return await setWorkspaceFeature(sqlClient, {
					...input,
					userId: context.user.id,
				});
			} catch (error) {
				if (error instanceof WorkspaceNotFoundError)
					throw new ORPCError("NOT_FOUND", { message: error.message });
				throw error;
			}
		}),
};
