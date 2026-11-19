import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { authClient } from "@/lib/auth-client";

export function useCanViewSession() {
	const { meta } = useOrganization();
	const { data: session } = authClient.useSession();
	const currentUserId = session?.user.id;

	return (sessionUserId: string) => {
		if (meta.readsEverySession) return true;
		return currentUserId === sessionUserId;
	};
}
