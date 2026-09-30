import { z } from "zod";
import { GITHUB_REST_API_VERSION } from "./types.js";

const DEFAULT_BASE_URL = "https://api.github.com";
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const DEFAULT_MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_USER_AGENT = "opaline-repository-intelligence/1";
const PRIVATE_KEY_HEADER =
	/-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/giu;
const PRIVATE_KEY_FOOTER = /KEY(?: BLOCK)?-----/iu;
const UTF8_ENCODER = new TextEncoder();

const pageCursorSchema = z.object({
	kind: z.literal("page"),
	version: z.literal(1),
	page: z.number().int().positive(),
});

export interface GitHubAuthorization {
	getHeader(): string;
	toJSON(): string;
	toString(): string;
}

export type GitHubConditionalCacheEntry = Readonly<{
	etag: string;
	body: string;
	link: string | null;
}>;

export interface GitHubConditionalCache {
	get(key: string): Promise<GitHubConditionalCacheEntry | null>;
	set(key: string, entry: GitHubConditionalCacheEntry): Promise<void>;
}

export type GitHubTransportOptions = Readonly<{
	authorization: GitHubAuthorization | undefined;
	baseUrl: string | undefined;
	conditionalCache: GitHubConditionalCache | undefined;
	fetch: typeof globalThis.fetch | undefined;
	maxResponseBytes: number | undefined;
	maxRetries: number | undefined;
	maxRetryDelayMs: number | undefined;
	now: (() => number) | undefined;
	sleep: ((milliseconds: number) => Promise<void>) | undefined;
	userAgent: string | undefined;
}>;

export type GitHubResponseMetadata = Readonly<{
	endpoint: string;
	requestId: string | null;
	etag: string | null;
	downloadedBytes: number;
	conditional: "disabled" | "miss" | "validated";
	link: string | null;
}>;

export type GitHubTransportResponse<TData> = Readonly<{
	data: TData;
	metadata: GitHubResponseMetadata;
}>;

export type GitHubTextBody = Readonly<{
	text: string;
	byteLength: number;
	originalByteLength: number | null;
	truncated: boolean;
	contentType: string | null;
}>;

type BoundedBody = Readonly<{
	text: string;
	byteLength: number;
}>;

type RedirectedResponse = Readonly<{
	response: Response;
	requestId: string | null;
}>;

export class GitHubSourceError extends Error {
	readonly kind:
		| "authentication"
		| "forbidden"
		| "not-found"
		| "rate-limit"
		| "validation"
		| "server"
		| "network"
		| "invalid-response";
	readonly endpoint: string;
	readonly status: number | null;
	readonly requestId: string | null;
	readonly retryAfterMs: number | null;

	constructor(input: {
		kind: GitHubSourceError["kind"];
		message: string;
		endpoint: string;
		status: number | null;
		requestId: string | null;
		retryAfterMs: number | null;
	}) {
		super(input.message);
		this.name = "GitHubSourceError";
		this.kind = input.kind;
		this.endpoint = input.endpoint;
		this.status = input.status;
		this.requestId = input.requestId;
		this.retryAfterMs = input.retryAfterMs;
	}

	toJSON(): Readonly<Record<string, string | number | null>> {
		return {
			name: this.name,
			kind: this.kind,
			message: this.message,
			endpoint: this.endpoint,
			status: this.status,
			requestId: this.requestId,
			retryAfterMs: this.retryAfterMs,
		};
	}
}

export interface GitHubTransport {
	requestJson<TSchema extends z.ZodTypeAny>(
		path: string,
		query: Readonly<Record<string, string | number | boolean | undefined>>,
		schema: TSchema,
	): Promise<GitHubTransportResponse<z.output<TSchema>>>;
	requestText(
		path: string,
		query: Readonly<Record<string, string | number | boolean | undefined>>,
		maxBytes: number,
	): Promise<GitHubTransportResponse<GitHubTextBody>>;
}

export function createGitHubAuthorization(token: string): GitHubAuthorization {
	const trimmedToken = token.trim();
	if (trimmedToken.length === 0) {
		throw new Error("GitHub token must not be empty");
	}

	return Object.freeze({
		getHeader(): string {
			return `Bearer ${trimmedToken}`;
		},
		toJSON(): string {
			return "[REDACTED]";
		},
		toString(): string {
			return "[REDACTED]";
		},
	});
}

