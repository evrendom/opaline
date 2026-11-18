import type { SessionListInput } from "@rudel/api-routes";
import { buildSessionListDateInput } from "@/features/sessions/session-date-ranges";

export const SESSION_PAGE_SIZE = 50;
export const SESSION_QUERY_STALE_TIME = 30_000;

export function buildSessionsListQueryInput({
	dayCount,
	endDate,
	startDate,
	today,
}: {
	dayCount: number;
	endDate: string;
	startDate: string;
	today?: Date;
}): SessionListInput {
	return {
		...buildSessionListDateInput({ dayCount, endDate, startDate, today }),
		limit: SESSION_PAGE_SIZE,
		sortBy: "session_date",
		sortOrder: "desc",
	};
}
