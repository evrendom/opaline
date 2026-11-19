import { createHash, randomBytes } from "node:crypto";
import {
	type FileHandle,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	rmdir,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { R2_INGEST_UPLOAD_URL_TTL_SECONDS } from "@rudel/api-routes";
import {
	isLocalUploadId,
	signDownloadUrl,
	signPartUploadUrl,
} from "./local-object-store-url.js";
import type {
	IncompleteMultipartUpload,
	LocalDiskConfiguration,
	R2ObjectListing,
	R2ObjectMetadata,
	R2StorageClient,
} from "./r2-ingest-storage.service.js";

const OBJECT_FILE_SUFFIX = "~";
const UPLOAD_RECORD_FILE = "upload.json";
const MAX_KEY_BYTES = 1024;
const MAX_SEGMENT_NAME_BYTES = 254;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 8 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;
const MAX_LIST_KEYS = 1000;
const PUBLISH_ATTEMPTS = 4;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RAW_SEGMENT_CHARACTER = /^[a-z0-9._-]$/u;
const ENCODED_SEGMENT = /^(?:[a-z0-9._-]|%[0-9A-F]{2})+$/u;
const ETAG = /^[a-f0-9]{32}$/u;

export type LocalObjectStoreErrorCode =
	| "EntityTooLarge"
	| "IncompleteBody"
	| "InvalidObjectName"
	| "InvalidObjectState"
	| "InvalidPart"
	| "InvalidPartOrder"
	| "MetadataTooLarge"
	| "NoSuchKey"
	| "NoSuchUpload";

export class LocalObjectStoreError extends Error {
	readonly code: LocalObjectStoreErrorCode;

	constructor(code: LocalObjectStoreErrorCode, message: string) {
		super(message);
		this.name = code;
		this.code = code;
	}
}

interface StoredHeader {
	readonly contentType: string;
	readonly etag: string;
	readonly metadata: Readonly<Record<string, string>>;
}

interface UploadRecord {
	readonly contentType: string;
	readonly initiatedAt: string;
	readonly metadata: Readonly<Record<string, string>>;
	readonly objectKey: string;
}

export interface OpenedLocalObject {
	readonly byteLength: number;
	readonly close: () => Promise<void>;
	readonly header: StoredHeader;
	readonly stream: () => ReadableStream<Uint8Array>;
}

interface ListedEntry {
	readonly key: string;
	readonly path: string;
}

export function encodeObjectKey(objectKey: string): readonly string[] {
	if (
		objectKey.length === 0 ||
		Buffer.byteLength(objectKey) > MAX_KEY_BYTES ||
		/\p{Cc}/u.test(objectKey) ||
		/\p{Cs}/u.test(objectKey)
	) {
		throw invalidName(objectKey);
	}
	const segments = objectKey.split("/");
	if (segments.some((segment) => segment === "." || segment === "..")) {
		throw invalidName(objectKey);
	}
	return segments.map((segment) => {
		if (segment.length === 0) throw invalidName(objectKey);
		const encoded = encodeSegment(segment);
		if (Buffer.byteLength(encoded) > MAX_SEGMENT_NAME_BYTES) {
			throw invalidName(objectKey);
		}
		return encoded;
	});
}

export function encodeSegment(segment: string): string {
	let encoded = "";
	for (const character of segment) {
		if (
			RAW_SEGMENT_CHARACTER.test(character) &&
			!(encoded.length === 0 && character === ".")
		) {
			encoded += character;
			continue;
		}
		for (const byte of Buffer.from(character, "utf8")) {
			encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
		}
	}
	return encoded;
}

export function decodeSegment(name: string): string | null {
	if (!ENCODED_SEGMENT.test(name)) return null;
	let decoded: string;
	try {
		decoded = decodeURIComponent(name);
	} catch {
		return null;
	}
	return decoded.length > 0 &&
		!decoded.includes("/") &&
		encodeSegment(decoded) === name
		? decoded
		: null;
}

export function compareObjectKeys(left: string, right: string): number {
	return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export class LocalObjectStore implements R2StorageClient {
	readonly objectsRoot: string;
	readonly scratchRoot: string;
	readonly uploadsRoot: string;

	constructor(
		private readonly configuration: LocalDiskConfiguration,
		private readonly now: () => Date = () => new Date(),
	) {
		this.objectsRoot = join(configuration.directory, "objects");
		this.scratchRoot = join(configuration.directory, "tmp");
		this.uploadsRoot = join(configuration.directory, "uploads");
	}

	objectPath(objectKey: string): string {
		const segments = [...encodeObjectKey(objectKey)];
		segments[segments.length - 1] += OBJECT_FILE_SUFFIX;
		return join(this.objectsRoot, ...segments);
	}

	async putObject(input: {
		body: Uint8Array;
		contentType: string;
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
		signal?: AbortSignal;
	}): Promise<void> {
		input.signal?.throwIfAborted();
		const target = this.objectPath(input.objectKey);
		const header = encodeHeader({
			contentType: input.contentType,
			etag: createHash("md5").update(input.body).digest("hex"),
			metadata: normalizeMetadata(input.metadata),
		});
		const scratch = await this.createScratchFile();
		try {
			await writeAll(scratch.handle, header);
			await writeAll(scratch.handle, input.body);
			await scratch.handle.sync();
		} catch (error) {
			await discardScratch(scratch);
			throw error;
		}
		await scratch.handle.close();
		await this.publish(scratch.path, target);
	}

	async getObject(
		objectKey: string,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		signal?.throwIfAborted();
		let bytes: Buffer;
		try {
			bytes = await readFile(this.objectPath(objectKey), { signal });
		} catch (error) {
			if (isNotFound(error)) throw noSuchKey(objectKey);
			throw error;
		}
		const { headerBytes } = parseHeader(bytes);
		return new Uint8Array(
			bytes.buffer,
			bytes.byteOffset + headerBytes,
			bytes.byteLength - headerBytes,
		);
	}

	async headObject(
		objectKey: string,
		signal?: AbortSignal,
	): Promise<R2ObjectMetadata | null> {
		signal?.throwIfAborted();
		const opened = await this.openObject(objectKey);
		if (!opened) return null;
		await opened.close();
		return { byteLength: opened.byteLength, metadata: opened.header.metadata };
	}

	async openObject(objectKey: string): Promise<OpenedLocalObject | null> {
		let handle: FileHandle;
		try {
			handle = await open(this.objectPath(objectKey), "r");
		} catch (error) {
			if (isNotFound(error)) return null;
			throw error;
		}
		try {
			const { size } = await handle.stat();
			const head = Buffer.alloc(Math.min(MAX_HEADER_BYTES, size));
			const { bytesRead } = await handle.read(head, 0, head.byteLength, 0);
			const { header, headerBytes } = parseHeader(head.subarray(0, bytesRead));
			const byteLength = size - headerBytes;
			return {
				byteLength,
				close: () => handle.close(),
				header,
				stream: () => readRange(handle, headerBytes, byteLength),
			};
		} catch (error) {
			await handle.close();
			throw error;
		}
	}

	async deleteObjects(objectKeys: readonly string[]): Promise<void> {
		for (const objectKey of objectKeys) {
			let path: string;
			try {
				path = this.objectPath(objectKey);
			} catch {
				continue;
			}
			await rm(path, { force: true });
			await this.pruneEmptyDirectories(dirname(path));
		}
	}

	async listObjects(input: {
		continuationToken?: string;
		maxKeys?: number;
		prefix: string;
		signal?: AbortSignal;
		startAfter?: string;
	}): Promise<R2ObjectListing> {
		input.signal?.throwIfAborted();
		const maxKeys = Math.max(
			1,
			Math.min(MAX_LIST_KEYS, input.maxKeys ?? MAX_LIST_KEYS),
		);
		const start = laterKey(
			input.startAfter,
			input.continuationToken === undefined
				? undefined
				: decodeContinuationToken(input.continuationToken),
		);
		const scope = resolveListingScope(input.prefix);
		if (!scope) return { nextContinuationToken: null, objects: [] };
		const found: ListedEntry[] = [];
		for await (const entry of this.walk(
			join(this.objectsRoot, ...scope.directory),
			scope.keyPrefix,
			scope.namePrefix,
			start,
		)) {
			found.push(entry);
			if (found.length > maxKeys) break;
		}
		const page = found.slice(0, maxKeys);
		const objects: { key: string; lastModified: Date }[] = [];
		for (const entry of page) {
			try {
				objects.push({
					key: entry.key,
					lastModified: (await stat(entry.path)).mtime,
				});
			} catch (error) {
				if (!isNotFound(error)) throw error;
			}
		}
		const last = page.at(-1);
		return {
			nextContinuationToken:
				found.length > maxKeys && last
					? Buffer.from(last.key).toString("base64url")
					: null,
			objects,
		};
	}

	async createMultipartUpload(input: {
		contentType?: string;
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
		signal?: AbortSignal;
	}): Promise<{ uploadId: string }> {
		input.signal?.throwIfAborted();
		this.objectPath(input.objectKey);
		const uploadId = randomBytes(16).toString("hex");
		const directory = join(this.uploadsRoot, uploadId);
		await mkdir(directory, { mode: DIRECTORY_MODE, recursive: true });
		const record: UploadRecord = {
			contentType: input.contentType ?? "application/x-ndjson",
			initiatedAt: this.now().toISOString(),
			metadata: normalizeMetadata(input.metadata),
			objectKey: input.objectKey,
		};
		await writeFile(
			join(directory, UPLOAD_RECORD_FILE),
			JSON.stringify(record),
			{ flag: "wx", mode: FILE_MODE },
		);
		return { uploadId };
	}

	async presignUploadPart(input: {
		byteLength: number;
		objectKey: string;
		partNumber: number;
		uploadId: string;
	}): Promise<string> {
		this.objectPath(input.objectKey);
		return signPartUploadUrl(this.configuration, {
			byteLength: input.byteLength,
			expiresAt:
				Math.floor(this.now().getTime() / 1000) +
				R2_INGEST_UPLOAD_URL_TTL_SECONDS,
			partNumber: input.partNumber,
			uploadId: input.uploadId,
		});
	}

	signDownload(input: {
		cacheControl: string;
		contentDisposition: string;
		contentType: string;
		expiresInSeconds: number;
		objectKey: string;
	}): string {
		this.objectPath(input.objectKey);
		return signDownloadUrl(this.configuration, {
			cacheControl: input.cacheControl,
			contentDisposition: input.contentDisposition,
			contentType: input.contentType,
			expiresAt:
				Math.floor(this.now().getTime() / 1000) + input.expiresInSeconds,
			objectKey: input.objectKey,
		});
	}

	async writePart(input: {
		body: ReadableStream<Uint8Array> | null;
		byteLength: number;
		partNumber: number;
		signal?: AbortSignal;
		uploadId: string;
	}): Promise<string> {
		if (!(await this.readUpload(input.uploadId))) {
			throw noSuchUpload(input.uploadId);
		}
		const scratch = await this.createScratchFile();
		const hash = createHash("md5");
		let written = 0;
		try {
			const reader = input.body?.getReader();
			try {
				while (reader) {
					input.signal?.throwIfAborted();
					const { done, value } = await reader.read();
					if (done) break;
					if (written + value.byteLength > input.byteLength) {
						throw new LocalObjectStoreError(
							"EntityTooLarge",
							"The part is larger than its signed length.",
						);
					}
					hash.update(value);
					await writeAll(scratch.handle, value);
					written += value.byteLength;
				}
			} catch (error) {
				await reader?.cancel().catch(() => {});
				throw error;
			}
			if (written !== input.byteLength) {
				throw new LocalObjectStoreError(
					"IncompleteBody",
					"The part is shorter than its signed length.",
				);
			}
		} catch (error) {
			await discardScratch(scratch);
			throw error;
		}
		await scratch.handle.close();
		const etag = hash.digest("hex");
		const directory = join(this.uploadsRoot, input.uploadId);
		const name = partFileName(input.partNumber, etag);
		try {
			await rename(scratch.path, join(directory, name));
		} catch (error) {
			await rm(scratch.path, { force: true });
			if (isNotFound(error)) throw noSuchUpload(input.uploadId);
			throw error;
		}
		const sameNumber = `${partFileName(input.partNumber, "")}`;
		for (const entry of await readdir(directory).catch(() => [])) {
			if (entry.startsWith(sameNumber) && entry !== name) {
				await rm(join(directory, entry), { force: true });
			}
		}
		return etag;
	}

	async completeMultipartUpload(input: {
		objectKey: string;
		parts: readonly { etag: string; partNumber: number }[];
		signal?: AbortSignal;
		uploadId: string;
	}): Promise<void> {
		input.signal?.throwIfAborted();
		const upload = await this.readUpload(input.uploadId);
		if (!upload || upload.objectKey !== input.objectKey) {
			throw noSuchUpload(input.uploadId);
		}
		const target = this.objectPath(input.objectKey);
		const parts = normalizeCompletedParts(input.parts);
		const directory = join(this.uploadsRoot, input.uploadId);
		for (const part of parts) {
			try {
				await stat(join(directory, partFileName(part.partNumber, part.etag)));
			} catch (error) {
				if (!isNotFound(error)) throw error;
				throw new LocalObjectStoreError(
					"InvalidPart",
					`Part ${part.partNumber} was not uploaded with ETag ${part.etag}.`,
				);
			}
		}
		const etag = `${createHash("md5")
			.update(Buffer.concat(parts.map((part) => Buffer.from(part.etag, "hex"))))
			.digest("hex")}-${parts.length}`;
		const scratch = await this.createScratchFile();
		try {
			await writeAll(
				scratch.handle,
				encodeHeader({
					contentType: upload.contentType,
					etag,
					metadata: upload.metadata,
				}),
			);
			const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
			for (const part of parts) {
				input.signal?.throwIfAborted();
				await copyVerifiedPart(
					join(directory, partFileName(part.partNumber, part.etag)),
					part,
					scratch.handle,
					buffer,
				);
			}
			await scratch.handle.sync();
		} catch (error) {
			await discardScratch(scratch);
			throw error;
		}
		await scratch.handle.close();
		await this.publish(scratch.path, target);
		await rm(directory, { force: true, recursive: true });
	}

	async abortMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<void> {
		const upload = await this.readUpload(input.uploadId);
		if (!upload || upload.objectKey !== input.objectKey) {
			throw noSuchUpload(input.uploadId);
		}
		await rm(join(this.uploadsRoot, input.uploadId), {
			force: true,
			recursive: true,
		});
	}

	async hasMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<boolean> {
		const upload = await this.readUpload(input.uploadId);
		return upload?.objectKey === input.objectKey;
	}

	async listMultipartUploads(
		objectKey: string,
	): Promise<readonly { initiatedAt: Date; uploadId: string }[]> {
		const uploads: { initiatedAt: Date; uploadId: string }[] = [];
		for await (const upload of this.incompleteMultipartUploads()) {
			if (upload.objectKey === objectKey) {
				uploads.push({
					initiatedAt: upload.initiatedAt,
					uploadId: upload.uploadId,
				});
			}
		}
		return uploads;
	}

	async *incompleteMultipartUploads(): AsyncGenerator<IncompleteMultipartUpload> {
		for (const uploadId of (await readdirIfExists(this.uploadsRoot)).sort()) {
			const upload = await this.readUpload(uploadId);
			if (!upload) continue;
			yield {
				initiatedAt: new Date(upload.initiatedAt),
				objectKey: upload.objectKey,
				uploadId,
			};
		}
	}

	async removeStaleScratch(olderThan: Date): Promise<number> {
		let removed = 0;
		for (const name of await readdirIfExists(this.scratchRoot)) {
			const path = join(this.scratchRoot, name);
			if (await isOlderThan(path, olderThan)) {
				await rm(path, { force: true, recursive: true });
				removed += 1;
			}
		}
		for (const name of await readdirIfExists(this.uploadsRoot)) {
			if (await this.readUpload(name)) continue;
			const path = join(this.uploadsRoot, name);
			if (await isOlderThan(path, olderThan)) {
				await rm(path, { force: true, recursive: true });
				removed += 1;
			}
		}
		return removed;
	}

	private async readUpload(uploadId: string): Promise<UploadRecord | null> {
		if (!isLocalUploadId(uploadId)) return null;
		let raw: string;
		try {
			raw = await readFile(
				join(this.uploadsRoot, uploadId, UPLOAD_RECORD_FILE),
				"utf8",
			);
		} catch (error) {
			if (isNotFound(error)) return null;
			throw error;
		}
		try {
			return parseUploadRecord(JSON.parse(raw));
		} catch {
			return null;
		}
	}

	private async createScratchFile(): Promise<{
		handle: FileHandle;
		path: string;
	}> {
		await mkdir(this.scratchRoot, { mode: DIRECTORY_MODE, recursive: true });
		const path = join(this.scratchRoot, randomBytes(16).toString("hex"));
		return { handle: await open(path, "wx", FILE_MODE), path };
	}

	private async publish(scratchPath: string, target: string): Promise<void> {
		for (let attempt = 1; ; attempt += 1) {
			await mkdir(dirname(target), { mode: DIRECTORY_MODE, recursive: true });
			try {
				await rename(scratchPath, target);
				return;
			} catch (error) {
				if (isNotFound(error) && attempt < PUBLISH_ATTEMPTS) continue;
				await rm(scratchPath, { force: true });
				throw error;
			}
		}
	}

	private async pruneEmptyDirectories(directory: string): Promise<void> {
		let current = directory;
		while (current.startsWith(`${this.objectsRoot}/`)) {
			try {
				await rmdir(current);
			} catch {
				return;
			}
			current = dirname(current);
		}
	}

	private async *walk(
		directory: string,
		keyPrefix: string,
		namePrefix: string,
		start: string | undefined,
	): AsyncGenerator<ListedEntry> {
		const entries: { isDirectory: boolean; name: string; sortKey: string }[] =
			[];
		for (const entry of await readdirEntriesIfExists(directory)) {
			const isDirectory = entry.isDirectory();
			if (!isDirectory && !entry.isFile()) continue;
			if (!isDirectory && !entry.name.endsWith(OBJECT_FILE_SUFFIX)) continue;
			const segment = decodeSegment(
				isDirectory ? entry.name : entry.name.slice(0, -1),
			);
			if (segment === null || !segment.startsWith(namePrefix)) continue;
			entries.push({
				isDirectory,
				name: entry.name,
				sortKey: `${keyPrefix}${segment}${isDirectory ? "/" : ""}`,
			});
		}
		entries.sort((left, right) =>
			compareObjectKeys(left.sortKey, right.sortKey),
		);
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (!entry.isDirectory) {
				if (
					start === undefined ||
					compareObjectKeys(entry.sortKey, start) > 0
				) {
					yield { key: entry.sortKey, path };
				}
				continue;
			}
			if (
				start !== undefined &&
				!start.startsWith(entry.sortKey) &&
				compareObjectKeys(entry.sortKey, start) < 0
			) {
				continue;
			}
			yield* this.walk(path, entry.sortKey, "", start);
		}
	}
}

export function createLocalObjectStoreClient(
	configuration: LocalDiskConfiguration,
	now?: () => Date,
): LocalObjectStore {
	return new LocalObjectStore(configuration, now);
}

function resolveListingScope(prefix: string): {
	directory: readonly string[];
	keyPrefix: string;
	namePrefix: string;
} | null {
	const segments = prefix.split("/");
	const namePrefix = segments.pop() ?? "";
	if (
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		return null;
	}
	try {
		return {
			directory: segments.length > 0 ? encodeObjectKey(segments.join("/")) : [],
			keyPrefix: segments.map((segment) => `${segment}/`).join(""),
			namePrefix,
		};
	} catch {
		return null;
	}
}

function laterKey(
	left: string | undefined,
	right: string | undefined,
): string | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	return compareObjectKeys(left, right) >= 0 ? left : right;
}

