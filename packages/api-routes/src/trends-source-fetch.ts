import {
	type AaRelease,
	aaPublicPayloadSchema,
	aaReleaseSchema,
} from "./trends-aa-release.js";
import {
	isT3HarnessProvider,
	type T3PublicSnapshot,
	type T3UsageRelease,
	t3PublicSnapshotSchema,
	t3UsageReleaseSchema,
} from "./trends-t3-usage.js";

/**
 * One identified, bounded fetch of each third-party Trends source, parsed
 * and validated. No caching or storage here: the API's cron keeps the last
 * good capture (see trends-sources), the local scripts cache to a file.
 * Bun runtime (both callers run on Bun).
 */

export const AA_SOURCE_URL = "https://artificialanalysis.ai/models";
// T3 Code's daily PostHog export, as published by Slopalytics.
export const T3_SOURCE_URL = "https://slopalytics.com/data/t3-usage.json";
const HEADERS = {
	"User-Agent": "OpalineTrends/1.0 (+https://opaline.so/trends)",
};
const TIMEOUT_MS = 30_000;

/** Artificial Analysis' public `/models` page and the model payload its RSC
 * manifest references: two sequential requests, no retries. */
export async function fetchAaRelease(
	now = new Date(),
	signal?: AbortSignal,
): Promise<AaRelease> {
	const html = await (await request(AA_SOURCE_URL, signal)).text();
	const manifest = discoverManifest(html);
	const rawPayload = await (
		await request(new URL(manifest.path, AA_SOURCE_URL).href, signal)
	).arrayBuffer();
	const keyBytes = Buffer.from(manifest.key, "hex");
	const digest = await crypto.subtle.digest("SHA-256", keyBytes);
	const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
		"decrypt",
	]);
	const compressed = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: new Uint8Array(digest).slice(0, 12),
			tagLength: 128,
		},
		key,
		rawPayload,
	);
	const payload = aaPublicPayloadSchema.parse(
		JSON.parse(
			new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(compressed))),
		),
	);
	return aaReleaseSchema.parse({
		source: "artificial_analysis",
		fetchedAt: now.toISOString(),
		sourceUrl: AA_SOURCE_URL,
		sourceSha256: new Bun.CryptoHasher("sha256")
			.update(rawPayload)
			.digest("hex"),
		indexVersion:
			html.match(/Intelligence Index v(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null,
		records: payload.models.map((record) => ({
			id: record.id,
			slug: record.slug,
			name: record.name,
			releaseSlug: record.release.slug,
			creatorId: record.creator.id,
			creatorSlug: record.creator.slug,
			creatorName: record.creator.name,
			releasedAt: record.releaseDate,
			openWeights: record.isOpenWeights,
			deprecated: record.deprecated,
			deprecatedTo: record.release.deprecatedTo ?? null,
			isReasoning: record.isReasoning,
			reasoningSetting: record.effort?.slug ?? null,
			effortLabel: record.effort?.label ?? null,
			effortOrder: record.effort?.level ?? null,
			estimated: record.intelligenceIndexIsEstimated,
			intelligence: record.intelligenceIndex,
			costPerTaskUsd: record.intelligenceIndexCostPerTask?.cost?.total ?? null,
			totalCostUsd: record.intelligenceIndexCost?.total ?? null,
			outputTokensPerTask:
				record.intelligenceIndexOutputTokensPerTask?.output ?? null,
			totalOutputTokens:
				record.canonicalIntelligenceIndexTokenCount?.output ?? null,
			timePerTaskSeconds: record.intelligenceIndexTimePerTask ?? null,
			outputSpeed: record.timescaleData?.medianOutputSpeed ?? null,
			inputPrice: record.price1mInputTokens ?? null,
			outputPrice: record.price1mOutputTokens ?? null,
			contextWindow: record.contextWindowTokens ?? null,
		})),
	});
}

export function discoverManifest(html: string): { path: string; key: string } {
	const chunks = [
		...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g),
	].flatMap((match) => {
		const chunk: unknown = JSON.parse(match[1] ?? "null");
		return Array.isArray(chunk) &&
			chunk[0] === 1 &&
			typeof chunk[1] === "string"
			? [chunk[1]]
			: [];
	});
	const flight = chunks.join("");
	const manifests = [
		...flight.matchAll(
			/"manifest":\{"path":"(\/data\/[a-f0-9]+\.txt)","key":"([a-f0-9]{64})"\}/g,
		),
	];
	if (manifests.length !== 2 || !flight.includes('"modelsAndReleases"'))
		throw new Error(
			"AA page shape drift: expected provider + model manifests in RSC flight.",
		);
	const modelManifest = manifests[1];
	if (!modelManifest?.[1] || !modelManifest[2])
		throw new Error("AA model manifest missing.");
	return { path: modelManifest[1], key: modelManifest[2] };
}

/** Slopalytics' published T3 Code snapshot: one request, no retries. */
export async function fetchT3Release(
	now = new Date(),
	signal?: AbortSignal,
): Promise<T3UsageRelease> {
	const raw = await (await request(T3_SOURCE_URL, signal)).arrayBuffer();
	const snapshot = t3PublicSnapshotSchema.parse(
		JSON.parse(new TextDecoder().decode(raw)),
	);
	return toT3UsageRelease(
		snapshot,
		new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
		now.toISOString(),
	);
}

export function toT3UsageRelease(
	snapshot: T3PublicSnapshot,
	sourceSha256: string,
	fetchedAt: string,
): T3UsageRelease {
	return t3UsageReleaseSchema.parse({
		source: "t3_code",
		fetchedAt,
		sourceUrl: T3_SOURCE_URL,
		sourceSha256,
		upstream: {
			fetchedAt: snapshot.fetchedAt,
			project: snapshot.project,
			source: snapshot.source,
			start: snapshot.start,
			endExclusive: snapshot.endExclusive,
			runawayThreshold: snapshot.runawayThreshold,
		},
		sent: snapshot.sent.filter((row) => isT3HarnessProvider(row.harness)),
		metrics: snapshot.metrics.filter((row) => isT3HarnessProvider(row.harness)),
	});
}

async function request(url: string, signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const response = await fetch(url, {
		headers: HEADERS,
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		redirect: "error",
	});
	if (!response.ok)
		throw new Error(`Fetch failed: HTTP ${response.status} at ${url}`);
	return response;
}
