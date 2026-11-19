import type { SessionSetupRuns } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { useReadsSessionData } from "./use-reads-session-data";

const SETUP_RUNS_STALE_TIME_MS = 5 * 60 * 1000;

export function useSessionSetupRuns(sessionId: string, read = true) {
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const options = orpc.analytics.sessions.setupRuns.queryOptions({
		input: { sessionId },
	});
	return useQuery<SessionSetupRuns>({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: read && reads && !!organizationId && sessionId.length > 0,
		retry: false,
		staleTime: SETUP_RUNS_STALE_TIME_MS,
	});
}
