import type { SessionAnalytics } from "@rudel/api-routes";
import { getSessionTimestamp } from "@/features/sessions/session-ordering";

const DAY_IN_MILLISECONDS = 86_400_000;
const MAX_ACTIVITY_PERIODS = 14;

export interface SessionMemberProfileSummary {
	activity: readonly number[];
	favoriteModel: string | null;
}

type ModelUsageSummary = {
	count: number;
	latestTimestamp: number;
};

function getUtcDayTimestamp(dateString: string) {
	const date = getSessionTimestamp(dateString);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getFavoriteModel(sessions: readonly SessionAnalytics[]) {
	const usageByModel = new Map<string, ModelUsageSummary>();

	for (const session of sessions) {
		const timestamp = getSessionTimestamp(session.session_date).getTime();
		const currentUsage = usageByModel.get(session.model_used);
		usageByModel.set(session.model_used, {
			count: (currentUsage?.count ?? 0) + 1,
			latestTimestamp: Math.max(
				currentUsage?.latestTimestamp ?? Number.NEGATIVE_INFINITY,
				Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp,
			),
		});
	}

	return (
		[...usageByModel.entries()].sort(
			([leftModel, leftUsage], [rightModel, rightUsage]) =>
				rightUsage.count - leftUsage.count ||
				rightUsage.latestTimestamp - leftUsage.latestTimestamp ||
				leftModel.localeCompare(rightModel),
		)[0]?.[0] ?? null
	);
}

function buildActivity(
	sessions: readonly SessionAnalytics[],
	earliestDayTimestamp: number | null,
	latestDayTimestamp: number | null,
) {
	if (earliestDayTimestamp === null || latestDayTimestamp === null) {
		return [];
	}

	const totalDays =
		Math.floor(
			(latestDayTimestamp - earliestDayTimestamp) / DAY_IN_MILLISECONDS,
		) + 1;
	const periodCount = Math.min(totalDays, MAX_ACTIVITY_PERIODS);
	const daysPerPeriod = Math.ceil(totalDays / periodCount);
	const initialActivity = Array.from({ length: periodCount }, () => 0);

	return sessions.reduce((activity, session) => {
		const dayTimestamp = getUtcDayTimestamp(session.session_date);
		if (dayTimestamp === null) {
			return activity;
		}

		const dayOffset = Math.floor(
			(dayTimestamp - earliestDayTimestamp) / DAY_IN_MILLISECONDS,
		);
		const periodIndex = Math.min(
			Math.floor(dayOffset / daysPerPeriod),
			periodCount - 1,
		);

		return activity.map((value, index) =>
			index === periodIndex ? value + 1 : value,
		);
	}, initialActivity);
}

export function buildSessionMemberProfileSummaries(
	sessions: readonly SessionAnalytics[],
) {
	const validDayTimestamps = sessions
		.map((session) => getUtcDayTimestamp(session.session_date))
		.filter((timestamp) => timestamp !== null);
	const earliestDayTimestamp =
		validDayTimestamps.length > 0 ? Math.min(...validDayTimestamps) : null;
	const latestDayTimestamp =
		validDayTimestamps.length > 0 ? Math.max(...validDayTimestamps) : null;
	const sessionsByUserId = new Map<string, SessionAnalytics[]>();

	for (const session of sessions) {
		const userSessions = sessionsByUserId.get(session.user_id) ?? [];
		sessionsByUserId.set(session.user_id, [...userSessions, session]);
	}

	return new Map(
		[...sessionsByUserId.entries()].map(([userId, userSessions]) => [
			userId,
			{
				activity: buildActivity(
					userSessions,
					earliestDayTimestamp,
					latestDayTimestamp,
				),
				favoriteModel: getFavoriteModel(userSessions),
			} satisfies SessionMemberProfileSummary,
		]),
	);
}
