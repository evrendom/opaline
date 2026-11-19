import { createHash } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import type {
	SessionDetailBodyChunkInput,
	SessionDetailOverview,
	SessionDetailWindowRequest,
} from "@rudel/api-routes";
import { isLiveSessionDetailRevision } from "@rudel/api-routes";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";
import { isSelfHosted } from "../lib/self-hosted.js";
import { timedIngestPhase } from "./ingest-phase-timings.js";
import { isLiveSessionsReadable } from "./live-session/live-session-config.js";
import {
	readLiveSessionDetailRevision,
	readLiveSessionDetailSnapshot,
} from "./live-session/live-session-detail.service.js";
import { LiveSessionStorageError } from "./live-session/live-session-gate.js";
import { getLiveSessionR2Client } from "./live-session/live-session-r2.js";
import { readR2IngestAvailability } from "./r2-ingest-storage.service.js";
import {
	createSessionDetailBodyChunk,
	type SerializedSessionDetailBody,
	serializeSessionDetailBody,
	serializeSessionDetailBodyForChunk,
} from "./session-detail-body-chunks.js";
import {
	assembleSessionDetailWindow,
	decodeSessionDetailWindowCursor,
	deriveSessionDetail,
	getSessionDetailSpine as getCachedSessionDetailSpine,
	getSessionDetailSubagent as getCachedSessionDetailSubagent,
	getSessionDetailTurn as getCachedSessionDetailTurn,
	getSessionDetailOverviewPage,
	type SessionDetailDerivation,
} from "./session-detail-derivation.service.js";
import {
	createSessionDetailDerivationCache,
	type SessionDetailDerivationCacheKey,
} from "./session-detail-derivation-cache.js";
import {
	SESSION_DETAIL_DERIVATION_CACHE_DEFAULT_MAX_BYTES,
	SESSION_DETAIL_DERIVATION_CACHE_DEFAULT_MAX_ENTRY_BYTES,
	SESSION_DETAIL_DERIVATION_MAX_CONCURRENCY,
} from "./session-detail-derivation-limits.js";
import { createSessionDetailDerivationSemaphore } from "./session-detail-derivation-semaphore.js";
import {
	deriveSessionDetailOffThread,
	loadAndDeriveSessionDetailOffThread,
} from "./session-detail-derivation-thread.js";
import { buildSessionDetailInitial } from "./session-detail-initial.js";
import { createSessionDetailInstrumentation } from "./session-detail-instrumentation.js";
import {
	getSessionDetailCurrentRevision,
	getSessionDetailRawSnapshot,
} from "./session-detail-snapshot.service.js";
import {
	readStoredSessionDetail,
	writeStoredSessionDetail,
} from "./session-detail-store.js";
import { getSessionFamilyCost } from "./session-family-cost.service.js";
import { sessionFileChangesOf } from "./session-file-changes/derivation-file-changes.js";

const logger = getLogger(["rudel", "api", "session-detail"]);
const MAX_LATENCY_SAMPLES = 1_024;
const instanceId = crypto.randomUUID();
const instrumentation = createSessionDetailInstrumentation({
	maxSamples: MAX_LATENCY_SAMPLES,
	readMemoryUsage: () => process.memoryUsage(),
	startedAt: new Date().toISOString(),
});
const cache = createSessionDetailDerivationCache<SessionDetailDerivation>({
	maxBytes: readPositiveSafeIntegerEnv(
		"SESSION_DETAIL_DERIVATION_CACHE_MAX_BYTES",
		SESSION_DETAIL_DERIVATION_CACHE_DEFAULT_MAX_BYTES,
	),
	maxEntryBytes: readPositiveSafeIntegerEnv(
		"SESSION_DETAIL_DERIVATION_CACHE_MAX_ENTRY_BYTES",
		SESSION_DETAIL_DERIVATION_CACHE_DEFAULT_MAX_ENTRY_BYTES,
	),
});
const derivationSemaphore = createSessionDetailDerivationSemaphore(
	SESSION_DETAIL_DERIVATION_MAX_CONCURRENCY,
);
// Separate, byte-bounded serialization cache: subsequent chunks must not
// repeatedly normalize/stringify the entire transcript. Never bypass revision
// or access checks on a cache hit. Keys include tenant, owner and body identity.
const bodyCache =
	createSessionDetailDerivationCache<SerializedSessionDetailBody>({
		maxBytes: 64 * 1024 * 1024,
		maxEntryBytes: 64 * 1024 * 1024,
	});

