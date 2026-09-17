import { expect, test } from "bun:test";
import {
	aggregateRepositories,
	type RepositoryAggregateRow,
} from "../services/repository-aggregation.js";

const row: RepositoryAggregateRow = {
	git_remote: "",
	package_name: "",
	project_path: "/opt/conductor/workspaces/app/tunis",
	user_id: "ada",
	session_count: 3,
	total_tokens: 1000,
	estimated_cost: 1.25,
	incomplete_costs: 0,
	model_apologies: 2,
	user_negative: 1,
	user_positive: 4,
	incomplete_signals: 0,
};

test("merges worktrees and user attribution before ranking the cards", () => {
	const repos = aggregateRepositories([
		row,
		{
			...row,
			project_path: "/opt/conductor/workspaces/app/osaka",
			session_count: 2,
		},
		{ ...row, user_id: "grace", session_count: 7 },
		{
			...row,
			project_path: "/opt/conductor/workspaces/other/tunis",
			session_count: 20,
		},
	]);
	expect(repos.map((repo) => repo.identity.repoKey)).toEqual([
		"path:other",
		"path:app",
	]);
	expect(repos[1]).toMatchObject({
		identity: { repoKey: "path:app", worktree: null },
		sessionCount: 12,
		totalTokens: 3000,
		estimatedCost: 3.75,
		userCount: 2,
		topUsers: [
			{ userId: "grace", sessionCount: 7 },
			{ userId: "ada", sessionCount: 5 },
		],
		signals: {
			modelApologies: 6,
			userNegative: 3,
			userPositive: 12,
			complete: true,
		},
	});
});

test("merges remote URL forms but keeps different owners separate", () => {
	const repos = aggregateRepositories([
		{
			...row,
			project_path: "/work/app",
			git_remote: "git@github.com:one/app.git",
		},
		{
			...row,
			project_path: "/work/clone",
			git_remote: "https://github.com/one/app",
		},
		{
			...row,
			project_path: "/work/other",
			git_remote: "https://github.com/two/app",
		},
	]);
	expect(
		repos.map((repo) => [repo.identity.repoKey, repo.sessionCount]),
	).toEqual([
		["remote:github.com/one/app", 6],
		["remote:github.com/two/app", 3],
	]);
});

test("does not present incomplete costs or signal scans as complete", () => {
	const [repo] = aggregateRepositories([
		row,
		{ ...row, incomplete_costs: 1, incomplete_signals: 1 },
		row,
	]);
	expect(repo?.estimatedCost).toBeNull();
	expect(repo?.signals.complete).toBe(false);
	expect(repo?.sessionCount).toBe(9);
});

test("keeps the full user count while displaying the three most active users", () => {
	const [repo] = aggregateRepositories(
		["ada", "bea", "cy", "dee"].map((user_id, index) => ({
			...row,
			user_id,
			session_count: index + 1,
		})),
	);
	expect(repo?.userCount).toBe(4);
	expect(repo?.topUsers.map((user) => user.userId)).toEqual([
		"dee",
		"cy",
		"bea",
	]);
});