function decodeContinuationToken(token: string): string {
	return Buffer.from(token, "base64url").toString("utf8");
}

function encodeHeader(header: StoredHeader): Buffer {
	return Buffer.from(
		`${JSON.stringify({
			contentType: header.contentType,
			etag: header.etag,
			metadata: header.metadata,
			v: 1,
		})}\n`,
	);
}

function parseHeader(bytes: Uint8Array): {
	header: StoredHeader;
	headerBytes: number;
} {
	const end = bytes.indexOf(0x0a);
	if (end < 0) {
		throw new LocalObjectStoreError(
			"InvalidObjectState",
			"A stored object has no header.",
		);
	}
	const parsed: unknown = JSON.parse(
		new TextDecoder().decode(bytes.subarray(0, end)),
	);
	if (
		!isRecord(parsed) ||
		parsed.v !== 1 ||
		typeof parsed.contentType !== "string" ||
		typeof parsed.etag !== "string" ||
		!isStringRecord(parsed.metadata)
	) {
		throw new LocalObjectStoreError(
			"InvalidObjectState",
			"A stored object has an invalid header.",
		);
	}
	return {
		header: {
			contentType: parsed.contentType,
			etag: parsed.etag,
			metadata: parsed.metadata,
		},
		headerBytes: end + 1,
	};
}

