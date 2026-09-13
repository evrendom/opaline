import {
	type UseQueryOptions,
	type UseQueryResult,
	useQuery,
} from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { useOrganization } from "@/features/workspace/organization/useOrganization";

export function useAnalyticsQuery<TQueryFnData, TData = TQueryFnData>(
	options: UseQueryOptions<TQueryFnData, Error, TData>,
): UseQueryResult<TData> {
	const { state } = useOrganization();
	const demo = useDemoRuntime();

	return useQuery({
		...options,
		queryKey: ["org", state.activeOrg?.id, ...(options.queryKey ?? [])],
		enabled:
			!!state.activeOrg?.id &&
			options.enabled !== false &&
			demo?.live !== false,
	});
}
