import { createHash, randomUUID as createRandomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import {
	type IngestSessionInput,
	IngestSessionInputSchema,
	type IngestSessionOutput,
	IngestSessionOutputSchema,
	R2_INGEST_PROTOCOL,
	type R2IngestCommitInput,
	type R2IngestCommitOutput,
	R2IngestMetadataSchema,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { readBooleanEnv } from "../lib/env.js";
import {
	isLargeIngestSession,
	STANDARD_SESSION_MAX_BYTES,
} from "../lib/ingest-size.js";
import {
	IngestProcessingCrashSimulationError,
	type IngestProcessingFailpoint,
	passIngestProcessingBoundary,
} from "./ingest-processing-boundary.js";
import {
	cleanupIngestJobObjects,
	wakeR2IngestWorker,
} from "./r2-ingest-cleanup.service.js";
import {
	getR2IngestMaterializationGate,
	type R2IngestMaterializationGate,
	R2IngestMaterializationGateError,
} from "./r2-ingest-materialization-gate.js";
import {
	isDefinitelyPermanentProcessingError,
	isRetryableProcessingError,
	R2_INGEST_COMMIT_QUEUED,
	R2_INGEST_DEPENDENCY_UNAVAILABLE,
	R2IngestCommitError,
	R2IngestCommitQueuedError,
} from "./r2-ingest-processing-error.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

export { R2IngestCommitError } from "./r2-ingest-processing-error.js";

const logger = getLogger(["rudel", "api", "r2-ingest-commit"]);
const DEFAULT_LEASE_DURATION_MS = 30 * 60_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const TRANSIENT_RETRY_MAX_DELAY_MS = 5 * 60_000;
/**
 * How long a queued commit waits before recovery claims it. Client retries in
 * that window are answered at once instead of queueing for another slot.
 */
const COMMIT_QUEUED_DELAY_MS = 5_000;
const COMMIT_QUEUED_MESSAGE =
	"Commit accepted; waiting for a materialization slot";
const LARGE_COMMIT_QUEUED_MESSAGE =
	"Commit accepted; a large session is materialized by the large-ingest worker";
const INTERRUPTED_FINAL_CLAIM_RESCUE_CODE =
	"R2_INGEST_INTERRUPTED_FINAL_CLAIM_RESCUE";
const INTERRUPTED_FINAL_CLAIM_RESCUE_MESSAGE =
	"Recovering one interrupted final ingest claim";
const INTERRUPTED_FINAL_CLAIM_RESCUE_QUIESCED_CODE =
	"R2_INGEST_INTERRUPTED_FINAL_CLAIM_RESCUE_QUIESCED";
const INTERRUPTED_FINAL_CLAIM_RESCUE_QUIESCED_MESSAGE =
	"Interrupted final-claim rescue is paused while session ingest is quiesced. Lift the barrier, then retry this commit.";

const StoredPartSchema = z.object({
	byteLength: z.number().int().positive(),
	etag: z.string().min(1).max(512).optional(),
	partNumber: z.number().int().min(1).max(10_000),
});
const StoredObjectSchema = z.object({
	agentId: z.string().min(1).max(200).optional(),
	kind: z.enum(["main", "subagent"]),
	objectKey: z.string().min(1).max(1_024),
	parts: z.array(StoredPartSchema).min(1).max(10_000),
	uploadId: z.string().min(1).max(1_024),
});
const StoredManifestSchema = z.array(StoredObjectSchema).min(1).max(513);
const ExpectedSizesSchema = z.record(z.string(), z.number().int().positive());
const ClientHashesSchema = z.record(
	z.string(),
	z.string().regex(/^[a-f0-9]{64}$/u),
);

type StoredObject = z.infer<typeof StoredObjectSchema>;

interface IngestJobRow {
	attempts: number;
	availableAt: Date | string;
	canonicalWriteRecorded: boolean;
	clientHashes: unknown;
	expectedSizes: unknown;
	expectedTotalBytes: number;
	expiresAt: Date | string;
	id: string;
	ingestMetadata: unknown;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	leaseExpiresAt: Date | string | null;
	leaseToken: string | null;
	maxAttempts: number;
	objectManifest: unknown;
	objectsDeletedAt: Date | string | null;
	organizationId: string;
	result: unknown;
	sessionId: string;
	status: "pending" | "running" | "completed" | "failed";
	userId: string;
	updatedAt: Date | string;
}

interface ClaimedIngestJob extends IngestJobRow {
	leaseToken: string;
	status: "running";
	transientRetryDelayMs: number;
}

type RequestedJobClaim =
	| { kind: "claimed"; job: ClaimedIngestJob }
	| { kind: "completed"; job: IngestJobRow; result: IngestSessionOutput }
	| { kind: "failed"; job: IngestJobRow };

export interface R2IngestProcessorResult {
	contentSha256: string;
	result: IngestSessionOutput;
}

export type R2IngestProcessor = (
	input: IngestSessionInput,
	identity: { operationId: string; organizationId: string; userId: string },
	signal: AbortSignal,
) => Promise<R2IngestProcessorResult>;

export interface CommitR2IngestJobOptions {
	database?: postgres.Sql;
	failpoint?: IngestProcessingFailpoint;
	gate?: R2IngestMaterializationGate;
	input: R2IngestCommitInput;
	leaseDurationMs?: number;
	now?: () => Date;
	process: R2IngestProcessor;
	r2: R2MultipartUploadClient;
	randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
	sessionIngestQuiesced?: boolean;
	signal?: AbortSignal;
	userId: string;
}

export async function commitR2IngestJob(
	options: CommitR2IngestJobOptions,
): Promise<R2IngestCommitOutput> {
	const database = options.database ?? sqlClient;
	const now = options.now ?? (() => new Date());
	const randomUUID = options.randomUUID ?? createRandomUUID;
	const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
	const sessionIngestQuiesced =
		options.sessionIngestQuiesced ??
		readBooleanEnv("SESSION_INGEST_QUIESCED", false);
	assertPositiveLeaseDuration(leaseDurationMs);
	const admissionNow = now();
	const admission = await readRequestedJob(
		options.input.jobId,
		options.userId,
		database,
	);
	if (!admission) {
		throw new R2IngestCommitError(
			"R2_INGEST_JOB_NOT_FOUND",
			"Ingest job not found",
			false,
		);
	}
	const terminalAdmission = await resolveTerminalAdmission(
		admission,
		database,
		options.r2,
		options.failpoint,
	);
	if (terminalAdmission) return terminalAdmission;
	assertRequestedJobCanBeClaimed(admission, admissionNow);
	assertInterruptedFinalClaimRescueAllowed(
		admission,
		admissionNow,
		sessionIngestQuiesced,
	);
	const rescueInterruptedFinalClaim = canRescueInterruptedFinalClaim(
		admission,
		admissionNow,
		sessionIngestQuiesced,
	);
	if (
		(admission.attempts >= admission.maxAttempts &&
			!rescueInterruptedFinalClaim) ||
		isJobExpired(admission, admissionNow)
	) {
		const admissionError =
			!isJobExpired(admission, admissionNow) &&
			admission.attempts >= admission.maxAttempts &&
			!rescueInterruptedFinalClaim
				? new R2IngestCommitError(
						"R2_INGEST_ATTEMPTS_EXHAUSTED",
						"Ingest job recovery attempts were exhausted",
						false,
					)
				: new R2IngestCommitError(
						"R2_INGEST_JOB_EXPIRED",
						"Ingest job expired before processing could start",
						false,
					);
		const failed = await terminalizeAvailableJob(
			admission,
			admissionError,
			admissionNow,
			database,
		);
		if (failed) {
			await cleanupIngestJobObjects(
				failed,
				database,
				options.r2,
				options.failpoint,
			);
		}
		throw admissionError;
	}
	let manifest: readonly StoredObject[];
	try {
		manifest = attachCompletionReceipt(
			admission.objectManifest,
			options.input.objects,
		);
	} catch (error) {
		const failed = await terminalizeAvailableJob(
			admission,
			error,
			admissionNow,
			database,
		);
		if (failed) {
			await cleanupIngestJobObjects(
				failed,
				database,
				options.r2,
				options.failpoint,
			);
		}
		throw error;
	}

	// A session above the standard size, or above what this process's gate
	// admits (main Vercel functions: `LARGE_INGEST_MIN_BYTES`), never
	// materializes inside the commit request: it holds several copies of the
	// transcript for minutes, and only the large-ingest worker (or a resident
	// server) is sized for that. Store the receipt and let recovery there run
	// it alone; the client polls `ingest.status`.
	const gate = options.gate ?? getR2IngestMaterializationGate();
	if (
		isLargeIngestSession(admission.expectedTotalBytes) ||
		admission.expectedTotalBytes > gate.maxJobBytes
	) {
		await markCommitQueued(
			admission,
			manifest,
			now(),
			database,
			LARGE_COMMIT_QUEUED_MESSAGE,
		);
		wakeR2IngestWorker();
		throw new R2IngestCommitQueuedError();
	}

	try {
		return await gate.run(
			admission.expectedTotalBytes,
			async (gateSignal) => {
				const claim = await claimRequestedJob({
					database,
					input: options.input,
					leaseDurationMs,
					manifest,
					now: now(),
					randomUUID,
					sessionIngestQuiesced,
					userId: options.userId,
				});
				if (claim.kind === "completed") {
					await cleanupIngestJobObjects(
						claim.job,
						database,
						options.r2,
						options.failpoint,
					);
					return completedOutput(claim.job, claim.result);
				}
				if (claim.kind === "failed") {
					await cleanupIngestJobObjects(
						claim.job,
						database,
						options.r2,
						options.failpoint,
					);
					throw failedJobError(claim.job);
				}
				return processClaimedJob({
					database,
					failpoint: options.failpoint,
					job: claim.job,
					leaseDurationMs,
					now,
					process: options.process,
					r2: options.r2,
					signal: gateSignal,
				});
			},
			options.signal,
		);
	} catch (error) {
		if (!(error instanceof R2IngestMaterializationGateError)) throw error;
		if (error.code === "R2_INGEST_GATE_OPERATION_TIMEOUT") {
			throw new R2IngestCommitError(error.code, error.message, true);
		}
		// Admission failed before any claim: the commit is valid, so store its
		// receipt and let recovery materialize the job instead of losing it.
		await markCommitQueued(
			admission,
			manifest,
			now(),
			database,
			COMMIT_QUEUED_MESSAGE,
		);
		wakeR2IngestWorker();
		throw new R2IngestCommitQueuedError();
	}
}

/**
 * Records an accepted commit that found no materialization slot. Jobs another
 * request already claimed, finished, or made recoverable (attempts or a
 * dependency error) are left alone.
 */
async function markCommitQueued(
	job: IngestJobRow,
	manifest: readonly StoredObject[],
	now: Date,
	database: postgres.Sql,
	message: string,
): Promise<void> {
	await database.unsafe(
		`UPDATE ingest_job
		 SET
			object_manifest = $1,
			available_at = LEAST($2::timestamptz, expires_at),
			last_error_code = $3,
			last_error_message = $4,
			updated_at = $5
		 WHERE id = $6
			AND user_id = $7
			AND status = 'pending'
			AND attempts = 0
			AND expires_at > $5
			AND (last_error_code IS NULL OR last_error_code = $3)`,
		[
			JSON.stringify(manifest),
			new Date(now.getTime() + COMMIT_QUEUED_DELAY_MS).toISOString(),
			R2_INGEST_COMMIT_QUEUED,
			message,
			now.toISOString(),
			job.id,
			job.userId,
		],
	);
}

async function readRequestedJob(
	jobId: string,
	userId: string,
	database: postgres.Sql,
): Promise<IngestJobRow | null> {
	const [job] = await database.unsafe<IngestJobRow[]>(
		`${selectIngestJobSql()} WHERE id = $1 AND user_id = $2 LIMIT 1`,
		[jobId, userId],
	);
	return job ?? null;
}

async function resolveTerminalAdmission(
	job: IngestJobRow,
	database: postgres.Sql,
	r2: R2MultipartUploadClient,
	failpoint: IngestProcessingFailpoint | undefined,
): Promise<R2IngestCommitOutput | null> {
	if (job.status === "completed") {
		const result = IngestSessionOutputSchema.safeParse(job.result);
		if (!result.success) {
			throw new Error("Completed R2 ingest job has an invalid result");
		}
		await cleanupIngestJobObjects(job, database, r2, failpoint);
		return completedOutput(job, result.data);
	}
	if (job.status === "failed") {
		await cleanupIngestJobObjects(job, database, r2, failpoint);
		throw failedJobError(job);
	}
	return null;
}

function completedOutput(
	job: IngestJobRow,
	result: IngestSessionOutput,
): R2IngestCommitOutput {
	return {
		jobId: job.id,
		protocol: R2_INGEST_PROTOCOL,
		result,
		status: "completed",
	};
}

function failedJobError(job: IngestJobRow): R2IngestCommitError {
	return new R2IngestCommitError(
		job.lastErrorCode ?? "R2_INGEST_JOB_FAILED",
		job.lastErrorMessage ?? "Ingest job failed and cannot be retried",
		false,
	);
}

async function terminalizeAvailableJob(
	job: IngestJobRow,
	error: unknown,
	now: Date,
	database: postgres.Sql,
): Promise<IngestJobRow | null> {
	return database.begin(async (transaction) => {
		const [current] = await transaction.unsafe<IngestJobRow[]>(
			`${selectIngestJobSql()}
			 WHERE id = $1 AND user_id = $2
			 FOR UPDATE`,
			[job.id, job.userId],
		);
		if (
			!current ||
			current.status === "completed" ||
			current.status === "failed" ||
			(current.status === "running" &&
				toDate(current.leaseExpiresAt).getTime() > now.getTime())
		) {
			return null;
		}
		await transaction.unsafe(
			`UPDATE ingest_job
			 SET
				status = 'failed',
				last_error_code = $1,
				last_error_message = $2,
				failed_at = $3,
				lease_token = NULL,
				lease_expires_at = NULL,
				updated_at = $3
			 WHERE id = $4`,
			[
				getSafeErrorCode(error),
				getSafeErrorMessage(error),
				now.toISOString(),
				current.id,
			],
		);
		const [failed] = await transaction.unsafe<IngestJobRow[]>(
			`${selectIngestJobSql()} WHERE id = $1`,
			[current.id],
		);
		return failed ?? null;
	});
}

async function claimRequestedJob(input: {
	database: postgres.Sql;
	input: R2IngestCommitInput;
	leaseDurationMs: number;
	manifest: readonly StoredObject[];
	now: Date;
	randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
	sessionIngestQuiesced: boolean;
	userId: string;
}): Promise<RequestedJobClaim> {
	return input.database.begin(async (transaction) => {
		const [requestedRow] = await transaction.unsafe<IngestJobRow[]>(
			`${selectIngestJobSql()}
			 WHERE id = $1 AND user_id = $2
			 FOR UPDATE`,
			[input.input.jobId, input.userId],
		);
		if (!requestedRow) {
			throw new R2IngestCommitError(
				"R2_INGEST_JOB_NOT_FOUND",
				"Ingest job not found",
				false,
			);
		}
		if (requestedRow.status === "completed") {
			const result = IngestSessionOutputSchema.safeParse(requestedRow.result);
			if (!result.success) {
				throw new Error("Completed R2 ingest job has an invalid result");
			}
			return { job: requestedRow, kind: "completed", result: result.data };
		}
		if (requestedRow.status === "failed") {
			return { job: requestedRow, kind: "failed" };
		}
		assertRequestedJobCanBeClaimed(requestedRow, input.now);
		assertInterruptedFinalClaimRescueAllowed(
			requestedRow,
			input.now,
			input.sessionIngestQuiesced,
		);
		const rescueInterruptedFinalClaim = canRescueInterruptedFinalClaim(
			requestedRow,
			input.now,
			input.sessionIngestQuiesced,
		);
		if (isJobExpired(requestedRow, input.now)) {
			await terminalizeExpiredJob(requestedRow.id, input.now, transaction);
			const [failed] = await transaction.unsafe<IngestJobRow[]>(
				`${selectIngestJobSql()} WHERE id = $1`,
				[requestedRow.id],
			);
			if (!failed) throw new Error("Expired R2 ingest job disappeared");
			return { job: failed, kind: "failed" };
		}
		if (
			requestedRow.attempts >= requestedRow.maxAttempts &&
			!rescueInterruptedFinalClaim
		) {
			await terminalizeExhaustedJob(requestedRow.id, input.now, transaction);
			const [failed] = await transaction.unsafe<IngestJobRow[]>(
				`${selectIngestJobSql()} WHERE id = $1`,
				[requestedRow.id],
			);
			if (!failed) throw new Error("Terminal R2 ingest job disappeared");
			return { job: failed, kind: "failed" };
		}
		const requested = await claimLockedJob({
			claimMode: rescueInterruptedFinalClaim
				? "interrupted_final_rescue"
				: "standard",
			job: requestedRow,
			leaseDurationMs: input.leaseDurationMs,
			leaseToken: input.randomUUID(),
			manifest: input.manifest,
			now: input.now,
			transaction,
		});
		return { job: requested, kind: "claimed" };
	});
}

function assertRequestedJobCanBeClaimed(job: IngestJobRow, now: Date): void {
	if (job.status === "failed") {
		throw new R2IngestCommitError(
			"R2_INGEST_JOB_FAILED",
			"Ingest job has exhausted its recovery attempts",
			false,
		);
	}
	if (
		job.status === "running" &&
		toDate(job.leaseExpiresAt).getTime() > now.getTime()
	) {
		throw new R2IngestCommitError(
			"R2_INGEST_JOB_BUSY",
			"Ingest job is already being processed",
			true,
		);
	}
	if (
		job.status === "pending" &&
		!isJobExpired(job, now) &&
		toDate(job.availableAt).getTime() > now.getTime()
	) {
		throw new R2IngestCommitError(
			"R2_INGEST_JOB_RETRY_LATER",
			"Ingest job is waiting for its retry window",
			true,
		);
	}
}

async function claimLockedJob(input: {
	claimMode: "interrupted_final_rescue" | "standard";
	job: IngestJobRow;
	leaseDurationMs: number;
	leaseToken: string;
	manifest: readonly StoredObject[];
	now: Date;
	transaction: postgres.TransactionSql;
}): Promise<ClaimedIngestJob> {
	const leaseExpiresAt = new Date(
		Math.min(
			input.now.getTime() + input.leaseDurationMs,
			toDate(input.job.expiresAt).getTime(),
		),
	);
	const transientRetryDelayMs =
		input.job.lastErrorCode === R2_INGEST_DEPENDENCY_UNAVAILABLE
			? Math.max(
					RETRY_BASE_DELAY_MS,
					toDate(input.job.availableAt).getTime() -
						toDate(input.job.updatedAt).getTime(),
				)
			: RETRY_BASE_DELAY_MS;
	const attemptIncrement = input.claimMode === "standard" ? 1 : 0;
	const claimErrorCode =
		input.claimMode === "interrupted_final_rescue"
			? INTERRUPTED_FINAL_CLAIM_RESCUE_CODE
			: null;
	const claimErrorMessage =
		input.claimMode === "interrupted_final_rescue"
			? INTERRUPTED_FINAL_CLAIM_RESCUE_MESSAGE
			: null;
	const [claimed] = await input.transaction.unsafe<IngestJobRow[]>(
		`UPDATE ingest_job
		 SET
			status = 'running',
			attempts = attempts + $1,
			object_manifest = $2,
			lease_token = $3,
			lease_expires_at = $4,
			last_error_code = $5,
			last_error_message = $6,
			updated_at = $7
		 WHERE id = $8
		 RETURNING
			id,
			organization_id AS "organizationId",
			user_id AS "userId",
			session_id AS "sessionId",
			status,
			attempts,
			max_attempts AS "maxAttempts",
			available_at AS "availableAt",
			lease_token AS "leaseToken",
			lease_expires_at AS "leaseExpiresAt",
			expires_at AS "expiresAt",
			object_manifest AS "objectManifest",
			expected_sizes AS "expectedSizes",
			expected_total_bytes AS "expectedTotalBytes",
			client_hashes AS "clientHashes",
			ingest_metadata AS "ingestMetadata",
			FALSE AS "canonicalWriteRecorded",
			result,
			objects_deleted_at AS "objectsDeletedAt",
			updated_at AS "updatedAt"`,
		[
			attemptIncrement,
			JSON.stringify(input.manifest),
			input.leaseToken,
			leaseExpiresAt.toISOString(),
			claimErrorCode,
			claimErrorMessage,
			input.now.toISOString(),
			input.job.id,
		],
	);
	if (!claimed || claimed.status !== "running" || !claimed.leaseToken) {
		throw new Error("R2 ingest lease claim failed");
	}
	return {
		...claimed,
		leaseToken: claimed.leaseToken,
		status: "running",
		transientRetryDelayMs,
	};
}

export interface R2IngestRecoveryRepairResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
}

export async function repairRecoverableR2IngestJobs(input: {
	database: postgres.Sql;
	deadline?: MaintenanceDeadline;
	gate?: R2IngestMaterializationGate;
	leaseDurationMs?: number;
	limit?: number;
	/** Select only jobs larger than this (the large-session worker). */
	minExpectedTotalBytes?: number;
	now?: () => Date;
	process: R2IngestProcessor;
	r2: R2MultipartUploadClient;
	randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
	sessionIngestQuiesced?: boolean;
	/** Aborts the running materialization; the job is recorded as a retry. */
	signal?: AbortSignal;
}): Promise<R2IngestRecoveryRepairResult> {
	const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
	assertPositiveLeaseDuration(leaseDurationMs);
	const limit = input.limit ?? 4;
	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 20) {
		throw new Error("R2 ingest recovery limit must be between 1 and 20");
	}
	const now = input.now ?? (() => new Date());
	const sessionIngestQuiesced =
		input.sessionIngestQuiesced ??
		readBooleanEnv("SESSION_INGEST_QUIESCED", false);
	const repairNow = now();
	const gate = input.gate ?? getR2IngestMaterializationGate();
	// Jobs larger than this process admits stay for a process that can run them
	// (large sessions: the resident worker), instead of being claimed here.
	const candidates = await input.database.unsafe<IngestJobRow[]>(
		`${selectIngestJobSql()}
		 WHERE (
			(status = 'pending'
				AND (attempts > 0 OR last_error_code IN ('${R2_INGEST_DEPENDENCY_UNAVAILABLE}', '${R2_INGEST_COMMIT_QUEUED}'))
				AND available_at <= $1)
			OR (status = 'running' AND lease_expires_at <= $1)
		 )
			AND expires_at > $2
			AND expected_total_bytes <= $4
			AND expected_total_bytes > $5
		 ORDER BY
			CASE WHEN status = 'running' THEN lease_expires_at ELSE available_at END ASC,
			created_at ASC
		 LIMIT $3`,
		[
			repairNow.toISOString(),
			repairNow.toISOString(),
			limit,
			gate.maxJobBytes,
			input.minExpectedTotalBytes ?? 0,
		],
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
		let manifest: readonly StoredObject[];
		try {
			manifest = StoredManifestSchema.parse(candidate.objectManifest);
			assertStoredManifest(manifest, candidate.id);
		} catch (error) {
			const failed = await terminalizeAvailableJob(
				candidate,
				error,
				now(),
				input.database,
			);
			if (failed) {
				await cleanupIngestJobObjects(
					failed,
					input.database,
					input.r2,
					undefined,
				);
				completed += 1;
			}
			continue;
		}

		try {
			await gate.run(
				candidate.expectedTotalBytes,
				async (signal) => {
					const claim = await claimRecoverableJob({
						candidateId: candidate.id,
						database: input.database,
						leaseDurationMs,
						manifest,
						now: now(),
						randomUUID: input.randomUUID ?? createRandomUUID,
						sessionIngestQuiesced,
					});
					if (!claim) return;
					if (claim.kind === "completed" || claim.kind === "failed") {
						await cleanupIngestJobObjects(
							claim.job,
							input.database,
							input.r2,
							undefined,
						);
						return;
					}
					await processClaimedJob({
						database: input.database,
						failpoint: undefined,
						job: claim.job,
						leaseDurationMs,
						now,
						process: input.process,
						r2: input.r2,
						signal,
					});
					completed += 1;
				},
				input.signal,
			);
		} catch (error) {
			logger.warn(
				"Dedicated R2 ingest recovery did not complete (job_id={jobId} error={error})",
				{ error: getSafeErrorCode(error), jobId: candidate.id },
			);
		}
	}
	return {
		attempted,
		completed,
		hasMore: deadlineReached || candidates.length === limit,
	};
}

