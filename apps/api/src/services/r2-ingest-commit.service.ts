import { createHash } from "node:crypto";
import { getLogger } from "@logtape/logtape";
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
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

const logger = getLogger(["rudel", "api", "r2-ingest-commit"]);
const LEASE_DURATION_MS = 30 * 60_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;

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
	clientHashes: unknown;
	expectedSizes: unknown;
	expectedTotalBytes: number;
	id: string;
	ingestMetadata: unknown;
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
}

interface ClaimedIngestJob extends IngestJobRow {
	leaseToken: string;
	status: "running";
}

type RequestedJobClaim =
	| { kind: "claimed"; job: ClaimedIngestJob }
	| { kind: "completed"; job: IngestJobRow; result: IngestSessionOutput };

export interface R2IngestProcessorResult {
	contentSha256: string;
	result: IngestSessionOutput;
}

export interface CommitR2IngestJobOptions {
	database?: postgres.Sql;
	input: R2IngestCommitInput;
	now?: () => Date;
	process: (
		input: IngestSessionInput,
		identity: { organizationId: string; userId: string },
	) => Promise<R2IngestProcessorResult>;
	r2: R2MultipartUploadClient;
	randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
	userId: string;
}

export class R2IngestCommitError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(code: string, message: string, retryable: boolean) {
		super(message);
		this.code = code;
		this.name = "R2IngestCommitError";
		this.retryable = retryable;
	}
}

export async function commitR2IngestJob(
	options: CommitR2IngestJobOptions,
): Promise<R2IngestCommitOutput> {
	const database = options.database ?? sqlClient;
	const now = options.now ?? (() => new Date());
	const randomUUID = options.randomUUID ?? crypto.randomUUID;
	const claims = await claimRequestedAndOrphanedJob({
		database,
		input: options.input,
		now: now(),
		randomUUID,
		userId: options.userId,
	});

	if (claims.requested.kind === "completed") {
		await cleanupCompletedJob(claims.requested.job, database, options.r2);
		return {
			jobId: claims.requested.job.id,
			protocol: R2_INGEST_PROTOCOL,
			result: claims.requested.result,
			status: "completed",
		};
	}

	let requestedResult: R2IngestCommitOutput | undefined;
	let requestedError: unknown;
	try {
		requestedResult = await processClaimedJob({
			database,
			job: claims.requested.job,
			now,
			process: options.process,
			r2: options.r2,
		});
	} catch (error) {
		requestedError = error;
	}

	if (claims.orphaned) {
		try {
			await processClaimedJob({
				database,
				job: claims.orphaned,
				now,
				process: options.process,
				r2: options.r2,
			});
		} catch (error) {
			logger.warn(
				"Piggybacked R2 ingest recovery did not complete (job_id={jobId} error={error})",
				{
					error: getSafeErrorCode(error),
					jobId: claims.orphaned.id,
				},
			);
		}
	}

	if (requestedError) throw requestedError;
	if (!requestedResult) {
		throw new Error("R2 ingest processing completed without a result");
	}
	return requestedResult;
}

