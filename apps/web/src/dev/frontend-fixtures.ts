import type {
	DeveloperSummary,
	DeveloperTeamCard,
	UserDailyTrendData,
} from "@rudel/api-routes";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_FIXTURE_DAYS = 14;
const FIXTURE_MODELS = ["claude-sonnet-4.5", "gpt-5.1-codex"];
const FIXTURE_REPOSITORIES = ["rudel/web", "rudel/api"];

export interface FrontendFixtureMember {
	userId: string;
	displayName: string;
	email: string | null;
	imageUrl: string | null;
}

export interface TeamAnalyticsFixtures {
	developerSummaries: DeveloperSummary[];
	teamCards: DeveloperTeamCard[];
	usersDailyTrend: UserDailyTrendData[];
}

const defaultFixtureMembers = [
	{
		userId: "fixture-user-1",
		displayName: "Local Designer",
		email: "designer@example.com",
		imageUrl: null,
	},
	{
		userId: "fixture-user-2",
		displayName: "Local Engineer",
		email: "engineer@example.com",
		imageUrl: null,
	},
] satisfies readonly FrontendFixtureMember[];

const announcedFixtureSurfaces = new Set<string>();

export function isFrontendFixturesEnabled() {
	return import.meta.env.DEV && import.meta.env.VITE_FRONTEND_FIXTURES === "1";
}

export function announceFrontendFixturesEnabled(surface: string) {
	if (!isFrontendFixturesEnabled() || announcedFixtureSurfaces.has(surface)) {
		return;
	}

	announcedFixtureSurfaces.add(surface);
	console.info(
		`[rudel] Frontend fixtures are enabled for ${surface}. Live analytics queries are disabled for this surface while VITE_FRONTEND_FIXTURES=1.`,
	);
}

export function buildTeamAnalyticsFixtures(input: {
	endDate: string;
	members: readonly FrontendFixtureMember[];
	startDate: string;
}): TeamAnalyticsFixtures {
	const members = getFixtureMembers(input.members);
	const teamCards = members.map((member, index) =>
		buildDeveloperTeamCard(member, index),
	);

	return {
		developerSummaries: teamCards.map((teamCard, index) => ({
			active_days: teamCard.active_days,
			avg_session_duration_min: 42 - index * 4,
			cost: teamCard.cost,
			favorite_model: teamCard.favorite_model,
			input_tokens: teamCard.input_tokens,
			last_active_date: teamCard.last_active_date,
			output_tokens: teamCard.output_tokens,
			total_duration_min: teamCard.total_sessions * (42 - index * 4),
			total_sessions: teamCard.total_sessions,
			total_tokens: teamCard.total_tokens,
			user_id: teamCard.user_id,
		})),
		teamCards,
		usersDailyTrend: buildUserDailyTrend(
			members,
			getFixtureDates(input.startDate, input.endDate),
		),
	};
}

function getFixtureMembers(members: readonly FrontendFixtureMember[]) {
	const usableMembers = members.filter(
		(member) =>
			member.userId.trim().length > 0 && member.displayName.trim().length > 0,
	);

	return usableMembers.length > 0 ? usableMembers : defaultFixtureMembers;
}

function getFixtureDates(startDateValue: string, endDateValue: string) {
	const parsedStartDate = parseDate(startDateValue);
	const parsedEndDate = parseDate(endDateValue);
	const fallbackEndDate = new Date();
	const endDate = parsedEndDate ?? fallbackEndDate;
	const requestedStartDate =
		parsedStartDate && parsedStartDate <= endDate
			? parsedStartDate
			: new Date(endDate.getTime() - 6 * MS_PER_DAY);
	const dayCount =
		Math.floor(
			(endDate.getTime() - requestedStartDate.getTime()) / MS_PER_DAY,
		) + 1;
	const cappedDayCount = Math.max(1, Math.min(dayCount, MAX_FIXTURE_DAYS));
	const startDate = new Date(
		endDate.getTime() - (cappedDayCount - 1) * MS_PER_DAY,
	);

	return Array.from({ length: cappedDayCount }, (_, index) =>
		formatDate(new Date(startDate.getTime() + index * MS_PER_DAY)),
	);
}

function parseDate(value: string) {
	const date = new Date(`${value}T00:00:00.000Z`);

	return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

function buildUserDailyTrend(
	members: readonly FrontendFixtureMember[],
	dates: readonly string[],
): UserDailyTrendData[] {
	return dates.flatMap((date, dayIndex) =>
		members.map((member, memberIndex) => {
			const sessions = Math.max(1, 3 - memberIndex + (dayIndex % 2));
			const inputTokens = sessions * (14_000 + memberIndex * 1_800);
			const outputTokens = sessions * (3_800 + memberIndex * 600);

			return {
				cost: Number(
					(inputTokens * 0.000003 + outputTokens * 0.000015).toFixed(2),
				),
				date,
				distinct_skills: 3,
				distinct_slash_commands: 2,
				input_tokens: inputTokens,
				models_used: [
					FIXTURE_MODELS[(dayIndex + memberIndex) % FIXTURE_MODELS.length],
				],
				output_tokens: outputTokens,
				repositories_touched: [
					FIXTURE_REPOSITORIES[
						(dayIndex + memberIndex) % FIXTURE_REPOSITORIES.length
					],
				],
				sessions,
				total_hours: Number((sessions * 0.7).toFixed(1)),
				total_tokens: inputTokens + outputTokens,
				user_id: member.userId,
			};
		}),
	);
}

function buildDeveloperTeamCard(
	member: FrontendFixtureMember,
	index: number,
): DeveloperTeamCard {
	const inputTokens = 420_000 - index * 70_000;
	const outputTokens = 110_000 - index * 20_000;
	const totalTokens = inputTokens + outputTokens;

	return {
		active_days: 8 - Math.min(index, 4),
		cost: Number((inputTokens * 0.000003 + outputTokens * 0.000015).toFixed(2)),
		display_name: member.displayName,
		favorite_model: FIXTURE_MODELS[index % FIXTURE_MODELS.length],
		input_tokens: inputTokens,
		last_active_date: formatDate(new Date()),
		output_tokens: outputTokens,
		top_skills: [
			{ count: 12 - index, name: "typescript" },
			{ count: 8 - index, name: "debugging" },
		],
		total_sessions: 22 - index * 4,
		total_tokens: totalTokens,
		user_id: member.userId,
	};
}