/**
 * True when a session above the standard size is ready for recovery. The
 * resident worker polls this so large commits accepted by other processes
 * (Vercel functions never materialize them) start within seconds instead of
 * waiting for the worker's next scheduled pass.
 */
export async function hasDueLargeR2IngestWork(
	database: postgres.Sql,
	now: Date,
): Promise<boolean> {
	const rows = await database.unsafe<{ due: number }[]>(
		`SELECT 1 AS due
		 FROM ingest_job
		 WHERE (
			(status = 'pending'
				AND (attempts > 0 OR last_error_code IN ('${R2_INGEST_DEPENDENCY_UNAVAILABLE}', '${R2_INGEST_COMMIT_QUEUED}'))
				AND available_at <= $1)
			OR (status = 'running' AND lease_expires_at <= $1)
		 )
			AND expires_at > $1
			AND expected_total_bytes > $2
		 LIMIT 1`,
		[now.toISOString(), STANDARD_SESSION_MAX_BYTES],
	);
	return rows.length > 0;
}

async function claimRecoverableJob(input: {
	candidateId: string;
	database: postgres.Sql;
	leaseDurationMs: number;
	manifest: readonly StoredObject[];
	now: Date;
	randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
	sessionIngestQuiesced: boolean;
}): Promise<RequestedJobClaim | null> {
	return input.database.begin(async (transaction) => {
		const [candidate] = await transaction.unsafe<IngestJobRow[]>(
			`${selectIngestJobSql()} WHERE id = $1 FOR UPDATE`,
			[input.candidateId],
		);
		if (!candidate) return null;
		if (candidate.status === "completed") {
			const result = IngestSessionOutputSchema.safeParse(candidate.result);
			if (!result.success) {
				throw new Error("Completed R2 ingest job has an invalid result");
			}
			return { job: candidate, kind: "completed", result: result.data };
		}
		if (candidate.status === "failed") {
			return { job: candidate, kind: "failed" };
		}
		const eligible =
			(candidate.status === "pending" &&
				(candidate.attempts > 0 ||
					candidate.lastErrorCode === R2_INGEST_DEPENDENCY_UNAVAILABLE ||
					candidate.lastErrorCode === R2_INGEST_COMMIT_QUEUED) &&
				toDate(candidate.availableAt).getTime() <= input.now.getTime()) ||
			(candidate.status === "running" &&
				toDate(candidate.leaseExpiresAt).getTime() <= input.now.getTime());
		if (!eligible) return null;
		assertInterruptedFinalClaimRescueAllowed(
			candidate,
			input.now,
			input.sessionIngestQuiesced,
		);
		const rescueInterruptedFinalClaim = canRescueInterruptedFinalClaim(
			candidate,
			input.now,
			input.sessionIngestQuiesced,
		);
		if (isJobExpired(candidate, input.now)) {
			await terminalizeExpiredJob(candidate.id, input.now, transaction);
			const [failed] = await transaction.unsafe<IngestJobRow[]>(
				`${selectIngestJobSql()} WHERE id = $1`,
				[candidate.id],
			);
			if (!failed) throw new Error("Expired R2 ingest job disappeared");
			return { job: failed, kind: "failed" };
		}
		if (
			candidate.attempts >= candidate.maxAttempts &&
			!rescueInterruptedFinalClaim
		) {
			await terminalizeExhaustedJob(candidate.id, input.now, transaction);
			const [failed] = await transaction.unsafe<IngestJobRow[]>(
				`${selectIngestJobSql()} WHERE id = $1`,
				[candidate.id],
			);
			if (!failed) throw new Error("Terminal R2 ingest job disappeared");
			return { job: failed, kind: "failed" };
		}
		return {
			job: await claimLockedJob({
				claimMode: rescueInterruptedFinalClaim
					? "interrupted_final_rescue"
					: "standard",
				job: candidate,
				leaseDurationMs: input.leaseDurationMs,
				leaseToken: input.randomUUID(),
				manifest: input.manifest,
				now: input.now,
				transaction,
			}),
			kind: "claimed",
		};
	});
}