function parseUploadRecord(value: unknown): UploadRecord | null {
	if (
		!isRecord(value) ||
		typeof value.contentType !== "string" ||
		typeof value.initiatedAt !== "string" ||
		Number.isNaN(new Date(value.initiatedAt).getTime()) ||
		typeof value.objectKey !== "string" ||
		!isStringRecord(value.metadata)
	) {
		return null;
	}
	return {
		contentType: value.contentType,
		initiatedAt: value.initiatedAt,
		metadata: value.metadata,
		objectKey: value.objectKey,
	};
}

function normalizeMetadata(
	metadata: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	const normalized = Object.fromEntries(
		Object.entries(metadata).map(([name, value]) => [
			name.toLowerCase(),
			String(value),
		]),
	);
	if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_METADATA_BYTES) {
		throw new LocalObjectStoreError(
			"MetadataTooLarge",
			"Object metadata is larger than 8 KiB.",
		);
	}
	return normalized;
}

function normalizeCompletedParts(
	parts: readonly { etag: string; partNumber: number }[],
): readonly { etag: string; partNumber: number }[] {
	if (parts.length === 0) {
		throw new LocalObjectStoreError(
			"InvalidPart",
			"A multipart upload needs at least one part.",
		);
	}
	let previous = 0;
	return parts.map((part) => {
		if (!Number.isSafeInteger(part.partNumber) || part.partNumber <= previous) {
			throw new LocalObjectStoreError(
				"InvalidPartOrder",
				"Parts must be listed in ascending order.",
			);
		}
		previous = part.partNumber;
		const etag = part.etag.trim().replace(/^"|"$/gu, "").toLowerCase();
		if (!ETAG.test(etag)) {
			throw new LocalObjectStoreError(
				"InvalidPart",
				`Part ${part.partNumber} has an invalid ETag.`,
			);
		}
		return { etag, partNumber: part.partNumber };
	});
}