export function createGitHubTransport(
	options: GitHubTransportOptions,
): GitHubTransport {
	const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
	const requestFetch = options.fetch ?? globalThis.fetch;
	const maxResponseBytes =
		options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
	const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
	const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

	validatePositiveInteger(maxResponseBytes, "maxResponseBytes");
	validateNonnegativeInteger(maxRetries, "maxRetries");
	validateNonnegativeInteger(maxRetryDelayMs, "maxRetryDelayMs");

	return Object.freeze({
		async requestJson<TSchema extends z.ZodTypeAny>(
			path: string,
			query: Readonly<Record<string, string | number | boolean | undefined>>,
			schema: TSchema,
		): Promise<GitHubTransportResponse<z.output<TSchema>>> {
			const url = buildGitHubUrl(baseUrl, path, query);
			const cacheKey = `${GITHUB_REST_API_VERSION}:${url}`;
			const cached = options.conditionalCache
				? await options.conditionalCache.get(cacheKey)
				: null;
			const headers = buildHeaders(
				options.authorization,
				userAgent,
				cached?.etag,
			);

			for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
				let response: Response;
				try {
					response = await requestFetch(url, { headers, method: "GET" });
				} catch {
					if (attempt < maxRetries) {
						await sleep(exponentialDelay(attempt));
						continue;
					}
					throw createTransportError(
						"network",
						"GitHub request failed before receiving a response",
						path,
						null,
						null,
						null,
					);
				}

				const requestId = response.headers.get("x-github-request-id");
				if (response.status === 304) {
					if (!cached) {
						throw createTransportError(
							"invalid-response",
							"GitHub returned 304 without a cached representation",
							path,
							304,
							requestId,
							null,
						);
					}
					return parseResponse(
						cached.body,
						schema,
						path,
						requestId,
						cached.etag,
						0,
						"validated",
						response.headers.get("link") ?? cached.link,
					);
				}

				if (!response.ok) {
					const errorBody = await readBoundedBody(response, 64 * 1024, path);
					const rateLimitDelay = getRetryDelay(
						response,
						now(),
						isSecondaryRateLimit(errorBody.text),
					);
					const retryDelay =
						rateLimitDelay === 0 &&
						(response.status === 408 || response.status >= 500)
							? exponentialDelay(attempt)
							: rateLimitDelay;
					if (
						shouldRetry(response, rateLimitDelay) &&
						attempt < maxRetries &&
						retryDelay <= maxRetryDelayMs
					) {
						await sleep(retryDelay);
						continue;
					}
					throw errorFromResponse(response, path, requestId, rateLimitDelay);
				}

				const body = await readBoundedBody(response, maxResponseBytes, path);
				const etag = response.headers.get("etag");
				if (etag && options.conditionalCache) {
					await options.conditionalCache.set(cacheKey, {
						etag,
						body: body.text,
						link: response.headers.get("link"),
					});
				}
				return parseResponse(
					body.text,
					schema,
					path,
					requestId,
					etag,
					body.byteLength,
					options.conditionalCache ? "miss" : "disabled",
					response.headers.get("link"),
				);
			}

			throw createTransportError(
				"network",
				"GitHub retry loop ended unexpectedly",
				path,
				null,
				null,
				null,
			);
		},
		async requestText(
			path: string,
			query: Readonly<Record<string, string | number | boolean | undefined>>,
			maxBytes: number,
		): Promise<GitHubTransportResponse<GitHubTextBody>> {
			validatePositiveInteger(maxBytes, "maxBytes");
			const url = buildGitHubUrl(baseUrl, path, query);
			const headers = buildHeaders(options.authorization, userAgent, undefined);

			for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
				let response: Response;
				let redirectRequestId: string | null = null;
				try {
					const redirected = await fetchFollowingRedirects(
						requestFetch,
						url,
						headers,
						path,
					);
					response = redirected.response;
					redirectRequestId = redirected.requestId;
				} catch (error) {
					if (error instanceof GitHubSourceError) {
						throw error;
					}
					if (attempt < maxRetries) {
						await sleep(exponentialDelay(attempt));
						continue;
					}
					throw createTransportError(
						"network",
						"GitHub request failed before receiving a response",
						path,
						null,
						null,
						null,
					);
				}

				const requestId =
					redirectRequestId ?? response.headers.get("x-github-request-id");
				if (!response.ok) {
					const errorBody = await readBoundedBody(response, 64 * 1024, path);
					const rateLimitDelay = getRetryDelay(
						response,
						now(),
						isSecondaryRateLimit(errorBody.text),
					);
					const retryDelay =
						rateLimitDelay === 0 &&
						(response.status === 408 || response.status >= 500)
							? exponentialDelay(attempt)
							: rateLimitDelay;
					if (
						shouldRetry(response, rateLimitDelay) &&
						attempt < maxRetries &&
						retryDelay <= maxRetryDelayMs
					) {
						await sleep(retryDelay);
						continue;
					}
					throw errorFromResponse(response, path, requestId, rateLimitDelay);
				}

				const body = await readBoundedText(response, maxBytes);
				const retained = dropUnterminatedPrivateKey(body);
				return {
					data: {
						text: retained.text,
						byteLength: retained.byteLength,
						originalByteLength: body.originalByteLength,
						truncated: body.truncated,
						contentType: response.headers.get("content-type"),
					},
					metadata: {
						endpoint: path,
						requestId,
						etag: null,
						downloadedBytes: body.byteLength,
						conditional: "disabled",
						link: null,
					},
				};
			}

			throw createTransportError(
				"network",
				"GitHub retry loop ended unexpectedly",
				path,
				null,
				null,
				null,
			);
		},
	});
}

