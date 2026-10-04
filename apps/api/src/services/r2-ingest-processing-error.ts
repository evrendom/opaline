import { ClickHouseError } from "@clickhouse/client-web";
import { ORPCError } from "@orpc/server";
import {
	REDACTION_BUDGET_EXCEEDED_CODE,
	REDACTION_DID_NOT_CONVERGE_CODE,
	SECRET_FILTER_JSON_INTEGRITY_CODE,
	SESSION_OWNERSHIP_CONFLICT_CODE,
	SESSION_UPLOAD_SHRINK_REJECTED_CODE,
} from "@rudel/api-routes";
import { ZodError } from "zod";
import {
	IngestFilterWorkerOperationalError,
	SessionLanguageSignalScannerOperationalError,
} from "./ingest-worker-operational.error.js";
import { PostgresLeaseLostError } from "./postgres-lease.service.js";
import { R2IngestMaterializationGateError } from "./r2-ingest-materialization-gate.js";

export const R2_INGEST_DEPENDENCY_UNAVAILABLE =
	"R2_INGEST_DEPENDENCY_UNAVAILABLE";
export const R2_INGEST_TRANSIENT_ERROR_CODES = [
	R2_INGEST_DEPENDENCY_UNAVAILABLE,
	"R2_INGEST_TRANSIENT_FAILURE",
	"R2_INGEST_SERVICE_UNAVAILABLE",
	"R2_INGEST_GATEWAY_TIMEOUT",
];

const MAX_ERROR_GRAPH_NODES = 64;
// Conservative subset of ClickHouse's documented connector retry list. Query,
// parse, type, per-query memory, and generic server errors stay terminal.
const RETRYABLE_CLICKHOUSE_ERROR_TYPES_BY_CODE = new Map([
	["159", "TIMEOUT_EXCEEDED"],
	["202", "TOO_MANY_SIMULTANEOUS_QUERIES"],
	["203", "NO_FREE_CONNECTION"],
	["209", "SOCKET_TIMEOUT"],
	["210", "NETWORK_ERROR"],
	["242", "TABLE_IS_READ_ONLY"],
	["252", "TOO_MANY_PARTS"],
	["285", "TOO_FEW_LIVE_REPLICAS"],
	["319", "UNKNOWN_STATUS_OF_INSERT"],
	["999", "KEEPER_EXCEPTION"],
]);
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
const RETRYABLE_ERROR_NAMES = new Set([
	"AbortError",
	"ClientDisconnect",
	"InternalError",
	"ServiceUnavailable",
	"TimeoutError",
	"TooManyRequests",
]);
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
const DEFINITELY_PERMANENT_ORPC_CODES: ReadonlySet<string> = new Set([
	"BAD_REQUEST",
	"CONFLICT",
	"FORBIDDEN",
	"PAYLOAD_TOO_LARGE",
	"UNAUTHORIZED",
	REDACTION_BUDGET_EXCEEDED_CODE,
	REDACTION_DID_NOT_CONVERGE_CODE,
	SECRET_FILTER_JSON_INTEGRITY_CODE,
	SESSION_OWNERSHIP_CONFLICT_CODE,
	SESSION_UPLOAD_SHRINK_REJECTED_CODE,
]);
const DEFINITELY_PERMANENT_R2_INGEST_CODES = new Set([
	"R2_INGEST_COMPLETION_RECEIPT_INVALID",
	"R2_INGEST_MANIFEST_INVALID",
	"R2_INGEST_OBJECT_ENCODING_INVALID",
	"R2_INGEST_OBJECT_HASH_MISMATCH",
	"R2_INGEST_OBJECT_METADATA_MISMATCH",
	"R2_INGEST_OBJECT_MISSING",
	"R2_INGEST_OBJECT_SIZE_MISMATCH",
	"R2_INGEST_TOTAL_SIZE_MISMATCH",
]);
const DEFINITELY_PERMANENT_CLICKHOUSE_ERROR_TYPES_BY_CODE = new Map([
	["53", "TYPE_MISMATCH"],
	["62", "SYNTAX_ERROR"],
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

/**
 * Closed allowlist for errors that cannot succeed with the same uploaded input.
 * Unknown errors must stay pending so a future operational failure cannot cause
 * a verified R2 object to be deleted before retry exhaustion or expiry cleanup.
 */
export function isDefinitelyPermanentProcessingError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	if (
		error instanceof R2IngestCommitError &&
		DEFINITELY_PERMANENT_R2_INGEST_CODES.has(error.code)
	) {
		return true;
	}
	if (
		error instanceof ORPCError &&
		DEFINITELY_PERMANENT_ORPC_CODES.has(error.code)
	) {
		return true;
	}
	if (error instanceof ZodError) return true;
	return isDefinitelyPermanentClickHouseError(error);
}

function isRetryableErrorNode(error: object): boolean {
	if (error instanceof R2IngestCommitError && error.retryable) return true;
	if (error instanceof R2IngestMaterializationGateError) return true;
	// Another processor took over the identity; this attempt did nothing wrong.
	if (error instanceof PostgresLeaseLostError) return true;
	if (
		error instanceof IngestFilterWorkerOperationalError ||
		error instanceof SessionLanguageSignalScannerOperationalError
	) {
		return true;
	}
	if (error instanceof ORPCError && RETRYABLE_ORPC_CODES.has(error.code)) {
		return true;
	}
	if (
		error instanceof ClickHouseError ||
		getErrorString(error, "type") !== null
	) {
		return isRetryableClickHouseError(error);
	}
	if (isRetryableClickHouseError(error)) return true;
	const code = getErrorString(error, "code");
	if (
		code &&
		(RETRYABLE_ERROR_CODES.has(code) ||
			(code.length === 5 && (code.startsWith("08") || code.startsWith("53"))))
	) {
		return true;
	}
	const name = getErrorString(error, "name");
	if (name && RETRYABLE_ERROR_NAMES.has(name)) return true;
	const message = getErrorString(error, "message");
	if (message && RETRYABLE_TRANSPORT_MESSAGES.has(message)) return true;
	if (
		message &&
		/(?:no available servers?|connection (?:refused|reset)|socket hang up|\b(?:timeout|timed out)\b|\b(?:HTTP(?:\s+(?:status|error))?|status(?:\s+code)?)[\s:=]+(?:502|503|504)\b)/iu.test(
			message,
		)
	) {
		return true;
	}
	const httpStatusCode = getHttpStatusCode(error);
	return (
		httpStatusCode === 408 ||
		httpStatusCode === 425 ||
		httpStatusCode === 429 ||
		(httpStatusCode !== null && httpStatusCode >= 500)
	);
}

function isDefinitelyPermanentClickHouseError(error: object): boolean {
	const code = getErrorString(error, "code");
	const type = getErrorString(error, "type");
	return (
		code !== null &&
		type !== null &&
		DEFINITELY_PERMANENT_CLICKHOUSE_ERROR_TYPES_BY_CODE.get(code) === type
	);
}

function isRetryableClickHouseError(error: object): boolean {
	const code = getErrorString(error, "code");
	const type = getErrorString(error, "type");
	if (code && type) {
		return RETRYABLE_CLICKHOUSE_ERROR_TYPES_BY_CODE.get(code) === type;
	}
	return code !== null && RETRYABLE_CLICKHOUSE_ERROR_TYPES_BY_CODE.has(code);
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
