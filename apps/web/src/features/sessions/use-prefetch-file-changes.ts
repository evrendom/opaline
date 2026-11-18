import { isLiveSessionDetailRevision } from "@rudel/api-routes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { useReadsSessionData } from "./use-reads-session-data";
import { sessionFileChangesQuery } from "./use-session-file-changes";

export function usePrefetchFileChanges(sessionId: string, revision: string) {
	const queryClient = useQueryClient();
	const reads = useReadsSessionData();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const ready =
		reads && !!organizationId && sessionId.length > 0 && revision.length > 0;
	useEffect(() => {
		if (!ready || isLiveSessionDetailRevision(revision)) return;
		const prefetch = () =>
			void queryClient.prefetchQuery(
				sessionFileChangesQuery(organizationId, sessionId, revision),
			);
		if (typeof requestIdleCallback === "function") {
			const handle = requestIdleCallback(prefetch, { timeout: 5_000 });
			return () => cancelIdleCallback(handle);
		}
		const timer = window.setTimeout(prefetch, 1_000);
		return () => window.clearTimeout(timer);
	}, [ready, queryClient, organizationId, sessionId, revision]);
}
