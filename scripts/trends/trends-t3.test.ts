import { expect, test } from "bun:test";
import { harnessBalance } from "../../apps/marketing/src/components/trends/trends-harness-chart";
import {
	PREVIEW_TRENDS_SNAPSHOT,
	previewBenchmarks,
} from "../../apps/marketing/src/trends/preview-snapshot";
import {
	addOpalineDays,
	applyT3Usage,
	deriveT3HarnessDays,
	deriveT3ModelDays,
} from "../../apps/marketing/src/trends/trends-t3";
import { t3UsageReleaseSchema } from "../../packages/api-routes/src/trends-t3-usage";
import { toT3UsageRelease } from "./fetch-t3-usage";

const metric = {
	tokenTurns: 0,
	input: 0,
	output: 0,
	pricedTurns: 0,
	estimatedCost: 0,
};

const snapshot = {
	schemaVersion: 2 as const,
	fetchedAt: "2026-10-03T02:44:34.175071+00:00",
	start: "2026-10-01",
	endExclusive: "2026-10-03",
	project: "T3 Code PROD",
	timezone: "UTC" as const,
	source: "https://us.posthog.com/project/1",
	runawayThreshold: 10000,
	sent: [
		{
			day: "2026-10-01",
			harness: "claudeAgent",
			turns: 300,
			installs: 9,
			excludedTurns: 0,
		},
		{
			day: "2026-10-01",
			harness: "codex",
			turns: 100,
			installs: 4,
			excludedTurns: 0,
		},
		{
			day: "2026-10-01",
			harness: "cursor",
			turns: 999,
			installs: 7,
			excludedTurns: 0,
		},
		{
			day: "2026-10-02",
			harness: "claudeAgent",
			turns: 50,
			installs: 2,
			excludedTurns: 0,
		},
		{
			day: "2026-10-02",
			harness: "codex",
			turns: 50,
			installs: 2,
			excludedTurns: 0,
		},
	],
	metrics: [
		{
			...metric,
			day: "2026-10-01",
			harness: "claudeAgent",
			model: "Opus 5.5",
			tokenTurns: 10,
			input: 4_000_000,
			output: 1_000_000,
			pricedTurns: 10,
			estimatedCost: 29.4,
		},
		// Unpriced on Slopalytics: its tokens count, its spend is zero.
		{
			...metric,
			day: "2026-10-01",
			harness: "claudeAgent",
			model: "Unreported model",
			tokenTurns: 10,
			input: 9_000_000,
			output: 500_000,
		},
		{
			...metric,
			day: "2026-10-01",
			harness: "codex",
			model: "GPT-6 Astra",
			tokenTurns: 5,
			input: 1_000_000,
			output: 2_000_000,
			pricedTurns: 5,
			estimatedCost: 110,
		},
		// Codex has no token report on the second day.
		{
			...metric,
			day: "2026-10-02",
			harness: "claudeAgent",
			model: "Opus 5.5",
			tokenTurns: 3,
			input: 70,
			output: 30,
			pricedTurns: 3,
			estimatedCost: 0.01,
		},
	],
};

const release = toT3UsageRelease(
	snapshot,
	"a".repeat(64),
	"2026-10-03T03:00:00.000Z",
);

test("the capture keeps only Claude Code and Codex rows with upstream provenance", () => {
	expect(t3UsageReleaseSchema.safeParse(release).success).toBe(true);
	expect(new Set(release.sent.map((row) => row.harness))).toEqual(
		new Set(["claudeAgent", "codex"]),
	);
	expect(release.upstream.fetchedAt).toBe(snapshot.fetchedAt);
});

test("prompts, tokens and spend per harness-day exactly as published", () => {
	const [first, second] = deriveT3HarnessDays(release);
	expect(first?.day).toBe("2026-10-01");
	expect(first?.runs).toEqual({ "claude-code": 300, codex: 100 });
	expect(first?.outputTokens).toEqual({
		"claude-code": 14_500_000,
		codex: 3_000_000,
	});
	expect(first?.costUsd?.["claude-code"]).toBeCloseTo(29.4, 9);
	expect(first?.costUsd?.codex).toBe(110);
	// Codex has no token report: a gap, not a zero.
	expect(second?.runs).toEqual({ "claude-code": 50, codex: 50 });
	expect(second?.outputTokens).toBeNull();
	expect(second?.costUsd).toBeNull();
});

