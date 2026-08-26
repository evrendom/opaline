import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
	UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_INGEST_UPLOAD_URL_TTL_SECONDS } from "@rudel/api-routes";

export const R2_INGEST_BUCKET = "opaline-ingest-prod";
export const R2_INGEST_ENVIRONMENT_VARIABLES = [
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
] as const;

export interface R2IngestConfiguration {
	accessKeyId: string;
	accountId: string;
	bucket: typeof R2_INGEST_BUCKET;
	endpoint: string;
	forcePathStyle: boolean;
	secretAccessKey: string;
}

export type R2IngestAvailability =
	| { enabled: true; configuration: R2IngestConfiguration }
	| { enabled: false; missingVariables: readonly string[] };

export interface R2MultipartUploadInitClient {
	abortMultipartUpload: (input: {
		objectKey: string;
		uploadId: string;
	}) => Promise<void>;
	createMultipartUpload: (input: {
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
	}) => Promise<{ uploadId: string }>;
	presignUploadPart: (input: {
		byteLength: number;
		objectKey: string;
		partNumber: number;
		uploadId: string;
	}) => Promise<string>;
}

export interface R2ObjectMetadata {
	byteLength: number;
	metadata: Readonly<Record<string, string>>;
}

export interface R2MultipartUploadClient extends R2MultipartUploadInitClient {
	completeMultipartUpload: (input: {
		objectKey: string;
		parts: readonly { etag: string; partNumber: number }[];
		signal?: AbortSignal;
		uploadId: string;
	}) => Promise<void>;
	deleteObjects: (objectKeys: readonly string[]) => Promise<void>;
	getObject: (objectKey: string, signal?: AbortSignal) => Promise<Uint8Array>;
	headObject: (
		objectKey: string,
		signal?: AbortSignal,
	) => Promise<R2ObjectMetadata | null>;
}

export function readR2IngestAvailability(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): R2IngestAvailability {
	const missingVariables = R2_INGEST_ENVIRONMENT_VARIABLES.filter(
		(name) => !environment[name]?.trim(),
	);
	if (missingVariables.length > 0) {
		return { enabled: false, missingVariables };
	}

	const accountId = environment.R2_ACCOUNT_ID?.trim();
	const accessKeyId = environment.R2_ACCESS_KEY_ID?.trim();
	const secretAccessKey = environment.R2_SECRET_ACCESS_KEY?.trim();
	if (!accountId || !accessKeyId || !secretAccessKey) {
		return {
			enabled: false,
			missingVariables: [...R2_INGEST_ENVIRONMENT_VARIABLES],
		};
	}

	return {
		enabled: true,
		configuration: {
			accessKeyId,
			accountId,
			bucket: R2_INGEST_BUCKET,
			endpoint:
				environment.R2_ENDPOINT?.trim() ||
				`https://${accountId}.eu.r2.cloudflarestorage.com`,
			forcePathStyle: Boolean(environment.R2_ENDPOINT?.trim()),
			secretAccessKey,
		},
	};
}

export function createR2MultipartUploadClient(
	configuration: R2IngestConfiguration,
): R2MultipartUploadClient {
	const client = new S3Client({
		credentials: {
			accessKeyId: configuration.accessKeyId,
			secretAccessKey: configuration.secretAccessKey,
		},
		endpoint: configuration.endpoint,
		forcePathStyle: configuration.forcePathStyle,
		region: "auto",
	});

	return {
		async abortMultipartUpload(input) {
			await client.send(
				new AbortMultipartUploadCommand({
					Bucket: configuration.bucket,
					Key: input.objectKey,
					UploadId: input.uploadId,
				}),
			);
		},
		async createMultipartUpload(input) {
			const result = await client.send(
				new CreateMultipartUploadCommand({
					Bucket: configuration.bucket,
					ContentType: "application/x-ndjson",
					Key: input.objectKey,
					Metadata: input.metadata,
				}),
			);
			if (!result.UploadId) {
				throw new Error("R2 did not return a multipart upload ID");
			}
			return { uploadId: result.UploadId };
		},
		async completeMultipartUpload(input) {
			await client.send(
				new CompleteMultipartUploadCommand({
					Bucket: configuration.bucket,
					Key: input.objectKey,
					MultipartUpload: {
						Parts: input.parts.map((part) => ({
							ETag: part.etag,
							PartNumber: part.partNumber,
						})),
					},
					UploadId: input.uploadId,
				}),
				{ abortSignal: input.signal },
			);
		},
		async deleteObjects(objectKeys) {
			if (objectKeys.length === 0) return;
			const result = await client.send(
				new DeleteObjectsCommand({
					Bucket: configuration.bucket,
					Delete: {
						Objects: objectKeys.map((objectKey) => ({ Key: objectKey })),
						Quiet: true,
					},
				}),
			);
			if (result.Errors && result.Errors.length > 0) {
				throw new Error(
					`R2 failed to delete ${result.Errors.length} ingest object(s)`,
				);
			}
		},
		async getObject(objectKey, signal) {
			const result = await client.send(
				new GetObjectCommand({
					Bucket: configuration.bucket,
					Key: objectKey,
				}),
				{ abortSignal: signal },
			);
			if (!result.Body) {
				throw new Error("R2 returned an ingest object without a body");
			}
			return result.Body.transformToByteArray();
		},
		async headObject(objectKey, signal) {
			try {
				const result = await client.send(
					new HeadObjectCommand({
						Bucket: configuration.bucket,
						Key: objectKey,
					}),
					{ abortSignal: signal },
				);
				if (result.ContentLength === undefined) {
					throw new Error("R2 object is missing its content length");
				}
				return {
					byteLength: result.ContentLength,
					metadata: result.Metadata ?? {},
				};
			} catch (error) {
				if (isNotFoundError(error)) return null;
				throw error;
			}
		},
		presignUploadPart(input) {
			return getSignedUrl(
				client,
				new UploadPartCommand({
					Bucket: configuration.bucket,
					ContentLength: input.byteLength,
					Key: input.objectKey,
					PartNumber: input.partNumber,
					UploadId: input.uploadId,
				}),
				{
					expiresIn: R2_INGEST_UPLOAD_URL_TTL_SECONDS,
					signableHeaders: new Set(["content-length"]),
				},
			);
		},
	};
}

function isNotFoundError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	if (
		"name" in error &&
		(error.name === "NotFound" || error.name === "NoSuchKey")
	) {
		return true;
	}
	if (!("$metadata" in error)) return false;
	const metadata = error.$metadata;
	return (
		typeof metadata === "object" &&
		metadata !== null &&
		"httpStatusCode" in metadata &&
		metadata.httpStatusCode === 404
	);
}
