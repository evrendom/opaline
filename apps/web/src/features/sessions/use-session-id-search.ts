import type { SessionAnalytics, SessionListInput } from "@rudel/api-routes";
import { useQuery } from "@tanstack/react-query";
import { useDemoRuntime } from "@/features/demo/demo-runtime";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { useOrganization } from "@/features/workspace/organization/useOrganization";
import { client } from "@/lib/orpc";

// A session ID search reads up to this many sessions, in big pages.
const MAX_SEARCHED_SESSIONS = 2_000;
const SEARCH_PAGE_SIZE = 1_000;

/**
 * Sessions whose ID contains `search`, among those the list `input` (its
 * range and filters) selects. The API has no ID filter, so while a search is
 * on this reads every page once and matches here; `fallback` (the rows
 * already loaded) stands in until that lands.
 */
export function useSessionIdSearch({
	search,
	input,
	fallback,
}: {
	search: string;
	input: Omit<SessionListInput, "limit" | "offset">;
	fallback: SessionAnalytics[] | undefined;
}) {
	const { state } = useOrganization();
	const demo = useDemoRuntime();
	const query = search.trim().toLowerCase();
	const pages = useQuery({
		queryKey: ["org", state.activeOrg?.id, "session-id-search", input],
		queryFn: async ({ signal }) => {
			const rows: SessionAnalytics[] = [];
			for (
				let offset = 0;
				offset < MAX_SEARCHED_SESSIONS;
				offset += SEARCH_PAGE_SIZE
			) {
				const page = parseSessionOverviewRows(
					await client.analytics.sessions.list(
						{ ...input, limit: SEARCH_PAGE_SIZE, offset },
						{ signal },
					),
				);
				rows.push(...page);
				if (page.length < SEARCH_PAGE_SIZE) break;
			}
			return rows;
		},
		enabled: !!query && !!state.activeOrg?.id && demo?.live !== false,
		staleTime: 60_000,
	});
	return {
		active: query.length > 0,
		sessions: query
			? (pages.data ?? fallback ?? []).filter((session) =>
					session.session_id.toLowerCase().includes(query),
				)
			: fallback,
	};
}
