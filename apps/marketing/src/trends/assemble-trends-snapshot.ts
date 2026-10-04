import type { AaRelease } from "../../../../packages/api-routes/src/trends-aa-release";
import type { T3UsageRelease } from "../../../../packages/api-routes/src/trends-t3-usage";
import type { TrendsUsageCapture } from "../../../../packages/api-routes/src/trends-usage";
import { PREVIEW_TRENDS_SNAPSHOT, previewBenchmarks } from "./preview-snapshot";
import { applyOpalineUsage } from "./trends-opaline";
import { applyAaRelease, selectBenchmarkModels } from "./trends-release";
import type { TrendsSnapshot } from "./trends-snapshot";
import { applyT3Usage } from "./trends-t3";

/** Each source's capture; a missing one keeps the preview data. */
export interface TrendsSourceCaptures {
	readonly usage: TrendsUsageCapture | null;
	readonly benchmarks: AaRelease | null;
	readonly harness: T3UsageRelease | null;
}

/** Which sources may be real at all: a build's kill switch keeps one on
 * preview data, in the build and in the browser's refresh alike. */
export interface TrendsLiveSources {
	readonly usage: boolean;
	readonly benchmarks: boolean;
	readonly harness: boolean;
}

/**
 * The page's snapshot from the source captures, at build time and in the
 * browser (which refreshes it from Opaline's stored sources). Usage first:
 * the benchmark groups follow the In use models.
 */
export function assembleTrendsSnapshot(
	captures: TrendsSourceCaptures,
): TrendsSnapshot {
	let snapshot = PREVIEW_TRENDS_SNAPSHOT;
	if (captures.usage) {
		const usage = applyOpalineUsage(
			snapshot,
			captures.usage.usage,
			captures.usage.sourceUrl,
		);
		snapshot = {
			...usage,
			benchmarks: selectBenchmarkModels(usage, previewBenchmarks()),
		};
	}
	if (captures.benchmarks)
		snapshot = applyAaRelease(snapshot, captures.benchmarks);
	if (captures.harness) snapshot = applyT3Usage(snapshot, captures.harness);
	return snapshot;
}