async function fetchFollowingRedirects(
	requestFetch: typeof globalThis.fetch,
	initialUrl: string,
	initialHeaders: Headers,
	endpoint: string,
): Promise<RedirectedResponse> {
	let currentUrl = new URL(initialUrl);
	let currentHeaders = new Headers(initialHeaders);
	let requestId: string | null = null;
	for (
		let redirectCount = 0;
		redirectCount <= MAX_REDIRECTS;
		redirectCount += 1
	) {
		const response = await requestFetch(currentUrl, {
			headers: currentHeaders,
			method: "GET",
			redirect: "manual",
		});
		requestId ??= response.headers.get("x-github-request-id");
		if (!isRedirectStatus(response.status)) {
			return { response, requestId };
		}
		const location = response.headers.get("location");
		if (!location) {
			await discardResponse(response);
			throw createTransportError(
				"invalid-response",
				"GitHub redirect did not include a location",
				endpoint,
				response.status,
				response.headers.get("x-github-request-id"),
				null,
			);
		}
		if (redirectCount === MAX_REDIRECTS) {
			await discardResponse(response);
			throw createTransportError(
				"invalid-response",
				`GitHub response exceeded the ${MAX_REDIRECTS} redirect limit`,
				endpoint,
				response.status,
				response.headers.get("x-github-request-id"),
				null,
			);
		}

		const nextUrl = new URL(location, currentUrl);
		if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:") {
			await discardResponse(response);
			throw createTransportError(
				"invalid-response",
				"GitHub redirect used an unsupported protocol",
				endpoint,
				response.status,
				response.headers.get("x-github-request-id"),
				null,
			);
		}
		if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
			await discardResponse(response);
			throw createTransportError(
				"invalid-response",
				"GitHub redirect attempted to downgrade a sensitive response to HTTP",
				endpoint,
				response.status,
				response.headers.get("x-github-request-id"),
				null,
			);
		}
		if (nextUrl.origin !== currentUrl.origin) {
			currentHeaders = withoutGitHubCredentials(currentHeaders);
		}
		await discardResponse(response);
		currentUrl = nextUrl;
	}

	throw createTransportError(
		"invalid-response",
		"GitHub redirect loop ended unexpectedly",
		endpoint,
		null,
		null,
		null,
	);
}

function isRedirectStatus(status: number): boolean {
	return (
		status === 301 ||
		status === 302 ||
		status === 303 ||
		status === 307 ||
		status === 308
	);
}

function withoutGitHubCredentials(headers: Headers): Headers {
	const redirectedHeaders = new Headers(headers);
	redirectedHeaders.delete("Authorization");
	redirectedHeaders.delete("X-GitHub-Api-Version");
	return redirectedHeaders;
}

export function buildGitHubUrl(
	baseUrl: string,
	path: string,
	query: Readonly<Record<string, string | number | boolean | undefined>>,
): string {
	if (!path.startsWith("/")) {
		throw new Error("GitHub API path must begin with '/'");
	}
	const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);
	for (const [name, value] of Object.entries(query)) {
		if (value !== undefined) {
			url.searchParams.set(name, String(value));
		}
	}
	return url.toString();
}

export function encodePageCursor(page: number): string {
	validatePositiveInteger(page, "page");
	return encodeCursor({ kind: "page", version: 1, page });
}

export function decodePageCursor(cursor: string | undefined): number {
	if (cursor === undefined) {
		return 1;
	}
	const parsed = pageCursorSchema.safeParse(decodeCursor(cursor));
	if (!parsed.success) {
		throw new Error("Invalid GitHub page cursor");
	}
	return parsed.data.page;
}

