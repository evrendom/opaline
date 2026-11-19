import {
	createR2MultipartUploadClient,
	type R2IngestConfiguration,
	type R2StorageClient,
} from "../r2-ingest-storage.service.js";

/**
 * Bound on one live session R2 call. An append holds its session's row lock
 * and a live pool connection while it writes, so a slow R2 call must fail
 * (the CLI retries) rather than hold them.
 */
export const LIVE_SESSION_R2_TIMEOUT_MS = 10_000;

let cached: { client: R2StorageClient; key: string } | undefined;

/** One R2 client per process for live session reads, writes and cleanup. */
export function getLiveSessionR2Client(
	configuration: R2IngestConfiguration,
): R2StorageClient {
	const key = JSON.stringify(configuration);
	if (cached?.key !== key) {
		cached = {
			client: createR2MultipartUploadClient(configuration, {
				requestTimeoutMs: LIVE_SESSION_R2_TIMEOUT_MS,
			}),
			key,
		};
	}
	return cached.client;
}

/** The request's signal, ending at the live R2 timeout at the latest. */
export function liveSessionR2Signal(signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(LIVE_SESSION_R2_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
