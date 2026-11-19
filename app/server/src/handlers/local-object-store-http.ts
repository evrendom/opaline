import { getLogger } from "@logtape/logtape";
import { isSelfHosted } from "../lib/self-hosted.js";
import {
	createLocalObjectStoreClient,
	LocalObjectStoreError,
	type OpenedLocalObject,
} from "../services/local-object-store.js";
import {
	LOCAL_OBJECT_DOWNLOAD_PATH,
	LOCAL_OBJECT_PART_PATH,
	LOCAL_OBJECT_STORE_PATH_PREFIX,
	verifyDownloadUrl,
	verifyPartUploadUrl,
} from "../services/local-object-store-url.js";
import {
	type LocalDiskConfiguration,
	readR2IngestAvailability,
} from "../services/r2-ingest-storage.service.js";

const logger = getLogger(["rudel", "api", "local-object-store"]);

export interface LocalObjectStoreRouteOptions {
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly now?: () => Date;
}

export function isLocalObjectStorePath(
	pathname: string,
	environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return (
		isSelfHosted(environment) &&
		pathname.startsWith(LOCAL_OBJECT_STORE_PATH_PREFIX)
	);
}

export function handleLocalObjectStoreRoute(
	request: Request,
	url: URL,
	options: LocalObjectStoreRouteOptions = {},
): Promise<Response> | null {
	const environment = options.environment ?? process.env;
	if (!isLocalObjectStorePath(url.pathname, environment)) return null;
	const availability = readR2IngestAvailability(environment);
	if (!availability.enabled || availability.configuration.backend !== "local") {
		return Promise.resolve(
			errorResponse(404, "NotFound", "This server has no local object store."),
		);
	}
	const nowSeconds = Math.floor(
		(options.now?.() ?? new Date()).getTime() / 1000,
	);
	const configuration = availability.configuration;
	if (url.pathname === LOCAL_OBJECT_PART_PATH) {
		return request.method === "PUT"
			? putPart(request, url, configuration, nowSeconds)
			: Promise.resolve(methodNotAllowed("PUT"));
	}
	if (url.pathname === LOCAL_OBJECT_DOWNLOAD_PATH) {
		return request.method === "GET" || request.method === "HEAD"
			? getObject(request, url, configuration, nowSeconds)
			: Promise.resolve(methodNotAllowed("GET, HEAD"));
	}
	return Promise.resolve(errorResponse(404, "NotFound", "Unknown route."));
}

async function putPart(
	request: Request,
	url: URL,
	configuration: LocalDiskConfiguration,
	nowSeconds: number,
): Promise<Response> {
	const verified = verifyPartUploadUrl(
		url,
		configuration.signingSecret,
		nowSeconds,
	);
	if (!verified.ok) {
		await request.body?.cancel().catch(() => {});
		return errorResponse(verified.status, verified.code, verified.message);
	}
	const declaredLength = request.headers.get("Content-Length");
	if (declaredLength === null) {
		await request.body?.cancel().catch(() => {});
		return errorResponse(
			411,
			"MissingContentLength",
			"A part upload needs a Content-Length header.",
		);
	}
	if (declaredLength.trim() !== String(verified.value.byteLength)) {
		await request.body?.cancel().catch(() => {});
		return errorResponse(
			403,
			"SignatureDoesNotMatch",
			"The Content-Length differs from the signed part length.",
		);
	}
	try {
		const etag = await createLocalObjectStoreClient(configuration).writePart({
			body: request.body,
			byteLength: verified.value.byteLength,
			partNumber: verified.value.partNumber,
			signal: request.signal,
			uploadId: verified.value.uploadId,
		});
		return new Response(null, { headers: { ETag: `"${etag}"` }, status: 200 });
	} catch (error) {
		return storeErrorResponse(error, "part upload");
	}
}

async function getObject(
	request: Request,
	url: URL,
	configuration: LocalDiskConfiguration,
	nowSeconds: number,
): Promise<Response> {
	const verified = verifyDownloadUrl(
		url,
		configuration.signingSecret,
		nowSeconds,
	);
	if (!verified.ok) {
		return errorResponse(verified.status, verified.code, verified.message);
	}
	let opened: OpenedLocalObject | null;
	try {
		opened = await createLocalObjectStoreClient(configuration).openObject(
			verified.value.objectKey,
		);
	} catch (error) {
		return storeErrorResponse(error, "download");
	}
	if (!opened) {
		return errorResponse(404, "NoSuchKey", "The object does not exist.");
	}
	const headers = {
		"Cache-Control": verified.value.cacheControl,
		"Content-Disposition": verified.value.contentDisposition,
		"Content-Length": String(opened.byteLength),
		"Content-Security-Policy": "default-src 'none'; sandbox",
		"Content-Type": verified.value.contentType,
		ETag: `"${opened.header.etag}"`,
		"X-Content-Type-Options": "nosniff",
	};
	if (request.method === "HEAD") {
		await opened.close();
		return new Response(null, { headers, status: 200 });
	}
	return new Response(opened.stream(), { headers, status: 200 });
}

function storeErrorResponse(error: unknown, operation: string): Response {
	if (error instanceof LocalObjectStoreError) {
		switch (error.code) {
			case "NoSuchKey":
			case "NoSuchUpload":
				return errorResponse(404, error.code, error.message);
			case "EntityTooLarge":
			case "IncompleteBody":
			case "InvalidObjectName":
				return errorResponse(400, error.code, error.message);
			default:
				break;
		}
	}
	if (error instanceof Error && error.name === "AbortError") {
		return errorResponse(400, "RequestAborted", "The request was aborted.");
	}
	logger.error("Local object store {operation} failed: {error}", {
		error: error instanceof Error ? error.message : String(error),
		operation,
	});
	return errorResponse(500, "InternalError", "The object store failed.");
}

function methodNotAllowed(allow: string): Response {
	const response = errorResponse(
		405,
		"MethodNotAllowed",
		"The method is not allowed here.",
	);
	response.headers.set("Allow", allow);
	return response;
}

function errorResponse(
	status: number,
	code: string,
	message: string,
): Response {
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${escapeXml(message)}</Message></Error>`,
		{ headers: { "Content-Type": "application/xml" }, status },
	);
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
