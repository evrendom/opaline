import { getLogger } from "@logtape/logtape";
import { INGEST_AGGREGATE_CONTENT_MAX_BYTES } from "@rudel/api-routes";
import type postgres from "postgres";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { readBooleanEnv } from "../lib/env.js";
import { STANDARD_SESSION_MAX_BYTES } from "../lib/ingest-size.js";
import { LARGE_R2_INGEST_WORKER_MAX_DURATION_MS } from "./large-r2-ingest-worker-config.js";
import {
	type R2IngestProcessor,
	repairRecoverableR2IngestJobs,
} from "./r2-ingest-commit.service.js";
import {
	createR2IngestMaterializationGate,
	type R2IngestMaterializationGate,
} from "./r2-ingest-materialization-gate.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

/**
 * A job starts only with this much budget left. One 256 MiB session took about
 * 35 s locally; the margin covers slower function CPUs many times over.
 */
const LARGE_JOB_START_MIN_REMAINING_MS = 420_000;
/**
 * The job lease is renewed every third of this while the job runs, so a
 * function killed mid-job (timeout, out of memory) is reclaimed by the next
 * invocation within five minutes instead of the default thirty.
 */
const LARGE_JOB_LEASE_DURATION_MS = 5 * 60_000;
const logger = getLogger(["rudel", "api", "large-r2-ingest-worker"]);

export interface LargeR2IngestWorkerPassResult {
	readonly attempted: number;
	readonly completed: number;
	readonly stopReason: "busy" | "complete" | "deadline" | "failed" | "quiesced";
}

let workerGate: R2IngestMaterializationGate | undefined;

/**
 * Claims and materializes due sessions above the standard size, one at a time
 * and alone in this process, until the budget no longer fits another job.
 * Each job is aborted at the deadline and recorded as a retry; a hard kill is
 * recovered when its five-minute lease lapses.
 */
export async function runLargeR2IngestWorkerPass(input: {
	readonly database: postgres.Sql;
	readonly deadline: MaintenanceDeadline;
	readonly gate?: R2IngestMaterializationGate;
	readonly process: R2IngestProcessor;
	readonly r2: R2MultipartUploadClient;
}): Promise<LargeR2IngestWorkerPassResult> {
	if (readBooleanEnv("SESSION_INGEST_QUIESCED", false)) {
		return { attempted: 0, completed: 0, stopReason: "quiesced" };
	}
	const gate = input.gate ?? getLargeR2IngestWorkerGate();
	// Fluid compute can route an overlapping cron invocation to an instance
	// that is already materializing a large session; never start a second.
	if (gate.getStats().activeJobs > 0) {
		return { attempted: 0, completed: 0, stopReason: "busy" };
	}
	let attempted = 0;
	let completed = 0;
	while (
		hasMaintenanceTimeRemaining(
			input.deadline,
			LARGE_JOB_START_MIN_REMAINING_MS,
		)
	) {
		const remainingMs = input.deadline.deadlineAt - input.deadline.now();
		const pass = await repairRecoverableR2IngestJobs({
			database: input.database,
			gate,
			leaseDurationMs: LARGE_JOB_LEASE_DURATION_MS,
			limit: 1,
			minExpectedTotalBytes: STANDARD_SESSION_MAX_BYTES,
			process: input.process,
			r2: input.r2,
			signal: AbortSignal.timeout(remainingMs),
		});
		attempted += pass.attempted;
		completed += pass.completed;
		if (pass.attempted === 0) {
			return { attempted, completed, stopReason: "complete" };
		}
		if (pass.completed < pass.attempted) {
			// The failure is already recorded on the job (retry or terminal).
			return { attempted, completed, stopReason: "failed" };
		}
	}
	return { attempted, completed, stopReason: "deadline" };
}

function getLargeR2IngestWorkerGate(): R2IngestMaterializationGate {
	workerGate ??= createR2IngestMaterializationGate({
		largeJobMaxBytes: INGEST_AGGREGATE_CONTENT_MAX_BYTES,
		maxBytes: STANDARD_SESSION_MAX_BYTES,
		maxJobs: 1,
		maxQueuedJobs: 1,
		operationTimeoutMs: LARGE_R2_INGEST_WORKER_MAX_DURATION_MS,
		queueTimeoutMs: 1_000,
		recycleUnsettledOperation(error) {
			logger.error(
				"Large R2 materialization did not settle after cancellation; recycling the process (error={error})",
				{ error: error.message },
			);
			process.exit(1);
		},
		unsettledOperationTimeoutMs: 30_000,
	});
	return workerGate;
}
