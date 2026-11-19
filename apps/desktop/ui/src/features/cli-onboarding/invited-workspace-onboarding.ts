import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { authClient, refreshAuthClientState } from "@/lib/auth-client";

const INVITED_WORKSPACE_PARAM = "workspace";
const MAX_WORKSPACE_ID_LENGTH = 200;

export async function activateInvitedWorkspaceOnboarding(
	organizationId: string,
) {
	const result = await authClient.organization.setActive({ organizationId });
	if (result.error)
		throw new Error(
			result.error.message ?? "Could not select the invited workspace.",
		);
	refreshAuthClientState();
	return getInvitedWorkspaceOnboardingPath(organizationId);
}

export function getInvitedWorkspaceOnboardingPath(organizationId: string) {
	const params = new URLSearchParams({
		[INVITED_WORKSPACE_PARAM]: organizationId,
	});
	return `${CLI_SETUP_PATH}?${params.toString()}`;
}

export function getInvitedWorkspaceId(search: string) {
	const value = new URLSearchParams(search)
		.get(INVITED_WORKSPACE_PARAM)
		?.trim();
	return value && value.length <= MAX_WORKSPACE_ID_LENGTH ? value : null;
}