export async function getSessionDetailBodyChunk(
	input: SessionDetailBodyChunkInput & {
		organizationId: string;
		ownerId: string;
	},
) {
	const current = await getCurrentRevision(input);
	if (!current) return null;
	if (current.revision !== input.revision) {
		throw new SessionDetailStaleRevisionError(input.revision, current.revision);
	}
	const key = createKey({
		...input,
		source: JSON.stringify([current.source, input.kind, input.targetId]),
	});
	try {
		const body = await bodyCache.getOrLoad(key, async () => {
			const derivation = await loadDerivation(
				createKey({ ...input, source: current.source }),
			);
			// Single-response body getters enforce the old response byte ceiling.
			// Chunk delivery reads the complete derived body instead; the chunk
			// serializer, not the whole transcript, defines this response's budget.
			const fileChanges =
				derivation &&
				input.kind === "fileChanges" &&
				input.targetId === input.sessionId
					? sessionFileChangesOf(derivation)
					: null;
			const serialized = !derivation
				? null
				: fileChanges
					? serializeSessionDetailBody(fileChanges)
					: serializeSessionDetailBodyForChunk(derivation, input);
			if (!serialized) throw new SessionDetailSnapshotNotFoundError();
			return { bytes: serialized.json.length * 2, value: serialized };
		});
		return createSessionDetailBodyChunk(body, {
			kind: input.kind,
			offset: input.offset,
			revision: input.revision,
			sessionId: input.sessionId,
			targetId: input.targetId,
		});
	} catch (error) {
		if (error instanceof SessionDetailSnapshotNotFoundError) return null;
		throw error;
	}
}

export class SessionDetailStaleRevisionError extends Error {
	constructor(
		readonly requestedRevision: string,
		readonly currentRevision: string,
	) {
		super("The session detail revision is stale");
		this.name = "SessionDetailStaleRevisionError";
	}
}

function logRequestLatency(
	kind: "initial" | "overview" | "spine" | "subagent" | "turn" | "window",
	startedAt: number,
) {
	const durationMs = Math.round(performance.now() - startedAt);
	const latency = instrumentation.recordRequestLatency(kind, durationMs);
	logger.info(
		"Served session detail {kind} in {durationMs}ms (p50={p50Ms}, p95={p95Ms}, p99={p99Ms}, samples={sampleCount})",
		{
			...cache.getStats(),
			instanceId,
			durationMs,
			kind,
			p50Ms: latency.p50,
			p95Ms: latency.p95,
			p99Ms: latency.p99,
			sampleCount: latency.sampleCount,
		},
	);
}

function createKey(input: {
	organizationId: string;
	ownerId: string;
	revision: string;
	sessionId: string;
	source: string;
}): SessionDetailDerivationCacheKey {
	return input;
}

// A session read live is derived again with each change; only its newest
// revision is worth holding.
const liveDerivationKeys = new Map<string, SessionDetailDerivationCacheKey>();

// The database is reached only for live sessions, when a request comes in:
// the module itself loads without one (its derivation is tested without).
async function liveSessionDatabase() {
	return (await import("../db.js")).sqlClient;
}

async function loadRawSnapshot(key: SessionDetailDerivationCacheKey) {
	const source = key.source === "codex" ? "codex" : "claude_code";
	if (!isLiveSessionDetailRevision(key.revision)) {
		return getSessionDetailRawSnapshot(
			key.organizationId,
			key.sessionId,
			key.ownerId,
			{ source, revision: key.revision },
		);
	}
	const availability = readR2IngestAvailability();
	if (!availability.enabled) {
		throw new LiveSessionStorageError(
			new Error("Live session storage is not configured"),
		);
	}
	const result = await readLiveSessionDetailSnapshot(
		{
			organizationId: key.organizationId,
			ownerId: key.ownerId,
			revision: key.revision,
			sessionId: key.sessionId,
			source,
		},
		{
			database: await liveSessionDatabase(),
			r2: getLiveSessionR2Client(availability.configuration),
		},
	);
	if (result.kind === "stale") {
		throw new SessionDetailStaleRevisionError(
			key.revision,
			result.currentRevision,
		);
	}
	return result.kind === "snapshot" ? result.snapshot : null;
}