async function copyVerifiedPart(
	path: string,
	part: { etag: string; partNumber: number },
	target: FileHandle,
	buffer: Buffer,
): Promise<void> {
	const source = await open(path, "r");
	const hash = createHash("md5");
	try {
		let position = 0;
		for (;;) {
			const { bytesRead } = await source.read(
				buffer,
				0,
				buffer.byteLength,
				position,
			);
			if (bytesRead === 0) break;
			const chunk = buffer.subarray(0, bytesRead);
			hash.update(chunk);
			await writeAll(target, chunk);
			position += bytesRead;
		}
	} finally {
		await source.close();
	}
	if (hash.digest("hex") !== part.etag) {
		throw new LocalObjectStoreError(
			"InvalidPart",
			`Part ${part.partNumber} no longer matches its ETag.`,
		);
	}
}

function readRange(
	handle: FileHandle,
	start: number,
	byteLength: number,
): ReadableStream<Uint8Array> {
	let offset = 0;
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await handle.close();
	};
	return new ReadableStream<Uint8Array>({
		async cancel() {
			await close();
		},
		async pull(controller) {
			try {
				const remaining = byteLength - offset;
				if (remaining <= 0) {
					await close();
					controller.close();
					return;
				}
				const chunk = Buffer.allocUnsafe(Math.min(COPY_CHUNK_BYTES, remaining));
				const { bytesRead } = await handle.read(
					chunk,
					0,
					chunk.byteLength,
					start + offset,
				);
				if (bytesRead === 0) {
					throw new LocalObjectStoreError(
						"InvalidObjectState",
						"A stored object ended early.",
					);
				}
				offset += bytesRead;
				controller.enqueue(chunk.subarray(0, bytesRead));
			} catch (error) {
				await close();
				controller.error(error);
			}
		},
	});
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(
			bytes,
			offset,
			bytes.byteLength - offset,
		);
		if (bytesWritten === 0) throw new Error("A local object write stalled.");
		offset += bytesWritten;
	}
}