async function claimRequestedAndOrphanedJob(input: {
	database: postgres.Sql;
	input: R2IngestCommitInput;
	now: Date;
	randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
	userId: string;
}): Promise<{
	orphaned: ClaimedIngestJob | null;
	requested: RequestedJobClaim;
}> {
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
			return {
				orphaned: null,
				requested: {
					job: requestedRow,
					kind: "completed",
					result: result.data,
				},
			};
		}
		assertRequestedJobCanBeClaimed(requestedRow, input.now);
		const manifest = attachCompletionReceipt(
			requestedRow.objectManifest,
			input.input.objects,
		);
		const requested = await claimLockedJob({
			job: requestedRow,
			leaseToken: input.randomUUID(),
			manifest,
			now: input.now,
			transaction,
		});

		const [orphanCandidate] = await transaction.unsafe<IngestJobRow[]>(
			`${selectIngestJobSql()}
			 WHERE id <> $1
				AND status = 'running'
				AND lease_expires_at <= $2
			 ORDER BY lease_expires_at ASC, created_at ASC
			 FOR UPDATE SKIP LOCKED
			 LIMIT 1`,
			[input.input.jobId, input.now.toISOString()],
		);
		let orphaned: ClaimedIngestJob | null = null;
		if (orphanCandidate) {
			if (orphanCandidate.attempts >= orphanCandidate.maxAttempts) {
				await terminalizeExhaustedJob(
					orphanCandidate.id,
					input.now,
					transaction,
				);
			} else {
				orphaned = await claimLockedJob({
					job: orphanCandidate,
					leaseToken: input.randomUUID(),
					manifest: StoredManifestSchema.parse(orphanCandidate.objectManifest),
					now: input.now,
					transaction,
				});
			}
		}

		return { orphaned, requested: { job: requested, kind: "claimed" } };
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
	if (job.attempts >= job.maxAttempts) {
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
	job: IngestJobRow;
	leaseToken: string;
	manifest: readonly StoredObject[];
	now: Date;
	transaction: postgres.TransactionSql;
}): Promise<ClaimedIngestJob> {
	const leaseExpiresAt = new Date(input.now.getTime() + LEASE_DURATION_MS);
	const [claimed] = await input.transaction.unsafe<IngestJobRow[]>(
		`UPDATE ingest_job
		 SET
			status = 'running',
			attempts = attempts + 1,
			object_manifest = $1,
			lease_token = $2,
			lease_expires_at = $3,
			last_error_code = NULL,
			last_error_message = NULL,
			updated_at = $4
		 WHERE id = $5
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
			object_manifest AS "objectManifest",
			expected_sizes AS "expectedSizes",
			expected_total_bytes AS "expectedTotalBytes",
			client_hashes AS "clientHashes",
			ingest_metadata AS "ingestMetadata",
			result,
			objects_deleted_at AS "objectsDeletedAt"`,
		[
			JSON.stringify(input.manifest),
			input.leaseToken,
			leaseExpiresAt.toISOString(),
			input.now.toISOString(),
			input.job.id,
		],
	);
	if (!claimed || claimed.status !== "running" || !claimed.leaseToken) {
		throw new Error("R2 ingest lease claim failed");
	}
	return { ...claimed, leaseToken: claimed.leaseToken, status: "running" };
}

