import { describe, expect, test } from "bun:test";
import type { AaRelease } from "./trends-aa-release.js";
import {
	acceptAaRelease,
	acceptT3Release,
	acceptUsageCapture,
	mergeT3Releases,
} from "./trends-sources.js";
import type { T3UsageRelease } from "./trends-t3-usage.js";
import type { TrendsUsageCapture } from "./trends-usage.js";

function t3Release(input: {
	fetchedAt: string;
	start: string;
	endExclusive: string;
	sent: T3UsageRelease["sent"];
	metrics?: T3UsageRelease["metrics"];
}): T3UsageRelease {
	return {
		source: "t3_code",
		fetchedAt: input.fetchedAt,
		sourceUrl: "https://slopalytics.com/data/t3-usage.json",
		sourceSha256: "a".repeat(64),
		upstream: {
			fetchedAt: input.fetchedAt,
			project: "t3",
			source: "https://posthog.example/t3",
			start: input.start,
			endExclusive: input.endExclusive,
			runawayThreshold: 500,
		},
		sent: input.sent,
		metrics: input.metrics ?? [],
	};
}

function sent(day: string, harness: string, turns: number) {
	return { day, harness, turns, installs: 1, excludedTurns: 0 };
}

function metric(day: string, harness: string, model: string, turns: number) {
	return {
		day,
		harness,
		model,
		tokenTurns: turns,
		input: turns * 10,
		output: turns,
		pricedTurns: turns,
		estimatedCost: turns / 100,
	};
}

describe("mergeT3Releases", () => {
	test("keeps days that left Slopalytics' rolling window", () => {
		const stored = t3Release({
			fetchedAt: "2026-10-03T04:00:00.000Z",
			start: "2026-09-03",
			endExclusive: "2026-09-05",
			sent: [
				sent("2026-09-03", "claudeAgent", 10),
				sent("2026-09-03", "codex", 5),
				sent("2026-09-04", "claudeAgent", 11),
				sent("2026-09-04", "codex", 6),
			],
		});
		const fresh = t3Release({
			fetchedAt: "2026-10-04T04:00:00.000Z",
			start: "2026-09-04",
			endExclusive: "2026-09-06",
			sent: [
				sent("2026-09-04", "claudeAgent", 12),
				sent("2026-09-04", "codex", 6),
				sent("2026-09-05", "claudeAgent", 13),
				sent("2026-09-05", "codex", 7),
			],
		});

		const merged = mergeT3Releases(stored, fresh);

		expect(merged.upstream.start).toBe("2026-09-03");
		expect(merged.upstream.endExclusive).toBe("2026-09-06");
		expect(merged.fetchedAt).toBe(fresh.fetchedAt);
		expect(merged.sent).toEqual([
			sent("2026-09-03", "claudeAgent", 10),
			sent("2026-09-03", "codex", 5),
			// A day both report takes the newer, revised figure.
			sent("2026-09-04", "claudeAgent", 12),
			sent("2026-09-04", "codex", 6),
			sent("2026-09-05", "claudeAgent", 13),
			sent("2026-09-05", "codex", 7),
		]);
	});

	test("never replaces a reported day with an empty one", () => {
		const stored = t3Release({
			fetchedAt: "2026-10-03T04:00:00.000Z",
			start: "2026-09-04",
			endExclusive: "2026-09-05",
			sent: [sent("2026-09-04", "claudeAgent", 12)],
			metrics: [metric("2026-09-04", "claudeAgent", "Opus 5.5", 8)],
		});
		const fresh = t3Release({
			fetchedAt: "2026-10-04T04:00:00.000Z",
			start: "2026-09-04",
			endExclusive: "2026-09-05",
			sent: [sent("2026-09-04", "claudeAgent", 0)],
			metrics: [metric("2026-09-04", "claudeAgent", "Opus 5.5", 0)],
		});

		const merged = mergeT3Releases(stored, fresh);

		expect(merged.sent).toEqual(stored.sent);
		expect(merged.metrics).toEqual(stored.metrics);
	});

	test("with nothing stored, takes the fresh release as it is", () => {
		const fresh = t3Release({
			fetchedAt: "2026-10-04T04:00:00.000Z",
			start: "2026-09-04",
			endExclusive: "2026-09-05",
			sent: [sent("2026-09-04", "codex", 3)],
			metrics: [metric("2026-09-04", "codex", "GPT-6 Astra", 3)],
		});

		expect(mergeT3Releases(null, fresh)).toEqual(fresh);
	});
});