test("the balance leaves unreported days blank and the rest of the snapshot untouched", () => {
	const applied = applyT3Usage(PREVIEW_TRENDS_SNAPSHOT, release);
	expect(applied.sources.harnesses.kind).toBe("t3_code");
	expect(applied.sources.usage).toEqual(PREVIEW_TRENDS_SNAPSHOT.sources.usage);
	expect(applied.models).toBe(PREVIEW_TRENDS_SNAPSHOT.models);
	const balance = harnessBalance(applied.harnessDays ?? [], "outputTokens");
	expect(balance[0]?.share).toBeCloseTo(14.5 / 17.5, 9);
	expect(balance[1]?.share).toBeNull();
	expect(harnessBalance(applied.harnessDays ?? [], "runs")[1]?.difference).toBe(
		0,
	);
});

test("turns per model per day sum both harnesses and keep only pickable named models", () => {
	const crossHarness = {
		...release,
		metrics: [
			...release.metrics,
			{
				...metric,
				day: "2026-10-01",
				harness: "claudeAgent",
				model: "GPT-6 Astra",
				tokenTurns: 2,
			},
			{
				...metric,
				day: "2026-10-02",
				harness: "codex",
				model: "Other models",
				tokenTurns: 40,
			},
		],
	};
	expect(deriveT3ModelDays(crossHarness, previewBenchmarks())).toEqual([
		{
			day: "2026-10-01",
			turnsByModel: { "claude-opus-5-5": 10, "gpt-6-astra": 7 },
		},
		{ day: "2026-10-02", turnsByModel: { "claude-opus-5-5": 3 } },
	]);
});

test("the model days start at the first day with a per-model report", () => {
	const earlier = {
		...release,
		upstream: { ...release.upstream, start: "2026-09-30" },
	};
	expect(
		deriveT3ModelDays(earlier, previewBenchmarks()).map((day) => day.day),
	).toEqual(["2026-10-01", "2026-10-02"]);
});

test("Opaline's own days join T3 Code's by transcript and fill the measures T3 Code left blank", () => {
	const snapshot = {
		...PREVIEW_TRENDS_SNAPSHOT,
		opalineHarnessDays: [
			{
				day: "2026-09-30",
				runs: { "claude-code": 5, codex: 2 },
				inputTokens: { "claude-code": 400, codex: 100 },
				outputTokens: { "claude-code": 70, codex: 30 },
				costUsd: { "claude-code": 1, codex: 0.5 },
			},
			{
				day: "2026-10-01",
				runs: { "claude-code": 1, codex: 1 },
				outputTokens: { "claude-code": 9, codex: 9 },
				costUsd: { "claude-code": 1, codex: 1 },
			},
		],
	};
	const days = addOpalineDays(
		[
			{
				day: "2026-09-30",
				runs: { "claude-code": 100, codex: 50 },
				outputTokens: { "claude-code": 1000, codex: 500 },
				costUsd: null,
			},
			{
				day: "2026-10-01",
				runs: { "claude-code": 10, codex: 5 },
				outputTokens: { "claude-code": 20, codex: 10 },
				costUsd: { "claude-code": 2, codex: 2 },
			},
		],
		snapshot,
	);
	expect(days).toEqual([
		{
			day: "2026-09-30",
			runs: { "claude-code": 105, codex: 52 },
			outputTokens: { "claude-code": 1470, codex: 630 },
			// T3 Code left spend blank that day: Opaline's alone.
			costUsd: { "claude-code": 1, codex: 0.5 },
		},
		{
			day: "2026-10-01",
			runs: { "claude-code": 11, codex: 6 },
			// No input tokens captured that day: tokens stay T3 Code's.
			outputTokens: { "claude-code": 20, codex: 10 },
			costUsd: { "claude-code": 3, codex: 3 },
		},
	]);
});
