import type { SessionSetupText } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { useReadsSessionData } from "./use-reads-session-data";

const SETUP_TEXT_STALE_TIME_MS = 5 * 60 * 1000;

export function useSessionSetupText(sessionId: string, setupFile: string) {
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const options = orpc.analytics.sessions.setupText.queryOptions({
		input: { sessionId, setupFile },
	});
	return useQuery<SessionSetupText>({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled:
			reads && !!organizationId && sessionId.length > 0 && setupFile.length > 0,
		retry: false,
		staleTime: SETUP_TEXT_STALE_TIME_MS,
	});
}
