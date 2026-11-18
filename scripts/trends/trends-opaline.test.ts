import { expect, test } from "bun:test";
import { rankMovements } from "../../apps/marketing/src/components/trends/trends-movement";
import {
	hasMeasurement,
	shareAddsOpaline,
	sharePeriods,
	TRENDS_SECTIONS,
} from "../../apps/marketing/src/components/trends/trends-sections";
import { PREVIEW_TRENDS_SNAPSHOT } from "../../apps/marketing/src/trends/preview-snapshot";
import { applyOpalineUsage } from "../../apps/marketing/src/trends/trends-opaline";
import {
	type TrendsUsage,
	type TrendsUsageMetrics,
	trendsUsageSchema,
} from "../../packages/api-routes/src/trends-usage";

const measured: TrendsUsageMetrics = {
	runs: 400,
	apologiesPer100Runs: 4,
	reactions: { negative: 0.1, mixed: 0.1, neutral: 0.5, positive: 0.3 },
	replyRate: 0.6,
	swearsPer1kPrompts: 2,
	toolFailureRate: 0.05,
	runSeconds: { p50: 40, p90: 200, p99: 900 },
	outputTokensPerRun: { p50: 1500, p90: 6000, p99: 20000 },
	costPerRunUsd: { p50: 0.1, p90: 0.6, p99: 2 },
};

const usage: TrendsUsage = trendsUsageSchema.parse({
	generatedAt: "2026-10-03T08:00:00.000Z",
	periodStart: "2026-09-01",
	periodEndExclusive: "2026-10-01",
	previousPeriodStart: "2026-08-01",
	thresholds: {
		minRuns: 100,
		minDevelopers: 3,
		minWorkspaces: 2,
		minRunShare: 0.01,
	},
	totals: { runs: 1000, developers: 12 },
	models: [
		{
			familyId: "claude-opus-5-5",
			runs: 400,
			developers: 8,
			workspaces: 4,
			firstUsedAt: "2026-09-22",
			totalOutputTokens: 600000,
			totalCostUsd: 40,
			topApology: "You're right",
			current: measured,
			previous: null,
		},
		{
			familyId: "gpt-6-astra",
			runs: 300,
			developers: 5,
			workspaces: 3,
			firstUsedAt: "2026-08-04",
			totalOutputTokens: 500000,
			totalCostUsd: 0,
			topApology: null,
			// No transcript records and no priced requests for this model.
			current: {
				...measured,
				runs: 300,
				runSeconds: { p50: 60, p90: 300, p99: 1200 },
				swearsPer1kPrompts: null,
				toolFailureRate: null,
				costPerRunUsd: null,
			},
			previous: { ...measured, runs: 200, costPerRunUsd: null },
		},
	],
	shareWindow: {
		start: "2026-06-29",
		endExclusive: "2026-09-28",
		completeWeeks: 13,
	},
	weeks: [],
	harnessDays: [],
});

const snapshot = applyOpalineUsage(
	PREVIEW_TRENDS_SNAPSHOT,
	usage,
	"https://opaline.so/api/trends/usage",
);
const section = (id: string) => {
	const found = TRENDS_SECTIONS.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Missing section ${id}`);
	return found;
};

test("published usage replaces the synthetic population and names come from the registry", () => {
	expect(snapshot.sources.usage.kind).toBe("opaline");
	expect(snapshot.sources.harnesses.kind).toBe("opaline");
	expect(
		snapshot.models.map((model) => [model.id, model.name, model.isNew]),
	).toEqual([
		["claude-opus-5-5", "Claude Opus 5.5", true],
		["gpt-6-astra", "GPT-6 Astra", false],
	]);
	expect(snapshot.models[1]?.effortPolicy).toBe("vendor_default");
	expect(snapshot.totals).toEqual(usage.totals);
});

test("a chart leaves out models without its figure instead of drawing zero", () => {
	const ids = (id: string) =>
		snapshot.models
			.filter((model) => hasMeasurement(section(id), model))
			.map((model) => model.id);
	expect(ids("cost")).toEqual(["claude-opus-5-5"]);
	expect(ids("run-time")).toEqual(["claude-opus-5-5", "gpt-6-astra"]);
});

test("rank movement skips periods without the figure", () => {
	const movements = rankMovements(section("cost"), snapshot.models);
	expect(movements.get("claude-opus-5-5")).toEqual({
		rank: 1,
		delta: null,
		isNew: true,
	});
	expect(movements.has("gpt-6-astra")).toBe(false);
	const runTime = rankMovements(section("run-time"), snapshot.models);
	expect(runTime.get("gpt-6-astra")?.delta).toBe(0);
});

test("Opaline's daily runs add to T3 Code's turns, model by model, on T3 Code's days", () => {
	const opaline = applyOpalineUsage(
		PREVIEW_TRENDS_SNAPSHOT,
		trendsUsageSchema.parse({
			...usage,
			modelDays: [
				{ day: "2026-09-29", runsByModel: { "claude-opus-5-5": 7 } },
				{
					day: "2026-09-30",
					runsByModel: { "claude-opus-5-5": 5, "gpt-6-astra": 2 },
				},
			],
		}),
		"https://opaline.so/api/trends/usage",
	);
	const snapshot = {
		...opaline,
		modelDays: [
			{ day: "2026-09-30", turnsByModel: { "claude-opus-5-5": 10 } },
			{ day: "2026-10-01", turnsByModel: { "gpt-6-astra": 4 } },
		],
	};
	expect(shareAddsOpaline(snapshot)).toBe(true);
	expect(sharePeriods(snapshot).periods).toEqual([
		{
			start: "2026-09-30",
			runsByModel: { "claude-opus-5-5": 15, "gpt-6-astra": 2 },
		},
		{ start: "2026-10-01", runsByModel: { "gpt-6-astra": 4 } },
	]);
	expect(shareAddsOpaline({ ...snapshot, opalineModelDays: undefined })).toBe(
		false,
	);
});
