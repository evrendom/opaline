import { appRoutes } from "@/app/routes";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";

export function getAuthenticatedRootPath({
	hasUploadedSessions,
	workspaceSlug,
}: {
	hasUploadedSessions: boolean;
	workspaceSlug: string | null;
}) {
	if (!hasUploadedSessions || !workspaceSlug) return CLI_SETUP_PATH;
	return appRoutes.workspaceSessions(workspaceSlug);
}
