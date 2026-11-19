import { useQuery } from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOptionalOrganization } from "@/features/workspace/organization/useOrganization";
import { orpc } from "@/lib/orpc";

/**
 * Whether the active workspace has Compass (the API's `moments` workspace
 * feature), and whether its members may observe moments with a model. False
 * until the API says so, and always in the plugin app and the product demo,
 * which don't serve the page.
 */
export function useCompassAccess(): {
	enabled: boolean;
	observations: boolean;
	pending: boolean;
} {
	const demo = useDemoRuntime();
	const organizationId = useOptionalOrganization()?.state.activeOrg?.id;
	const available = import.meta.env.MODE !== "plugin" && demo === null;
	const options = orpc.analytics.moments.access.queryOptions();
	const access = useQuery({
		...options,
		queryKey: ["org", organizationId, ...options.queryKey],
		enabled: available && !!organizationId,
		retry: false,
		staleTime: 5 * 60_000,
	});
	return {
		enabled: available && access.data?.moments === true,
		observations: available && access.data?.observations === true,
		pending: available && !!organizationId && access.isPending,
	};
}

/** Whether the active workspace has Compass. */
export function useCompassEnabled(): boolean {
	return useCompassAccess().enabled;
}
