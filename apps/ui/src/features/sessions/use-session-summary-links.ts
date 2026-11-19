import type { SessionSummaryLinks } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";
import { useReadsSessionData } from "./use-reads-session-data";

const SUMMARY_LINKS_STALE_TIME_MS = 5 * 60 * 1000;

export function useSessionSummaryLinks(
	sessionId: string,
): SessionSummaryLinks | undefined {
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const options = orpc.analytics.sessions.summaryLinks.queryOptions({
		input: { sessionId },
	});
	const enabled = reads && !!organizationId && sessionId.length > 0;
	const query = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled,
		retry: false,
		staleTime: SUMMARY_LINKS_STALE_TIME_MS,
	});
	if (query.data) return query.data;
	return !enabled || query.isError ? NO_LINKS : undefined;
}

const NO_LINKS: SessionSummaryLinks = { pullRequests: [], setup: [] };
