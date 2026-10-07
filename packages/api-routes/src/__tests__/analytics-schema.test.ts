import { describe, expect, test } from "bun:test";
import {
	DaysInputSchema,
	DeveloperSummarySchema,
	DeveloperTeamCardSchema,
	DimensionAnalysisInputSchema,
	HistoricalSkillDetailSchema,
	HistoricalSkillSummarySchema,
	SessionAnalyticsSchema,
	SessionListInputSchema,
} from "../schemas/analytics.js";

describe("analytics input schemas", () => {
	test("reject oversized free-form analytics filters", () => {
		expect(() =>
			SessionListInputSchema.parse({
				days: 7,
				projectPath: "a".repeat(4097),
			}),
		).toThrow();
	});

	test("bounds historical skill version bodies", () => {
		const version = {
			content: "a".repeat(256 * 1024 + 1),
			contentSha256: "0".repeat(64),
			firstUsedAt: "2026-08-25T00:00:00Z",
			lastUsedAt: "2026-08-25T00:00:00Z",
			sessionCount: 1,
			sourceAgent: "claude",
		};
		expect(
			HistoricalSkillDetailSchema.safeParse({
				claudeSessionCount: 1,
				codexSessionCount: 0,
				name: "large-skill",
				sessionCount: 1,
				sourceAgents: ["claude"],
				unavailableSessionCount: 0,
				versions: [version],
			}).success,
		).toBe(false);
	});

	test("days capped at 365", () => {
		expect(DaysInputSchema.safeParse({ days: 365 }).success).toBe(true);
		expect(DaysInputSchema.safeParse({ days: 366 }).success).toBe(false);
	});

	test("limit capped at 1000 on session list", () => {
		expect(SessionListInputSchema.safeParse({ limit: 1000 }).success).toBe(
			true,
		);
		expect(SessionListInputSchema.safeParse({ limit: 1001 }).success).toBe(
			false,
		);
	});

	test("session rows default missing persisted language counts to zero", () => {
		const parsed = SessionAnalyticsSchema.parse({
			duration_min: 0,
			input_tokens: 0,
			model_used: "",
			output_tokens: 0,
			project_path: "",
			repository: null,
			repository_identity: {
				repoKey: "path-raw:",
				repoLabel: "Untitled project",
				repoName: null,
				source: "unresolved",
				worktree: null,
			},
			session_date: "2026-08-19T00:00:00Z",
			session_id: "session-1",
			skills: [],
			slash_commands: [],
			subagent_types: [],
			total_interactions: 0,
			total_tokens: 0,
			user_id: "user-1",
		});

		expect(parsed).toMatchObject({
			member_apologies: 0,

			member_positive: 0,

			member_swears: 0,

			model_apologies: 0,

			model_positive: 0,

			model_swears: 0,
		});
	});

	test("accepts additive typed linked subagent metadata", () => {
		const result = SessionAnalyticsSchema.pick({
			linked_subagent_count: true,
			linked_subagents: true,
		}).parse({
			linked_subagent_count: 1,
			linked_subagents: [
				{
					confidence: "prompt_echo",
					model: "gpt-5.5",
					provider: "openai",
					session_id: "child-1",
					source: "codex",
				},
			],
		});

		expect(result.linked_subagent_count).toBe(1);
		expect(result.linked_subagents?.[0]?.model).toBe("gpt-5.5");
	});

	test("session list input does not retain view-state enrichment ids", () => {
		const parsed = SessionListInputSchema.parse({
			signalSessionIds: ["session-1"],
		});

		expect(parsed).not.toHaveProperty("signalSessionIds");
	});

	test("keeps skill attribution backward compatible and capped", () => {
		const legacySummary = HistoricalSkillSummarySchema.parse({
			name: "testing-bun",
			sessionCount: 3,
			claudeSessionCount: 2,
			codexSessionCount: 1,
		});
		expect(legacySummary).toEqual({
			name: "testing-bun",
			sessionCount: 3,
			claudeSessionCount: 2,
			codexSessionCount: 1,
			contentPreview: null,
		});
		expect(
			HistoricalSkillSummarySchema.parse({
				...legacySummary,
				attribution: {},
			}).attribution,
		).toEqual({ userCount: 0, topUsers: [], repoCount: 0, topRepos: [] });

		const oversizedAttribution = {
			...legacySummary,
			attribution: {
				userCount: 4,
				topUsers: ["one", "two", "three", "four"].map((userId) => ({
					userId,
					sessionCount: 1,
				})),
				repoCount: 0,
				topRepos: [],
			},
		};
		expect(
			HistoricalSkillSummarySchema.safeParse(oversizedAttribution).success,
		).toBe(false);

		expect(
			HistoricalSkillSummarySchema.safeParse({
				...legacySummary,
				attribution: {
					userCount: 0,
					topUsers: [],
					repoCount: 4,
					topRepos: ["one", "two", "three", "four"].map((repoKey) => ({
						repoKey,
						repoLabel: repoKey,
						sessionCount: 1,
					})),
				},
			}).success,
		).toBe(false);
	});

	test("limit capped at 1000 on dimension analysis", () => {
		expect(
			DimensionAnalysisInputSchema.safeParse({
				dimension: "user_id",
				metric: "session_count",
				limit: 1000,
			}).success,
		).toBe(true);
		expect(
			DimensionAnalysisInputSchema.safeParse({
				dimension: "user_id",
				metric: "session_count",
				limit: 1001,
			}).success,
		).toBe(false);
	});

	test("retains interaction-count metrics for older clients", () => {
		for (const metric of ["avg_interactions", "total_interactions"]) {
			expect(
				DimensionAnalysisInputSchema.safeParse({
					dimension: "user_id",
					metric,
				}).success,
			).toBe(true);
		}
	});
});

describe("usage-event cutover output contract", () => {
	test("keeps pricing diagnostics and coverage internal", () => {
		const publicKeys = [
			DeveloperSummarySchema,
			DeveloperTeamCardSchema,
		].flatMap((schema) => Object.keys(schema.shape));

		for (const internalField of [
			"integrity_count",
			"priced_token_percent",
			"pricing_coverage",
			"pricing_coverage_percent",
			"token_classes",
			"unpriced_session_count",
			"unresolved_models",
		]) {
			expect(publicKeys).not.toContain(internalField);
		}
	});

	test("reuses nullable cost fields for fail-closed pricing", () => {
		expect(DeveloperSummarySchema.shape.cost.safeParse(null).success).toBe(
			true,
		);
		expect(DeveloperTeamCardSchema.shape.cost.safeParse(null).success).toBe(
			true,
		);
	});
});