function assertInterruptedFinalClaimRescueAllowed(
	job: IngestJobRow,
	now: Date,
	sessionIngestQuiesced: boolean,
): void {
	if (
		sessionIngestQuiesced &&
		isInterruptedFinalClaimRescueCandidate(job, now)
	) {
		throw new R2IngestCommitError(
			INTERRUPTED_FINAL_CLAIM_RESCUE_QUIESCED_CODE,
			INTERRUPTED_FINAL_CLAIM_RESCUE_QUIESCED_MESSAGE,
			true,
		);
	}
}

function canRescueInterruptedFinalClaim(
	job: IngestJobRow,
	now: Date,
	sessionIngestQuiesced: boolean,
): boolean {
	return (
		!sessionIngestQuiesced && isInterruptedFinalClaimRescueCandidate(job, now)
	);
}

function isInterruptedFinalClaimRescueCandidate(
	job: IngestJobRow,
	now: Date,
): boolean {
	return (
		job.status === "running" &&
		job.attempts >= job.maxAttempts &&
		toDate(job.leaseExpiresAt).getTime() <= now.getTime() &&
		!job.canonicalWriteRecorded &&
		job.lastErrorCode === null &&
		job.lastErrorMessage === null
	);
}

async function processClaimedJob(input: {
	database: postgres.Sql;
	failpoint: IngestProcessingFailpoint | undefined;
	job: ClaimedIngestJob;
	leaseDurationMs: number;
	now: () => Date;
	process: R2IngestProcessor;
	r2: R2MultipartUploadClient;
	signal: AbortSignal;
}): Promise<R2IngestCommitOutput> {
	let processed: R2IngestProcessorResult;
	const heartbeat = startR2IngestLeaseHeartbeat({
		database: input.database,
		job: input.job,
		leaseDurationMs: input.leaseDurationMs,
		now: input.now,
		parentSignal: input.signal,
	});
	try {
		heartbeat.signal.throwIfAborted();
		const session = await materializeIngestSession(
			input.job,
			input.r2,
			input.failpoint,
			heartbeat.signal,
		);
		processed = await input.process(
			session,
			{
				operationId: input.job.id,
				organizationId: input.job.organizationId,
				userId: input.job.userId,
			},
			heartbeat.signal,
		);
		if (!/^[a-f0-9]{64}$/u.test(processed.contentSha256)) {
			throw new Error("Ingest processor returned an invalid content hash");
		}
		IngestSessionOutputSchema.parse(processed.result);
		const heartbeatError = await heartbeat.stop();
		if (heartbeatError) throw heartbeatError;
		heartbeat.signal.throwIfAborted();
		if (
			!(await renewR2IngestJobLease({
				database: input.database,
				job: input.job,
				leaseDurationMs: input.leaseDurationMs,
				now: input.now,
			}))
		) {
			throw new R2IngestCommitError(
				"R2_INGEST_LEASE_LOST",
				"Ingest job lease was lost before completion",
				true,
			);
		}
		await markJobCompleted(input.job, processed, input.database, input.now());
		await passIngestProcessingBoundary(input.failpoint, {
			store: "postgres",
			target: "job-completed",
		});
	} catch (error) {
		const heartbeatError = await heartbeat.stop();
		if (error instanceof IngestProcessingCrashSimulationError) {
			throw error;
		}
		const effectiveError = heartbeatError ?? error;
		const disposition = await recordProcessingFailure(
			input.job,
			effectiveError,
			input.database,
			input.now(),
		);
		if (disposition === "terminal") {
			await cleanupIngestJobObjects(
				input.job,
				input.database,
				input.r2,
				input.failpoint,
			);
		}
		throw effectiveError;
	}

	await cleanupIngestJobObjects(
		input.job,
		input.database,
		input.r2,
		input.failpoint,
	);
	return {
		jobId: input.job.id,
		protocol: R2_INGEST_PROTOCOL,
		result: processed.result,
		status: "completed",
	};
}

