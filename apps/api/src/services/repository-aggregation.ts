import {
	dashboardRepositoryId,
	MAX_DASHBOARD_REPOSITORY_IDS,
	type RepositorySummary,
	unifyRepoIdentities,
} from "@rudel/api-routes";
import { toRepoIdentityInput } from "./repo-identity-rows.js";

export interface RepositoryAggregateRow {
	git_remote: string;
	package_name: string;
	project_path: string;
	user_id: string;
	session_count: number;
	total_tokens: number;
	estimated_cost: number;
	incomplete_costs: number;
	last_active_at: string;
	model_apologies: number;
	user_negative: number;
	user_positive: number;
	incomplete_signals: number;
}

export function aggregateRepositories(
	rows: readonly RepositoryAggregateRow[],
): RepositorySummary[] {
	const groups = new Map<
		string,
		{
			summary: RepositorySummary;
			users: Map<string, number>;
			dashboardIds: Set<string>;
		}
	>();
	const resolver = unifyRepoIdentities(rows.map(toRepoIdentityInput));
	for (const row of rows) {
		const identity = resolver.resolve(toRepoIdentityInput(row));
		let group = groups.get(identity.repoKey);
		if (!group) {
			group = {
				summary: {
					identity: { ...identity, worktree: null },
					dashboardIds: [],
					sessionCount: 0,
					totalTokens: 0,
					estimatedCost: 0,
					lastActiveAt: null,
					userCount: 0,
					topUsers: [],
					signals: {
						modelApologies: 0,
						userNegative: 0,
						userPositive: 0,
						complete: true,
					},
				},
				users: new Map(),
				dashboardIds: new Set(),
			};
			groups.set(identity.repoKey, group);
		}
		const { summary, users, dashboardIds } = group;
		const dashboardId = dashboardRepositoryId(row);
		if (dashboardId) dashboardIds.add(dashboardId);
		summary.sessionCount += Number(row.session_count);
		summary.totalTokens += Number(row.total_tokens);
		summary.estimatedCost =
			summary.estimatedCost === null || Number(row.incomplete_costs) > 0
				? null
				: summary.estimatedCost + Number(row.estimated_cost);
		// ISO-8601 UTC strings sort chronologically.
		if (!summary.lastActiveAt || row.last_active_at > summary.lastActiveAt)
			summary.lastActiveAt = row.last_active_at;
		summary.signals.modelApologies += Number(row.model_apologies);
		summary.signals.userNegative += Number(row.user_negative);
		summary.signals.userPositive += Number(row.user_positive);
		summary.signals.complete &&= Number(row.incomplete_signals) === 0;
		users.set(
			row.user_id,
			(users.get(row.user_id) ?? 0) + Number(row.session_count),
		);
	}
	return [...groups.values()]
		.map(({ summary, users, dashboardIds }) => ({
			...summary,
			dashboardIds: [...dashboardIds]
				.sort()
				.slice(0, MAX_DASHBOARD_REPOSITORY_IDS),
			userCount: users.size,
			topUsers: [...users]
				.map(([userId, sessionCount]) => ({ userId, sessionCount }))
				.sort(
					(a, b) =>
						b.sessionCount - a.sessionCount || a.userId.localeCompare(b.userId),
				)
				.slice(0, 3),
		}))
		.sort(
			(a, b) =>
				b.sessionCount - a.sessionCount ||
				a.identity.repoKey.localeCompare(b.identity.repoKey),
		);
}
