import { beforeAll, expect, test } from "bun:test";
import type { AaRelease } from "@rudel/api-routes/trends-aa-release";
import { trendsSourcesSchema } from "@rudel/api-routes/trends-sources";
import type { T3UsageRelease } from "@rudel/api-routes/trends-t3-usage";
import type { TrendsUsage } from "@rudel/api-routes/trends-usage";
import { sqlClient } from "../db.js";
import { handleTrendsSourcesRequest } from "../handlers/trends-sources-http.js";
import {
	postgresTrendsSourceStore,
	refreshTrendsSources,
	usageCapture,
} from "../services/trends-sources.service.js";

const store = postgresTrendsSourceStore();

beforeAll(async () => {
	await sqlClient`DELETE FROM trends_source`;
});

function aaRelease(models: number, fetchedAt: string): AaRelease {
	return {
		source: "artificial_analysis",
		fetchedAt,
		sourceUrl: "https://artificialanalysis.ai/models",
		sourceSha256: "a".repeat(64),
		indexVersion: "4.0",
		records: Array.from({ length: models }, (_, index) => ({
			id: crypto.randomUUID(),
			slug: `model-${index}`,
			name: `Model ${index}`,
			releaseSlug: `model-${index}`,
			creatorId: crypto.randomUUID(),
			creatorSlug: "lab",
			creatorName: "Lab",
			releasedAt: "2026-01-01",
			openWeights: false,
			deprecated: false,
			deprecatedTo: null,
			isReasoning: true,
			reasoningSetting: null,
			effortLabel: null,
			effortOrder: null,
			estimated: false,
			intelligence: 50 + index,
			costPerTaskUsd: 0.1,
			totalCostUsd: 100,
			outputTokensPerTask: 1000,
			totalOutputTokens: 1_000_000,
			timePerTaskSeconds: 30,
			outputSpeed: 80,
			inputPrice: 1,
			outputPrice: 5,
			contextWindow: 200_000,
		})),
	};
}

function t3Release(
	fetchedAt: string,
	start: string,
	endExclusive: string,
	days: readonly string[],
): T3UsageRelease {
	return {
		source: "t3_code",
		fetchedAt,
		sourceUrl: "https://slopalytics.com/data/t3-usage.json",
		sourceSha256: "b".repeat(64),
		upstream: {
			fetchedAt,
			project: "t3",
			source: "https://posthog.example/t3",
			start,
			endExclusive,
			runawayThreshold: 500,
		},
		sent: days.flatMap((day) => [
			{ day, harness: "claudeAgent", turns: 20, installs: 2, excludedTurns: 0 },
			{ day, harness: "codex", turns: 10, installs: 1, excludedTurns: 0 },
		]),
		metrics: [],
	};
}

function usage(runs: number, models: number): TrendsUsage {
	const metrics = {
		runs,
		apologiesPer100Runs: null,
		reactions: null,
		replyRate: 0.5,
		swearsPer1kPrompts: null,
		toolFailureRate: null,
		runSeconds: null,
		outputTokensPerRun: null,
		costPerRunUsd: null,
	};
	return {
		generatedAt: "2026-10-04T04:00:00.000Z",
		scope: "all_time",
		periodStart: "2026-01-01",
		periodEndExclusive: "2026-10-04",
		previousPeriodStart: "2026-01-01",
		thresholds: {
			minRuns: 100,
			minDevelopers: 3,
			minWorkspaces: 2,
			minRunShare: 0.01,
		},
		totals: { runs, developers: 5 },
		models: Array.from({ length: models }, (_, index) => ({
			familyId: `family-${index}`,
			runs,
			developers: 5,
			workspaces: 2,
			firstUsedAt: "2026-01-01",
			totalOutputTokens: 1000,
			totalCostUsd: 10,
			topApology: null,
			current: metrics,
			previous: null,
		})),
		shareWindow: {
			start: "2026-07-01",
			endExclusive: "2026-10-04",
			completeWeeks: 13,
		},
		weeks: [],
		harnessDays: [],
	};
}

async function servedSources() {
	const response = await handleTrendsSourcesRequest({
		cors: {},
		method: "GET",
	});
	expect(response.status).toBe(200);
	return trendsSourcesSchema.parse(await response.json());
}

test("stores each source's capture and serves it", async () => {
	const outcomes = await refreshTrendsSources(store, {
		benchmarks: async () => aaRelease(10, "2026-10-03T04:00:00.000Z"),
		harness: async () =>
			t3Release("2026-10-03T04:00:00.000Z", "2026-09-03", "2026-09-05", [
				"2026-09-03",
				"2026-09-04",
			]),
		usage: async () =>
			usageCapture(usage(1000, 3), new Date("2026-10-03T04:00:00.000Z")),
	});

	expect(outcomes).toEqual({
		artificial_analysis: { status: "stored" },
		t3_code: { status: "stored" },
		opaline_usage: { status: "stored" },
	});
	const sources = await servedSources();
	expect(sources.benchmarks?.records).toHaveLength(10);
	expect(sources.harness?.upstream.start).toBe("2026-09-03");
	expect(sources.usage?.usage.totals.runs).toBe(1000);
});

test("a failed, blocked or suspicious capture keeps the stored one, and Slopalytics' window is merged in", async () => {
	const outcomes = await refreshTrendsSources(store, {
		benchmarks: async () => {
			throw new Error(
				"Fetch failed: HTTP 403 at https://artificialanalysis.ai/models",
			);
		},
		// The window moved a day: Sep 3 is no longer published.
		harness: async () =>
			t3Release("2026-10-04T04:00:00.000Z", "2026-09-04", "2026-09-06", [
				"2026-09-04",
				"2026-09-05",
			]),
		usage: async () =>
			usageCapture(usage(1200, 0), new Date("2026-10-04T04:00:00.000Z")),
	});

	expect(outcomes).toEqual({
		artificial_analysis: {
			status: "kept",
			reason: "Fetch failed: HTTP 403 at https://artificialanalysis.ai/models",
		},
		t3_code: { status: "stored" },
		opaline_usage: {
			status: "kept",
			reason: "Opaline usage published no models",
		},
	});
	const sources = await servedSources();
	expect(sources.benchmarks?.fetchedAt).toBe("2026-10-03T04:00:00.000Z");
	expect(sources.usage?.usage.totals.runs).toBe(1000);
	expect(sources.harness?.upstream.start).toBe("2026-09-03");
	expect(sources.harness?.upstream.endExclusive).toBe("2026-09-06");
	expect([...new Set(sources.harness?.sent.map((row) => row.day))]).toEqual([
		"2026-09-03",
		"2026-09-04",
		"2026-09-05",
	]);
});

test("a Slopalytics capture without Codex is rejected whole", async () => {
	const release = t3Release(
		"2026-10-05T04:00:00.000Z",
		"2026-09-05",
		"2026-09-07",
		["2026-09-05", "2026-09-06"],
	);
	const outcomes = await refreshTrendsSources(store, {
		benchmarks: async () => aaRelease(10, "2026-10-05T04:00:00.000Z"),
		harness: async () => ({
			...release,
			sent: release.sent.filter((row) => row.harness !== "codex"),
		}),
		usage: async () =>
			usageCapture(usage(1300, 3), new Date("2026-10-05T04:00:00.000Z")),
	});

	expect(outcomes.t3_code).toEqual({
		status: "kept",
		reason: "Slopalytics reported no Codex turns",
	});
	const sources = await servedSources();
	expect(sources.harness?.upstream.endExclusive).toBe("2026-09-06");
	expect(sources.benchmarks?.fetchedAt).toBe("2026-10-05T04:00:00.000Z");
});