async function materializeIngestSession(
	job: IngestJobRow,
	r2: R2MultipartUploadClient,
	failpoint: IngestProcessingFailpoint | undefined,
	signal: AbortSignal,
): Promise<IngestSessionInput> {
	signal.throwIfAborted();
	const manifest = StoredManifestSchema.parse(job.objectManifest);
	const expectedSizes = ExpectedSizesSchema.parse(job.expectedSizes);
	const clientHashes = ClientHashesSchema.parse(job.clientHashes);
	const metadata = R2IngestMetadataSchema.parse(job.ingestMetadata);
	assertStoredManifest(manifest, job.id);

	const contents = new Map<string, string>();
	let totalBytes = 0;
	for (let offset = 0; offset < manifest.length; offset += 8) {
		signal.throwIfAborted();
		const batch = manifest.slice(offset, offset + 8);
		const loaded = await Promise.all(
			batch.map((object) =>
				loadVerifiedObject({
					expectedBytes: expectedSizes[object.objectKey],
					expectedHash: clientHashes[object.objectKey],
					failpoint,
					jobId: job.id,
					object,
					r2,
					signal,
				}),
			),
		);
		for (const object of loaded) {
			contents.set(object.objectKey, object.content);
			totalBytes += object.byteLength;
		}
	}
	if (totalBytes !== job.expectedTotalBytes) {
		throw integrityError("R2_INGEST_TOTAL_SIZE_MISMATCH");
	}

	const main = manifest.find((object) => object.kind === "main");
	if (!main) throw integrityError("R2_INGEST_MANIFEST_INVALID");
	const content = contents.get(main.objectKey);
	if (content === undefined) throw integrityError("R2_INGEST_OBJECT_MISSING");
	const subagents = manifest
		.filter((object) => object.kind === "subagent")
		.map((object) => {
			const subagentContent = contents.get(object.objectKey);
			if (!object.agentId || subagentContent === undefined) {
				throw integrityError("R2_INGEST_MANIFEST_INVALID");
			}
			return { agentId: object.agentId, content: subagentContent };
		});

	return IngestSessionInputSchema.parse({
		...metadata,
		content,
		organizationId: job.organizationId,
		...(subagents.length > 0 ? { subagents } : {}),
	});
}