function retainOnlyNewestLiveDerivation(key: SessionDetailDerivationCacheKey) {
	if (!isLiveSessionDetailRevision(key.revision)) return;
	const sessionKey = JSON.stringify([
		key.organizationId,
		key.ownerId,
		key.source,
		key.sessionId,
	]);
	const previous = liveDerivationKeys.get(sessionKey);
	if (previous && previous.revision !== key.revision) cache.delete(previous);
	liveDerivationKeys.set(sessionKey, key);
}

async function loadDerivation(
	key: SessionDetailDerivationCacheKey,
): Promise<SessionDetailDerivation | null> {
	try {
		const derivation = await cache.getOrLoad(key, async () => {
			const stored = await timedIngestPhase("detail.store_read", () =>
				readStoredSessionDetail(key),
			);
			if (stored) return { bytes: stored.byteSize, value: stored };
			return derivationSemaphore.run(async () => {
				if (isSelfHosted() && !isLiveSessionDetailRevision(key.revision)) {
					const startedAt = performance.now();
					const loaded = await timedIngestPhase("detail.derive", () =>
						loadAndDeriveSessionDetailOffThread(key),
					);
					if (!loaded) throw new SessionDetailSnapshotNotFoundError();
					if (
						loaded.loaded.revision !== key.revision ||
						loaded.loaded.source !== key.source
					)
						throw new SessionDetailStaleRevisionError(
							key.revision,
							loaded.loaded.revision,
						);
					const value = loaded.derivation;
					const durationMs = Math.round(performance.now() - startedAt);
					instrumentation.recordDerivation({
						cachedBytes: value.byteSize,
						durationMs,
						heapGrowthBytes: 0,
						rawBytes: loaded.loaded.rawBytes,
					});
					logger.info(
						"Derived session detail snapshot off thread in {durationMs}ms (rawBytes={rawBytes}, cachedBytes={cachedBytes})",
						{
							cachedBytes: value.byteSize,
							durationMs,
							instanceId,
							rawBytes: loaded.loaded.rawBytes,
						},
					);
					return { bytes: value.byteSize, value };
				}
				const memoryBefore = process.memoryUsage();
				const startedAt = performance.now();
				const snapshot = await timedIngestPhase("detail.raw_fetch", () =>
					loadRawSnapshot(key),
				);
				const rawFetchDurationMs = Math.round(performance.now() - startedAt);
				if (!snapshot) {
					throw new SessionDetailSnapshotNotFoundError();
				}
				if (
					snapshot.revision !== key.revision ||
					snapshot.source !== key.source
				) {
					throw new SessionDetailStaleRevisionError(
						key.revision,
						snapshot.revision,
					);
				}
				const derivationStartedAt = performance.now();
				const value = isSelfHosted()
					? await timedIngestPhase("detail.derive", () =>
							deriveSessionDetailOffThread(snapshot),
						)
					: deriveSessionDetail(snapshot);
				const derivationDurationMs = Math.round(
					performance.now() - derivationStartedAt,
				);
				const durationMs = Math.round(performance.now() - startedAt);
				const heapGrowthBytes =
					process.memoryUsage().heapUsed - memoryBefore.heapUsed;
				const rawBytes =
					Buffer.byteLength(snapshot.content, "utf8") +
					Object.values(snapshot.subagents).reduce(
						(total, content) => total + Buffer.byteLength(content, "utf8"),
						0,
					);
				instrumentation.recordDerivation({
					cachedBytes: value.byteSize,
					durationMs,
					heapGrowthBytes,
					rawBytes,
				});
				logger.info(
					"Derived session detail snapshot in {durationMs}ms (fetch={rawFetchDurationMs}ms, prepare={derivationDurationMs}ms, rawBytes={rawBytes}, cachedBytes={cachedBytes}, heapGrowthBytes={heapGrowthBytes})",
					{
						cachedBytes: value.byteSize,
						durationMs,
						rawFetchDurationMs,
						derivationDurationMs,
						instanceId,
						snapshotFingerprint: createHash("sha256")
							.update(
								JSON.stringify([
									key.organizationId,
									key.ownerId,
									key.source,
									key.sessionId,
									key.revision,
								]),
							)
							.digest("hex")
							.slice(0, 24),
						heapGrowthBytes,
						rawBytes,
					},
				);
				void writeStoredSessionDetail(key, value);
				return { bytes: value.byteSize, value };
			});
		});
		retainOnlyNewestLiveDerivation(key);
		return derivation;
	} catch (error) {
		if (error instanceof SessionDetailSnapshotNotFoundError) {
			return null;
		}
		throw error;
	}
}

