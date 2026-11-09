import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useDateRange } from "@/features/analytics/date-range/useDateRange";
import type { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { useUserMap } from "@/features/workspace/hooks/useUserMap";

export type RepoSession = ReturnType<typeof parseSessionOverviewRows>[number];

export type RepoData = {
	repoKey: string;
	userName: (userId: string) => string;
	userAvatar: (userId: string) => string | undefined;
};

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

const RepoDataContext = createContext<RepoData | null>(null);

export function useRepoData(): RepoData {
	const data = useContext(RepoDataContext);
	if (!data) throw new Error("useRepoData outside RepoDataProvider");
	return data;
}

export function RepoDataProvider({
	children,
	repoKey,
}: {
	children: ReactNode;
	repoKey: string;
}) {
	const { userMap, avatarMap } = useUserMap();
	const value = useMemo<RepoData>(
		() => ({
			repoKey,
			userName: (userId) => userMap[userId] ?? userId.slice(0, 8),
			userAvatar: (userId) => avatarMap[userId],
		}),
		[repoKey, userMap, avatarMap],
	);
	return (
		<RepoDataContext.Provider value={value}>
			{children}
		</RepoDataContext.Provider>
	);
}
