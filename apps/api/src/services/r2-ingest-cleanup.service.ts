import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { z } from "zod";
import type { IngestProcessingFailpoint } from "./ingest-processing-boundary.js";
import { passIngestProcessingBoundary } from "./ingest-processing-boundary.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

const logger = getLogger(["rudel", "api", "r2-ingest-cleanup"]);
const MAX_CLEANUP_JOBS_PER_REPAIR = 20;

const CleanupObjectSchema = z.object({
	objectKey: z.string().min(1).max(1_024),
	uploadId: z.string().min(1).max(1_024),
});
const CleanupManifestSchema = z.array(CleanupObjectSchema).min(1).max(513);

export interface R2IngestCleanupJob {
	readonly id: string;
	readonly objectManifest: unknown;
	readonly objectsDeletedAt: Date | string | null;
}

export interface R2IngestCleanupRepairResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
}

export interface R2IngestCleanupWorker {
	wake: () => Promise<void>;
}

let registeredR2IngestCleanupWorker: R2IngestCleanupWorker | undefined;

export function registerR2IngestCleanupWorker(
	worker: R2IngestCleanupWorker,
): void {
	registeredR2IngestCleanupWorker = worker;
}

export async function cleanupIngestJobObjects(
	job: R2IngestCleanupJob,
	database: postgres.Sql,
	r2: R2MultipartUploadClient,
	failpoint: IngestProcessingFailpoint | undefined,
	wakeWorkerOnFailure = true,
): Promise<boolean> {
	if (job.objectsDeletedAt) return true;
	const manifest = CleanupManifestSchema.parse(job.objectManifest);
	try {
		for (const object of manifest) {
			try {
				await r2.abortMultipartUpload({
					objectKey: object.objectKey,
					uploadId: object.uploadId,
				});
			} catch (error) {
				if (!isNoSuchUploadError(error)) throw error;
				logger.debug(
					"R2 multipart upload was already absent (job_id={jobId} object_key={objectKey})",
					{ jobId: job.id, objectKey: object.objectKey },
				);
			}
			await passIngestProcessingBoundary(failpoint, {
				store: "r2",
				target: "abort-multipart",
			});
		}
		await r2.deleteObjects(manifest.map((object) => object.objectKey));
		await passIngestProcessingBoundary(failpoint, {
			store: "r2",
			target: "delete-objects",
		});
		await database.unsafe(
			`UPDATE ingest_job
			 SET objects_deleted_at = NOW(), updated_at = NOW()
			 WHERE id = $1
				AND status IN ('completed', 'failed')
				AND objects_deleted_at IS NULL`,
			[job.id],
		);
		return true;
	} catch (error) {
		logger.warn(
			"R2 ingest object cleanup will be retried (job_id={jobId} error={error})",
			{
				error: getSafeCleanupErrorCode(error),
				jobId: job.id,
			},
		);
		if (wakeWorkerOnFailure) {
			void registeredR2IngestCleanupWorker?.wake();
		}
		return false;
	}
}

export async function repairR2IngestCleanupJobs(input: {
	database: postgres.Sql;
	limit?: number;
	r2: R2MultipartUploadClient;
}): Promise<R2IngestCleanupRepairResult> {
	const limit = input.limit ?? MAX_CLEANUP_JOBS_PER_REPAIR;
	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
		throw new Error("R2 ingest cleanup repair limit must be between 1 and 100");
	}
	const candidates = await input.database.unsafe<R2IngestCleanupJob[]>(
		`SELECT
			id,
			object_manifest AS "objectManifest",
			objects_deleted_at AS "objectsDeletedAt"
		 FROM ingest_job
		 WHERE status IN ('completed', 'failed')
			AND objects_deleted_at IS NULL
		 ORDER BY updated_at ASC, id ASC
		 LIMIT $1`,
		[limit],
	);
	let completed = 0;
	for (const candidate of candidates) {
		if (
			await cleanupIngestJobObjects(
				candidate,
				input.database,
				input.r2,
				undefined,
				false,
			)
		) {
			completed += 1;
		}
	}
	return {
		attempted: candidates.length,
		completed,
		hasMore: candidates.length === limit && completed === candidates.length,
	};
}

function isNoSuchUploadError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	for (const key of ["name", "code", "Code"] as const) {
		if (Reflect.get(error, key) === "NoSuchUpload") return true;
	}
	return false;
}

function getSafeCleanupErrorCode(error: unknown): string {
	if (typeof error !== "object" || error === null) return "UNKNOWN";
	for (const key of ["name", "code", "Code"] as const) {
		const value = Reflect.get(error, key);
		if (typeof value === "string" && value.length > 0)
			return value.slice(0, 100);
	}
	return "UNKNOWN";
}
