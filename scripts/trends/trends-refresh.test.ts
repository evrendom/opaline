import { describe, expect, test } from "bun:test";
import type { TrendsSourceCaptures } from "../../apps/marketing/src/trends/assemble-trends-snapshot";
import type { TrendsSnapshot } from "../../apps/marketing/src/trends/trends-snapshot";
import { refreshes } from "../../apps/marketing/src/trends/use-latest-trends-snapshot";
import type { AaRelease } from "../../packages/api-routes/src/trends-aa-release";
import type { T3UsageRelease } from "../../packages/api-routes/src/trends-t3-usage";
import type { TrendsUsageCapture } from "../../packages/api-routes/src/trends-usage";

// Only provenance decides a refresh; the rest of the snapshot is irrelevant.
function built(sources: {
	benchmarks: "artificial_analysis" | "preview";
	usage: "opaline" | "preview";
	harnesses: "t3_code" | "opaline" | "preview";
}): TrendsSnapshot {
	return {
		sources: {
			benchmarks: {
				kind: sources.benchmarks,
				fetchedAt: "2026-10-03T04:00:00.000Z",
			},
			usage: {
				kind: sources.usage,
				periodStart: "2026-01-01",
				periodEndExclusive: "2026-10-03",
			},
			harnesses: {
				kind: sources.harnesses,
				fetchedAt: "2026-10-03T03:10:00.000Z",
			},
		},
	} as unknown as TrendsSnapshot;
}

function captures(input: {
	benchmarks?: string;
	usageEnd?: string;
	harness?: string;
}): TrendsSourceCaptures {
	return {
		benchmarks: input.benchmarks
			? ({ fetchedAt: input.benchmarks } as AaRelease)
			: null,
		usage: input.usageEnd
			? ({
					usage: { periodEndExclusive: input.usageEnd },
				} as TrendsUsageCapture)
			: null,
		harness: input.harness
			? ({ upstream: { fetchedAt: input.harness } } as T3UsageRelease)
			: null,
	};
}

const real = built({
	benchmarks: "artificial_analysis",
	usage: "opaline",
	harnesses: "t3_code",
});

describe("refreshes", () => {
	test("takes newer stored sources", () => {
		expect(
			refreshes(
				real,
				captures({
					benchmarks: "2026-10-04T04:00:00.000Z",
					usageEnd: "2026-10-04",
					harness: "2026-10-04T03:10:00.000Z",
				}),
			),
		).toBe(true);
	});

	test("keeps the built snapshot when nothing is newer", () => {
		expect(
			refreshes(
				real,
				captures({
					benchmarks: "2026-10-03T04:00:00.000Z",
					usageEnd: "2026-10-03",
					harness: "2026-10-03T03:10:00.000Z",
				}),
			),
		).toBe(false);
	});

	test("never drops a source the build had", () => {
		expect(
			refreshes(
				real,
				captures({
					benchmarks: "2026-10-04T04:00:00.000Z",
					usageEnd: "2026-10-04",
				}),
			),
		).toBe(false);
	});

	test("replaces a build's preview fallback with stored data", () => {
		expect(
			refreshes(
				built({
					benchmarks: "preview",
					usage: "preview",
					harnesses: "preview",
				}),
				captures({ usageEnd: "2026-10-03" }),
			),
		).toBe(true);
	});
});