export function getNextPageCursor(linkHeader: string | null): string | null {
	if (!linkHeader) {
		return null;
	}
	for (const segment of linkHeader.split(",")) {
		const match = segment.match(/<([^>]+)>;\s*rel="next"/);
		if (!match?.[1]) {
			continue;
		}
		const page = Number(new URL(match[1]).searchParams.get("page"));
		if (Number.isInteger(page) && page > 0) {
			return encodePageCursor(page);
		}
	}
	return null;
}

function buildHeaders(
	authorization: GitHubAuthorization | undefined,
	userAgent: string,
	etag: string | undefined,
): Headers {
	const headers = new Headers({
		Accept: "application/vnd.github+json",
		"User-Agent": userAgent,
		"X-GitHub-Api-Version": GITHUB_REST_API_VERSION,
	});
	if (authorization) {
		headers.set("Authorization", authorization.getHeader());
	}
	if (etag) {
		headers.set("If-None-Match", etag);
	}
	return headers;
}

async function readBoundedBody(
	response: Response,
	maxBytes: number,
	endpoint: string,
): Promise<BoundedBody> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await discardResponse(response);
		throw createTransportError(
			"invalid-response",
			`GitHub response exceeded the ${maxBytes} byte limit`,
			endpoint,
			response.status,
			response.headers.get("x-github-request-id"),
			null,
		);
	}
	if (!response.body) {
		return { text: "", byteLength: 0 };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let receivedBytes = 0;
	let body = "";
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			body += decoder.decode();
			return { text: body, byteLength: receivedBytes };
		}
		receivedBytes += chunk.value.byteLength;
		if (receivedBytes > maxBytes) {
			await reader.cancel();
			throw createTransportError(
				"invalid-response",
				`GitHub response exceeded the ${maxBytes} byte limit`,
				endpoint,
				response.status,
				response.headers.get("x-github-request-id"),
				null,
			);
		}
		body += decoder.decode(chunk.value, { stream: true });
	}
}

// A secret filter can only recognize a PEM block that still carries its
// footer. When the byte cap cuts a log inside a private key, the retained
// prefix would hold the header and part of the key body with nothing left to
// anchor a redaction, so the partial block is removed before anything leaves
// the transport.
function dropUnterminatedPrivateKey<
	TBody extends BoundedBody & Readonly<{ truncated: boolean }>,
>(body: TBody): TBody {
	if (!body.truncated) return body;
	let lastHeader: { readonly start: number; readonly end: number } | null =
		null;
	for (const match of body.text.matchAll(PRIVATE_KEY_HEADER)) {
		lastHeader = { start: match.index, end: match.index + match[0].length };
	}
	if (lastHeader === null) return body;
	if (PRIVATE_KEY_FOOTER.test(body.text.slice(lastHeader.end))) return body;
	const text = body.text.slice(0, lastHeader.start);
	return { ...body, text, byteLength: UTF8_ENCODER.encode(text).byteLength };
}

async function readBoundedText(
	response: Response,
	maxBytes: number,
): Promise<
	BoundedBody &
		Readonly<{ originalByteLength: number | null; truncated: boolean }>