describe("acceptT3Release", () => {
	test("rejects a release missing either harness", () => {
		const onlyCodex = t3Release({
			fetchedAt: "2026-10-04T04:00:00.000Z",
			start: "2026-09-04",
			endExclusive: "2026-09-05",
			sent: [sent("2026-09-04", "codex", 3)],
		});

		expect(acceptT3Release(onlyCodex)).toBe(
			"Slopalytics reported no Claude Code turns",
		);
	});

	test("accepts a release with both harnesses", () => {
		const both = t3Release({
			fetchedAt: "2026-10-04T04:00:00.000Z",
			start: "2026-09-04",
			endExclusive: "2026-09-05",
			sent: [
				sent("2026-09-04", "codex", 3),
				sent("2026-09-04", "claudeAgent", 4),
			],
		});

		expect(acceptT3Release(both)).toBeNull();
	});
});

function aaRelease(count: number): AaRelease {
	return {
		source: "artificial_analysis",
		fetchedAt: "2026-10-04T04:00:00.000Z",
		sourceUrl: "https://artificialanalysis.ai/models",
		sourceSha256: "b".repeat(64),
		indexVersion: "4.0",
		records: Array.from({ length: count }, (_, index) => ({
			id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
			slug: `model-${index}`,
			name: `Model ${index}`,
			releaseSlug: `model-${index}`,
			creatorId: "00000000-0000-4000-8000-000000000000",
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
			intelligence: 50,
			costPerTaskUsd: null,
			totalCostUsd: null,
			outputTokensPerTask: null,
			totalOutputTokens: null,
			timePerTaskSeconds: null,
			outputSpeed: null,
			inputPrice: null,
			outputPrice: null,
			contextWindow: null,
		})),
	} as AaRelease;
}

describe("acceptAaRelease", () => {
	test("rejects a release that lost more than half the stored models", () => {
		expect(acceptAaRelease(aaRelease(100), aaRelease(40))).toBe(
			"Artificial Analysis listed 40 models, under half of the stored 100",
		);
	});

	test("accepts a comparable release, or any non-empty first one", () => {
		expect(acceptAaRelease(aaRelease(100), aaRelease(96))).toBeNull();
		expect(acceptAaRelease(null, aaRelease(3))).toBeNull();
	});

	test("rejects an empty release", () => {
		expect(acceptAaRelease(null, aaRelease(0))).toBe(
			"Artificial Analysis listed no models",
		);
	});
});

function usageCapture(runs: number, models: number): TrendsUsageCapture {
	return {
		fetchedAt: "2026-10-04T04:00:00.000Z",
		sourceUrl: "https://opaline.so/api/trends/usage",
		usage: {
			totals: { runs },
			models: Array.from({ length: models }, () => ({})),
		},
	} as unknown as TrendsUsageCapture;
}

describe("acceptUsageCapture", () => {
	test("rejects usage with no published models", () => {
		expect(acceptUsageCapture(null, usageCapture(500, 0))).toBe(
			"Opaline usage published no models",
		);
	});

	test("rejects usage that lost more than half the stored runs", () => {
		expect(
			acceptUsageCapture(usageCapture(1000, 5), usageCapture(400, 5)),
		).toBe("Opaline usage counted 400 runs, under half of the stored 1000");
	});

	test("accepts growing usage", () => {
		expect(
			acceptUsageCapture(usageCapture(1000, 5), usageCapture(1200, 6)),
		).toBeNull();
	});
});
