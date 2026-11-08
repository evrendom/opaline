import { resolve } from "node:path";
import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListMultipartUploadsCommand,
	ListObjectsV2Command,
	ListPartsCommand,
	PutObjectCommand,
	S3Client,
	UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getLogger } from "@logtape/logtape";
import { R2_INGEST_UPLOAD_URL_TTL_SECONDS } from "@rudel/api-routes";
import { isSelfHosted } from "../lib/self-hosted.js";
import { createLocalObjectStoreClient } from "./local-object-store.js";

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

export const S3_OBJECT_STORE_ENVIRONMENT_VARIABLES = [
	"S3_ENDPOINT",
	"S3_BUCKET",
	"S3_REGION",
	"S3_ACCESS_KEY_ID",
	"S3_SECRET_ACCESS_KEY",
	"S3_FORCE_PATH_STYLE",
] as const;
export const LOCAL_OBJECT_STORE_DIRECTORY = "object-store";
const S3_REQUIRED_ENVIRONMENT_VARIABLES = [
	"S3_BUCKET",
	"S3_ACCESS_KEY_ID",
	"S3_SECRET_ACCESS_KEY",
] as const;
const LOCAL_OBJECT_STORE_ENVIRONMENT_VARIABLES = [
	"OPALINE_DATA_DIR",
	"APP_URL",
	"BETTER_AUTH_SECRET",
] as const;
const DEFAULT_S3_REGION = "us-east-1";

export interface CloudflareR2Configuration {
	readonly backend?: "r2";
	accessKeyId: string;
	accountId: string;
	bucket: typeof R2_INGEST_BUCKET;
	endpoint: string;
	forcePathStyle: boolean;
	secretAccessKey: string;
}

export interface S3CompatibleConfiguration {
	readonly backend: "s3";
	accessKeyId: string;
	bucket: string;
	endpoint: string | undefined;
	forcePathStyle: boolean;
	region: string;
	secretAccessKey: string;
}

export interface LocalDiskConfiguration {
	readonly backend: "local";
	directory: string;
	publicOrigin: string;
	signingSecret: string;
}

export type R2IngestConfiguration =
	| CloudflareR2Configuration
	| S3CompatibleConfiguration
	| LocalDiskConfiguration;

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

export interface R2ObjectListing {
	readonly nextContinuationToken: string | null;
	readonly objects: readonly { key: string; lastModified: Date }[];
}

/** One page of object keys under a prefix (S3 ListObjectsV2). */
export interface R2ObjectListingClient {
	listObjects: (input: {
		continuationToken?: string;
		maxKeys?: number;
		prefix: string;
		signal?: AbortSignal;
		startAfter?: string;
	}) => Promise<R2ObjectListing>;
}

export interface R2StorageClient
	extends R2EvidenceStorageClient,
		R2ObjectListingClient {}

export interface IncompleteMultipartUpload {
	readonly initiatedAt: Date;
	readonly objectKey: string;
	readonly uploadId: string;
}

export interface ObjectStoreClient extends R2StorageClient {
	incompleteMultipartUploads: () => AsyncIterable<IncompleteMultipartUpload>;
	removeStaleScratch?: (olderThan: Date) => Promise<number>;
}

export interface R2ClientOptions {
	/** Per-request socket timeout; unset keeps the SDK default (none). */
	readonly requestTimeoutMs?: number;
}

export function readR2IngestAvailability(
	environment: Readonly<Record<string, string | undefined>> = process.env,
	warnIgnoredEndpoint: (
		reason: IgnoredR2EndpointOverrideReason,
	) => void = warnIgnoredR2Endpoint,
): R2IngestAvailability {
	if (!isSelfHosted(environment)) {
		return readCloudflareR2Availability(environment, warnIgnoredEndpoint);
	}
	if (hasAnyVariable(environment, S3_OBJECT_STORE_ENVIRONMENT_VARIABLES)) {
		const s3 = parseS3Configuration(environment);
		return s3.ok
			? { enabled: true, configuration: s3.configuration }
			: { enabled: false, missingVariables: s3.missingVariables };
	}
	if (hasAnyVariable(environment, R2_INGEST_ENVIRONMENT_VARIABLES)) {
		return readCloudflareR2Availability(environment, warnIgnoredEndpoint);
	}
	return readLocalDiskAvailability(environment);
}