class SessionDetailSnapshotNotFoundError extends Error {}

/**
 * The revision the session is read at: its upload's, or while it runs (and
 * before it is uploaded) the live lines' revision, its last update.
 */
async function getCurrentRevision(input: {
	organizationId: string;
	ownerId: string;
	sessionId: string;
}) {
	const uploaded = await getSessionDetailCurrentRevision(
		input.organizationId,
		input.sessionId,
		input.ownerId,
	);
	if (!isLiveSessionsReadable(input.organizationId)) return uploaded;
	const live = await readLiveSessionDetailRevision(
		{ ...input, hasUpload: uploaded !== null },
		{ database: await liveSessionDatabase(), now: () => new Date() },
	);
	return live ?? uploaded;
}

async function getCurrentDerivation(input: {
	organizationId: string;
	ownerId: string;
	sessionId: string;
}) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const current = await getCurrentRevision(input);
		if (!current) {
			return null;
		}
		try {
			return await loadDerivation(createKey({ ...input, ...current }));
		} catch (error) {
			if (error instanceof SessionDetailStaleRevisionError && attempt === 0) {
				continue;
			}
			throw error;
		}
	}
	return null;
}

async function getRequestedDerivation(input: {
	organizationId: string;
	ownerId: string;
	revision: string;
	sessionId: string;
}) {
	const current = await getCurrentRevision(input);
	if (!current) {
		return null;
	}
	if (current.revision !== input.revision) {
		throw new SessionDetailStaleRevisionError(input.revision, current.revision);
	}
	return loadDerivation(createKey({ ...input, source: current.source }));
}

export function getCurrentSessionDetailDerivation(input: {
	organizationId: string;
	ownerId: string;
	sessionId: string;
}) {
	return getCurrentDerivation(input);
}

export async function getSessionDetailInitial(input: {
	bodyChunks?: boolean;
	organizationId: string;
	ownerId: string;
	sessionId: string;
}) {
	const startedAt = performance.now();
	try {
		const derivation = await getCurrentDerivation(input);
		if (!derivation) return null;
		const assemblyStartedAt = performance.now();
		const response = buildSessionDetailInitial(derivation, {
			bodyChunks: input.bodyChunks,
		});
		response.overview = await withSessionFamilyCost(response.overview, input);
		logger.info("Assembled initial session detail", {
			instanceId,
			assemblyDurationMs: Math.round(performance.now() - assemblyStartedAt),
			serializedBytes: Buffer.byteLength(JSON.stringify(response), "utf8"),
			turnsIncluded: response.window.turns.length,
		});
		return response;
	} finally {
		logRequestLatency("initial", startedAt);
	}
}

export async function getSessionDetailOverview(input: {
	organizationId: string;
	ownerId: string;
	sessionId: string;
	turnCursor?: string;
	turnLimit: number;
}) {
	const startedAt = performance.now();
	try {
		const derivation = await getCurrentDerivation(input);
		if (!derivation) {
			return null;
		}
		const overview = getSessionDetailOverviewPage({
			cursor: input.turnCursor,
			derivation,
			limit: input.turnLimit,
		});
		const response = await withSessionFamilyCost(overview, input);
		logger.info(
			"Serialized session detail overview ({serializedBytes} bytes)",
			{
				serializedBytes: Buffer.byteLength(JSON.stringify(response), "utf8"),
			},
		);
		return response;
	} finally {
		logRequestLatency("overview", startedAt);
	}
}

