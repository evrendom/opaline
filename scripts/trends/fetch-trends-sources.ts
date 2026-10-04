import {
	TRENDS_SOURCES_PATH,
	type TrendsSources,
	trendsSourcesSchema,
} from "../../packages/api-routes/src/trends-sources";
import { writeAaRelease } from "./fetch-artificial-analysis";
import { writeUsageCapture } from "./fetch-opaline-usage";
import { writeT3Release } from "./fetch-t3-usage";

/** `TRENDS_SOURCES_API_URL` points at another API, e.g. a preview. */
export function trendsSourcesUrl() {
	return new URL(
		TRENDS_SOURCES_PATH,
		process.env.TRENDS_SOURCES_API_URL ?? "https://opaline.so",
	).href;
}

/**
 * The last good capture of each source, as Opaline's API stored it, written
 * where the marketing build reads them. Returns which sources it wrote; a
 * source the API has not stored yet is left to the build's own fallback.
 */
export async function fetchTrendsSources(): Promise<{
	readonly benchmarks: boolean;
	readonly harness: boolean;
	readonly usage: boolean;
}> {
	const response = await fetch(trendsSourcesUrl(), {
		headers: { "User-Agent": "OpalineTrends/1.0 (+https://opaline.so/trends)" },
		signal: AbortSignal.timeout(60_000),
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(`Trends sources fetch failed: HTTP ${response.status}`);
	const sources: TrendsSources = trendsSourcesSchema.parse(
		await response.json(),
	);
	if (sources.benchmarks) await writeAaRelease(sources.benchmarks);
	if (sources.harness) await writeT3Release(sources.harness);
	if (sources.usage) await writeUsageCapture(sources.usage);
	console.log(
		`Trends sources from ${trendsSourcesUrl()}: benchmarks ${sources.benchmarks?.fetchedAt ?? "none"}, T3 Code ${sources.harness ? `${sources.harness.upstream.start} to ${sources.harness.upstream.endExclusive}` : "none"}, usage ${sources.usage?.fetchedAt ?? "none"}.`,
	);
	return {
		benchmarks: sources.benchmarks !== null,
		harness: sources.harness !== null,
		usage: sources.usage !== null,
	};
}

if (import.meta.main) await fetchTrendsSources();
