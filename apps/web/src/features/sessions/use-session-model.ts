import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { sessionDetailInitialQueryOptions } from "./components/session-detail-fast-query";
import { buildSessionDetailOverviewViewModel } from "./components/session-detail-overview-model";

export function useSessionModel(sessionId: string | null): string | null {
	const queryClient = useQueryClient();
	const cache = queryClient.getQueryCache();
	const read = () =>
		sessionId
			? queryClient.getQueryData(
					sessionDetailInitialQueryOptions(sessionId).queryKey,
				)?.overview
			: undefined;
	const overview = useSyncExternalStore(
		(onChange) => cache.subscribe(onChange),
		read,
		read,
	);
	return useMemo(
		() =>
			overview
				? (buildSessionDetailOverviewViewModel(overview, {}).displayModel ??
					null)
				: null,
		[overview],
	);
}
