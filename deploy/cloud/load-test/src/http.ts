export type RequestClassification =
	| "success"
	| "http_error"
	| "network_error"
	| "timeout";

export interface RequestMeasurement {
	readonly attempt: number;
	readonly bytesSent: number;
	readonly classification: RequestClassification;
	readonly durationMs: number;
	readonly errorCode: string | null;
	readonly errorMessage: string | null;
	readonly httpStatus: number | null;
	readonly method: "POST" | "PUT";
	readonly phase: "commit" | "init" | "r2_part" | "status";
	readonly startedOffsetMs: number;
	readonly target: string;
	readonly uploadIndex: number;
}

export interface RequestContext {
	readonly record: (measurement: RequestMeasurement) => void;
	readonly requestTimeoutMs: number;
	readonly runStartedAt: number;
	readonly uploadIndex: number;
}

export type JsonRequestResult<TValue> =
	| {
			readonly data: TValue;
			readonly durationMs: number;
			readonly kind: "success";
			readonly status: number;
	  }
	| {
			readonly body: unknown;
			readonly durationMs: number;
			readonly errorCode: string | null;
			readonly errorMessage: string;
			readonly kind: "failure";
			readonly retryAfterMs: number | null;
			readonly status: number | null;
			readonly type: Exclude<RequestClassification, "success">;
	  };

export type PartUploadResult =
	| { readonly etag: string; readonly kind: "success" }
	| {
			readonly errorMessage: string;
			readonly kind: "failure";
			readonly status: number | null;
			readonly type: Exclude<RequestClassification, "success">;
	  };

