import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import assert from "node:assert/strict";
import {
	INGEST_LIMIT_REASONS,
	type IngestSessionInput,
} from "@rudel/api-routes";
import postgres from "postgres";
import {
	checkIngestRateLimit,
	createPostgresIngestRateLimitEnvironment,
	type IngestRateLimitConfig,
} from "../services/ingest-rate-limit.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(30_000);

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) {
	throw new Error("PG_CONNECTION_STRING is required for integration tests");
}

const TEST_KEY_PREFIX = `ingest-rate-limit-${crypto.randomUUID()}`;
const DEFAULT_TEST_CONFIG: IngestRateLimitConfig = {
	bytesMax: 100,
	bytesWindowSeconds: 3600,
	requestsMax: 10,
	requestsWindowSeconds: 3600,
};

let server: ApiTestServer;
let apiKey: { id: string; key: string };
const firstDatabase = postgres(connectionString, { max: 1, prepare: false });
const secondDatabase = postgres(connectionString, { max: 1, prepare: false });
const firstInstance = createPostgresIngestRateLimitEnvironment(firstDatabase);
const secondInstance = createPostgresIngestRateLimitEnvironment(secondDatabase);

beforeAll(async () => {
	server = await startApiTestServer({
		RATE_LIMIT_INGEST_BYTES_MAX: "1",
		RATE_LIMIT_INGEST_REQUESTS_MAX: "1",
	});
	const bearerToken = await signUpTestUser(server.baseUrl);
	apiKey = await createIngestApiKey(server.baseUrl, bearerToken);
});

afterAll(async () => {
	await firstDatabase`
		DELETE FROM apikey
		WHERE id LIKE ${`${TEST_KEY_PREFIX}%`}
			OR id = ${apiKey?.id ?? ""}
	`;
	await Promise.all([
		server?.stop(),
		firstDatabase.end(),
		secondDatabase.end(),
	]);
});

