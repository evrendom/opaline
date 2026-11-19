import { getLogger } from "@logtape/logtape";
import { sqlClient } from "../db.js";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";
import { runLargeR2IngestWorkerPass } from "../services/large-r2-ingest-worker.service.js";
import {
	hasLargeR2IngestWorkerFiles,
	LARGE_R2_INGEST_WORKER_BUDGET_MS,
	readLargeR2IngestWorkerState,
} from "../services/large-r2-ingest-worker-config.js";
import { processRecoveredR2IngestJob } from "../services/r2-ingest-repair.service.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "../services/r2-ingest-storage.service.js";

const logger = getLogger(["rudel", "api", "large-r2-ingest-worker"]);

/**
 * Cron entry of the large-ingest deployment (`deploy/cloud/large-ingest`): it alone
 * materializes R2 sessions above 128 MiB, in a project whose functions have
 * 4 GB. Answers 503 without touching any job unless worker mode is enabled
 * and the function has the memory for it.
 */
export async function handleLargeR2IngestWorkerRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const worker = readLargeR2IngestWorkerState();
	if (!worker.enabled) {
		logger.error(
			"Large R2 ingest worker is disabled (reason={reason} memory_mb={memoryMb})",
			{ memoryMb: worker.memoryMb, reason: worker.reason },
		);
		return Response.json(worker, { status: 503 });
	}
	const availability = readR2IngestAvailability();
	if (!availability.enabled) {
		return Response.json(
			{ enabled: false, reason: "r2_unavailable" },
			{ status: 503 },
		);
	}
	const idle = await import("../services/idle-activity.js");
	const skipped = idle.idleCronResponse(await idle.cronGate());
	if (skipped) return skipped;
	try {
		const result = await runLargeR2IngestWorkerPass({
			database: sqlClient,
			deadline: {
				deadlineAt: Date.now() + LARGE_R2_INGEST_WORKER_BUDGET_MS,
				now: Date.now,
			},
			process: processRecoveredR2IngestJob,
			r2: createR2MultipartUploadClient(availability.configuration),
		});
		return Response.json({ ...worker, ...result });
	} catch (error) {
		logger.error("Large R2 ingest worker pass failed: {error}", {
			error: String(error),
		});
		return Response.json(
			{ error: "Large R2 ingest worker pass failed" },
			{ status: 500 },
		);
	}
}

/**
 * Unauthenticated deploy smoke check: reports whether worker mode is enabled,
 * the memory the function sees, and whether the Bun worker files shipped.
 * Touches no job and no database.
 */
export function handleLargeR2IngestWorkerHealthRequest(): Response {
	const worker = readLargeR2IngestWorkerState();
	const workerFiles = hasLargeR2IngestWorkerFiles();
	const r2 = readR2IngestAvailability().enabled;
	const ready = worker.enabled && workerFiles && r2;
	return Response.json(
		{
			status: ready ? "ok" : "not_ready",
			worker,
			workerFiles,
			r2,
		},
		{ status: ready ? 200 : 503 },
	);
}
