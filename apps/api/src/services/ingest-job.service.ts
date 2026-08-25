import {
	IngestSessionOutputSchema,
	R2_INGEST_PART_SIZE_BYTES,
	R2_INGEST_PROTOCOL,
	R2_INGEST_UPLOAD_URL_TTL_SECONDS,
	type R2IngestInitInput,
	type R2IngestObjectInput,
	type R2IngestStatusOutput,
	type R2IngestUploadObject,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { sqlClient } from "../db.js";
import {
	getR2IngestPartByteLengths,
	sortR2IngestObjects,
} from "../lib/r2-ingest-manifest.js";
import type { R2MultipartUploadInitClient } from "./r2-ingest-storage.service.js";

interface CreatedMultipartUpload {
	objectKey: string;
	uploadId: string;
}

const R2_INGEST_JOB_TTL_MS = 24 * 60 * 60_000;

interface IngestJobStatusRow {
	attempts: number;
	availableAt: Date | string;
	id: string;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	leaseExpiresAt: Date | string | null;
	result: unknown;
	status: "pending" | "running" | "completed" | "failed";
	updatedAt: Date | string;
}

export interface InitR2IngestJobOptions {
	database: postgres.Sql;
	input: R2IngestInitInput;
	now: () => Date;
	organizationId: string;
	r2: R2MultipartUploadInitClient;
	randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
	userId: string;
}

export async function initR2IngestJob(
	options: InitR2IngestJobOptions,
): Promise<{
	expiresAt: string;
	jobId: string;
	objects: R2IngestUploadObject[];
	partSizeBytes: typeof R2_INGEST_PART_SIZE_BYTES;
	protocol: typeof R2_INGEST_PROTOCOL;
}> {
	const jobId = options.randomUUID();
	const initializedAt = options.now();
	const jobExpiresAt = new Date(initializedAt.getTime() + R2_INGEST_JOB_TTL_MS);
	const sortedObjects = sortR2IngestObjects(options.input.objects);
	const createdUploads: CreatedMultipartUpload[] = [];
	let uploadObjects: R2IngestUploadObject[];

	try {
		uploadObjects = await createUploadObjects({
			createdUploads,
			jobId,
			objects: sortedObjects,
			r2: options.r2,
		});
	} catch (error) {
		await abortCreatedUploads(createdUploads, options.r2);
		throw error;
	}

	const { objects: ignoredObjects, ...ingestMetadata } = options.input;
	void ignoredObjects;
	const expectedSizes = Object.fromEntries(
		uploadObjects.map((object) => [object.objectKey, object.byteLength]),
	);
	const clientHashes = Object.fromEntries(
		uploadObjects.map((object) => [object.objectKey, object.sha256]),
	);
	const objectManifest = uploadObjects.map((object) => ({
		...(object.kind === "subagent" ? { agentId: object.agentId } : {}),
		kind: object.kind,
		objectKey: object.objectKey,
		parts: object.parts.map((part) => ({
			byteLength: part.byteLength,
			partNumber: part.partNumber,
		})),
		uploadId: object.uploadId,
	}));
	const expectedTotalBytes = uploadObjects.reduce(
		(total, object) => total + object.byteLength,
		0,
	);

	try {
		await options.database.unsafe(
			`
				INSERT INTO ingest_job (
					id,
					organization_id,
					user_id,
					session_id,
					source,
					object_manifest,
					expected_sizes,
					expected_total_bytes,
					client_hashes,
					ingest_metadata,
					expires_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			`,
			[
				jobId,
				options.organizationId,
				options.userId,
				options.input.sessionId,
				options.input.source,
				JSON.stringify(objectManifest),
				JSON.stringify(expectedSizes),
				expectedTotalBytes,
				JSON.stringify(clientHashes),
				JSON.stringify(ingestMetadata),
				jobExpiresAt.toISOString(),
			],
		);
	} catch (error) {
		await abortCreatedUploads(createdUploads, options.r2);
		throw error;
	}

	return {
		expiresAt: new Date(
			initializedAt.getTime() + R2_INGEST_UPLOAD_URL_TTL_SECONDS * 1000,
		).toISOString(),
		jobId,
		objects: uploadObjects,
		partSizeBytes: R2_INGEST_PART_SIZE_BYTES,
		protocol: R2_INGEST_PROTOCOL,
	};
}

export async function getR2IngestJobStatus(
	jobId: string,
	userId: string,
	database: postgres.Sql = sqlClient,
): Promise<R2IngestStatusOutput | null> {
	const [row] = await database.unsafe<IngestJobStatusRow[]>(
		`
			SELECT
				id,
				status,
				attempts,
				available_at AS "availableAt",
				lease_expires_at AS "leaseExpiresAt",
				result,
				last_error_code AS "lastErrorCode",
				last_error_message AS "lastErrorMessage",
				updated_at AS "updatedAt"
			FROM ingest_job
			WHERE id = $1
				AND user_id = $2
			LIMIT 1
		`,
		[jobId, userId],
	);
	if (!row) {
		return null;
	}

	const parsedResult = IngestSessionOutputSchema.safeParse(row.result);
	return {
		attempts: row.attempts,
		availableAt: toIsoString(row.availableAt),
		error:
			row.lastErrorCode && row.lastErrorMessage
				? { code: row.lastErrorCode, message: row.lastErrorMessage }
				: null,
		jobId: row.id,
		leaseExpiresAt: row.leaseExpiresAt ? toIsoString(row.leaseExpiresAt) : null,
		protocol: R2_INGEST_PROTOCOL,
		result: parsedResult.success ? parsedResult.data : null,
		status: row.status,
		updatedAt: toIsoString(row.updatedAt),
	};
}

async function createUploadObjects(input: {
	createdUploads: CreatedMultipartUpload[];
	jobId: string;
	objects: readonly R2IngestObjectInput[];
	r2: R2MultipartUploadInitClient;
}): Promise<R2IngestUploadObject[]> {
	const results: R2IngestUploadObject[] = [];
	const batchSize = 8;
	for (let offset = 0; offset < input.objects.length; offset += batchSize) {
		const batch = input.objects.slice(offset, offset + batchSize);
		const created = await Promise.allSettled(
			batch.map((object, batchIndex) =>
				createUploadObject({
					createdUploads: input.createdUploads,
					index: offset + batchIndex,
					jobId: input.jobId,
					object,
					r2: input.r2,
				}),
			),
		);
		const failed = created.find((result) => result.status === "rejected");
		if (failed) {
			throw failed.reason;
		}
		for (const item of created) {
			if (item.status === "fulfilled") {
				results.push(item.value);
			}
		}
	}
	return results;
}

async function createUploadObject(input: {
	createdUploads: CreatedMultipartUpload[];
	index: number;
	jobId: string;
	object: R2IngestObjectInput;
	r2: R2MultipartUploadInitClient;
}): Promise<R2IngestUploadObject> {
	const suffix =
		input.object.kind === "main" ? "main" : `subagent-${input.index}`;
	const objectKey = `ingest/${input.jobId}/${suffix}.jsonl`;
	const created = await input.r2.createMultipartUpload({
		metadata: {
			"content-sha256": input.object.sha256,
			"expected-bytes": input.object.byteLength.toString(),
			"ingest-job-id": input.jobId,
			"object-kind": input.object.kind,
		},
		objectKey,
	});
	input.createdUploads.push({ objectKey, uploadId: created.uploadId });
	const partByteLengths = getR2IngestPartByteLengths(input.object.byteLength);
	const uploadUrls = await Promise.all(
		partByteLengths.map((byteLength, index) =>
			input.r2.presignUploadPart({
				byteLength,
				objectKey,
				partNumber: index + 1,
				uploadId: created.uploadId,
			}),
		),
	);
	const parts = partByteLengths.map((byteLength, index) => ({
		byteLength,
		headers: { "Content-Length": byteLength.toString() },
		partNumber: index + 1,
		uploadUrl: uploadUrls[index] ?? "",
	}));

	return input.object.kind === "main"
		? {
				byteLength: input.object.byteLength,
				kind: "main",
				objectKey,
				parts,
				sha256: input.object.sha256,
				uploadId: created.uploadId,
			}
		: {
				agentId: input.object.agentId,
				byteLength: input.object.byteLength,
				kind: "subagent",
				objectKey,
				parts,
				sha256: input.object.sha256,
				uploadId: created.uploadId,
			};
}

async function abortCreatedUploads(
	uploads: readonly CreatedMultipartUpload[],
	r2: R2MultipartUploadInitClient,
): Promise<void> {
	await Promise.allSettled(
		uploads.map((upload) => r2.abortMultipartUpload(upload)),
	);
}

function toIsoString(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}
