import { createHash } from "node:crypto";
import type {
	R2ObjectListing,
	R2ObjectMetadata,
	R2StorageClient,
} from "../../services/r2-ingest-storage.service.js";

interface FakeMultipartUpload {
	readonly initiatedAt: Date;
	readonly metadata: Readonly<Record<string, string>>;
	readonly objectKey: string;
	readonly parts: Map<number, Uint8Array>;
}

interface FakeObject {
	readonly bytes: Uint8Array;
	readonly lastModified?: Date;
	readonly metadata: Readonly<Record<string, string>>;
}

export class NoSuchUploadError extends Error {
	override name = "NoSuchUpload";
}

/** In-memory R2 that models multipart uploads, completion, and deletion. */
export class FakeEvidenceR2 implements R2StorageClient {
	readonly abortedUploadIds: string[] = [];
	readonly deletedKeys: string[] = [];
	readonly putKeys: string[] = [];
	readonly readKeys: string[] = [];
	putFailure: Error | null = null;
	readonly objects = new Map<string, FakeObject>();
	readonly uploads = new Map<string, FakeMultipartUpload>();
	multipartListingLimit = Number.POSITIVE_INFINITY;
	private nextUploadNumber = 1;
	initiatedAt = new Date();

	async abortMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<void> {
		if (!this.uploads.delete(input.uploadId)) throw new NoSuchUploadError();
		this.abortedUploadIds.push(input.uploadId);
	}

	async createMultipartUpload(input: {
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
	}): Promise<{ uploadId: string }> {
		const uploadId = `upload-${this.nextUploadNumber}`;
		this.nextUploadNumber += 1;
		this.uploads.set(uploadId, {
			initiatedAt: this.initiatedAt,
			metadata: input.metadata,
			objectKey: input.objectKey,
			parts: new Map(),
		});
		return { uploadId };
	}

	async completeMultipartUpload(input: {
		objectKey: string;
		parts: readonly { etag: string; partNumber: number }[];
		uploadId: string;
	}): Promise<void> {
		const upload = this.uploads.get(input.uploadId);
		if (!upload) throw new NoSuchUploadError();
		const chunks = input.parts.map((part) => {
			const bytes = upload.parts.get(part.partNumber);
			if (!bytes) throw new Error(`Missing part ${part.partNumber}`);
			return bytes;
		});
		const bytes = new Uint8Array(
			chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
		);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		this.objects.set(input.objectKey, { bytes, metadata: upload.metadata });
		this.uploads.delete(input.uploadId);
	}

	async deleteObjects(objectKeys: readonly string[]): Promise<void> {
		for (const objectKey of objectKeys) {
			this.objects.delete(objectKey);
			this.deletedKeys.push(objectKey);
		}
	}

	async getObject(objectKey: string): Promise<Uint8Array> {
		this.readKeys.push(objectKey);
		const object = this.objects.get(objectKey);
		if (!object) throw new Error(`Missing object ${objectKey}`);
		return object.bytes;
	}

	async hasMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<boolean> {
		return this.uploads.get(input.uploadId)?.objectKey === input.objectKey;
	}

	async headObject(objectKey: string): Promise<R2ObjectMetadata | null> {
		const object = this.objects.get(objectKey);
		return object
			? { byteLength: object.bytes.byteLength, metadata: object.metadata }
			: null;
	}

	async listMultipartUploads(
		objectKey: string,
	): Promise<readonly { initiatedAt: Date; uploadId: string }[]> {
		return [...this.uploads]
			.filter(([, upload]) => upload.objectKey === objectKey)
			.map(([uploadId, upload]) => ({
				initiatedAt: upload.initiatedAt,
				uploadId,
			}))
			.slice(0, this.multipartListingLimit);
	}

	async putObject(input: {
		body: Uint8Array;
		contentType?: string;
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
	}): Promise<void> {
		if (this.putFailure) throw this.putFailure;
		this.putKeys.push(input.objectKey);
		this.objects.set(input.objectKey, {
			bytes: input.body,
			lastModified: new Date(),
			metadata: input.metadata,
		});
	}

	/** Keys in byte order, like S3; objects without a write time read as new. */
	async listObjects(input: {
		continuationToken?: string;
		maxKeys?: number;
		prefix: string;
		startAfter?: string;
	}): Promise<R2ObjectListing> {
		const after = input.continuationToken ?? input.startAfter ?? "";
		const keys = [...this.objects.keys()]
			.filter((key) => key.startsWith(input.prefix) && key > after)
			.sort();
		const page = keys.slice(0, input.maxKeys ?? 1_000);
		const last = page.at(-1);
		return {
			nextContinuationToken:
				last !== undefined && keys.length > page.length ? last : null,
			objects: page.map((key) => ({
				key,
				lastModified: this.objects.get(key)?.lastModified ?? new Date(),
			})),
		};
	}

	async presignUploadPart(input: {
		objectKey: string;
		partNumber: number;
		uploadId: string;
	}): Promise<string> {
		return `https://r2.example.test/${input.objectKey}?part=${input.partNumber}&uploadId=${input.uploadId}`;
	}

	/** Test helper standing in for the client's presigned part PUT. */
	putPart(uploadId: string, partNumber: number, bytes: Uint8Array): string {
		const upload = this.uploads.get(uploadId);
		if (!upload) throw new NoSuchUploadError();
		upload.parts.set(partNumber, bytes);
		return createHash("sha256").update(bytes).digest("hex");
	}
}