async function loadVerifiedObject(input: {
	expectedBytes: number | undefined;
	expectedHash: string | undefined;
	failpoint: IngestProcessingFailpoint | undefined;
	jobId: string;
	object: StoredObject;
	r2: R2MultipartUploadClient;
	signal: AbortSignal;
}): Promise<{ byteLength: number; content: string; objectKey: string }> {
	input.signal.throwIfAborted();
	if (input.expectedBytes === undefined || input.expectedHash === undefined) {
		throw integrityError("R2_INGEST_MANIFEST_INVALID");
	}
	let head = await input.r2.headObject(input.object.objectKey, input.signal);
	if (!head) {
		const parts = input.object.parts.map((part) => {
			if (!part.etag)
				throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
			return { etag: part.etag, partNumber: part.partNumber };
		});
		await input.r2.completeMultipartUpload({
			objectKey: input.object.objectKey,
			parts,
			signal: input.signal,
			uploadId: input.object.uploadId,
		});
		await passIngestProcessingBoundary(input.failpoint, {
			store: "r2",
			target: "multipart-complete",
		});
		head = await input.r2.headObject(input.object.objectKey, input.signal);
	}
	if (!head) throw integrityError("R2_INGEST_OBJECT_MISSING");
	if (
		head.byteLength !== input.expectedBytes ||
		head.metadata["content-sha256"] !== input.expectedHash ||
		head.metadata["expected-bytes"] !== input.expectedBytes.toString() ||
		head.metadata["ingest-job-id"] !== input.jobId ||
		head.metadata["object-kind"] !== input.object.kind
	) {
		throw integrityError("R2_INGEST_OBJECT_METADATA_MISMATCH");
	}

	const bytes = await input.r2.getObject(input.object.objectKey, input.signal);
	if (bytes.byteLength !== input.expectedBytes) {
		throw integrityError("R2_INGEST_OBJECT_SIZE_MISMATCH");
	}
	const hash = createHash("sha256").update(bytes).digest("hex");
	if (hash !== input.expectedHash) {
		throw integrityError("R2_INGEST_OBJECT_HASH_MISMATCH");
	}
	try {
		return {
			byteLength: bytes.byteLength,
			content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			objectKey: input.object.objectKey,
		};
	} catch {
		throw integrityError("R2_INGEST_OBJECT_ENCODING_INVALID");
	}
}

