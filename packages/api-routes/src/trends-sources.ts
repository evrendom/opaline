import { z as zod } from "zod";
import { type AaRelease, aaReleaseSchema } from "./trends-aa-release.js";
import {
	type T3UsageRelease,
	t3UsageReleaseSchema,
} from "./trends-t3-usage.js";
import {
	type TrendsUsageCapture,
	trendsUsageCaptureSchema,
} from "./trends-usage.js";

/**
 * Trends' sources as Opaline keeps them: the last good capture of each,
 * refreshed by the API's cron and served to the marketing build, so the
 * page never depends on a third party being up (or still publishing) at
 * build time.
 */
export const TRENDS_SOURCES_PATH = "/api/trends/sources";

export const TRENDS_SOURCE_IDS = [
	"artificial_analysis",
	"t3_code",
	"opaline_usage",
] as const;

export type TrendsSourceId = (typeof TRENDS_SOURCE_IDS)[number];

/** Each source's last good capture; null until one was ever stored. */
export const trendsSourcesSchema = zod.object({
	benchmarks: aaReleaseSchema.nullable(),
	harness: t3UsageReleaseSchema.nullable(),
	usage: trendsUsageCaptureSchema.nullable(),
});

export type TrendsSources = zod.infer<typeof trendsSourcesSchema>;

/**
 * Slopalytics publishes a rolling 30-day window, so each capture is merged
 * into the stored one instead of replacing it: days that left the window
 * stay, a day both report takes the newer (revised) figures, and a row that
 * comes back empty never replaces one that was reported.
 */
export function mergeT3Releases(
	stored: T3UsageRelease | null,
	fresh: T3UsageRelease,
): T3UsageRelease {
	if (!stored) return fresh;
	return {
		...fresh,
		upstream: {
			...fresh.upstream,
			start: minDay(stored.upstream.start, fresh.upstream.start),
			endExclusive: maxDay(
				stored.upstream.endExclusive,
				fresh.upstream.endExclusive,
			),
		},
		sent: mergeRows<T3UsageRelease["sent"][number]>(
			stored.sent,
			fresh.sent,
			(row) => `${row.day}|${row.harness}`,
			(row) => row.turns === 0,
		),
		metrics: mergeRows<T3UsageRelease["metrics"][number]>(
			stored.metrics,
			fresh.metrics,
			(row) => `${row.day}|${row.harness}|${row.model}`,
			(row) => row.tokenTurns === 0 && row.pricedTurns === 0,
		),
	};
}

/** Why a fresh Slopalytics capture is not stored, or null to store it. */
export function acceptT3Release(fresh: T3UsageRelease): string | null {
	const reported = (harness: string) =>
		fresh.sent.some((row) => row.harness === harness && row.turns > 0);
	if (!reported("claudeAgent"))
		return "Slopalytics reported no Claude Code turns";
	if (!reported("codex")) return "Slopalytics reported no Codex turns";
	return null;
}

/** Why a fresh Artificial Analysis release is not stored, or null to store
 * it: a release that lost most of its models is a broken page, not news. */
export function acceptAaRelease(
	stored: AaRelease | null,
	fresh: AaRelease,
): string | null {
	const count = fresh.records.length;
	if (count === 0) return "Artificial Analysis listed no models";
	if (stored && count * 2 < stored.records.length)
		return `Artificial Analysis listed ${count} models, under half of the stored ${stored.records.length}`;
	return null;
}

/** Why fresh Opaline usage is not stored, or null to store it. All-time
 * runs only shrink when accounts are deleted, never by half. */
export function acceptUsageCapture(
	stored: TrendsUsageCapture | null,
	fresh: TrendsUsageCapture,
): string | null {
	if (fresh.usage.models.length === 0)
		return "Opaline usage published no models";
	const runs = fresh.usage.totals.runs;
	if (stored && runs * 2 < stored.usage.totals.runs)
		return `Opaline usage counted ${runs} runs, under half of the stored ${stored.usage.totals.runs}`;
	return null;
}

function mergeRows<Row extends { readonly day: string }>(
	stored: readonly Row[],
	fresh: readonly Row[],
	key: (row: Row) => string,
	empty: (row: Row) => boolean,
): Row[] {
	const rows = new Map(stored.map((row) => [key(row), row]));
	for (const row of fresh) {
		const kept = rows.get(key(row));
		if (kept && empty(row) && !empty(kept)) continue;
		rows.set(key(row), row);
	}
	return [...rows.entries()]
		.sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
		.map(([, row]) => row);
}

function minDay(first: string, second: string) {
	return first < second ? first : second;
}

function maxDay(first: string, second: string) {
	return first > second ? first : second;
}
