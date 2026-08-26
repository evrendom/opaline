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
	createBackgroundIngestErrorFactories,
	processIngestSession,
} from "../router.js";
import {
	checkIngestRateLimit,
	createPostgresIngestRateLimitEnvironment,
	type IngestRateLimitConfig,
	type IngestRateLimitEnvironment,
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
	await firstDatabase`
		DELETE FROM "user"
		WHERE id LIKE ${`${TEST_KEY_PREFIX}%`}
	`;
	await Promise.all([
		server?.stop(),
		firstDatabase.end(),
		secondDatabase.end(),
	]);
});

describe("atomic Postgres ingest rate limiting", () => {
	test("serializes simultaneous first inserts from separate clients", async () => {
		const apiKeyId = await createCounterApiKey("concurrent-first-insert");
		const subject = { id: apiKeyId, kind: "api_key" } as const;

		await Promise.all([
			checkIngestRateLimit(subject, 4, DEFAULT_TEST_CONFIG, firstInstance),
			checkIngestRateLimit(subject, 6, DEFAULT_TEST_CONFIG, secondInstance),
		]);

		expect(await readCounter(apiKeyId)).toMatchObject({
			byteCount: 10,
			requestCount: 2,
		});
	});

	test("serializes simultaneous rollover of one expired row", async () => {
		const apiKeyId = await createCounterApiKey("concurrent-rollover");
		const subject = { id: apiKeyId, kind: "api_key" } as const;

		await checkIngestRateLimit(subject, 1, DEFAULT_TEST_CONFIG, firstInstance);
		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = NOW() - INTERVAL '2 hours',
				byte_window_started_at = NOW() - INTERVAL '2 hours'
			WHERE api_key_id = ${apiKeyId}
		`;

		await Promise.all([
			checkIngestRateLimit(subject, 3, DEFAULT_TEST_CONFIG, firstInstance),
			checkIngestRateLimit(subject, 4, DEFAULT_TEST_CONFIG, secondInstance),
		]);

		expect(await readCounter(apiKeyId)).toMatchObject({
			byteCount: 7,
			requestCount: 2,
		});
	});

	test("request rejection cannot re-anchor an expired byte window", async () => {
		const apiKeyId = await createCounterApiKey("mixed-window-regression");
		const subject = { id: apiKeyId, kind: "api_key" } as const;
		const config: IngestRateLimitConfig = {
			bytesMax: 100,
			bytesWindowSeconds: 150,
			requestsMax: 2,
			requestsWindowSeconds: 200,
		};

		await checkIngestRateLimit(subject, 100, config, freshEnvironment());
		await checkIngestRateLimit(subject, 0, config, freshEnvironment());
		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = CURRENT_TIMESTAMP - INTERVAL '151 seconds',
				byte_window_started_at = CURRENT_TIMESTAMP - INTERVAL '151 seconds'
			WHERE api_key_id = ${apiKeyId}
		`;
		const beforeRequestRejection = await readCounter(apiKeyId);

		await expect(
			checkIngestRateLimit(subject, 100, config, freshEnvironment()),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: { reason: INGEST_LIMIT_REASONS.requestLimit },
		});
		const afterRequestRejection = await readCounter(apiKeyId);
		expect(afterRequestRejection.byteWindowStartedAt.getTime()).toBe(
			beforeRequestRejection.byteWindowStartedAt.getTime(),
		);
		expect(afterRequestRejection).toMatchObject({
			byteCount: 100,
			requestCount: 2,
		});

		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = CURRENT_TIMESTAMP - INTERVAL '200 seconds',
				byte_window_started_at = CURRENT_TIMESTAMP - INTERVAL '200 seconds'
			WHERE api_key_id = ${apiKeyId}
		`;
		await checkIngestRateLimit(subject, 100, config, freshEnvironment());

		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = CURRENT_TIMESTAMP - INTERVAL '101 seconds',
				byte_window_started_at = CURRENT_TIMESTAMP - INTERVAL '101 seconds'
			WHERE api_key_id = ${apiKeyId}
		`;
		await expect(
			checkIngestRateLimit(subject, 100, config, freshEnvironment()),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 200,
				limit: 100,
				reason: INGEST_LIMIT_REASONS.byteLimit,
				windowSeconds: 150,
			},
		});
		expect(await readCounter(apiKeyId)).toMatchObject({
			byteCount: 100,
			requestCount: 2,
		});
	});

	test("accepts the exact request and byte caps before rejecting the excess", async () => {
		const requestKeyId = await createCounterApiKey("exact-request-cap");
		const requestSubject = { id: requestKeyId, kind: "api_key" } as const;
		const requestConfig = {
			...DEFAULT_TEST_CONFIG,
			requestsMax: 3,
		};
		for (let attempt = 0; attempt < requestConfig.requestsMax; attempt += 1) {
			await checkIngestRateLimit(
				requestSubject,
				0,
				requestConfig,
				firstInstance,
			);
		}
		await expect(
			checkIngestRateLimit(requestSubject, 0, requestConfig, firstInstance),
		).rejects.toMatchObject({
			data: {
				current: 4,
				limit: 3,
				reason: INGEST_LIMIT_REASONS.requestLimit,
			},
		});

		const byteKeyId = await createCounterApiKey("exact-byte-cap");
		const byteSubject = { id: byteKeyId, kind: "api_key" } as const;
		const byteConfig = { ...DEFAULT_TEST_CONFIG, bytesMax: 10 };
		await checkIngestRateLimit(byteSubject, 4, byteConfig, firstInstance);
		await checkIngestRateLimit(byteSubject, 6, byteConfig, firstInstance);
		await expect(
			checkIngestRateLimit(byteSubject, 1, byteConfig, firstInstance),
		).rejects.toMatchObject({
			data: {
				current: 11,
				limit: 10,
				reason: INGEST_LIMIT_REASONS.byteLimit,
			},
		});
		expect(await readCounter(byteKeyId)).toMatchObject({
			byteCount: 10,
			requestCount: 3,
		});
	});

	test("expires both counters at the exact fixed-window boundary", async () => {
		const apiKeyId = await createCounterApiKey("exact-boundary");
		const subject = { id: apiKeyId, kind: "api_key" } as const;
		const config: IngestRateLimitConfig = {
			bytesMax: 10,
			bytesWindowSeconds: 60,
			requestsMax: 1,
			requestsWindowSeconds: 60,
		};
		await checkIngestRateLimit(subject, 10, config, freshEnvironment());

		await firstDatabase.begin(async (transaction) => {
			await transaction.unsafe(
				`UPDATE ingest_rate_limit_counter
				SET
					request_window_started_at = CURRENT_TIMESTAMP - INTERVAL '60 seconds',
					byte_window_started_at = CURRENT_TIMESTAMP - INTERVAL '60 seconds'
				WHERE api_key_id = $1`,
				[apiKeyId],
			);
			const transactionEnvironment: IngestRateLimitEnvironment = {
				execute: (statement, parameters) =>
					transaction.unsafe(statement, [...parameters]),
			};
			await checkIngestRateLimit(subject, 3, config, transactionEnvironment);
		});

		expect(await readCounter(apiKeyId)).toMatchObject({
			byteCount: 3,
			requestCount: 1,
		});
	});

	test("deleting an API key cascades its counter row", async () => {
		const apiKeyId = await createCounterApiKey("cascade");
		await checkIngestRateLimit(
			{ id: apiKeyId, kind: "api_key" },
			1,
			DEFAULT_TEST_CONFIG,
			firstInstance,
		);
		expect(await countCounters("api_key_id", apiKeyId)).toBe(1);

		await firstDatabase`DELETE FROM apikey WHERE id = ${apiKeyId}`;

		expect(await countCounters("api_key_id", apiKeyId)).toBe(0);
	});

	test("enforces one unique counter for each legacy user subject", async () => {
		const userId = await createLegacyCounterUser("legacy-unique");
		const subject = { id: userId, kind: "legacy_user" } as const;
		await checkIngestRateLimit(subject, 1, DEFAULT_TEST_CONFIG, firstInstance);
		await checkIngestRateLimit(subject, 1, DEFAULT_TEST_CONFIG, secondInstance);
		expect(await countCounters("user_id", userId)).toBe(1);

		await expect(firstDatabase`
			INSERT INTO ingest_rate_limit_counter (
				limiter_key,
				user_id,
				request_window_started_at,
				request_count,
				byte_window_started_at,
				byte_count,
				last_request_allowed,
				last_byte_allowed
			)
			VALUES (
				${`legacy_user_duplicate:${userId}`},
				${userId},
				CURRENT_TIMESTAMP,
				0,
				CURRENT_TIMESTAMP,
				0,
				true,
				true
			)
		`).rejects.toThrow();
	});

	test("charges an oversized direct ingest request without touching byte count", async () => {
		const apiKeyId = await createCounterApiKey("oversized-request-charge");
		await checkIngestRateLimit(
			{ id: apiKeyId, kind: "api_key" },
			1,
			DEFAULT_TEST_CONFIG,
			freshEnvironment(),
		);
		const beforeOversizedAttempt = await readCounter(apiKeyId);
		await expect(
			processIngestSession({
				aggregateContentMaxBytes: 1,
				awaitLanguageSignals: false,
				context: {
					apiKeyId,
					session: null,
					user: { id: `user-${TEST_KEY_PREFIX}` },
				},
				enforceRateLimits: true,
				errorFactories: createBackgroundIngestErrorFactories(),
				input: {
					content: "ab",
					projectPath: "/test/rate-limit",
					sessionId: `oversized-${crypto.randomUUID()}`,
					source: "claude_code",
				},
			}),
		).rejects.toMatchObject({
			code: "PAYLOAD_TOO_LARGE",
			data: {
				actualBytes: 2,
				maxBytes: 1,
				reason: INGEST_LIMIT_REASONS.transcriptTooLarge,
			},
		});
		const afterOversizedAttempt = await readCounter(apiKeyId);
		expect(afterOversizedAttempt).toMatchObject({
			byteCount: 1,
			requestCount: 2,
		});
		expect(afterOversizedAttempt.byteWindowStartedAt.getTime()).toBe(
			beforeOversizedAttempt.byteWindowStartedAt.getTime(),
		);
	});

	test("short-circuits repeated request rejection without another statement", async () => {
		const apiKeyId = await createCounterApiKey("negative-cache");
		const subject = { id: apiKeyId, kind: "api_key" } as const;
		const config = {
			...DEFAULT_TEST_CONFIG,
			requestsMax: 1,
			requestsWindowSeconds: 60,
		};
		const statementCounter = { count: 0 };
		const countingEnvironment: IngestRateLimitEnvironment = {
			execute(statement, parameters) {
				statementCounter.count += 1;
				return firstInstance.execute(statement, parameters);
			},
		};
		const expectedRejection = {
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 2,
				limit: 1,
				reason: INGEST_LIMIT_REASONS.requestLimit,
				windowSeconds: 60,
			},
		};

		await checkIngestRateLimit(subject, 0, config, countingEnvironment);
		await expect(
			checkIngestRateLimit(subject, 0, config, countingEnvironment),
		).rejects.toMatchObject(expectedRejection);
		expect(statementCounter.count).toBe(2);

		await expect(
			checkIngestRateLimit(subject, 0, config, countingEnvironment),
		).rejects.toMatchObject(expectedRejection);
		expect(statementCounter.count).toBe(2);
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

	test("fails closed with the SERVICE_UNAVAILABLE shape over HTTP", async () => {
		const unavailableServer = await startApiTestServer(
			{},
			"apps/api/src/__tests__/fixtures/unavailable-ingest-rate-limit-server.ts",
		);
		const unavailable = await callIngest(
			{
				content: "a",
				projectPath: "/test/rate-limit",
				sessionId: `database-unavailable-${crypto.randomUUID()}`,
				source: "claude_code",
			},
			unavailableServer.baseUrl,
		);

		expect(unavailable.status).toBe(503);
		expect(readRpcError(unavailable.body)).toEqual({
			code: "SERVICE_UNAVAILABLE",
			reason: "ingest_rate_limit_unavailable",
			retryAfterMs: 1_000,
		});
		await unavailableServer.stop();
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

async function createLegacyCounterUser(label: string): Promise<string> {
	const id = `${TEST_KEY_PREFIX}-${label}`;
	await firstDatabase`
		INSERT INTO "user" (id, name, email)
		VALUES (
			${id},
			${`Ingest rate-limit ${label}`},
			${`${id}@example.com`}
		)
	`;
	return id;
}

function freshEnvironment(): IngestRateLimitEnvironment {
	return createPostgresIngestRateLimitEnvironment(firstDatabase);
}

async function readCounter(apiKeyId: string) {
	const [row] = await firstDatabase<
		Array<{
			byteCount: number;
			byteWindowStartedAt: Date;
			requestCount: number;
			requestWindowStartedAt: Date;
		}>
	>`
		SELECT
			byte_count::int AS "byteCount",
			byte_window_started_at AS "byteWindowStartedAt",
			request_count::int AS "requestCount",
			request_window_started_at AS "requestWindowStartedAt"
		FROM ingest_rate_limit_counter
		WHERE api_key_id = ${apiKeyId}
	`;
	assert(row);
	return row;
}

async function countCounters(
	subjectColumn: "api_key_id" | "user_id",
	subjectId: string,
): Promise<number> {
	const rows =
		subjectColumn === "api_key_id"
			? await firstDatabase<Array<{ count: number }>>`
				SELECT COUNT(*)::int AS count
				FROM ingest_rate_limit_counter
				WHERE api_key_id = ${subjectId}
			`
			: await firstDatabase<Array<{ count: number }>>`
				SELECT COUNT(*)::int AS count
				FROM ingest_rate_limit_counter
				WHERE user_id = ${subjectId}
			`;
	return rows[0]?.count ?? 0;
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

async function callIngest(input: IngestSessionInput, baseUrl = server.baseUrl) {
	const response = await fetch(`${baseUrl}/rpc/ingestSession`, {
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

function readRpcError(value: unknown): {
	code: string;
	reason: string | undefined;
	retryAfterMs: number | undefined;
} {
	if (
		typeof value === "object" &&
		value !== null &&
		"json" in value &&
		typeof value.json === "object" &&
		value.json !== null &&
		"code" in value.json &&
		typeof value.json.code === "string"
	) {
		const data =
			"data" in value.json &&
			typeof value.json.data === "object" &&
			value.json.data !== null
				? value.json.data
				: null;
		return {
			code: value.json.code,
			reason:
				data && "reason" in data && typeof data.reason === "string"
					? data.reason
					: undefined,
			retryAfterMs:
				data && "retryAfterMs" in data && typeof data.retryAfterMs === "number"
					? data.retryAfterMs
					: undefined,
		};
	}
	throw new Error("RPC response did not include an error envelope");
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