function attachCompletionReceipt(
	storedManifest: unknown,
	completedObjects: R2IngestCommitInput["objects"],
): readonly StoredObject[] {
	const manifest = StoredManifestSchema.parse(storedManifest);
	if (completedObjects.length !== manifest.length) {
		throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
	}
	const completedByKey = new Map(
		completedObjects.map((object) => [object.objectKey, object]),
	);
	if (completedByKey.size !== completedObjects.length) {
		throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
	}

	return manifest.map((object) => {
		const completed = completedByKey.get(object.objectKey);
		if (
			!completed ||
			completed.uploadId !== object.uploadId ||
			completed.parts.length !== object.parts.length
		) {
			throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
		}
		const etags = new Map(
			completed.parts.map((part) => [part.partNumber, part.etag.trim()]),
		);
		if (etags.size !== completed.parts.length) {
			throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
		}
		return {
			...object,
			parts: object.parts.map((part) => {
				const etag = etags.get(part.partNumber);
				if (!etag) throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
				return { ...part, etag };
			}),
		};
	});
}

function assertStoredManifest(
	manifest: readonly StoredObject[],
	jobId: string,
): void {
	if (manifest.filter((object) => object.kind === "main").length !== 1) {
		throw integrityError("R2_INGEST_MANIFEST_INVALID");
	}
	const keys = new Set<string>();
	for (const object of manifest) {
		if (
			!object.objectKey.startsWith(`ingest/${jobId}/`) ||
			keys.has(object.objectKey)
		) {
			throw integrityError("R2_INGEST_MANIFEST_INVALID");
		}
		keys.add(object.objectKey);
		if (object.kind === "subagent" && !object.agentId) {
			throw integrityError("R2_INGEST_MANIFEST_INVALID");
		}
		for (const [index, part] of object.parts.entries()) {
			if (part.partNumber !== index + 1 || !part.etag) {
				throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
			}
		}
	}
}

