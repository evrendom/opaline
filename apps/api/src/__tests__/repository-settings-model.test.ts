import { expect, test } from "bun:test";
import { buildRepositorySettings } from "../services/repository-settings-model.js";

const reportedAt = "2026-09-17T12:00:00.000Z";

test("confirmed worktree aliases join saved auto-upload settings to existing session counts", () => {
	const result = buildRepositorySettings(
		[
			{
				project_path: "/home/dev/conductor/workspaces/repo/tunis",
				git_remote: "",
				package_name: "",
				session_count: 12,
			},
			{
				project_path: "/home/dev/repo",
				git_remote: "github.com/team/repo",
				package_name: "",
				session_count: 3,
			},
		],
		[
			{
				installation_id: "computer-a",
				reported_at: reportedAt,
				repositories: [
					{
						key: "remote:github.com/team/repo",
						name: "repo",
						state: "enabled",
						aliases: ["path:repo"],
					},
				],
			},
		],
	);
	expect(result.repositories).toEqual([
		{
			key: "remote:github.com/team/repo",
			name: "repo",
			sessionCount: 15,
			reports: [{ installationId: "computer-a", state: "enabled", reportedAt }],
		},
	]);
});

test("a git remote decides the repository even under an aliased worktree path", () => {
	const result = buildRepositorySettings(
		[
			{
				project_path: "/home/dev/conductor/workspaces/repo/tunis",
				git_remote: "github.com/old/repo",
				package_name: "",
				session_count: 12,
			},
			{
				project_path: "/home/dev/repo",
				git_remote: "github.com/team/repo",
				package_name: "",
				session_count: 3,
			},
		],
		[
			{
				installation_id: "computer-a",
				reported_at: reportedAt,
				repositories: [
					{
						key: "remote:github.com/team/repo",
						name: "repo",
						state: "enabled",
						aliases: ["path:repo"],
					},
				],
			},
		],
	);
	expect(
		result.repositories.map(({ key, sessionCount }) => ({ key, sessionCount })),
	).toEqual([
		{ key: "remote:github.com/old/repo", sessionCount: 12 },
		{ key: "remote:github.com/team/repo", sessionCount: 3 },
	]);
});

test("equal display names do not imply equal repositories or enabled uploads", () => {
	const result = buildRepositorySettings(
		[
			{
				project_path: "/home/dev/conductor/workspaces/repo/tunis",
				git_remote: "",
				package_name: "",
				session_count: 4,
			},
		],
		[
			{
				installation_id: "computer-a",
				reported_at: reportedAt,
				repositories: [
					{
						key: "remote:github.com/team/repo",
						name: "repo",
						state: "enabled",
					},
				],
			},
		],
	);
	expect(result.repositories).toHaveLength(2);
	expect(result.repositories[0]?.sessionCount).toBe(4);
	expect(result.repositories[0]?.reports).toEqual([]);
});

test("conflicting worktree aliases remain unreported while computer settings stay distinct", () => {
	const result = buildRepositorySettings(
		[
			{
				project_path: "/home/dev/conductor/workspaces/repo/tunis",
				git_remote: "",
				package_name: "",
				session_count: 4,
			},
		],
		["a", "b"].map((team) => ({
			installation_id: `computer-${team}`,
			reported_at: reportedAt,
			repositories: [
				{
					key: `remote:github.com/${team}/repo`,
					name: "repo",
					state: "enabled",
					aliases: ["path:repo"],
				},
			],
		})),
	);
	expect(result.repositories).toHaveLength(3);
	expect(result.repositories[0]?.key).toBe("path:repo");
	expect(result.repositories[0]?.reports).toEqual([]);
});

test("computers reporting different states for one repository share its session count", () => {
	const result = buildRepositorySettings(
		[
			{
				project_path: "/home/dev/conductor/workspaces/repo/tunis",
				git_remote: "",
				package_name: "",
				session_count: 4,
			},
		],
		["enabled", "disabled"].map((state) => ({
			installation_id: state,
			reported_at: reportedAt,
			repositories: [
				{
					key: "remote:github.com/team/repo",
					name: "repo",
					state,
					aliases: ["path:repo"],
				},
			],
		})),
	);
	expect(result.repositories).toHaveLength(1);
	expect(result.repositories[0]?.sessionCount).toBe(4);
	expect(result.repositories[0]?.reports.map((report) => report.state)).toEqual(
		["enabled", "disabled"],
	);
});