async function withSessionFamilyCost(
	overview: SessionDetailOverview,
	input: { organizationId: string; ownerId: string; sessionId: string },
): Promise<SessionDetailOverview> {
	if (overview.session.source !== "codex") return overview;
	// Descendants can advance without a new parent revision. Keep their cost
	// outside the immutable transcript derivation cache.
	let estimatedCost: number | null = null;
	try {
		estimatedCost = await getSessionFamilyCost({
			...input,
			estimatedCost: overview.session.estimatedCost,
			source: overview.session.source,
		});
	} catch (error) {
		// Keep the transcript available when analytics is unavailable, without
		// presenting the parent's subtotal as the complete session cost.
		logger.warn("Session family cost unavailable", { error });
	}
	return {
		...overview,
		session: { ...overview.session, estimatedCost },
	};
}

export async function getSessionDetailWindow(input: {
	organizationId: string;
	ownerId: string;
	request: SessionDetailWindowRequest;
	sessionId: string;
}) {
	const startedAt = performance.now();
	try {
		const derivation = await getWindowDerivation(input);
		if (!derivation) {
			return null;
		}
		const assemblyStartedAt = performance.now();
		const assembly = assembleSessionDetailWindow({
			derivation,
			request: input.request,
		});
		const assemblyDurationMs = Math.round(
			performance.now() - assemblyStartedAt,
		);
		instrumentation.recordWindow({
			assemblyDurationMs,
			oversizedTurns: assembly.oversizedTurns,
			serializedBytes: assembly.serializedBytes,
			truncatedByBudget: assembly.truncatedByBudget,
			turnsIncluded: assembly.window.turns.length,
		});
		logger.info(
			"Assembled session detail window ({turnsIncluded} turns, {serializedBytes} bytes, truncated={truncatedByBudget}, oversized={oversizedTurns})",
			{
				assemblyDurationMs,
				oversizedTurns: assembly.oversizedTurns,
				serializedBytes: assembly.serializedBytes,
				truncatedByBudget: assembly.truncatedByBudget,
				turnsIncluded: assembly.window.turns.length,
			},
		);
		return assembly.window;
	} finally {
		logRequestLatency("window", startedAt);
	}
}

export async function getSessionDetailSpine(input: {
	organizationId: string;
	ownerId: string;
	revision: string;
	sessionId: string;
}) {
	const startedAt = performance.now();
	try {
		const derivation = await getRequestedDerivation(input);
		return derivation ? getCachedSessionDetailSpine(derivation) : null;
	} finally {
		logRequestLatency("spine", startedAt);
	}
}

async function getWindowDerivation(input: {
	organizationId: string;
	ownerId: string;
	request: SessionDetailWindowRequest;
	sessionId: string;
}) {
	if (input.request.mode === "initial") {
		return getCurrentDerivation(input);
	}
	const revision =
		input.request.mode === "anchor"
			? input.request.revision
			: decodeSessionDetailWindowCursor(input.request.cursor).revision;
	return getRequestedDerivation({ ...input, revision });
}

export async function getSessionDetailTurn(input: {
	organizationId: string;
	ownerId: string;
	revision: string;
	sessionId: string;
	turnId: string;
}) {
	const startedAt = performance.now();
	try {
		const derivation = await getRequestedDerivation(input);
		return derivation
			? getCachedSessionDetailTurn(derivation, input.turnId)
			: null;
	} finally {
		logRequestLatency("turn", startedAt);
	}
}

export async function getSessionDetailSubagent(input: {
	organizationId: string;
	ownerId: string;
	revision: string;
	sessionId: string;
	subagentId: string;
}) {
	const startedAt = performance.now();
	try {
		const derivation = await getRequestedDerivation(input);
		return derivation
			? getCachedSessionDetailSubagent(derivation, input.subagentId)
			: null;
	} finally {
		logRequestLatency("subagent", startedAt);
	}
}

export function getSessionDetailInstrumentationStats() {
	const cacheStats = cache.getStats();
	const cacheRequests = cacheStats.hitCount + cacheStats.missCount;
	return {
		...instrumentation.getStats(),
		cache: {
			...cacheStats,
			hitRate: cacheRequests === 0 ? null : cacheStats.hitCount / cacheRequests,
		},
		derivationConcurrency: derivationSemaphore.getStats(),
	};
}
