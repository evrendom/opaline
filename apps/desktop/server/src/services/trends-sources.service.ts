import { getLogger } from "@logtape/logtape";
import type { AaRelease } from "@rudel/api-routes/trends-aa-release";
import {
	acceptAaRelease,
	acceptT3Release,
	acceptUsageCapture,
	mergeT3Releases,
	type TrendsSourceId,
	type TrendsSources,
	trendsSourcesSchema,
} from "@rudel/api-routes/trends-sources";
import type { T3UsageRelease } from "@rudel/api-routes/trends-t3-usage";
import {
	TRENDS_USAGE_PATH,
	type TrendsUsageCapture,
} from "@rudel/api-routes/trends-usage";
import { trendsSource } from "@rudel/sql-schema";
import { eq } from "drizzle-orm";
import { db } from "../db.js";

const logger = getLogger(["rudel", "api", "trends"]);

/** Where each source's last good capture is kept. */
export interface TrendsSourceStore {
	read(source: TrendsSourceId): Promise<unknown>;
	write(
		source: TrendsSourceId,
		payload: unknown,
		fetchedAt: Date,
	): Promise<void>;
}

/** One fresh capture of each source; each may throw. */
export interface TrendsSourceFetchers {
	readonly benchmarks: () => Promise<AaRelease>;
	readonly harness: () => Promise<T3UsageRelease>;
	readonly usage: () => Promise<TrendsUsageCapture>;
}

export type TrendsSourceOutcome =
	| { readonly status: "stored" }
	| { readonly status: "kept"; readonly reason: string };

export function postgresTrendsSourceStore(): TrendsSourceStore {
	return {
		async read(source) {
			const [row] = await db
				.select({ payload: trendsSource.payload })
				.from(trendsSource)
				.where(eq(trendsSource.source, source))
				.limit(1);
			return row?.payload ?? null;
		},
		async write(source, payload, fetchedAt) {
			await db
				.insert(trendsSource)
				.values({ source, payload, fetchedAt })
				.onConflictDoUpdate({
					target: trendsSource.source,
					set: { payload, fetchedAt, updatedAt: new Date() },
				});
		},
	};
}

/** Each source's last good capture; a stored one that no longer validates
 * reads as missing (the build then falls back), never as an error. */
export async function readTrendsSources(
	store: TrendsSourceStore,
): Promise<TrendsSources> {
	const [benchmarks, harness, usage] = await Promise.all([
		store.read("artificial_analysis"),
		store.read("t3_code"),
		store.read("opaline_usage"),
	]);
	const shape = trendsSourcesSchema.shape;
	return {
		benchmarks: parsedOrNull(
			"artificial_analysis",
			shape.benchmarks,
			benchmarks,
		),
		harness: parsedOrNull("t3_code", shape.harness, harness),
		usage: parsedOrNull("opaline_usage", shape.usage, usage),
	};
}

/**
 * Fetches every source and stores what passes its checks. A failed fetch,
 * a block or a suspicious capture keeps the stored one; Slopalytics'
 * rolling window is merged into the stored days, never replacing them.
 * Each source stands alone, so one failing never holds back the others.
 */
export async function refreshTrendsSources(
	store: TrendsSourceStore,
	fetchers: TrendsSourceFetchers,
): Promise<Record<TrendsSourceId, TrendsSourceOutcome>> {
	const stored = await readTrendsSources(store);
	const [artificialAnalysis, t3Code, opalineUsage] = await Promise.all([
		refreshSource(
			"artificial_analysis",
			store,
			fetchers.benchmarks,
			(fresh) => {
				const reason = acceptAaRelease(stored.benchmarks, fresh);
				return reason ? { reason } : { payload: fresh };
			},
		),
		refreshSource("t3_code", store, fetchers.harness, (fresh) => {
			const reason = acceptT3Release(fresh);
			return reason
				? { reason }
				: { payload: mergeT3Releases(stored.harness, fresh) };
		}),
		refreshSource("opaline_usage", store, fetchers.usage, (fresh) => {
			const reason = acceptUsageCapture(stored.usage, fresh);
			return reason ? { reason } : { payload: fresh };
		}),
	]);
	return {
		artificial_analysis: artificialAnalysis,
		t3_code: t3Code,
		opaline_usage: opalineUsage,
	};
}

/** Opaline's own usage, captured as the marketing build would fetch it. */
export function usageCapture(
	usage: TrendsUsageCapture["usage"],
	now = new Date(),
): TrendsUsageCapture {
	return {
		fetchedAt: now.toISOString(),
		sourceUrl: new URL(
			TRENDS_USAGE_PATH,
			process.env.APP_URL ?? "https://opaline.so",
		).href,
		usage,
	};
}

async function refreshSource<Capture extends { readonly fetchedAt: string }>(
	source: TrendsSourceId,
	store: TrendsSourceStore,
	fetch: () => Promise<Capture>,
	decide: (fresh: Capture) => { payload: Capture } | { reason: string },
): Promise<TrendsSourceOutcome> {
	let fresh: Capture;
	try {
		fresh = await fetch();
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.warn("Trends source {source} fetch failed, kept stored: {reason}", {
			source,
			reason,
		});
		return { status: "kept", reason };
	}
	const decision = decide(fresh);
	if ("reason" in decision) {
		logger.warn(
			"Trends source {source} capture rejected, kept stored: {reason}",
			{
				source,
				reason: decision.reason,
			},
		);
		return { status: "kept", reason: decision.reason };
	}
	await store.write(source, decision.payload, new Date(fresh.fetchedAt));
	return { status: "stored" };
}

interface Validator<Value> {
	safeParse(
		value: unknown,
	):
		| { readonly success: true; readonly data: Value }
		| { readonly success: false; readonly error: unknown };
}

function parsedOrNull<Value>(
	source: TrendsSourceId,
	schema: Validator<Value>,
	value: unknown,
): Value | null {
	if (value === null) return null;
	const result = schema.safeParse(value);
	if (result.success) return result.data;
	logger.error("Stored Trends source {source} no longer validates", {
		source,
		error: result.error,
	});
	return null;
}
