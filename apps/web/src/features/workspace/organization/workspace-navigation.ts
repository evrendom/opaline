import { getWorkspaceAppPath } from "@/app/routes";
import { authClient, refreshAuthClientState } from "@/lib/auth-client";

// Invitations can add a workspace that is not in the browser's cached list yet.
// Resolve its current slug from membership data, never from an old invite URL.
export async function resolveWorkspaceAppPath(
	organizationId: string,
	path: string,
): Promise<string> {
	const result = await authClient.organization.list();
	if (result.error) throw new Error("Could not load your workspaces.");
	const organization = result.data?.find((item) => item.id === organizationId);
	if (!organization) throw new Error("This workspace is no longer available.");
	refreshAuthClientState();
	return getWorkspaceAppPath(organization.slug, path);
}
