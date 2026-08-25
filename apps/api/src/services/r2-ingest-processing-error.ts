import { ORPCError } from "@orpc/server";
import { R2IngestMaterializationGateError } from "./r2-ingest-materialization-gate.js";

const MAX_ERROR_GRAPH_NODES = 64;
const RETRYABLE_ERROR_CODES = new Set([
	"40001",
	"40P01",
	"55P03",
	"57014",
	"57P01",
	"57P02",
	"57P03",
	"CONNECT_TIMEOUT",
	"CONNECTION_CLOSED",
	"CONNECTION_DESTROYED",
	"ConnectionRefused",
	"ConnectionReset",
	"ConnectionTimedOut",
	"DNS_ENOTFOUND",
	"EAI_AGAIN",
	"ECONNABORTED",
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"EPIPE",
	"ETIMEDOUT",
	"FailedToOpenSocket",
	"SocketTimeout",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
]);
const RETRYABLE_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);
const RETRYABLE_ORPC_CODES = new Set([
	"CLIENT_CLOSED_REQUEST",
	"GATEWAY_TIMEOUT",
	"SERVICE_UNAVAILABLE",
	"TOO_MANY_REQUESTS",
]);
const RETRYABLE_TRANSPORT_MESSAGES = new Set([
	"The user aborted a request.",
	"Timeout error.",
]);

export class R2IngestCommitError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(code: string, message: string, retryable: boolean) {
		super(message);
		this.code = code;
		this.name = "R2IngestCommitError";
		this.retryable = retryable;
	}
}

export function isRetryableProcessingError(error: unknown): boolean {
	const pending: unknown[] = [error];
	const seen = new Set<object>();
	let nextIndex = 0;
	while (nextIndex < pending.length && nextIndex < MAX_ERROR_GRAPH_NODES) {
		const candidate = pending[nextIndex];
		nextIndex += 1;
		if (typeof candidate !== "object" || candidate === null) continue;
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		if (isRetryableErrorNode(candidate)) return true;

		const cause = getErrorValue(candidate, "cause");
		if (cause !== undefined) pending.push(cause);
		const aggregateErrors = getErrorValue(candidate, "errors");
		if (Array.isArray(aggregateErrors)) {
			for (const aggregateError of aggregateErrors) {
				if (pending.length >= MAX_ERROR_GRAPH_NODES) break;
				pending.push(aggregateError);
			}
		}
	}
	return false;
}

function isRetryableErrorNode(error: object): boolean {
	if (error instanceof R2IngestCommitError && error.retryable) return true;
	if (error instanceof R2IngestMaterializationGateError) return true;
	if (error instanceof ORPCError && RETRYABLE_ORPC_CODES.has(error.code)) {
		return true;
	}
	const code = getErrorString(error, "code");
	if (
		code &&
		(RETRYABLE_ERROR_CODES.has(code) ||
			code.startsWith("08") ||
			code.startsWith("53"))
	) {
		return true;
	}
	const name = getErrorString(error, "name");
	if (name && RETRYABLE_ERROR_NAMES.has(name)) return true;
	const message = getErrorString(error, "message");
	if (message && RETRYABLE_TRANSPORT_MESSAGES.has(message)) return true;
	const httpStatusCode = getHttpStatusCode(error);
	return (
		httpStatusCode === 408 ||
		httpStatusCode === 425 ||
		httpStatusCode === 429 ||
		(httpStatusCode !== null && httpStatusCode >= 500)
	);
}

function getErrorString(error: object, key: string): string | null {
	const value = getErrorValue(error, key);
	return typeof value === "string" && value.length > 0 ? value : null;
}

function getErrorValue(error: object, key: string): unknown {
	try {
		return Reflect.get(error, key);
	} catch {
		return undefined;
	}
}

function getHttpStatusCode(error: object): number | null {
	for (const key of ["status", "statusCode"] as const) {
		const value = getErrorValue(error, key);
		if (typeof value === "number") return value;
	}
	const metadata = getErrorValue(error, "$metadata");
	if (typeof metadata !== "object" || metadata === null) return null;
	const value = getErrorValue(metadata, "httpStatusCode");
	return typeof value === "number" ? value : null;
}
