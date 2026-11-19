import { describe, expect, test } from "bun:test";
import type { SessionAnalytics } from "@rudel/api-routes";
import { buildSessionMemberProfileSummaries } from "./session-member-profile-summary";

function createSession({
	date,
	id,
	model,
	userId,
}: {
	date: string;
	id: string;
	model: string;
	userId: string;
}): SessionAnalytics {
	return {
		duration_min: 12,
		error_count: 0,
		git_branch: "main",
		input_tokens: 1_000,
		member_apologies: 0,
		member_positive: 0,
		member_swears: 0,
		model_apologies: 0,
		model_positive: 0,
		model_swears: 0,
		model_used: model,
		output_tokens: 500,
		project_path: "/workspace/rudel",
		repository: "obsessiondb/rudel",
		repository_identity: {
			repoKey: "remote:github.com/obsessiondb/rudel",
			repoLabel: "obsessiondb/rudel",
			repoName: "rudel",
			source: "remote",
			worktree: null,
		},
		session_date: date,
		session_id: id,
		skills: [],
		slash_commands: [],
		subagent_count: 0,
		subagent_types: [],
		total_tokens: 1_500,
		total_interactions: 1,
		user_id: userId,
		worktree: null,
	};
}

describe("buildSessionMemberProfileSummaries", () => {
	test("builds a selected-range activity trend and favorite model per member", () => {
		const summaries = buildSessionMemberProfileSummaries([
			createSession({
				date: "2026-08-20T09:00:00.000Z",
				id: "session-1",
				model: "claude-sonnet-4",
				userId: "user-1",
			}),
			createSession({
				date: "2026-08-21T09:00:00.000Z",
				id: "session-2",
				model: "gpt-5",
				userId: "user-1",
			}),
			createSession({
				date: "2026-08-21T13:00:00.000Z",
				id: "session-3",
				model: "gpt-5",
				userId: "user-1",
			}),
			createSession({
				date: "2026-08-20T11:00:00.000Z",
				id: "session-4",
				model: "claude-opus-4",
				userId: "user-2",
			}),
		]);

		expect(summaries.get("user-1")).toEqual({
			activity: [1, 2],
			favoriteModel: "gpt-5",
		});
		expect(summaries.get("user-2")).toEqual({
			activity: [1, 0],
			favoriteModel: "claude-opus-4",
		});
	});
});