async function processClaimedJob(input: {
	database: postgres.Sql;
	job: ClaimedIngestJob;
	now: () => Date;
	process: (
		input: IngestSessionInput,
		identity: { organizationId: string; userId: string },
	) => Promise<R2IngestProcessorResult>;
	r2: R2MultipartUploadClient;
}): Promise<R2IngestCommitOutput> {
	let processed: R2IngestProcessorResult;
	try {
		const session = await materializeIngestSession(input.job, input.r2);
		processed = await input.process(session, {
			organizationId: input.job.organizationId,
			userId: input.job.userId,
		});
		if (!/^[a-f0-9]{64}$/u.test(processed.contentSha256)) {
			throw new Error("Ingest processor returned an invalid content hash");
		}
		IngestSessionOutputSchema.parse(processed.result);
		await markJobCompleted(input.job, processed, input.database, input.now());
	} catch (error) {
		await recordProcessingFailure(
			input.job,
			error,
			input.database,
			input.now(),
		);
		throw error;
	}

	await cleanupCompletedJob(input.job, input.database, input.r2);
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
): Promise<IngestSessionInput> {
	const manifest = StoredManifestSchema.parse(job.objectManifest);
	const expectedSizes = ExpectedSizesSchema.parse(job.expectedSizes);
	const clientHashes = ClientHashesSchema.parse(job.clientHashes);
	const metadata = R2IngestMetadataSchema.parse(job.ingestMetadata);
	assertStoredManifest(manifest, job.id);

	const contents = new Map<string, string>();
	let totalBytes = 0;
	for (let offset = 0; offset < manifest.length; offset += 8) {
		const batch = manifest.slice(offset, offset + 8);
		const loaded = await Promise.all(
			batch.map((object) =>
				loadVerifiedObject({
					expectedBytes: expectedSizes[object.objectKey],
					expectedHash: clientHashes[object.objectKey],
					jobId: job.id,
					object,
					r2,
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
	jobId: string;
	object: StoredObject;
	r2: R2MultipartUploadClient;
}): Promise<{ byteLength: number; content: string; objectKey: string }> {
	if (input.expectedBytes === undefined || input.expectedHash === undefined) {
		throw integrityError("R2_INGEST_MANIFEST_INVALID");
	}
	let head = await input.r2.headObject(input.object.objectKey);
	if (!head) {
		const parts = input.object.parts.map((part) => {
			if (!part.etag)
				throw integrityError("R2_INGEST_COMPLETION_RECEIPT_INVALID");
			return { etag: part.etag, partNumber: part.partNumber };
		});
		await input.r2.completeMultipartUpload({
			objectKey: input.object.objectKey,
			parts,
			uploadId: input.object.uploadId,
		});
		head = await input.r2.headObject(input.object.objectKey);
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

	const bytes = await input.r2.getObject(input.object.objectKey);
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

async function recordProcessingFailure(
	job: ClaimedIngestJob,
	error: unknown,
	database: postgres.Sql,
	now: Date,
): Promise<void> {
	const code = getSafeErrorCode(error);
	const retryable = !(error instanceof R2IngestCommitError) || error.retryable;
	const terminal = !retryable || job.attempts >= job.maxAttempts;
	const retryDelayMs = Math.min(
		RETRY_MAX_DELAY_MS,
		RETRY_BASE_DELAY_MS * 2 ** Math.max(0, job.attempts - 1),
	);
	await database.unsafe(
		`UPDATE ingest_job
		 SET
			status = $1,
			available_at = $2,
			last_error_code = $3,
			last_error_message = $4,
			failed_at = $5,
			lease_token = NULL,
			lease_expires_at = NULL,
			updated_at = $6
		 WHERE id = $7 AND status = 'running' AND lease_token = $8`,
		[
			terminal ? "failed" : "pending",
			new Date(now.getTime() + retryDelayMs).toISOString(),
			code,
			getSafeErrorMessage(error),
			terminal ? now.toISOString() : null,
			now.toISOString(),
			job.id,
			job.leaseToken,
		],
	);
}

async function cleanupCompletedJob(
	job: IngestJobRow,
	database: postgres.Sql,
	r2: R2MultipartUploadClient,
): Promise<void> {
	if (job.objectsDeletedAt) return;
	const manifest = StoredManifestSchema.parse(job.objectManifest);
	try {
		await r2.deleteObjects(manifest.map((object) => object.objectKey));
		await database.unsafe(
			`UPDATE ingest_job
			 SET objects_deleted_at = NOW(), updated_at = NOW()
			 WHERE id = $1 AND status = 'completed' AND objects_deleted_at IS NULL`,
			[job.id],
		);
	} catch (error) {
		logger.warn(
			"R2 ingest object cleanup will be retried (job_id={jobId} error={error})",
			{
				error: getSafeErrorCode(error),
				jobId: job.id,
			},
		);
	}
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
		object_manifest AS "objectManifest",
		expected_sizes AS "expectedSizes",
		expected_total_bytes AS "expectedTotalBytes",
		client_hashes AS "clientHashes",
		ingest_metadata AS "ingestMetadata",
		result,
		objects_deleted_at AS "objectsDeletedAt"
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
	return error instanceof R2IngestCommitError
		? error.code
		: "R2_INGEST_PROCESSING_FAILED";
}

function getSafeErrorMessage(error: unknown): string {
	return error instanceof R2IngestCommitError
		? error.message
		: "Ingest processing failed and may be retried";
}

function toDate(value: Date | string | null): Date {
	if (!value) return new Date(0);
	return value instanceof Date ? value : new Date(value);
}
