import { describe, expect, test } from "bun:test";
import {
	buildDigestReport,
	type DigestRow,
	repositoryLabel,
} from "./report.js";
import { periodOf } from "./schedule.js";

function row(overrides: Partial<DigestRow>): DigestRow {
	return {
		user_id: "u1",
		session_id: "s1",
		day: "2026-10-06",
		agent: "claude_code",
		repository: "github.com/acme/web",
		model: "claude-opus-5-5",
		runs: 2,
		prompts: 3,
		active_minutes: 30,
		cost_usd: 2,
		tool_calls: 40,
		failed_calls: 4,
		interrupts: 1,
		compactions: 0,
		api_errors_known_runs: 0,
		api_errors: 0,
		cache_read_tokens: 0,
		longest_run_minutes: 12,
		subagent_launches: 1,
		subagent_minutes: 5,
		subagent_runs: 1,
		subagent_cost_usd: 0.5,
		subagent_tool_calls: 10,
		subagent_failed_calls: 1,
		turn_errors: 0,
		timeouts: 0,
		refusals: 0,
		input_tokens: 0,
		...overrides,
	};
}

describe("usage digest report", () => {
	test("names repositories without paths or hosts", () => {
		expect(repositoryLabel("github.com/acme/web")).toBe("acme/web");
		expect(repositoryLabel("git@github.com:acme/web.git")).toBe("acme/web");
		expect(repositoryLabel("https://gitlab.example.com/group/sub/api")).toBe(
			"sub/api",
		);
		expect(repositoryLabel("/Users/someone/code/opaline")).toBe("opaline");
		expect(repositoryLabel("@acme/sdk")).toBe("@acme/sdk");
		expect(repositoryLabel("")).toBe("Other");
	});

	test("sums each member and the team over the period, apart from the week before", () => {
		const report = buildDigestReport(
			[
				row({}),
				row({
					session_id: "s2",
					day: "2026-10-08",
					repository: "/home/x/api",
					model: "<synthetic>",
				}),
				row({
					user_id: "u2",
					session_id: "s3",
					agent: "codex",
					model: "gpt-6.1-sol",
					api_errors_known_runs: 2,
					api_errors: 1,
				}),
				// The same session on another day counts once.
				row({ day: "2026-10-07" }),
				// The week before, and usage no run claims.
				row({ day: "2026-09-30", session_id: "s0" }),
				row({
					user_id: "u3",
					session_id: "s9",
					runs: 0,
					prompts: 0,
					active_minutes: 0,
					cost_usd: 5,
				}),
			],
			[
				{ user_id: "u1", kind: "command", name: "/review", uses: 3 },
				{ user_id: "u1", kind: "skill", name: "tdd", uses: 5 },
				{ user_id: "u1", kind: "subagent", name: "Explore", uses: 2 },
			],
			[
				{
					user_id: "u1",
					session_id: "s1",
					day: "2026-10-06",
					negatives: 2,
					swears: 1,
					apologies: 4,
					phrases: { "didn't work": 2 },
					title: "Fix the login redirect",
					repository: "github.com/acme/web",
				},
				{
					user_id: "u1",
					session_id: "s0",
					day: "2026-09-30",
					negatives: 1,
					swears: 0,
					apologies: 0,
					phrases: { "not working": 1 },
					title: null,
					repository: "",
				},
			],
			periodOf("weekly", "2026-10-05"),
		);
		expect([...report.members.keys()].sort()).toEqual(["u1", "u2"]);
		const you = report.members.get("u1");
		expect(you?.current.sessions).toBe(2);
		expect(you?.previous?.sessions).toBe(1);
		expect(you?.current.apiErrors).toBeNull();
		expect(you?.days).toEqual([0, 2, 2, 2, 0, 0, 0]);
		expect(you?.repositories.map((item) => item.label)).toEqual([
			"acme/web",
			"api",
		]);
		expect(you?.models.map((item) => item.label)).toEqual(["Claude Opus 5.5"]);
		expect(you?.toolbox).toEqual([
			{ name: "tdd", uses: 5, kind: "skill" },
			{ name: "/review", uses: 3, kind: "command" },
		]);
		expect(you?.subagents.current).toEqual({
			launches: 3,
			minutes: 15,
			runs: 3,
			costUsd: 1.5,
			toolCalls: 30,
			failedCalls: 3,
		});
		expect(you?.subagents.previous?.launches).toBe(1);
		expect(you?.subagents.types).toEqual([{ name: "Explore", uses: 2 }]);
		expect(you?.models.map((item) => item.provider)).toEqual(["anthropic"]);
		expect(you?.frustration).toEqual({
			moments: 3,
			previousMoments: 1,
			swears: 1,
			apologies: 4,
			phrases: [{ text: "didn't work", count: 2 }],
			sessions: [
				{ title: "Fix the login redirect", day: "2026-10-06", moments: 3 },
			],
		});
		expect(report.team.frustration).toBeNull();
		expect(report.team.activeMembers).toBe(2);
		expect(report.team.previousActiveMembers).toBe(1);
		expect(report.team.current.sessions).toBe(3);
		expect(report.team.current.costUsd).toBe(13);
		expect(report.team.current.apiErrors).toBe(1);
		expect(report.team.agents.map((item) => [item.label, item.share])).toEqual([
			["Claude Code", 0.75],
			["Codex", 0.25],
		]);
	});
});
