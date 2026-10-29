import type { SessionFileChanges } from "@rudel/api-routes";
import { isLiveSessionDetailRevision } from "@rudel/api-routes";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { useReadsSessionData } from "./use-reads-session-data";

const FILE_CHANGES_STALE_TIME_MS = 5 * 60 * 1000;
const LIVE_FILE_CHANGES_STALE_TIME_MS = 30 * 1000;

export function fileChangesRevisionKey(revision: string): string {
	return isLiveSessionDetailRevision(revision) ? "live" : revision;
}

export function sessionFileChangesQuery(
	organizationId: string | undefined,
	sessionId: string,
	revision: string,
) {
	const options = orpc.analytics.sessions.fileChanges.queryOptions({
		input: { sessionId },
	});
	return queryOptions<SessionFileChanges>({
		queryFn: options.queryFn,
		queryKey: [
			"org",
			organizationId,
			...options.queryKey,
			fileChangesRevisionKey(revision),
		],
		retry: false,
		staleTime: isLiveSessionDetailRevision(revision)
			? LIVE_FILE_CHANGES_STALE_TIME_MS
			: FILE_CHANGES_STALE_TIME_MS,
	});
}

export function useSessionFileChanges(
	sessionId: string,
	revision: string,
	read = true,
) {
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const live = isLiveSessionDetailRevision(revision);
	return useQuery({
		...sessionFileChangesQuery(organizationId, sessionId, revision),
		enabled: read && reads && !!organizationId && sessionId.length > 0,
		refetchInterval: live ? LIVE_FILE_CHANGES_STALE_TIME_MS : false,
	});
}
