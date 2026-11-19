import { ORPCError } from "@orpc/server";
import { sqlClient } from "../db.js";
import { ingestAuthMiddleware, orgMiddleware, os } from "../middleware.js";
import { getRepositorySettings } from "../services/repository-settings.js";

export const repositorySettingsRouter = {
	list: os.repositorySettings.list
		.use(orgMiddleware)
		.handler(({ context }) =>
			getRepositorySettings(context.organizationId, context.user.id),
		),
	report: os.repositorySettings.report
		.use(ingestAuthMiddleware)
		.handler(async ({ input, context }) => {
			const { workspaces } = input;
			const memberships = await sqlClient<{ organization_id: string }[]>`
			SELECT organization_id FROM member WHERE user_id = ${context.user.id}
		`;
			const allowed = new Set(memberships.map((row) => row.organization_id));
			if (
				workspaces.some((workspace) => !allowed.has(workspace.organizationId))
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "Not a member of the specified workspace",
				});
			}
			if (
				new Set(workspaces.map((workspace) => workspace.organizationId))
					.size !== workspaces.length
			) {
				throw new ORPCError("BAD_REQUEST", { message: "Duplicate workspace" });
			}
			await sqlClient.begin(async (sql) => {
				// Serialize simultaneous scans/saves from the same installation.
				await sql.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
					[`${context.user.id}:${input.installationId}`],
				);
				await sql.unsafe(
					"DELETE FROM repository_upload_report WHERE user_id = $1 AND installation_id = $2",
					[context.user.id, input.installationId],
				);
				for (const workspace of workspaces) {
					await sql.unsafe(
						"INSERT INTO repository_upload_report (organization_id, user_id, installation_id, repositories) VALUES ($1, $2, $3, $4::jsonb)",
						[
							workspace.organizationId,
							context.user.id,
							input.installationId,
							JSON.stringify(workspace.repositories),
						],
					);
				}
			});
			return { success: true };
		}),
};