export function objectStoreConfigurationProblems(
	environment: Readonly<Record<string, string | undefined>>,
): string[] {
	const usesS3 = hasAnyVariable(
		environment,
		S3_OBJECT_STORE_ENVIRONMENT_VARIABLES,
	);
	const r2Variables = R2_INGEST_ENVIRONMENT_VARIABLES.filter((name) =>
		environment[name]?.trim(),
	);
	if (usesS3 && r2Variables.length > 0) {
		return [
			`set either the S3_* variables or ${r2Variables.join(", ")}, not both`,
		];
	}
	if (usesS3) {
		const s3 = parseS3Configuration(environment);
		return s3.ok ? [] : s3.problems;
	}
	if (
		r2Variables.length > 0 &&
		r2Variables.length < R2_INGEST_ENVIRONMENT_VARIABLES.length
	) {
		return [
			`${R2_INGEST_ENVIRONMENT_VARIABLES.join(", ")} must be set together to use Cloudflare R2`,
		];
	}
	return [];
}

export function describeObjectStore(
	availability: R2IngestAvailability,
): string {
	if (!availability.enabled) {
		return `off (missing ${availability.missingVariables.join(", ")})`;
	}
	const configuration = availability.configuration;
	if (configuration.backend === "local") {
		return `local disk ${configuration.directory}`;
	}
	if (configuration.backend === "s3") {
		return `S3 bucket ${configuration.bucket} at ${configuration.endpoint ?? `AWS ${configuration.region}`}`;
	}
	return `Cloudflare R2 bucket ${configuration.bucket}`;
}

