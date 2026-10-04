import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { z } from "zod";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import type { IngestProcessingFailpoint } from "./ingest-processing-boundary.js";
import { passIngestProcessingBoundary } from "./ingest-processing-boundary.js";
import {
	R2_INGEST_COMMIT_QUEUED,
	R2_INGEST_DEPENDENCY_UNAVAILABLE,
	R2_INGEST_TRANSIENT_ERROR_CODES,
} from "./r2-ingest-processing-error.js";
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

interface LockedR2IngestCleanupJob extends R2IngestCleanupJob {
	readonly status: string;
}

export interface R2IngestCleanupRepairResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
}

export interface R2IngestExpirySweepResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
}

interface R2IngestNextWorkDueRow {
	readonly nextDueAt: Date | string | null;
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

export function wakeR2IngestWorker(): void {
	void registeredR2IngestCleanupWorker?.wake();
}

export async function cleanupIngestJobObjects(
	job: R2IngestCleanupJob,
	database: postgres.Sql,
	r2: R2MultipartUploadClient,
	failpoint: IngestProcessingFailpoint | undefined,
	wakeWorkerOnFailure = true,
): Promise<boolean> {
	try {
		return await database.begin(async (transaction) => {
			const [current] = await transaction.unsafe<LockedR2IngestCleanupJob[]>(
				`SELECT id, status, object_manifest AS "objectManifest",
					objects_deleted_at AS "objectsDeletedAt"
				 FROM ingest_job WHERE id = $1
					AND (status != 'failed' OR expires_at <= NOW()
						OR COALESCE(last_error_code, '') != ALL($2::text[]))
				 FOR UPDATE`,
				[job.id, R2_INGEST_TRANSIENT_ERROR_CODES],
			);
			if (!current || !["completed", "failed"].includes(current.status))
				return false;
			if (current.objectsDeletedAt) return true;
			const manifest = CleanupManifestSchema.parse(current.objectManifest);
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
			await transaction.unsafe(
				`UPDATE ingest_job
			 SET objects_deleted_at = NOW(), updated_at = NOW()
			 WHERE id = $1
				AND status IN ('completed', 'failed')
				AND objects_deleted_at IS NULL`,
				[job.id],
			);
			return true;
		});
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
	deadline?: MaintenanceDeadline;
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
			AND (status != 'failed' OR expires_at <= NOW()
				OR COALESCE(last_error_code, '') != ALL($2::text[]))
		 ORDER BY updated_at ASC, id ASC
		 LIMIT $1`,
		[limit, R2_INGEST_TRANSIENT_ERROR_CODES],
	);
	let attempted = 0;
	let completed = 0;
	let deadlineReached = false;
	for (const candidate of candidates) {
		if (!hasMaintenanceTimeRemaining(input.deadline)) {
			deadlineReached = true;
			break;
		}
		attempted += 1;
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
		attempted,
		completed,
		hasMore:
			deadlineReached ||
			(candidates.length === limit && completed === candidates.length),
	};
}

export async function sweepExpiredR2IngestJobs(input: {
	database: postgres.Sql;
	deadline?: MaintenanceDeadline;
	limit?: number;
	now?: Date;
	r2: R2MultipartUploadClient;
}): Promise<R2IngestExpirySweepResult> {
	const limit = input.limit ?? MAX_CLEANUP_JOBS_PER_REPAIR;
	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
		throw new Error("R2 ingest expiry sweep limit must be between 1 and 100");
	}
	const now = input.now ?? new Date();
	const expired = await input.database.unsafe<R2IngestCleanupJob[]>(
		`WITH candidates AS (
			SELECT id
			FROM ingest_job
			WHERE expires_at <= $1
				AND (
					status = 'pending'
					OR (status = 'running' AND lease_expires_at <= $1)
				)
			ORDER BY expires_at ASC, id ASC
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		), terminalized AS (
			UPDATE ingest_job AS job
			SET
				status = 'failed',
				last_error_code = 'R2_INGEST_JOB_EXPIRED',
				last_error_message = 'Ingest job expired before completion',
				failed_at = $1,
				lease_token = NULL,
				lease_expires_at = NULL,
				updated_at = $1
			FROM candidates
			WHERE job.id = candidates.id
			RETURNING
				job.id,
				job.object_manifest AS "objectManifest",
				job.objects_deleted_at AS "objectsDeletedAt"
		)
		SELECT id, "objectManifest", "objectsDeletedAt"
		FROM terminalized`,
		[now.toISOString(), limit],
	);
	let attempted = 0;
	let completed = 0;
	let deadlineReached = false;
	for (const job of expired) {
		if (!hasMaintenanceTimeRemaining(input.deadline)) {
			deadlineReached = true;
			break;
		}
		attempted += 1;
		if (
			await cleanupIngestJobObjects(
				job,
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
		attempted,
		completed,
		hasMore:
			deadlineReached ||
			(expired.length === limit && completed === expired.length),
	};
}

export async function getNextR2IngestWorkDueAt(
	database: postgres.Sql,
): Promise<Date | null> {
	const [row] = await database.unsafe<R2IngestNextWorkDueRow[]>(
		`SELECT MIN(due_at) AS "nextDueAt"
		 FROM (
			SELECT available_at AS due_at
			FROM ingest_job
			WHERE status = 'pending'
				AND (attempts > 0 OR last_error_code IN ('${R2_INGEST_DEPENDENCY_UNAVAILABLE}', '${R2_INGEST_COMMIT_QUEUED}'))

			UNION ALL

			SELECT lease_expires_at AS due_at
			FROM ingest_job
			WHERE status = 'running' AND lease_expires_at IS NOT NULL

			UNION ALL

			SELECT expires_at AS due_at
			FROM ingest_job
			WHERE status = 'pending'
		 ) AS due_work`,
	);
	if (!row?.nextDueAt) return null;
	const nextDueAt =
		row.nextDueAt instanceof Date ? row.nextDueAt : new Date(row.nextDueAt);
	return Number.isNaN(nextDueAt.getTime()) ? null : nextDueAt;
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
