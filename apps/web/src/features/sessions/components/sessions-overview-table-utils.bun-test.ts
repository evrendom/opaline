import { describe, expect, test } from "bun:test";
import type { SessionAnalytics } from "@rudel/api-routes";
import {
	buildSessionOverviewFilterOptions,
	compareSessions,
	getRepositoryLabel,
	getSessionBranchLabel,
} from "./sessions-overview-table-utils";

const session: SessionAnalytics = {
	duration_min: 12,
	error_count: 0,
	input_tokens: 6_000,
	model_used: "gpt-5.6",
	output_tokens: 4_000,
	project_path: "/opt/conductor/workspaces/rudel-v2/osaka",
	repository: "/opt/conductor/workspaces/rudel-v2/osaka",
	repository_identity: {
		repoKey: "path:rudel-v2",
		repoLabel: "rudel-v2",
		repoName: "rudel-v2",
		source: "worktree",
		worktree: "osaka",
	},
	session_date: "2026-08-19T12:00:00Z",
	session_id: "session-1",
	skills: [],
	slash_commands: [],
	subagent_types: [],
	total_interactions: 6,
	total_tokens: 10_000,
	user_id: "user-1",
	worktree: "osaka",
	member_swears: 0,
	member_apologies: 0,
	member_positive: 0,
	model_swears: 0,
	model_apologies: 0,
	model_positive: 0,
};

describe("getRepositoryLabel", () => {
	test("uses the structured worktree basename from cached list payloads", () => {
		expect(getRepositoryLabel(session)).toBe("rudel-v2");
	});

	test("uses the structured remote basename from cached list payloads", () => {
		expect(
			getRepositoryLabel({
				...session,
				git_remote: "github.com/example/rudel",
				project_path: "/opt/coding-projects/rudel",
				repository: "github.com/example/rudel",
				repository_identity: {
					repoKey: "remote:github.com/example/rudel",
					repoLabel: "example/rudel",
					repoName: "rudel",
					source: "remote",
					worktree: null,
				},
				worktree: null,
			}),
		).toBe("rudel");
	});

	test("shows only the final repository segment", () => {
		expect(
			getRepositoryLabel({
				...session,
				git_remote: "github.com/acme/flick",
				project_path: "/opt/flick",
				repository: "acme/flick",
				repository_identity: {
					repoKey: "remote:github.com/acme/flick",
					repoLabel: "acme/flick",
					repoName: "flick",
					source: "remote",
					worktree: null,
				},
				worktree: null,
			}),
		).toBe("flick");
		expect(
			getRepositoryLabel({
				...session,
				project_path: "/opt/unresolved",
				repository: "/opt/unresolved",
				repository_identity: {
					repoKey: "path-raw:/opt/unresolved",
					repoLabel: "opt/unresolved",
					repoName: null,
					source: "unresolved",
					worktree: null,
				},
				worktree: null,
			}),
		).toBe("No repository");
	});

	test("keeps owner-qualified repository identities distinct in filters", () => {
		const otherOwnerSession: SessionAnalytics = {
			...session,
			git_remote: "github.com/other/rudel-v2",
			project_path: "/opt/coding-projects/rudel-v2",
			repository: "other/rudel-v2",
			repository_identity: {
				repoKey: "remote:github.com/other/rudel-v2",
				repoLabel: "other/rudel-v2",
				repoName: "rudel-v2",
				source: "remote",
				worktree: null,
			},
			session_id: "session-2",
			worktree: null,
		};

		expect(
			buildSessionOverviewFilterOptions(
				[session, otherOwnerSession],
				"repository",
				{},
			),
		).toEqual([
			{
				label: "rudel-v2 (other/rudel-v2)",
				value: "remote:github.com/other/rudel-v2",
			},
			{ label: "rudel-v2 (rudel-v2)", value: "path:rudel-v2" },
		]);
	});

	test("cleans repository prefixes from branch labels using the structured name", () => {
		expect(
			getSessionBranchLabel({
				...session,
				git_branch: "refs/heads/rudel/pr2-usage-events",
			}),
		).toBe("pr2-usage-events");
	});
});

describe("compareSessions", () => {
	test("sorts signal columns by frustration signals, leaving out positive ones", () => {
		const louderSession: SessionAnalytics = {
			...session,
			member_swears: 2,
			model_positive: 1,
		};
		const quieterSession: SessionAnalytics = {
			...session,
			member_apologies: 1,
			session_id: "session-2",
		};

		expect(compareSessions(louderSession, quieterSession, "signals", {})).toBe(
			1,
		);
	});
});