function readCloudflareR2Availability(
	environment: Readonly<Record<string, string | undefined>>,
	warnIgnoredEndpoint: (reason: IgnoredR2EndpointOverrideReason) => void,
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

function parseS3Configuration(
	environment: Readonly<Record<string, string | undefined>>,
):
	| { ok: true; configuration: S3CompatibleConfiguration }
	| { ok: false; missingVariables: string[]; problems: string[] } {
	const read = (name: (typeof S3_OBJECT_STORE_ENVIRONMENT_VARIABLES)[number]) =>
		environment[name]?.trim() || undefined;
	const missingVariables: string[] = S3_REQUIRED_ENVIRONMENT_VARIABLES.filter(
		(name) => !read(name),
	);
	const problems = missingVariables.map(
		(name) => `${name} is not set: it is needed for S3 object storage`,
	);
	const endpoint = read("S3_ENDPOINT");
	if (endpoint !== undefined) {
		let url: URL | undefined;
		try {
			url = new URL(endpoint);
		} catch {}
		if (
			!url ||
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.search ||
			url.hash
		) {
			missingVariables.push("S3_ENDPOINT");
			problems.push(
				`S3_ENDPOINT must be an http:// or https:// URL, not ${JSON.stringify(endpoint)}`,
			);
		}
	}
	const region =
		read("S3_REGION") ?? (endpoint ? DEFAULT_S3_REGION : undefined);
	if (region === undefined) {
		missingVariables.push("S3_ENDPOINT");
		problems.push(
			"S3_ENDPOINT is not set: point it at the S3-compatible server, or set S3_REGION for AWS S3",
		);
	}
	const pathStyle = read("S3_FORCE_PATH_STYLE")?.toLowerCase();
	if (
		pathStyle !== undefined &&
		!["true", "false", "1", "0"].includes(pathStyle)
	) {
		missingVariables.push("S3_FORCE_PATH_STYLE");
		problems.push(
			`S3_FORCE_PATH_STYLE must be true or false, not ${JSON.stringify(environment.S3_FORCE_PATH_STYLE)}`,
		);
	}
	const bucket = read("S3_BUCKET");
	const accessKeyId = read("S3_ACCESS_KEY_ID");
	const secretAccessKey = read("S3_SECRET_ACCESS_KEY");
	if (
		problems.length > 0 ||
		!bucket ||
		!accessKeyId ||
		!secretAccessKey ||
		!region
	) {
		return { ok: false, missingVariables, problems };
	}
	return {
		ok: true,
		configuration: {
			accessKeyId,
			backend: "s3",
			bucket,
			endpoint,
			forcePathStyle:
				pathStyle === undefined
					? endpoint !== undefined
					: pathStyle === "true" || pathStyle === "1",
			region,
			secretAccessKey,
		},
	};
}

function readLocalDiskAvailability(
	environment: Readonly<Record<string, string | undefined>>,
): R2IngestAvailability {
	const missingVariables = LOCAL_OBJECT_STORE_ENVIRONMENT_VARIABLES.filter(
		(name) => !environment[name]?.trim(),
	);
	const dataDirectory = environment.OPALINE_DATA_DIR?.trim();
	const appUrl = environment.APP_URL?.trim();
	const signingSecret = environment.BETTER_AUTH_SECRET?.trim();
	if (
		missingVariables.length > 0 ||
		!dataDirectory ||
		!appUrl ||
		!signingSecret
	) {
		return { enabled: false, missingVariables };
	}
	let publicOrigin: string;
	try {
		publicOrigin = new URL(appUrl).origin;
	} catch {
		return { enabled: false, missingVariables: ["APP_URL"] };
	}
	return {
		enabled: true,
		configuration: {
			backend: "local",
			directory: resolve(dataDirectory, LOCAL_OBJECT_STORE_DIRECTORY),
			publicOrigin,
			signingSecret,
		},
	};
}

function hasAnyVariable(
	environment: Readonly<Record<string, string | undefined>>,
	names: readonly string[],
): boolean {
	return names.some((name) => Boolean(environment[name]?.trim()));
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
	options: R2ClientOptions = {},
): R2StorageClient {
	return createObjectStoreClient(configuration, options);
}

export function createObjectStoreClient(
	configuration: R2IngestConfiguration,
	options: R2ClientOptions = {},
): ObjectStoreClient {
	if (configuration.backend === "local") {
		return createLocalObjectStoreClient(configuration);
	}
	return createS3ObjectStoreClient(configuration, options);
}

export function createObjectStoreS3Client(
	configuration: CloudflareR2Configuration | S3CompatibleConfiguration,
	options: R2ClientOptions = {},
): S3Client {
	return new S3Client({
		credentials: {
			accessKeyId: configuration.accessKeyId,
			secretAccessKey: configuration.secretAccessKey,
		},
		endpoint: configuration.endpoint,
		forcePathStyle: configuration.forcePathStyle,
		region: configuration.backend === "s3" ? configuration.region : "auto",
		...(configuration.backend === "s3"
			? {
					requestChecksumCalculation: "WHEN_REQUIRED" as const,
					responseChecksumValidation: "WHEN_REQUIRED" as const,
				}
			: {}),
		...(options.requestTimeoutMs === undefined
			? {}
			: {
					requestHandler: {
						connectionTimeout: options.requestTimeoutMs,
						requestTimeout: options.requestTimeoutMs,
					},
				}),
	});
}

function createS3ObjectStoreClient(
	configuration: CloudflareR2Configuration | S3CompatibleConfiguration,
	options: R2ClientOptions,
): ObjectStoreClient {
	const client = createObjectStoreS3Client(configuration, options);

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
		async *incompleteMultipartUploads() {
			let keyMarker: string | undefined;
			let uploadIdMarker: string | undefined;
			for (;;) {
				const result = await client.send(
					new ListMultipartUploadsCommand({
						Bucket: configuration.bucket,
						KeyMarker: keyMarker,
						UploadIdMarker: uploadIdMarker,
					}),
				);
				for (const upload of result.Uploads ?? []) {
					if (upload.Key && upload.UploadId && upload.Initiated) {
						yield {
							initiatedAt: upload.Initiated,
							objectKey: upload.Key,
							uploadId: upload.UploadId,
						};
					}
				}
				if (!result.IsTruncated || !result.NextKeyMarker) return;
				keyMarker = result.NextKeyMarker;
				uploadIdMarker = result.NextUploadIdMarker;
			}
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
		async listObjects(input) {
			const result = await client.send(
				new ListObjectsV2Command({
					Bucket: configuration.bucket,
					ContinuationToken: input.continuationToken,
					MaxKeys: input.maxKeys,
					Prefix: input.prefix,
					StartAfter: input.startAfter,
				}),
				{ abortSignal: input.signal },
			);
			return {
				nextContinuationToken: result.IsTruncated
					? (result.NextContinuationToken ?? null)
					: null,
				objects: (result.Contents ?? []).flatMap((object) =>
					object.Key && object.LastModified
						? [{ key: object.Key, lastModified: object.LastModified }]
						: [],
				),
			};
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
