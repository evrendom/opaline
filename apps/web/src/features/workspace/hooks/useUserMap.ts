import { useMemo } from "react";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useFullOrganization } from "@/features/workspace/hooks/useFullOrganization";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

export function useUserMap() {
	const demo = useDemoRuntime();
	const { state } = useOrganization();
	const { data: fullOrg, isLoading } = useFullOrganization(state.activeOrg?.id);

	const { userMap, avatarMap } = useMemo(() => {
		const names: Record<string, string> = {};
		const avatars: Record<string, string> = {};
		for (const member of demo?.seed.members ?? []) {
			names[member.userId] = member.name;
			avatars[member.userId] = member.image;
		}

		for (const member of fullOrg?.members ?? []) {
			names[member.userId] = member.user.name;

			if (member.user.image && !avatars[member.userId]) {
				avatars[member.userId] = member.user.image;
			}
		}

		return { userMap: names, avatarMap: avatars };
	}, [fullOrg, demo?.seed.members]);

	return { userMap, avatarMap, isLoading };
}
