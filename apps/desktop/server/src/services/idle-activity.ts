import { getLogger } from "@logtape/logtape";
import {
	createR2MultipartUploadClient,
	type R2EvidenceStorageClient,
	readR2IngestAvailability,
} from "./r2-ingest-storage.service.js";

const logger = getLogger(["rudel", "api", "idle-activity"]);

export const ACTIVITY_OBJECT_KEY = "maintenance/activity";
export const ACTIVITY_WINDOW_MS = 30 * 60_000;
export const SWEEP_MINUTE = 10;
const MARK_INTERVAL_MS = 60_000;
const R2_TIMEOUT_MS = 3_000;

export interface ActivityStore {
	read(signal?: AbortSignal): Promise<Date | null>;
	write(at: Date, signal?: AbortSignal): Promise<void>;
}

export type CronGate =
	| { readonly run: true; readonly reason: "active" | "sweep" | "unknown" }
	| { readonly run: false; readonly lastActivityAt: string };

export function r2ActivityStore(
	client: Pick<R2EvidenceStorageClient, "headObject" | "putObject">,
): ActivityStore {
	return {
		async read(signal) {
			const object = await client.headObject(ACTIVITY_OBJECT_KEY, signal);
			const at = object?.metadata.at;
			if (!at) return null;
			const parsed = new Date(at);
			return Number.isNaN(parsed.getTime()) ? null : parsed;
		},
		async write(at, signal) {
			await client.putObject({
				body: new Uint8Array(),
				contentType: "application/octet-stream",
				metadata: { at: at.toISOString() },
				objectKey: ACTIVITY_OBJECT_KEY,
				signal,
			});
		},
	};
}

let configuredStore: ActivityStore | null | undefined;

function configuredActivityStore(): ActivityStore | null {
	if (configuredStore !== undefined) return configuredStore;
	const availability = readR2IngestAvailability();
	configuredStore =
		availability.enabled && process.env.NODE_ENV !== "test"
			? r2ActivityStore(
					createR2MultipartUploadClient(availability.configuration, {
						requestTimeoutMs: R2_TIMEOUT_MS,
					}),
				)
			: null;
	return configuredStore;
}

export function decideCronGate(
	now: Date,
	lastActivityAt: Date | null,
): CronGate {
	if (now.getUTCMinutes() === SWEEP_MINUTE)
		return { run: true, reason: "sweep" };
	if (lastActivityAt === null) return { run: true, reason: "unknown" };
	if (now.getTime() - lastActivityAt.getTime() < ACTIVITY_WINDOW_MS)
		return { run: true, reason: "active" };
	return { run: false, lastActivityAt: lastActivityAt.toISOString() };
}

export async function readLastActivity(
	store: ActivityStore | null = configuredActivityStore(),
): Promise<Date | null> {
	if (!store) return null;
	try {
		return await store.read(AbortSignal.timeout(R2_TIMEOUT_MS));
	} catch (error) {
		logger.warn("Reading the activity marker failed: {error}", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function cronGate(
	now: Date = new Date(),
	store: ActivityStore | null = configuredActivityStore(),
): Promise<CronGate> {
	if (now.getUTCMinutes() === SWEEP_MINUTE)
		return { run: true, reason: "sweep" };
	return decideCronGate(now, await readLastActivity(store));
}

export function idleCronResponse(gate: CronGate): Response | null {
	return gate.run
		? null
		: Response.json({
				ok: true,
				skipped: "idle",
				lastActivityAt: gate.lastActivityAt,
			});
}

let lastMarkedAt = 0;

export function markActivity(
	now: Date = new Date(),
	store: ActivityStore | null = configuredActivityStore(),
): Promise<void> | null {
	if (!store || now.getTime() - lastMarkedAt < MARK_INTERVAL_MS) return null;
	lastMarkedAt = now.getTime();
	return store.write(now, AbortSignal.timeout(R2_TIMEOUT_MS)).catch((error) => {
		lastMarkedAt = 0;
		logger.warn("Writing the activity marker failed: {error}", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

export function resetActivityMarkThrottle(): void {
	lastMarkedAt = 0;
}
