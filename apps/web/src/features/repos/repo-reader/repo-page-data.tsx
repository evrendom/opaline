import type {
	HistoricalSkillSummary,
	RepositoryOverview,
	RepositoryPullRequest,
	RepositorySummary,
} from "@rudel/api-routes";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";
import { orpc } from "@/lib/orpc";
import { getRepoPulls, type RepoPull } from "./repo-ci-model";

export type RepoSession = ReturnType<typeof parseSessionOverviewRows>[number];

export type WorkOutcome = "merged" | "open" | "closed" | "no-pr";

export type RepoWork = {
	branch: string;
	sessions: RepoSession[];
	pulls: RepoPull[];
	cost: number;
	minutes: number;
	firstAt: number;
	lastAt: number;
	outcome: WorkOutcome;
	frustration: number;
	apologies: number;
	errors: number;
	users: string[];
};

export type RepoData = {
	repoKey: string;
	name: string;
	range: { startDate: string; endDate: string; days: number };
	summary: RepositorySummary | undefined;
	overview: RepositoryOverview | undefined;
	sessions: RepoSession[];
	skills: HistoricalSkillSummary[];
	pulls: RepoPull[];
	work: RepoWork[];
	userName: (userId: string) => string;
	userAvatar: (userId: string) => string | undefined;
	loading: boolean;
};

const NO_BRANCH = "(no branch)";

export function useRepoRange() {
	const { meta, state } = useDateRange();
	return useMemo(
		() => ({
			startDate: state.startDate,
			endDate: state.endDate,
			days: meta.dayCount,
		}),
		[meta.dayCount, state.endDate, state.startDate],
	);
}

export function keepWhileRangeChanges(scope: Record<string, unknown>) {
	const wanted = JSON.stringify(scope);
	return <Data,>(
		previous: Data | undefined,
		previousQuery?: { queryKey: readonly unknown[] },
	) => {
		const last = previousQuery?.queryKey.at(-1) as
			| { input?: Record<string, unknown> }
			| undefined;
		if (!last?.input) return undefined;
		const { range: _range, ...rest } = last.input;
		return JSON.stringify(rest) === wanted ? previous : undefined;
	};
}

export function useRepoRangeInput() {
	const { startDate, endDate } = useRepoRange();
	return useMemo(() => ({ startDate, endDate }), [startDate, endDate]);
}

function outcomeOf(pulls: readonly RepoPull[]): WorkOutcome {
	if (pulls.length === 0) return "no-pr";
	if (pulls.some((each) => each.pull.mergedAt)) return "merged";
	if (pulls.some((each) => each.pull.state === "open")) return "open";
	return "closed";
}

export function getRepoWork(
	sessions: readonly RepoSession[],
	pulls: readonly RepoPull[],
): RepoWork[] {
	const bySession = new Map<string, RepoPull[]>();
	for (const pull of pulls)
		for (const id of pull.pull.sessions)
			bySession.set(id, [...(bySession.get(id) ?? []), pull]);
	const byBranch = new Map<
		string,
		{ sessions: RepoSession[]; pulls: Set<RepoPull> }
	>();
	const entry = (branch: string) => {
		const found = byBranch.get(branch);
		if (found) return found;
		const made = { sessions: [] as RepoSession[], pulls: new Set<RepoPull>() };
		byBranch.set(branch, made);
		return made;
	};
	for (const session of sessions) {
		const linked = bySession.get(session.session_id) ?? [];
		const branch = linked[0]?.pull.headRef ?? session.git_branch ?? NO_BRANCH;
		const work = entry(branch);
		work.sessions.push(session);
		for (const pull of linked) work.pulls.add(pull);
	}
	for (const pull of pulls) {
		const branch = pull.pull.headRef;
		if (branch && byBranch.has(branch)) byBranch.get(branch)?.pulls.add(pull);
	}
	return [...byBranch]
		.map(([branch, { sessions: own, pulls: linked }]) => {
			const times = own
				.map((each) => Date.parse(each.session_date))
				.filter(Number.isFinite);
			const list = [...linked];
			return {
				branch,
				sessions: own,
				pulls: list,
				cost: own.reduce((sum, each) => sum + (each.estimated_cost ?? 0), 0),
				minutes: own.reduce((sum, each) => sum + each.duration_min, 0),
				firstAt: times.length > 0 ? Math.min(...times) : 0,
				lastAt: times.length > 0 ? Math.max(...times) : 0,
				outcome: outcomeOf(list),
				frustration: own.reduce((sum, each) => sum + each.member_swears, 0),
				apologies: own.reduce((sum, each) => sum + each.model_apologies, 0),
				errors: own.reduce((sum, each) => sum + (each.error_count ?? 0), 0),
				users: [...new Set(own.map((each) => each.user_id))],
			};
		})
		.sort((a, b) => b.lastAt - a.lastAt);
}

const RepoDataContext = createContext<RepoData | null>(null);

export function useRepoData(): RepoData {
	const data = useContext(RepoDataContext);
	if (!data) throw new Error("useRepoData outside RepoDataProvider");
	return data;
}

export function RepoDataProvider({
	children,
	name,
	pullRequests,
	repoKey,
	summary,
}: {
	children: ReactNode;
	name: string;
	pullRequests: readonly RepositoryPullRequest[];
	repoKey: string;
	summary: RepositorySummary | undefined;
}) {
	const range = useRepoRange();
	const overview = useAnalyticsQuery(
		orpc.analytics.repositories.overview.queryOptions({
			input: { repoKey, startDate: range.startDate, endDate: range.endDate },
		}),
	);
	const sessionsQuery = useAnalyticsQuery(
		orpc.analytics.sessions.list.queryOptions({
			input: {
				repoKey,
				startDate: range.startDate,
				endDate: range.endDate,
				limit: 500,
				offset: 0,
			},
		}),
	);
	const detail = useAnalyticsQuery(
		orpc.analytics.repositories.detail.queryOptions({ input: { repoKey } }),
	);
	const { userMap, avatarMap } = useUserMap();
	const sessions = useMemo(
		() =>
			sessionsQuery.data ? parseSessionOverviewRows(sessionsQuery.data) : [],
		[sessionsQuery.data],
	);
	const pulls = useMemo(() => getRepoPulls(pullRequests), [pullRequests]);
	const work = useMemo(() => getRepoWork(sessions, pulls), [sessions, pulls]);
	const value = useMemo<RepoData>(
		() => ({
			repoKey,
			name,
			range,
			summary,
			overview: overview.data,
			sessions,
			skills: detail.data?.skills ?? [],
			pulls,
			work,
			userName: (userId) => userMap[userId] ?? userId.slice(0, 8),
			userAvatar: (userId) => avatarMap[userId],
			loading:
				overview.isPending || sessionsQuery.isPending || detail.isPending,
		}),
		[
			repoKey,
			name,
			range,
			summary,
			overview.data,
			overview.isPending,
			sessions,
			sessionsQuery.isPending,
			detail.data,
			detail.isPending,
			pulls,
			work,
			userMap,
			avatarMap,
		],
	);
	return (
		<RepoDataContext.Provider value={value}>
			{children}
		</RepoDataContext.Provider>
	);
}