describe("atomic Postgres ingest rate limiting", () => {
	test("enforces one API-key cap across two service instances", async () => {
		const apiKeyId = await createCounterApiKey("two-instances");
		const config = { ...DEFAULT_TEST_CONFIG, requestsMax: 1 };

		await checkIngestRateLimit(
			{ id: apiKeyId, kind: "api_key" },
			10,
			config,
			firstInstance,
		);
		await expect(
			checkIngestRateLimit(
				{ id: apiKeyId, kind: "api_key" },
				10,
				config,
				secondInstance,
			),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: { reason: INGEST_LIMIT_REASONS.requestLimit },
		});
	});

	test("rolls both fixed windows in SQL", async () => {
		const apiKeyId = await createCounterApiKey("rollover");
		const config = {
			...DEFAULT_TEST_CONFIG,
			bytesMax: 10,
			requestsMax: 1,
		};

		await checkIngestRateLimit(
			{ id: apiKeyId, kind: "api_key" },
			10,
			config,
			firstInstance,
		);
		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = NOW() - INTERVAL '2 hours',
				byte_window_started_at = NOW() - INTERVAL '2 hours'
			WHERE api_key_id = ${apiKeyId}
		`;

		await expect(
			checkIngestRateLimit(
				{ id: apiKeyId, kind: "api_key" },
				1,
				config,
				secondInstance,
			),
		).resolves.toBeUndefined();
		expect(await readCounter(apiKeyId)).toMatchObject({
			byteCount: 1,
			requestCount: 1,
		});
	});

	test("enforces the request and byte caps independently", async () => {
		const requestLimitedKey = await createCounterApiKey("request-independent");
		const byteLimitedKey = await createCounterApiKey("byte-independent");
		const requestConfig = { ...DEFAULT_TEST_CONFIG, requestsMax: 1 };
		const byteConfig = { ...DEFAULT_TEST_CONFIG, bytesMax: 10 };

		await checkIngestRateLimit(
			{ id: requestLimitedKey, kind: "api_key" },
			10,
			requestConfig,
			firstInstance,
		);
		await expect(
			checkIngestRateLimit(
				{ id: requestLimitedKey, kind: "api_key" },
				10,
				requestConfig,
				secondInstance,
			),
		).rejects.toMatchObject({
			data: { reason: INGEST_LIMIT_REASONS.requestLimit },
		});
		expect(await readCounter(requestLimitedKey)).toMatchObject({
			byteCount: 10,
			requestCount: 1,
		});

		await checkIngestRateLimit(
			{ id: byteLimitedKey, kind: "api_key" },
			6,
			byteConfig,
			firstInstance,
		);
		await expect(
			checkIngestRateLimit(
				{ id: byteLimitedKey, kind: "api_key" },
				5,
				byteConfig,
				secondInstance,
			),
		).rejects.toMatchObject({
			data: { reason: INGEST_LIMIT_REASONS.byteLimit },
		});
		expect(await readCounter(byteLimitedKey)).toMatchObject({
			byteCount: 6,
			requestCount: 2,
		});
	});

	test("counts a retried ingest request as another attempt", async () => {
		const apiKeyId = await createCounterApiKey("retry");
		const config = { ...DEFAULT_TEST_CONFIG, requestsMax: 1 };
		const subject = { id: apiKeyId, kind: "api_key" } as const;

		await checkIngestRateLimit(subject, 10, config, firstInstance);
		await expect(
			checkIngestRateLimit(subject, 10, config, firstInstance),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: { reason: INGEST_LIMIT_REASONS.requestLimit },
		});
	});
});

describe("ingest rate-limit oRPC errors", () => {
	test("preserves byte and request 429 reason discriminators over HTTP", async () => {
		const byteLimited = await callIngest({
			content: "ab",
			projectPath: "/test/rate-limit",
			sessionId: `byte-limit-${crypto.randomUUID()}`,
			source: "claude_code",
		});
		expect(byteLimited.status).toBe(429);
		expect(readRpcErrorData(byteLimited.body)).toEqual({
			current: 2,
			limit: 1,
			reason: INGEST_LIMIT_REASONS.byteLimit,
			windowSeconds: 3600,
		});

		const requestLimited = await callIngest({
			content: "",
			projectPath: "/test/rate-limit",
			sessionId: `request-limit-${crypto.randomUUID()}`,
			source: "claude_code",
		});
		expect(requestLimited.status).toBe(429);
		expect(readRpcErrorData(requestLimited.body)).toEqual({
			current: 2,
			limit: 1,
			reason: INGEST_LIMIT_REASONS.requestLimit,
			windowSeconds: 3600,
		});
	});
});

async function createCounterApiKey(label: string): Promise<string> {
	const id = `${TEST_KEY_PREFIX}-${label}`;
	await firstDatabase`
		INSERT INTO apikey (id, key, reference_id)
		VALUES (${id}, ${crypto.randomUUID()}, ${`user-${TEST_KEY_PREFIX}`})
	`;
	return id;
}

async function readCounter(apiKeyId: string) {
	const [row] = await firstDatabase<
		Array<{ byteCount: number; requestCount: number }>
	>`
		SELECT
			byte_count::int AS "byteCount",
			request_count::int AS "requestCount"
		FROM ingest_rate_limit_counter
		WHERE api_key_id = ${apiKeyId}
	`;
	assert(row);
	return row;
}

async function signUpTestUser(baseUrl: string): Promise<string> {
	const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `ingest-rate-limit-${crypto.randomUUID()}@example.com`,
			name: "Ingest Rate Limit Test",
			password: "ingest-rate-limit-test-password",
		}),
	});

	expect(response.ok).toBe(true);
	const body: unknown = await response.json();
	assert(isAuthResponse(body));
	return body.token;
}

async function createIngestApiKey(
	baseUrl: string,
	bearerToken: string,
): Promise<{ id: string; key: string }> {
	const response = await fetch(`${baseUrl}/api/auth/api-key/create`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			expiresIn: null,
			name: "ingest-rate-limit-integration",
		}),
	});

	expect(response.ok).toBe(true);
	const body: unknown = await response.json();
	assert(isApiKeyResponse(body));
	return body;
}

async function callIngest(input: IngestSessionInput) {
	const response = await fetch(`${server.baseUrl}/rpc/ingestSession`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey.key,
		},
		body: JSON.stringify({ json: input }),
	});

	return {
		body: await response.json(),
		status: response.status,
	};
}

function readRpcErrorData(value: unknown): {
	current: number;
	limit: number;
	reason: string;
	windowSeconds: number;
} {
	if (
		typeof value === "object" &&
		value !== null &&
		"json" in value &&
		typeof value.json === "object" &&
		value.json !== null &&
		"data" in value.json &&
		typeof value.json.data === "object" &&
		value.json.data !== null &&
		"current" in value.json.data &&
		typeof value.json.data.current === "number" &&
		"limit" in value.json.data &&
		typeof value.json.data.limit === "number" &&
		"reason" in value.json.data &&
		typeof value.json.data.reason === "string" &&
		"windowSeconds" in value.json.data &&
		typeof value.json.data.windowSeconds === "number"
	) {
		return {
			current: value.json.data.current,
			limit: value.json.data.limit,
			reason: value.json.data.reason,
			windowSeconds: value.json.data.windowSeconds,
		};
	}
	throw new Error("RPC response did not include ingest rate-limit data");
}

function isAuthResponse(value: unknown): value is { token: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"token" in value &&
		typeof value.token === "string"
	);
}

function isApiKeyResponse(
	value: unknown,
): value is { id: string; key: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"key" in value &&
		typeof value.key === "string"
	);
}
