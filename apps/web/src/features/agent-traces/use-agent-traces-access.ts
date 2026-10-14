import { useQuery } from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

/**
 * Whether the active workspace may open Agent traces (the API's
 * `AGENT_TRACES_WORKSPACES`). False until the API says so, and always in the
 * plugin app and the product demo, which don't serve the page.
 */
export function useAgentTracesEnabled(): boolean {
	return useAgentTracesAccess().enabled;
}

/** The same, and whether the API has not answered yet. */
export function useAgentTracesAccess(): { enabled: boolean; pending: boolean } {
	const demo = useDemoRuntime();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const available = import.meta.env.MODE !== "plugin" && demo === null;
	const options = orpc.analytics.sessions.agentTracesAccess.queryOptions();
	const access = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: available && !!organizationId,
		retry: false,
		staleTime: 5 * 60_000,
	});
	return {
		enabled: available && access.data?.enabled === true,
		pending: available && !!organizationId && access.isPending,
	};
}
