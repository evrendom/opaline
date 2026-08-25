import { describe, expect, it } from "vitest";
import { buildBoundedSessionDetailViewModel } from "./bounded-session-detail";

describe("bounded session detail view model", () => {
	it("maps overview metadata without requiring a full transcript response", () => {
		const model = buildBoundedSessionDetailViewModel(
			{
				activityTotals: {
					edit: 0,
					error: 0,
					read: 0,
					signal: 0,
					signalScanVersion: 1,
					skill: 1,
					subagent: 1,
					write: 0,
				},
				context: { errors: [], files: [] },
				revision: "2026-08-25T08:00:00.000Z",
				session: {
					durationMinutes: 2,
					estimatedCost: 0.05,
					gitBranch: "main",
					gitSha: "abcdef",
					inputTokens: 100,
					lastInteractionDate: "2026-08-25T08:02:00.000Z",
					modelUsed: "claude-sonnet-4-5",
					outputTokens: 200,
					projectPath: "/repo",
					repository: "rudel",
					sessionDate: "2026-08-25T08:00:00.000Z",
					sessionId: "session-1",
					skills: ["testing-bun"],
					slashCommands: ["review"],
					source: "claude_code",
					totalTokens: 300,
					userId: "user-1",
				},
				subagents: [
					{
						estimatedCost: 0.01,
						hasTranscript: true,
						inputTokens: 10,
						model: "claude-haiku-4-5",
						outputTokens: 20,
						subagentId: "agent-1",
						totalTokens: 30,
					},
				],
				turnPage: { items: [], nextCursor: null, total: 3 },
			},
			{ "user-1": "Ada" },
		);

		expect(model.safeSessionId).toBe("session-1");
		expect(model.safeUserDisplayName).toBe("Ada");
		expect(model.conversationSummary).toMatchObject({
			assistantMessages: 3,
			userMessages: 3,
		});
		expect(model.subagentSummaries).toEqual([
			{ id: "agent-1", model: "claude-haiku-4-5", totalTokens: 30 },
		]);
	});
});
