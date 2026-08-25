import {
	AbortMultipartUploadCommand,
	CreateMultipartUploadCommand,
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
	secretAccessKey: string;
}

export type R2IngestAvailability =
	| { enabled: true; configuration: R2IngestConfiguration }
	| { enabled: false; missingVariables: readonly string[] };

export interface R2MultipartUploadClient {
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
			endpoint: `https://${accountId}.eu.r2.cloudflarestorage.com`,
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
