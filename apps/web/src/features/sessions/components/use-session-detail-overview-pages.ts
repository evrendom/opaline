import { useInfiniteQuery } from "@tanstack/react-query";
// biome-ignore lint/style/noRestrictedImports: Schedule each background summary page after the current page can paint.
import { useEffect } from "react";
import {
	fetchSessionDetailOverview,
	SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	shouldRetrySessionDetailFastQuery,
} from "./session-detail-fast-query";
import type { NormalizedSessionDetailOverview } from "./session-detail-fast-response";
import { assertSessionDetailOverviewPage } from "./session-detail-full-transcript";

export function useSessionDetailOverviewPages(
	first: NormalizedSessionDetailOverview,
) {
	const query = useInfiniteQuery({
		queryKey: [
			"session-detail-v2",
			"overview",
			first.session.sessionId,
			first.revision,
			"pages",
		],
		initialPageParam: "",
		initialData: { pages: [first], pageParams: [""] },
		queryFn: async ({ pageParam, signal }) => {
			const parsed = await fetchSessionDetailOverview(
				{
					expectedRevision: first.revision,
					sessionId: first.session.sessionId,
					turnCursor: pageParam || undefined,
				},
				signal,
			);
			assertSessionDetailOverviewPage(first, parsed.overview);
			if (parsed.overview.turnPage.nextCursor === pageParam) {
				throw new Error(
					"Session detail pagination returned a repeated cursor.",
				);
			}
			return parsed.overview;
		},
		getNextPageParam: (page, _pages, _cursor, cursors) => {
			const next = page.turnPage.nextCursor;
			return next && !cursors.includes(next) ? next : undefined;
		},
		retry: shouldRetrySessionDetailFastQuery,
		staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	});
	const { error, fetchNextPage, hasNextPage, isFetching } = query;
	useEffect(() => {
		if (!hasNextPage || isFetching || error) return;
		// The first messages are already available. Yield a paint before fetching
		// each additional summary page, and expose each page as soon as it arrives.
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				void fetchNextPage({ cancelRefetch: false });
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [error, fetchNextPage, hasNextPage, isFetching]);
	return query;
}
