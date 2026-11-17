import type { SessionAnalytics, SessionListInput } from "@rudel/api-routes";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { isFamilyMemberRow } from "@/features/sessions/session-row-key";
import { client } from "@/lib/orpc";

const SESSION_PAGE_SIZE = 1000;
// Stops a very busy filter from paging forever.
const MAX_SESSIONS = 20_000;

export type SessionRowsFilter = Pick<SessionListInput, "repoKey" | "skillName">;

/** Identifies a filter's session rows; the date range follows it. */
export function sessionRowsKey(filter: SessionRowsFilter) {
	return ["session-rows", filter] as const;
}

/** Every session matching a filter over an inclusive date range. */
export async function fetchSessionRows(
	filter: SessionRowsFilter,
	range: { startDate: string; endDate: string },
	signal: AbortSignal,
) {
	const sessions: SessionAnalytics[] = [];
	for (let offset = 0; offset < MAX_SESSIONS; offset += SESSION_PAGE_SIZE) {
		const page = parseSessionOverviewRows(
			await client.analytics.sessions.list(
				{ ...filter, ...range, limit: SESSION_PAGE_SIZE, offset },
				{ signal },
			),
		);
		sessions.push(...page.filter((session) => !isFamilyMemberRow(session)));
		if (page.length < SESSION_PAGE_SIZE) break;
	}
	return sessions;
}
