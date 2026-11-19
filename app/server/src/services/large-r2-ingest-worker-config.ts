import { existsSync } from "node:fs";
import { totalmem } from "node:os";

/**
 * Must equal `maxDuration` of `api/cron/large-r2-ingest.ts` in
 * the large-ingest project's `vercel.json` (the Pro plan's generally available
 * maximum on fluid compute).
 */
export const LARGE_R2_INGEST_WORKER_MAX_DURATION_MS = 800_000;
/** Leaves time to record an aborted job as a retry and flush the response. */
export const LARGE_R2_INGEST_WORKER_BUDGET_MS =
	LARGE_R2_INGEST_WORKER_MAX_DURATION_MS - 60_000;
/** Below this the process cannot hold one 256 MiB session (peak about 2.3 GB). */
export const LARGE_R2_INGEST_WORKER_MIN_MEMORY_MB = 3_500;
const MEBIBYTE = 1024 * 1024;
/** Bun workers loaded by URL; the deploy must ship them as files. */
const WORKER_ENTRY_FILES = [
	"./ingest-filter.worker.ts",
	"./usage-extraction.worker.ts",
	"./transcript-records.worker.ts",
	"./git-observation-extraction.worker.ts",
	"./session-language-signal-scanner.worker.ts",
] as const;

export type LargeR2IngestWorkerState =
	| { readonly enabled: true; readonly memoryMb: number }
	| {
			readonly enabled: false;
			readonly memoryMb: number;
			readonly reason: "flag_off" | "insufficient_memory";
	  };

/**
 * Worker mode is off unless `R2_LARGE_INGEST_WORKER` is exactly `true` and the
 * function has the memory for one large session. Only the large-ingest
 * deployment's entry point consults this; the main project never runs the
 * large path whatever its environment says.
 */
export function readLargeR2IngestWorkerState(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): LargeR2IngestWorkerState {
	const memoryMb = readFunctionMemoryMb(environment);
	if (environment.R2_LARGE_INGEST_WORKER !== "true") {
		return { enabled: false, memoryMb, reason: "flag_off" };
	}
	if (memoryMb < LARGE_R2_INGEST_WORKER_MIN_MEMORY_MB) {
		return { enabled: false, memoryMb, reason: "insufficient_memory" };
	}
	return { enabled: true, memoryMb };
}

/** Whether every Bun worker entry file was deployed next to this module. */
export function hasLargeR2IngestWorkerFiles(): boolean {
	return WORKER_ENTRY_FILES.every((file) =>
		existsSync(new URL(file, import.meta.url)),
	);
}

function readFunctionMemoryMb(
	environment: Readonly<Record<string, string | undefined>>,
): number {
	// Vercel functions run on AWS Lambda, which reports the configured size
	// here (2048 for Standard, 4096 for Performance); elsewhere use the host.
	const configured = Number(environment.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
	if (Number.isSafeInteger(configured) && configured > 0) return configured;
	return Math.floor(totalmem() / MEBIBYTE);
}
