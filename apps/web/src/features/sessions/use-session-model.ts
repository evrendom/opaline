import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { sessionDetailInitialQueryOptions } from "./components/session-detail-fast-query";
import { buildSessionDetailOverviewViewModel } from "./components/session-detail-overview-model";
import { getSessionModelDisplayValue } from "./components/session-model-identity";

type ListRow = {
	model_used?: string | null;
	session_id?: string;
	source?: string | null;
	total_tokens?: number;
};

function fromList(queryClient: QueryClient, sessionId: string) {
	for (const [, data] of queryClient.getQueriesData<{ pages?: unknown }>({
		queryKey: ["org"],
	})) {
		const pages = data?.pages;
		if (!Array.isArray(pages)) continue;
		for (const page of pages) {
			if (!Array.isArray(page)) continue;
			const row = (page as ListRow[]).find(
				(each) => each?.session_id === sessionId,
			);
			if (row)
				return (
					getSessionModelDisplayValue({
						errorCount: 0,
						model: row.model_used,
						source: row.source,
						totalTokens: row.total_tokens ?? 0,
					}) ?? null
				);
		}
	}
	return undefined;
}

export function useSessionModel(
	sessionId: string | null,
): string | null | undefined {
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
	const readListed = () =>
		sessionId && !overview ? fromList(queryClient, sessionId) : undefined;
	const listed = useSyncExternalStore(
		(onChange) => cache.subscribe(onChange),
		readListed,
		readListed,
	);
	return useMemo(() => {
		if (!sessionId) return null;
		if (overview)
			return (
				buildSessionDetailOverviewViewModel(overview, {}).displayModel ?? null
			);
		return listed;
	}, [listed, overview, sessionId]);
}
