import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListMultipartUploadsCommand,
	ListPartsCommand,
	PutObjectCommand,
	S3Client,
	UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getLogger } from "@logtape/logtape";
import { R2_INGEST_UPLOAD_URL_TTL_SECONDS } from "@rudel/api-routes";

const logger = getLogger(["rudel", "api", "r2-ingest-storage"]);
const LOOPBACK_R2_ENDPOINT_HOSTNAMES = new Set([
	"127.0.0.1",
	"localhost",
	"[::1]",
]);
type IgnoredR2EndpointOverrideReason =
	| "invalid-url"
	| "non-loopback-hostname"
	| "non-test-environment";

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
		contentType?: string;
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
		signal?: AbortSignal;
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
	hasMultipartUpload: (input: {
		objectKey: string;
		uploadId: string;
	}) => Promise<boolean>;
	listMultipartUploads: (objectKey: string) => Promise<
		readonly {
			initiatedAt: Date;
			uploadId: string;
		}[]
	>;
	headObject: (
		objectKey: string,
		signal?: AbortSignal,
	) => Promise<R2ObjectMetadata | null>;
}

export interface R2EvidenceStorageClient extends R2MultipartUploadClient {
	putObject: (input: {
		body: Uint8Array;
		contentType: string;
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
		signal?: AbortSignal;
	}) => Promise<void>;
}

export function readR2IngestAvailability(
	environment: Readonly<Record<string, string | undefined>> = process.env,
	warnIgnoredEndpoint: (
		reason: IgnoredR2EndpointOverrideReason,
	) => void = warnIgnoredR2Endpoint,
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
	const endpointOverride = readTestR2EndpointOverride(
		environment,
		warnIgnoredEndpoint,
	);

	return {
		enabled: true,
		configuration: {
			accessKeyId,
			accountId,
			bucket: R2_INGEST_BUCKET,
			endpoint:
				endpointOverride || `https://${accountId}.eu.r2.cloudflarestorage.com`,
			forcePathStyle: endpointOverride !== null,
			secretAccessKey,
		},
	};
}

function readTestR2EndpointOverride(
	environment: Readonly<Record<string, string | undefined>>,
	warnIgnoredEndpoint: (reason: IgnoredR2EndpointOverrideReason) => void,
): string | null {
	const endpointOverride = environment.R2_ENDPOINT?.trim();
	if (!endpointOverride) return null;
	if (environment.NODE_ENV !== "test") {
		warnIgnoredEndpoint("non-test-environment");
		return null;
	}

	let endpointUrl: URL;
	try {
		endpointUrl = new URL(endpointOverride);
	} catch {
		warnIgnoredEndpoint("invalid-url");
		return null;
	}
	if (!LOOPBACK_R2_ENDPOINT_HOSTNAMES.has(endpointUrl.hostname)) {
		warnIgnoredEndpoint("non-loopback-hostname");
		return null;
	}
	return endpointOverride;
}

function warnIgnoredR2Endpoint(reason: IgnoredR2EndpointOverrideReason): void {
	logger.warn(
		"Ignoring R2_ENDPOINT override ({reason}); the pinned Cloudflare EU endpoint remains active",
		{ reason },
	);
}

export function createR2MultipartUploadClient(
	configuration: R2IngestConfiguration,
): R2EvidenceStorageClient {
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
					ContentType: input.contentType ?? "application/x-ndjson",
					Key: input.objectKey,
					Metadata: input.metadata,
				}),
				{ abortSignal: input.signal },
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
		async hasMultipartUpload(input) {
			try {
				await client.send(
					new ListPartsCommand({
						Bucket: configuration.bucket,
						Key: input.objectKey,
						MaxParts: 1,
						UploadId: input.uploadId,
					}),
				);
				return true;
			} catch (error) {
				return !(
					typeof error === "object" &&
					error !== null &&
					"name" in error &&
					error.name === "NoSuchUpload"
				);
			}
		},
		async listMultipartUploads(objectKey) {
			const result = await client.send(
				new ListMultipartUploadsCommand({
					Bucket: configuration.bucket,
					Prefix: objectKey,
				}),
			);
			return (result.Uploads ?? [])
				.filter(
					(upload) =>
						upload.Key === objectKey &&
						upload.UploadId !== undefined &&
						upload.Initiated !== undefined,
				)
				.map((upload) => ({
					initiatedAt: upload.Initiated as Date,
					uploadId: upload.UploadId as string,
				}));
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
		async putObject(input) {
			await client.send(
				new PutObjectCommand({
					Body: input.body,
					Bucket: configuration.bucket,
					ContentLength: input.body.byteLength,
					ContentType: input.contentType,
					Key: input.objectKey,
					Metadata: input.metadata,
				}),
				{ abortSignal: input.signal },
			);
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
