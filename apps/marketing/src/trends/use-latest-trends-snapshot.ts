import { useEffect, useState } from "react";
import {
	TRENDS_SOURCES_PATH,
	type TrendsSources,
	trendsSourcesSchema,
} from "../../../../packages/api-routes/src/trends-sources";
import {
	assembleTrendsSnapshot,
	type TrendsLiveSources,
	type TrendsSourceCaptures,
} from "./assemble-trends-snapshot";
import type { TrendsSnapshot } from "./trends-snapshot";

/**
 * The page's snapshot, refreshed once it opens from Opaline's stored
 * sources (kept current by the API's daily cron), so a page built days ago
 * still shows today's data. Until then, and whenever the refresh fails or
 * would drop a source the build had, the built snapshot stays: the first
 * render always matches the server's.
 */
export function useLatestTrendsSnapshot(
	built: TrendsSnapshot,
	live: TrendsLiveSources,
): TrendsSnapshot {
	const [latest, setLatest] = useState(built);
	useEffect(() => {
		const controller = new AbortController();
		const refresh = async () => {
			const response = await fetch(TRENDS_SOURCES_PATH, {
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});
			if (!response.ok) return;
			const captures = liveCaptures(
				trendsSourcesSchema.parse(await response.json()),
				live,
			);
			if (refreshes(built, captures))
				setLatest(assembleTrendsSnapshot(captures));
		};
		refresh().catch(() => {
			// Offline, an older API or a local build: the built snapshot stays.
		});
		return () => controller.abort();
	}, [built, live]);
	return latest;
}

function liveCaptures(
	sources: TrendsSources,
	live: TrendsLiveSources,
): TrendsSourceCaptures {
	return {
		usage: live.usage ? sources.usage : null,
		benchmarks: live.benchmarks ? sources.benchmarks : null,
		harness: live.harness ? sources.harness : null,
	};
}

/** Whether the stored captures make a newer snapshot than the built one,
 * without dropping any source it had. */
export function refreshes(
	built: TrendsSnapshot,
	captures: TrendsSourceCaptures,
): boolean {
	const { benchmarks, usage, harnesses } = built.sources;
	if (benchmarks.kind === "artificial_analysis" && !captures.benchmarks)
		return false;
	if (usage.kind === "opaline" && !captures.usage) return false;
	if (harnesses.kind === "t3_code" && !captures.harness) return false;
	return (
		(captures.benchmarks !== null &&
			(benchmarks.kind !== "artificial_analysis" ||
				captures.benchmarks.fetchedAt > benchmarks.fetchedAt)) ||
		(captures.usage !== null &&
			(usage.kind !== "opaline" ||
				captures.usage.usage.periodEndExclusive >
					(usage.periodEndExclusive ?? ""))) ||
		(captures.harness !== null &&
			(harnesses.kind !== "t3_code" ||
				captures.harness.upstream.fetchedAt > harnesses.fetchedAt))
	);
}