> {
	const contentLengthHeader = response.headers.get("content-length");
	const contentLength =
		contentLengthHeader === null ? null : Number(contentLengthHeader);
	const knownContentLength =
		contentLength !== null &&
		Number.isFinite(contentLength) &&
		contentLength >= 0
			? contentLength
			: null;
	if (!response.body) {
		return {
			text: "",
			byteLength: 0,
			originalByteLength: knownContentLength ?? 0,
			truncated: false,
		};
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let receivedBytes = 0;
	let body = "";

	while (receivedBytes < maxBytes) {
		const chunk = await reader.read();
		if (chunk.done) {
			body += decoder.decode();
			return {
				text: body,
				byteLength: receivedBytes,
				originalByteLength: knownContentLength ?? receivedBytes,
				truncated: false,
			};
		}
		const remainingBytes = maxBytes - receivedBytes;
		const retainedChunk = chunk.value.subarray(0, remainingBytes);
		receivedBytes += retainedChunk.byteLength;
		body += decoder.decode(retainedChunk, { stream: true });
		if (chunk.value.byteLength > remainingBytes) {
			await reader.cancel();
			body += decoder.decode();
			return {
				text: body,
				byteLength: receivedBytes,
				originalByteLength: knownContentLength,
				truncated: true,
			};
		}
	}

	if (knownContentLength !== null) {
		if (knownContentLength > maxBytes) {
			await reader.cancel();
			body += decoder.decode();
			return {
				text: body,
				byteLength: receivedBytes,
				originalByteLength: knownContentLength,
				truncated: true,
			};
		}
	}

	const overflow = await reader.read();
	if (overflow.done) {
		body += decoder.decode();
		return {
			text: body,
			byteLength: receivedBytes,
			originalByteLength: knownContentLength ?? receivedBytes,
			truncated: false,
		};
	}
	await reader.cancel();
	body += decoder.decode();
	return {
		text: body,
		byteLength: receivedBytes,
		originalByteLength: knownContentLength,
		truncated: true,
	};
}

function parseResponse<TSchema extends z.ZodTypeAny>(
	body: string,
	schema: TSchema,
	endpoint: string,
	requestId: string | null,
	etag: string | null,
	downloadedBytes: number,
	conditional: GitHubResponseMetadata["conditional"],
	link: string | null,
): GitHubTransportResponse<z.output<TSchema>> {
	let rawData: unknown;
	try {
		rawData = JSON.parse(body);
	} catch {
		throw createTransportError(
			"invalid-response",
			"GitHub returned malformed JSON",
			endpoint,
			200,
			requestId,
			null,
		);
	}
	const parsed = schema.safeParse(rawData);
	if (!parsed.success) {
		throw createTransportError(
			"invalid-response",
			`GitHub response failed runtime validation at ${formatIssues(parsed.error)}`,
			endpoint,
			200,
			requestId,
			null,
		);
	}
	return {
		data: parsed.data,
		metadata: {
			endpoint,
			requestId,
			etag,
			downloadedBytes,
			conditional,
			link,
		},
	};
}

function shouldRetry(response: Response, retryDelay: number): boolean {
	return (
		response.status === 408 ||
		response.status === 429 ||
		response.status >= 500 ||
		(response.status === 403 && retryDelay > 0)
	);
}

function getRetryDelay(
	response: Response,
	nowMs: number,
	secondaryRateLimit: boolean,
): number {
	const retryAfter = response.headers.get("retry-after");
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.ceil(seconds * 1000);
		}
		const retryAt = Date.parse(retryAfter);
		if (Number.isFinite(retryAt)) {
			return Math.max(0, retryAt - nowMs);
		}
	}
	if (response.headers.get("x-ratelimit-remaining") === "0") {
		const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
		if (Number.isFinite(resetSeconds)) {
			return Math.max(0, resetSeconds * 1000 - nowMs);
		}
	}
	if (response.status === 429 || secondaryRateLimit) {
		return 60_000;
	}
	return 0;
}

function isSecondaryRateLimit(body: string): boolean {
	return /secondary rate limit|abuse detection/i.test(body);
}

function errorFromResponse(
	response: Response,
	endpoint: string,
	requestId: string | null,
	retryAfterMs: number,
): GitHubSourceError {
	if (response.status === 401) {
		return createTransportError(
			"authentication",
			"GitHub rejected the supplied credentials",
			endpoint,
			response.status,
			requestId,
			null,
		);
	}
	if (response.status === 404) {
		return createTransportError(
			"not-found",
			"GitHub resource is unavailable or does not exist",
			endpoint,
			response.status,
			requestId,
			null,
		);
	}
	if (response.status === 403 && retryAfterMs === 0) {
		return createTransportError(
			"forbidden",
			"GitHub denied access to this resource",
			endpoint,
			response.status,
			requestId,
			null,
		);
	}
	if (response.status === 403 || response.status === 429) {
		return createTransportError(
			"rate-limit",
			"GitHub rate limited the request",
			endpoint,
			response.status,
			requestId,
			retryAfterMs,
		);
	}
	if (response.status === 422) {
		return createTransportError(
			"validation",
			"GitHub rejected the request parameters",
			endpoint,
			response.status,
			requestId,
			null,
		);
	}
	return createTransportError(
		response.status >= 500 ? "server" : "invalid-response",
		`GitHub request failed with status ${response.status}`,
		endpoint,
		response.status,
		requestId,
		null,
	);
}

function createTransportError(
	kind: GitHubSourceError["kind"],
	message: string,
	endpoint: string,
	status: number | null,
	requestId: string | null,
	retryAfterMs: number | null,
): GitHubSourceError {
	return new GitHubSourceError({
		kind,
		message,
		endpoint,
		status,
		requestId,
		retryAfterMs,
	});
}

function formatIssues(error: z.ZodError): string {
	return error.issues
		.slice(0, 3)
		.map((issue) => issue.path.join(".") || "response")
		.join(", ");
}

function exponentialDelay(attempt: number): number {
	return Math.min(250 * 2 ** attempt, 5_000);
}

async function discardResponse(response: Response): Promise<void> {
	if (response.body) {
		await response.body.cancel();
	}
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function encodeCursor(value: object): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): unknown {
	try {
		return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

function validatePositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
}

function validateNonnegativeInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a nonnegative integer`);
	}
}

async function defaultSleep(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
