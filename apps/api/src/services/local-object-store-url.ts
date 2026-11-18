import { createHmac, timingSafeEqual } from "node:crypto";

export const LOCAL_OBJECT_STORE_PATH_PREFIX = "/api/selfhost/objects/";
export const LOCAL_OBJECT_PART_PATH = `${LOCAL_OBJECT_STORE_PATH_PREFIX}part`;
export const LOCAL_OBJECT_DOWNLOAD_PATH = `${LOCAL_OBJECT_STORE_PATH_PREFIX}object`;

const SIGNING_CONTEXT = "opaline-local-object-store-url-v1";
const UPLOAD_ID_PATTERN = /^[a-f0-9]{32}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]{0,15}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const MAX_PART_NUMBER = 10_000;
export const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;

export interface LocalObjectUrlSigning {
	readonly publicOrigin: string;
	readonly signingSecret: string;
}

export interface SignedPartUpload {
	readonly byteLength: number;
	readonly expiresAt: number;
	readonly partNumber: number;
	readonly uploadId: string;
}

export interface SignedDownload {
	readonly cacheControl: string;
	readonly contentDisposition: string;
	readonly contentType: string;
	readonly expiresAt: number;
	readonly objectKey: string;
}

export type UrlVerification<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly code:
				| "AccessDenied"
				| "InvalidRequest"
				| "SignatureDoesNotMatch";
			readonly message: string;
			readonly ok: false;
			readonly status: 400 | 403;
	  };

export function isLocalUploadId(value: string): boolean {
	return UPLOAD_ID_PATTERN.test(value);
}

export function signPartUploadUrl(
	signing: LocalObjectUrlSigning,
	part: SignedPartUpload,
): string {
	const url = new URL(LOCAL_OBJECT_PART_PATH, signing.publicOrigin);
	url.searchParams.set("upload", part.uploadId);
	url.searchParams.set("part", String(part.partNumber));
	url.searchParams.set("bytes", String(part.byteLength));
	url.searchParams.set("expires", String(part.expiresAt));
	url.searchParams.set(
		"signature",
		sign(signing.signingSecret, partFields(part)),
	);
	return url.toString();
}

export function signDownloadUrl(
	signing: LocalObjectUrlSigning,
	download: SignedDownload,
): string {
	const url = new URL(LOCAL_OBJECT_DOWNLOAD_PATH, signing.publicOrigin);
	url.searchParams.set("key", download.objectKey);
	url.searchParams.set("type", download.contentType);
	url.searchParams.set("disposition", download.contentDisposition);
	url.searchParams.set("cache", download.cacheControl);
	url.searchParams.set("expires", String(download.expiresAt));
	url.searchParams.set(
		"signature",
		sign(signing.signingSecret, downloadFields(download)),
	);
	return url.toString();
}

export function verifyPartUploadUrl(
	url: URL,
	signingSecret: string,
	nowSeconds: number,
): UrlVerification<SignedPartUpload> {
	const uploadId = url.searchParams.get("upload") ?? "";
	const partNumber = readPositiveInteger(url.searchParams.get("part"));
	const byteLength = readPositiveInteger(url.searchParams.get("bytes"));
	const expiresAt = readPositiveInteger(url.searchParams.get("expires"));
	if (
		!isLocalUploadId(uploadId) ||
		partNumber === null ||
		partNumber > MAX_PART_NUMBER ||
		byteLength === null ||
		byteLength > MAX_PART_BYTES ||
		expiresAt === null
	) {
		return invalid("The upload URL is malformed.");
	}
	const part = { byteLength, expiresAt, partNumber, uploadId };
	return checkSignature(
		url,
		signingSecret,
		partFields(part),
		expiresAt,
		nowSeconds,
		part,
	);
}

export function verifyDownloadUrl(
	url: URL,
	signingSecret: string,
	nowSeconds: number,
): UrlVerification<SignedDownload> {
	const objectKey = url.searchParams.get("key");
	const contentType = url.searchParams.get("type");
	const contentDisposition = url.searchParams.get("disposition");
	const cacheControl = url.searchParams.get("cache");
	const expiresAt = readPositiveInteger(url.searchParams.get("expires"));
	if (
		!objectKey ||
		!contentType ||
		!contentDisposition ||
		!cacheControl ||
		expiresAt === null ||
		[contentType, contentDisposition, cacheControl].some(hasControlCharacter)
	) {
		return invalid("The download URL is malformed.");
	}
	const download = {
		cacheControl,
		contentDisposition,
		contentType,
		expiresAt,
		objectKey,
	};
	return checkSignature(
		url,
		signingSecret,
		downloadFields(download),
		expiresAt,
		nowSeconds,
		download,
	);
}

function checkSignature<T>(
	url: URL,
	signingSecret: string,
	fields: readonly (number | string)[],
	expiresAt: number,
	nowSeconds: number,
	value: T,
): UrlVerification<T> {
	const provided = url.searchParams.get("signature") ?? "";
	if (!SIGNATURE_PATTERN.test(provided)) {
		return {
			code: "AccessDenied",
			message: "The URL is not signed.",
			ok: false,
			status: 403,
		};
	}
	const expected = Buffer.from(sign(signingSecret, fields));
	if (!timingSafeEqual(expected, Buffer.from(provided))) {
		return {
			code: "SignatureDoesNotMatch",
			message: "The URL signature does not match.",
			ok: false,
			status: 403,
		};
	}
	if (expiresAt < nowSeconds) {
		return {
			code: "AccessDenied",
			message: "The URL has expired.",
			ok: false,
			status: 403,
		};
	}
	return { ok: true, value };
}

function partFields(part: SignedPartUpload): readonly (number | string)[] {
	return [
		"part",
		part.uploadId,
		part.partNumber,
		part.byteLength,
		part.expiresAt,
	];
}

function downloadFields(
	download: SignedDownload,
): readonly (number | string)[] {
	return [
		"object",
		download.objectKey,
		download.contentType,
		download.contentDisposition,
		download.cacheControl,
		download.expiresAt,
	];
}

function sign(secret: string, fields: readonly (number | string)[]): string {
	const key = createHmac("sha256", secret).update(SIGNING_CONTEXT).digest();
	return createHmac("sha256", key)
		.update(JSON.stringify(fields))
		.digest("base64url");
}

function readPositiveInteger(value: string | null): number | null {
	if (value === null || !POSITIVE_INTEGER_PATTERN.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function hasControlCharacter(value: string): boolean {
	return /\p{Cc}/u.test(value);
}

function invalid(message: string): UrlVerification<never> {
	return { code: "InvalidRequest", message, ok: false, status: 400 };
}
