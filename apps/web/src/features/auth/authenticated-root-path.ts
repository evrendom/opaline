import { appRoutes } from "@/app/routes";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";

export function getAuthenticatedRootPath({
	hasUploadedSessions,
	hasCliLogin = false,
	selfHosted = false,
	workspaceSlug,
}: {
	hasUploadedSessions: boolean;
	hasCliLogin?: boolean;
	selfHosted?: boolean;
	workspaceSlug: string | null;
}) {
	if (!workspaceSlug) return CLI_SETUP_PATH;
	if (hasUploadedSessions || (selfHosted && hasCliLogin))
		return appRoutes.workspaceSessions(workspaceSlug);
	return CLI_SETUP_PATH;
}