export async function postRpc<TValue>(input: {
	readonly apiKey: string;
	readonly attempt: number;
	readonly baseUrl: URL;
	readonly context: RequestContext;
	readonly parse: (value: unknown) => TValue;
	readonly path: "ingest/commit" | "ingest/init" | "ingest/status";
	readonly payload: unknown;
}): Promise<JsonRequestResult<TValue>> {
	const url = new URL(`/rpc/${input.path}`, input.baseUrl);
	const body = JSON.stringify({ json: input.payload });
	const phase = getRpcPhase(input.path);
	const startedAt = performance.now();
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("Request timed out")),
		input.context.requestTimeoutMs,
	);

	try {
		const response = await fetch(url, {
			body,
			headers: {
				"Content-Type": "application/json",
				"x-api-key": input.apiKey,
			},
			method: "POST",
			signal: controller.signal,
		});
		const responseText = await response.text();
		const durationMs = performance.now() - startedAt;
		const responseBody = parseJsonOrText(responseText);
		if (!response.ok) {
			const errorMessage =
				findStringField(responseBody, "message") ?? responseText;
			const errorCode =
				findStringField(responseBody, "reason") ??
				findStringField(responseBody, "code");
			input.context.record({
				attempt: input.attempt,
				bytesSent: Buffer.byteLength(body),
				classification: "http_error",
				durationMs,
				errorCode,
				errorMessage: truncate(errorMessage),
				httpStatus: response.status,
				method: "POST",
				phase,
				startedOffsetMs: startedAt - input.context.runStartedAt,
				target: `/rpc/${input.path}`,
				uploadIndex: input.context.uploadIndex,
			});
			return {
				body: responseBody,
				durationMs,
				errorCode,
				errorMessage: truncate(errorMessage || `HTTP ${response.status}`),
				kind: "failure",
				retryAfterMs: findNumberField(responseBody, "retryAfterMs"),
				status: response.status,
				type: "http_error",
			};
		}

		try {
			const data = input.parse(unwrapRpcJson(responseBody));
			input.context.record({
				attempt: input.attempt,
				bytesSent: Buffer.byteLength(body),
				classification: "success",
				durationMs,
				errorCode: null,
				errorMessage: null,
				httpStatus: response.status,
				method: "POST",
				phase,
				startedOffsetMs: startedAt - input.context.runStartedAt,
				target: `/rpc/${input.path}`,
				uploadIndex: input.context.uploadIndex,
			});
			return { data, durationMs, kind: "success", status: response.status };
		} catch (error) {
			const errorMessage = `Invalid successful RPC response: ${getErrorMessage(error)}`;
			input.context.record({
				attempt: input.attempt,
				bytesSent: Buffer.byteLength(body),
				classification: "network_error",
				durationMs,
				errorCode: "INVALID_RESPONSE",
				errorMessage,
				httpStatus: response.status,
				method: "POST",
				phase,
				startedOffsetMs: startedAt - input.context.runStartedAt,
				target: `/rpc/${input.path}`,
				uploadIndex: input.context.uploadIndex,
			});
			return {
				body: responseBody,
				durationMs,
				errorCode: "INVALID_RESPONSE",
				errorMessage,
				kind: "failure",
				retryAfterMs: null,
				status: response.status,
				type: "network_error",
			};
		}
	} catch (error) {
		const durationMs = performance.now() - startedAt;
		const classification = controller.signal.aborted
			? "timeout"
			: "network_error";
		const errorMessage = getErrorMessage(error);
		input.context.record({
			attempt: input.attempt,
			bytesSent: Buffer.byteLength(body),
			classification,
			durationMs,
			errorCode: null,
			errorMessage: truncate(errorMessage),
			httpStatus: null,
			method: "POST",
			phase,
			startedOffsetMs: startedAt - input.context.runStartedAt,
			target: `/rpc/${input.path}`,
			uploadIndex: input.context.uploadIndex,
		});
		return {
			body: null,
			durationMs,
			errorCode: null,
			errorMessage: truncate(errorMessage),
			kind: "failure",
			retryAfterMs: null,
			status: null,
			type: classification,
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function putR2Part(input: {
	readonly attempt: number;
	readonly body: Blob;
	readonly byteLength: number;
	readonly context: RequestContext;
	readonly contentLength: string;
	readonly objectKey: string;
	readonly partNumber: number;
	readonly uploadUrl: string;
}): Promise<PartUploadResult> {
	const startedAt = performance.now();
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("R2 upload timed out")),
		input.context.requestTimeoutMs,
	);
	try {
		const response = await fetch(input.uploadUrl, {
			body: input.body,
			headers: { "Content-Length": input.contentLength },
			method: "PUT",
			signal: controller.signal,
		});
		const durationMs = performance.now() - startedAt;
		if (!response.ok) {
			const errorMessage = truncate(await response.text());
			input.context.record({
				attempt: input.attempt,
				bytesSent: input.byteLength,
				classification: "http_error",
				durationMs,
				errorCode: null,
				errorMessage,
				httpStatus: response.status,
				method: "PUT",
				phase: "r2_part",
				startedOffsetMs: startedAt - input.context.runStartedAt,
				target: `${input.objectKey}#part-${input.partNumber}`,
				uploadIndex: input.context.uploadIndex,
			});
			return {
				errorMessage: errorMessage || `R2 returned HTTP ${response.status}`,
				kind: "failure",
				status: response.status,
				type: "http_error",
			};
		}
		const etag = response.headers.get("etag")?.trim();
		if (!etag) {
			const errorMessage = "R2 upload response did not include an ETag";
			input.context.record({
				attempt: input.attempt,
				bytesSent: input.byteLength,
				classification: "network_error",
				durationMs,
				errorCode: "MISSING_ETAG",
				errorMessage,
				httpStatus: response.status,
				method: "PUT",
				phase: "r2_part",
				startedOffsetMs: startedAt - input.context.runStartedAt,
				target: `${input.objectKey}#part-${input.partNumber}`,
				uploadIndex: input.context.uploadIndex,
			});
			return {
				errorMessage,
				kind: "failure",
				status: response.status,
				type: "network_error",
			};
		}
		input.context.record({
			attempt: input.attempt,
			bytesSent: input.byteLength,
			classification: "success",
			durationMs,
			errorCode: null,
			errorMessage: null,
			httpStatus: response.status,
			method: "PUT",
			phase: "r2_part",
			startedOffsetMs: startedAt - input.context.runStartedAt,
			target: `${input.objectKey}#part-${input.partNumber}`,
			uploadIndex: input.context.uploadIndex,
		});
		return { etag, kind: "success" };
	} catch (error) {
		const durationMs = performance.now() - startedAt;
		const classification = controller.signal.aborted
			? "timeout"
			: "network_error";
		const errorMessage = truncate(getErrorMessage(error));
		input.context.record({
			attempt: input.attempt,
			bytesSent: input.byteLength,
			classification,
			durationMs,
			errorCode: null,
			errorMessage,
			httpStatus: null,
			method: "PUT",
			phase: "r2_part",
			startedOffsetMs: startedAt - input.context.runStartedAt,
			target: `${input.objectKey}#part-${input.partNumber}`,
			uploadIndex: input.context.uploadIndex,
		});
		return {
			errorMessage,
			kind: "failure",
			status: null,
			type: classification,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function unwrapRpcJson(value: unknown): unknown {
	return isRecord(value) && Object.hasOwn(value, "json") ? value.json : value;
}

function parseJsonOrText(value: string): unknown {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed;
	} catch {
		return value;
	}
}

function findStringField(value: unknown, key: string): string | null {
	if (isRecord(value)) {
		const direct = value[key];
		if (typeof direct === "string" && direct) return direct;
		for (const child of Object.values(value)) {
			const found = findStringField(child, key);
			if (found) return found;
		}
	}
	if (Array.isArray(value)) {
		for (const child of value) {
			const found = findStringField(child, key);
			if (found) return found;
		}
	}
	return null;
}

function findNumberField(value: unknown, key: string): number | null {
	if (isRecord(value)) {
		const direct = value[key];
		if (typeof direct === "number" && Number.isFinite(direct)) return direct;
		for (const child of Object.values(value)) {
			const found = findNumberField(child, key);
			if (found !== null) return found;
		}
	}
	if (Array.isArray(value)) {
		for (const child of value) {
			const found = findNumberField(child, key);
			if (found !== null) return found;
		}
	}
	return null;
}

function getRpcPhase(
	path: "ingest/commit" | "ingest/init" | "ingest/status",
): "commit" | "init" | "status" {
	if (path === "ingest/commit") return "commit";
	if (path === "ingest/init") return "init";
	return "status";
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function truncate(value: string): string {
	return value.length <= 2_000 ? value : `${value.slice(0, 2_000)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
