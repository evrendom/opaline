import { describe, expect, test } from "bun:test";
import { SessionAnalyticsSchema, unifyRepoIdentities } from "@rudel/api-routes";
import {
	mapSessionAnalyticsRow,
	type SessionAnalyticsRaw,
} from "../services/session-analytics.service.js";
import { summarizeSessionLanguageSignals } from "../services/session-language-signal-summary.js";

const rawSession: SessionAnalyticsRaw = {
	actual_duration_min: 12,
	cost_is_complete: 1,
	cost_uses_default_region: 0,
	error_count: 3,
	estimated_cost: 1.25,
	git_branch: "main",
	git_remote: "",
	git_sha: "abc123",
	input_tokens: 6_000,
	last_interaction_date: "2026-08-19T12:12:00Z",
	model_used: "gpt-5.6",
	member_apologies: 0,
	member_apology_matches: [],
	member_positive: 0,
	member_positive_matches: [],
	member_swears: 0,
	member_swear_matches: [],
	model_apologies: 0,
	model_apology_matches: [],
	model_positive: 0,
	model_positive_matches: [],
	model_swears: 0,
	model_swear_matches: [],
	organization_id: "org-1",
	output_tokens: 4_000,
	package_name: "",
	project_path: "/opt/conductor/workspaces/rudel-v2/osaka",
	session_date: "2026-08-19T12:00:00Z",
	session_id: "session-1",
	source: "codex",
	skills: [],
	slash_commands: [],
	subagent_count: 2,
	subagent_types: [],
	total_interactions: 6,
	total_tokens: 10_000,
	user_id: "user-1",
};

describe("mapSessionAnalyticsRow", () => {
	test("uses the canonical repository label for Conductor workspaces", () => {
		expect(mapSessionAnalyticsRow(rawSession)).toMatchObject({
			git_branch: "main",
			repository: "rudel-v2",
			repository_identity: {
				repoKey: "path:rudel-v2",
				repoLabel: "rudel-v2",
				repoName: "rudel-v2",
				source: "worktree",
				worktree: "osaka",
			},
			worktree: "osaka",
		});
	});

	test("joins a remote-less Conductor session to the workspace's same-name remote repo", () => {
		const resolver = unifyRepoIdentities([
			{
				gitRemote: "github.com/evrendom/rudel-v2",
				packageName: null,
				projectPath: "/work/rudel-v2",
			},
		]);
		expect(mapSessionAnalyticsRow(rawSession, resolver)).toMatchObject({
			repository: "evrendom/rudel-v2",
			repository_identity: {
				repoKey: "remote:github.com/evrendom/rudel-v2",
				source: "remote",
				worktree: "osaka",
			},
			worktree: "osaka",
		});
	});

	test("preserves list metrics through contract parsing", () => {
		const parsed = SessionAnalyticsSchema.parse(
			mapSessionAnalyticsRow(rawSession),
		);

		expect(parsed).toMatchObject({
			error_count: 3,
			git_branch: "main",
			subagent_count: 2,
			total_interactions: 6,
		});
	});

	test("returns native subagent identities and their models in the list contract", () => {
		const parsed = SessionAnalyticsSchema.parse(
			mapSessionAnalyticsRow({
				...rawSession,
				native_subagents: [
					["child-a", "claude-sonnet-4"],
					["child-b", ""],
				],
			}),
		);
		expect(parsed.native_subagents).toEqual([
			{ subagent_id: "child-a", model: "claude-sonnet-4" },
			{ subagent_id: "child-b", model: null },
		]);
		expect(parsed.subagent_count).toBe(2);
	});

	test("maps typed cross-provider children without folding their own usage", () => {
		const mapped = mapSessionAnalyticsRow({
			...rawSession,
			linked_subagent_count: 1,
			linked_subagents: [
				["child-1", "claude", "claude", "claude-fable-5", "prompt_echo"],
			],
		});

		expect(mapped.linked_subagent_count).toBe(1);
		expect(mapped.linked_subagents).toEqual([
			{
				confidence: "prompt_echo",
				model: "claude-fable-5",
				provider: "claude",
				session_id: "child-1",
				source: "claude",
			},
		]);
		expect(mapped.total_tokens).toBe(rawSession.total_tokens);
	});

	test("returns an unknown cost when server pricing is incomplete", () => {
		expect(
			mapSessionAnalyticsRow({
				...rawSession,
				cost_is_complete: 0,
			}).estimated_cost,
		).toBeNull();
	});
});

describe("summarizeSessionLanguageSignals", () => {
	test("returns persisted counts for member and model text", () => {
		const transcript = [
			{
				message: {
					content:
						"<system_instruction>Excellent work</system_instruction>Great, sorry, this feels fishy shit??",
					role: "user",
				},
				sessionId: "session-1",
				timestamp: "2026-08-19T12:00:00Z",
				type: "user",
				uuid: "user-1",
			},
			{
				message: {
					content: [
						{
							text: "Excellent, sorry, this feels fishy fuck??",
							type: "text",
						},
					],
					role: "assistant",
				},
				sessionId: "session-1",
				timestamp: "2026-08-19T12:00:01Z",
				type: "assistant",
				uuid: "assistant-1",
			},
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n");

		expect(summarizeSessionLanguageSignals(transcript)).toEqual({
			member_apologies: 1,
			member_positive: 1,
			member_negative: 2,
			member_swears: 1,
			model_apologies: 1,
			model_positive: 0,
			model_swears: 0,
		});
	});
});
