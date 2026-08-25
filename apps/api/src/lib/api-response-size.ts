import {
	StandardRPCJsonSerializer,
	StandardRPCSerializer,
} from "@orpc/client/standard";
import { ORPCError } from "@orpc/server";

export const API_RESPONSE_MAX_BYTES = 3_750_000;
export const API_RESPONSE_TOO_LARGE_CODE = "RESPONSE_TOO_LARGE";

const HEALTH_PATHS = new Set(["/health", "/rpc/health"]);
const RPC_SERIALIZER = new StandardRPCSerializer(
	new StandardRPCJsonSerializer(),
);

export async function enforceApiResponseSize(input: {
	maxBytes?: number;
	pathname: string;
	response: Response;
}): Promise<Response> {
	const maxBytes = input.maxBytes ?? API_RESPONSE_MAX_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error("API response byte limit must be a positive safe integer");
	}
	if (
		!isApiPath(input.pathname) ||
		HEALTH_PATHS.has(input.pathname) ||
		input.response.body === null
	) {
		return input.response;
	}

	const declaredLength = readContentLength(input.response.headers);
	if (declaredLength !== null && declaredLength > maxBytes) {
		return createResponseTooLargeError(
			input.pathname,
			input.response,
			maxBytes,
		);
	}
	const serialized = await input.response.clone().arrayBuffer();
	if (serialized.byteLength <= maxBytes) return input.response;
	return createResponseTooLargeError(input.pathname, input.response, maxBytes);
}

function isApiPath(pathname: string): boolean {
	return (
		pathname === "/api" ||
		pathname.startsWith("/api/") ||
		pathname === "/rpc" ||
		pathname.startsWith("/rpc/")
	);
}

function readContentLength(headers: Headers): number | null {
	const value = headers.get("Content-Length");
	if (!value || !/^\d+$/u.test(value)) return null;
	const length = Number(value);
	return Number.isSafeInteger(length) ? length : null;
}

function createResponseTooLargeError(
	pathname: string,
	response: Response,
	maxBytes: number,
): Response {
	const headers = new Headers(response.headers);
	headers.delete("Content-Encoding");
	headers.delete("Content-Length");
	headers.set("Cache-Control", "no-store");
	headers.set("Content-Type", "application/json; charset=utf-8");
	const message =
		"The serialized API response exceeds the supported size limit.";
	const data = { maxBytes };
	const body = isRpcPath(pathname)
		? RPC_SERIALIZER.serialize(
				new ORPCError(API_RESPONSE_TOO_LARGE_CODE, {
					data,
					message,
					status: 413,
				}).toJSON(),
			)
		: {
				error: {
					code: API_RESPONSE_TOO_LARGE_CODE,
					data,
					message,
				},
			};
	return new Response(JSON.stringify(body), { headers, status: 413 });
}

function isRpcPath(pathname: string): boolean {
	return pathname === "/rpc" || pathname.startsWith("/rpc/");
}