async function markJobCompleted(
	job: ClaimedIngestJob,
	processed: R2IngestProcessorResult,
	database: postgres.Sql,
	now: Date,
): Promise<void> {
	const completed = await database.unsafe<Array<{ id: string }>>(
		`UPDATE ingest_job
		 SET
			status = 'completed',
			content_sha256 = $1,
			result = $2,
			completed_at = $3,
			failed_at = NULL,
			lease_token = NULL,
			lease_expires_at = NULL,
			last_error_code = NULL,
			last_error_message = NULL,
			updated_at = $3
		 WHERE id = $4 AND status = 'running' AND lease_token = $5
		 RETURNING id`,
		[
			processed.contentSha256,
			JSON.stringify(processed.result),
			now.toISOString(),
			job.id,
			job.leaseToken,
		],
	);
	if (completed.length !== 1) {
		throw new R2IngestCommitError(
			"R2_INGEST_LEASE_LOST",
			"Ingest job lease expired before completion",
			true,
		);
	}
}

function startR2IngestLeaseHeartbeat(input: {
	database: postgres.Sql;
	job: ClaimedIngestJob;
	leaseDurationMs: number;
	now: () => Date;
	parentSignal: AbortSignal;
}): { signal: AbortSignal; stop: () => Promise<Error | null> } {
	const controller = new AbortController();
	let activeHeartbeat = Promise.resolve();
	let heartbeatError: Error | null = null;
	let stopPromise: Promise<Error | null> | undefined;
	const abortFromParent = (): void =>
		controller.abort(input.parentSignal.reason);
	if (input.parentSignal.aborted) {
		abortFromParent();
	} else {
		input.parentSignal.addEventListener("abort", abortFromParent, {
			once: true,
		});
	}

	const intervalMs = Math.max(25, Math.floor(input.leaseDurationMs / 3));
	const timer = setInterval(() => {
		activeHeartbeat = activeHeartbeat.then(async () => {
			if (heartbeatError || controller.signal.aborted) return;
			try {
				const renewed = await renewR2IngestJobLease(input);
				if (!renewed) {
					heartbeatError = new R2IngestCommitError(
						"R2_INGEST_LEASE_LOST",
						"Ingest job lease was lost during processing",
						true,
					);
					controller.abort(heartbeatError);
				}
			} catch (error) {
				heartbeatError =
					error instanceof Error
						? error
						: new Error("R2 ingest lease renewal failed");
				controller.abort(heartbeatError);
			}
		});
	}, intervalMs);
	timer.unref();

	return {
		signal: controller.signal,
		stop() {
			if (stopPromise) return stopPromise;
			stopPromise = (async () => {
				clearInterval(timer);
				input.parentSignal.removeEventListener("abort", abortFromParent);
				await activeHeartbeat;
				return heartbeatError;
			})();
			return stopPromise;
		},
	};
}

async function renewR2IngestJobLease(input: {
	database: postgres.Sql;
	job: ClaimedIngestJob;
	leaseDurationMs: number;
	now: () => Date;
}): Promise<boolean> {
	const renewedAt = input.now();
	const renewed = await input.database.unsafe<Array<{ id: string }>>(
		`UPDATE ingest_job
		 SET
			lease_expires_at = LEAST($1, expires_at),
			updated_at = $2
		 WHERE id = $3
			AND status = 'running'
			AND lease_token = $4
			AND expires_at > $2
		 RETURNING id`,
		[
			new Date(renewedAt.getTime() + input.leaseDurationMs).toISOString(),
			renewedAt.toISOString(),
			input.job.id,
			input.job.leaseToken,
		],
	);
	return renewed.length === 1;
}