async function discardScratch(scratch: {
	handle: FileHandle;
	path: string;
}): Promise<void> {
	await scratch.handle.close().catch(() => {});
	await rm(scratch.path, { force: true });
}

async function readdirIfExists(directory: string): Promise<string[]> {
	try {
		return await readdir(directory);
	} catch (error) {
		if (isNotFound(error)) return [];
		throw error;
	}
}

async function readdirEntriesIfExists(directory: string) {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isNotFound(error)) return [];
		throw error;
	}
}

async function isOlderThan(path: string, olderThan: Date): Promise<boolean> {
	try {
		return (await stat(path)).mtime.getTime() < olderThan.getTime();
	} catch (error) {
		if (isNotFound(error)) return false;
		throw error;
	}
}

function partFileName(partNumber: number, etag: string): string {
	return `part-${String(partNumber).padStart(5, "0")}-${etag}`;
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((entry) => typeof entry === "string")
	);
}

function invalidName(objectKey: string): LocalObjectStoreError {
	return new LocalObjectStoreError(
		"InvalidObjectName",
		`Object key ${JSON.stringify(objectKey.slice(0, 200))} cannot be stored.`,
	);
}

function noSuchKey(objectKey: string): LocalObjectStoreError {
	return new LocalObjectStoreError(
		"NoSuchKey",
		`Object ${JSON.stringify(objectKey.slice(0, 200))} does not exist.`,
	);
}

function noSuchUpload(uploadId: string): LocalObjectStoreError {
	return new LocalObjectStoreError(
		"NoSuchUpload",
		`Multipart upload ${JSON.stringify(uploadId.slice(0, 64))} does not exist.`,
	);
}