async function recordProcessingFailure(
	job: ClaimedIngestJob,
	error: unknown,
	database: postgres.Sql,
	now: Date,
): Promise<"lease_lost" | "retryable" | "terminal"> {
	const permanent = isDefinitelyPermanentProcessingError(error);
	const transient = !permanent && isRetryableProcessingError(error);
	const expired = isJobExpired(job, now);
	const terminal =
		expired || permanent || (!transient && job.attempts >= job.maxAttempts);
	const code = expired
		? "R2_INGEST_JOB_EXPIRED"
		: transient
			? R2_INGEST_DEPENDENCY_UNAVAILABLE
			: getSafeErrorCode(error);
	const retryDelayMs = transient
		? Math.min(
				TRANSIENT_RETRY_MAX_DELAY_MS,
				Math.floor(
					RETRY_BASE_DELAY_MS +
						Math.random() *
							(job.transientRetryDelayMs * 3 - RETRY_BASE_DELAY_MS),
				),
			)
		: Math.min(
				RETRY_MAX_DELAY_MS,
				RETRY_BASE_DELAY_MS * 2 ** Math.max(0, job.attempts - 1),
			);
	const updated = await database.unsafe<Array<{ id: string }>>(
		`UPDATE ingest_job
		 SET
			status = $1,
			available_at = $2,
			last_error_code = $3,
			last_error_message = $4,
			failed_at = $5,
			lease_token = NULL,
			lease_expires_at = NULL,
			updated_at = $6,
			attempts = attempts - $9
		 WHERE id = $7 AND status = 'running' AND lease_token = $8
		 RETURNING id`,
		[
			terminal ? "failed" : "pending",
			new Date(
				Math.min(now.getTime() + retryDelayMs, toDate(job.expiresAt).getTime()),
			).toISOString(),
			code,
			expired
				? "Ingest job expired before completion"
				: getSafeErrorMessage(error),
			terminal ? now.toISOString() : null,
			now.toISOString(),
			job.id,
			job.leaseToken,
			transient ? 1 : 0,
		],
	);
	if (updated.length !== 1) return "lease_lost";
	if (!terminal) wakeR2IngestWorker();
	return terminal ? "terminal" : "retryable";
}

async function terminalizeExhaustedJob(
	jobId: string,
	now: Date,
	transaction: postgres.TransactionSql,
): Promise<void> {
	await transaction.unsafe(
		`UPDATE ingest_job
		 SET
			status = 'failed',
			last_error_code = 'R2_INGEST_ATTEMPTS_EXHAUSTED',
			last_error_message = 'Ingest job recovery attempts were exhausted',
			failed_at = $1,
			lease_token = NULL,
			lease_expires_at = NULL,
			updated_at = $1
		 WHERE id = $2`,
		[now.toISOString(), jobId],
	);
}

async function terminalizeExpiredJob(
	jobId: string,
	now: Date,
	transaction: postgres.TransactionSql,
): Promise<void> {
	await transaction.unsafe(
		`UPDATE ingest_job
		 SET
			status = 'failed',
			last_error_code = 'R2_INGEST_JOB_EXPIRED',
			last_error_message = 'Ingest job expired before processing could start',
			failed_at = $1,
			lease_token = NULL,
			lease_expires_at = NULL,
			updated_at = $1
		 WHERE id = $2`,
		[now.toISOString(), jobId],
	);
}

function selectIngestJobSql(): string {
	return `SELECT
		id,
		organization_id AS "organizationId",
		user_id AS "userId",
		session_id AS "sessionId",
		status,
		attempts,
		max_attempts AS "maxAttempts",
		available_at AS "availableAt",
		lease_token AS "leaseToken",
		lease_expires_at AS "leaseExpiresAt",
		expires_at AS "expiresAt",
		object_manifest AS "objectManifest",
		expected_sizes AS "expectedSizes",
		expected_total_bytes AS "expectedTotalBytes",
		client_hashes AS "clientHashes",
		ingest_metadata AS "ingestMetadata",
		last_error_code AS "lastErrorCode",
		last_error_message AS "lastErrorMessage",
		EXISTS (
			SELECT 1
			FROM session_ingest_revision AS revision
			JOIN ingest_processing_ledger AS ledger
				ON ledger.organization_id = revision.organization_id
				AND ledger.session_id = revision.session_id
				AND ledger.filtered_content_sha256 = revision.content_sha256
			JOIN ingest_processing_target_receipt AS receipt
				ON receipt.ledger_id = ledger.id
				AND receipt.target = CASE ingest_job.source
					WHEN 'claude_code' THEN 'rudel.claude_sessions'
					ELSE 'rudel.codex_sessions'
				END
			WHERE revision.organization_id = ingest_job.organization_id
				AND revision.session_id = ingest_job.session_id
				AND revision.operation_id = 'r2:' || ingest_job.id
		) AS "canonicalWriteRecorded",
		result,
		objects_deleted_at AS "objectsDeletedAt",
		updated_at AS "updatedAt"
	FROM ingest_job`;
}

function integrityError(code: string): R2IngestCommitError {
	return new R2IngestCommitError(
		code,
		"Uploaded transcript integrity verification failed",
		false,
	);
}

function getSafeErrorCode(error: unknown): string {
	if (error instanceof R2IngestCommitError) return error.code;
	if (error instanceof R2IngestMaterializationGateError) return error.code;
	if (error instanceof ORPCError) return `R2_INGEST_${error.code}`;
	if (error instanceof z.ZodError) return "R2_INGEST_SCHEMA_VALIDATION_FAILED";
	return isDefinitelyPermanentProcessingError(error)
		? "R2_INGEST_PROCESSING_FAILED"
		: "R2_INGEST_TRANSIENT_FAILURE";
}

function getSafeErrorMessage(error: unknown): string {
	if (error instanceof R2IngestCommitError) return error.message;
	if (error instanceof R2IngestMaterializationGateError) return error.message;
	return isDefinitelyPermanentProcessingError(error)
		? "Ingest processing was rejected and will not be retried"
		: "Ingest processing temporarily failed and may be retried";
}

function isJobExpired(job: IngestJobRow, now: Date): boolean {
	return toDate(job.expiresAt).getTime() <= now.getTime();
}

function assertPositiveLeaseDuration(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error("R2 ingest lease duration must be a positive integer");
	}
}

function toDate(value: Date | string | null): Date {
	if (!value) return new Date(0);
	return value instanceof Date ? value : new Date(value);
}
