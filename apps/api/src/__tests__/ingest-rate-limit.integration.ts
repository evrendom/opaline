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
let sameUserApiKey: { id: string; key: string };
let otherUserApiKey: { id: string; key: string };
let primaryUserId: string;
let otherUserId: string;
// Fail fast instead of wedging the single-connection pools: a stuck lock or
// statement must surface as a diagnosable error, not strand afterAll behind a
// busy connection until the CI job timeout kills the run silently.
const FAIL_FAST_OPTIONS = {
	connect_timeout: 10,
	connection: {
		lock_timeout: 10_000,
		statement_timeout: 20_000,
	},
	max: 1,
	prepare: false,
} as const;
const firstDatabase = postgres(connectionString, FAIL_FAST_OPTIONS);
const secondDatabase = postgres(connectionString, FAIL_FAST_OPTIONS);
const firstInstance = createPostgresIngestRateLimitEnvironment(firstDatabase);
const secondInstance = createPostgresIngestRateLimitEnvironment(secondDatabase);

beforeAll(async () => {
	server = await startApiTestServer({
		RATE_LIMIT_INGEST_BYTES_MAX: "1",
		RATE_LIMIT_INGEST_REQUESTS_MAX: "1",
	});
	const primaryToken = await signUpTestUser(server.baseUrl);
	apiKey = await createIngestApiKey(server.baseUrl, primaryToken);
	sameUserApiKey = await createIngestApiKey(server.baseUrl, primaryToken);
	primaryUserId = await readApiKeyOwner(apiKey.id);
	const otherToken = await signUpTestUser(server.baseUrl);
	otherUserApiKey = await createIngestApiKey(server.baseUrl, otherToken);
	otherUserId = await readApiKeyOwner(otherUserApiKey.id);
});

afterAll(async () => {
	const cleanupClient = postgres(connectionString, FAIL_FAST_OPTIONS);
	try {
		await cleanupClient`
			DELETE FROM apikey
			WHERE id LIKE ${`${TEST_KEY_PREFIX}%`}
				OR id = ${apiKey?.id ?? ""}
				OR id = ${sameUserApiKey?.id ?? ""}
				OR id = ${otherUserApiKey?.id ?? ""}
		`;
		await cleanupClient`
			DELETE FROM "user"
			WHERE id LIKE ${`${TEST_KEY_PREFIX}%`}
				OR id = ${primaryUserId ?? ""}
				OR id = ${otherUserId ?? ""}
		`;
	} finally {
		await Promise.allSettled([
			server?.stop(),
			cleanupClient.end({ timeout: 5 }),
			firstDatabase.end({ timeout: 5 }),
			secondDatabase.end({ timeout: 5 }),
		]);
	}
});

describe("atomic Postgres ingest rate limiting", () => {
	test("serializes simultaneous first inserts from separate clients", async () => {
		const userId = await createCounterUser("concurrent-first-insert");
		const subject = { id: userId, kind: "user" } as const;

		await Promise.all([
			checkIngestRateLimit(subject, 4, DEFAULT_TEST_CONFIG, firstInstance),
			checkIngestRateLimit(subject, 6, DEFAULT_TEST_CONFIG, secondInstance),
		]);

		expect(await readCounter(userId)).toMatchObject({
			byteCount: 10,
			requestCount: 2,
		});
	});

	test("serializes simultaneous rollover of one expired row", async () => {
		const userId = await createCounterUser("concurrent-rollover");
		const subject = { id: userId, kind: "user" } as const;

		await checkIngestRateLimit(subject, 1, DEFAULT_TEST_CONFIG, firstInstance);
		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = NOW() - INTERVAL '2 hours',
				byte_window_started_at = NOW() - INTERVAL '2 hours'
			WHERE user_id = ${userId}
		`;

		await Promise.all([
			checkIngestRateLimit(subject, 3, DEFAULT_TEST_CONFIG, firstInstance),
			checkIngestRateLimit(subject, 4, DEFAULT_TEST_CONFIG, secondInstance),
		]);

		expect(await readCounter(userId)).toMatchObject({
			byteCount: 7,
			requestCount: 2,
		});
	});

	test("request rejection cannot re-anchor an expired byte window", async () => {
		const userId = await createCounterUser("mixed-window-regression");
		const subject = { id: userId, kind: "user" } as const;
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
			WHERE user_id = ${userId}
		`;
		const beforeRequestRejection = await readCounter(userId);

		await expect(
			checkIngestRateLimit(subject, 100, config, freshEnvironment()),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: { reason: INGEST_LIMIT_REASONS.requestLimit },
		});
		const afterRequestRejection = await readCounter(userId);
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
			WHERE user_id = ${userId}
		`;
		await checkIngestRateLimit(subject, 100, config, freshEnvironment());

		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET
				request_window_started_at = CURRENT_TIMESTAMP - INTERVAL '101 seconds',
				byte_window_started_at = CURRENT_TIMESTAMP - INTERVAL '101 seconds'
			WHERE user_id = ${userId}
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
		expect(await readCounter(userId)).toMatchObject({
			byteCount: 100,
			requestCount: 2,
		});
	});

	test("accepts the exact request and byte caps before rejecting the excess", async () => {
		const requestUserId = await createCounterUser("exact-request-cap");
		const requestSubject = { id: requestUserId, kind: "user" } as const;
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

		const byteUserId = await createCounterUser("exact-byte-cap");
		const byteSubject = { id: byteUserId, kind: "user" } as const;
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
		expect(await readCounter(byteUserId)).toMatchObject({
			byteCount: 10,
			requestCount: 3,
		});
	});

	test("expires both counters at the exact fixed-window boundary", async () => {
		const userId = await createCounterUser("exact-boundary");
		const subject = { id: userId, kind: "user" } as const;
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
				WHERE user_id = $1`,
				[userId],
			);
			const transactionEnvironment: IngestRateLimitEnvironment = {
				execute: (statement, parameters) =>
					transaction.unsafe(statement, [...parameters]),
			};
			await checkIngestRateLimit(subject, 3, config, transactionEnvironment);
		});

		expect(await readCounter(userId)).toMatchObject({
			byteCount: 3,
			requestCount: 1,
		});
	});

	test("deleting a user cascades its authoritative counter row", async () => {
		const userId = await createCounterUser("cascade");
		await checkIngestRateLimit(
			{ id: userId, kind: "user" },
			1,
			DEFAULT_TEST_CONFIG,
			firstInstance,
		);
		expect(await countUserCounters(userId)).toBe(1);

		await firstDatabase`DELETE FROM "user" WHERE id = ${userId}`;

		expect(await countUserCounters(userId)).toBe(0);
	});

	test("enforces one unique counter for each user subject", async () => {
		const userId = await createCounterUser("user-unique");
		const subject = { id: userId, kind: "user" } as const;
		await checkIngestRateLimit(subject, 1, DEFAULT_TEST_CONFIG, firstInstance);
		await checkIngestRateLimit(subject, 1, DEFAULT_TEST_CONFIG, secondInstance);
		expect(await countUserCounters(userId)).toBe(1);

		const duplicateClient = postgres(connectionString, FAIL_FAST_OPTIONS);
		try {
			await expect(duplicateClient`
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
				${`user_duplicate:${userId}`},
				${userId},
				CURRENT_TIMESTAMP,
				0,
				CURRENT_TIMESTAMP,
				0,
				true,
				true
			)
		`).rejects.toThrow(/duplicate key|unique/i);
		} finally {
			await duplicateClient.end();
		}
	});

	test("fresh oversized request leaves no byte anchor before the first positive charge", async () => {
		const userId = await createCounterUser("fresh-oversized-request");
		const apiKeyId = await createCounterApiKey(
			userId,
			"fresh-oversized-request",
		);
		await expect(
			processIngestSession({
				aggregateContentMaxBytes: 1,
				awaitLanguageSignals: false,
				context: {
					apiKeyId,
					session: null,
					user: { id: userId },
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
		const afterOversizedAttempt = await readCounter(userId);
		expect(afterOversizedAttempt).toMatchObject({
			byteCount: 0,
			requestCount: 1,
		});

		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET byte_window_started_at = CURRENT_TIMESTAMP - INTERVAL '58 seconds'
			WHERE user_id = ${userId}
		`;
		const zeroCountState = await readCounter(userId);
		const config: IngestRateLimitConfig = {
			bytesMax: 10,
			bytesWindowSeconds: 60,
			requestsMax: 10,
			requestsWindowSeconds: 60,
		};
		const subject = { id: userId, kind: "user" } as const;
		await checkIngestRateLimit(subject, 10, config, freshEnvironment());
		const firstPositiveCharge = await readCounter(userId);
		expect(firstPositiveCharge.byteWindowStartedAt.getTime()).toBeGreaterThan(
			zeroCountState.byteWindowStartedAt.getTime(),
		);
		expect(firstPositiveCharge).toMatchObject({
			byteCount: 10,
			requestCount: 2,
		});

		// Simulate the two-second epsilon around the old boundary. A preserved
		// zero-count anchor would expire; the first positive charge's anchor does not.
		await firstDatabase`
			UPDATE ingest_rate_limit_counter
			SET byte_window_started_at = byte_window_started_at - INTERVAL '2 seconds'
			WHERE user_id = ${userId}
		`;
		await expect(
			checkIngestRateLimit(subject, 10, config, freshEnvironment()),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 20,
				limit: 10,
				reason: INGEST_LIMIT_REASONS.byteLimit,
				windowSeconds: 60,
			},
		});
		expect(await readCounter(userId)).toMatchObject({
			byteCount: 10,
			requestCount: 3,
		});
	});

	test("short-circuits repeated request rejection without another statement", async () => {
		const userId = await createCounterUser("negative-cache");
		const subject = { id: userId, kind: "user" } as const;
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

	test("sends a smaller byte attempt after a rejection to Postgres", async () => {
		const userId = await createCounterUser("byte-cache-smaller-attempt");
		const subject = { id: userId, kind: "user" } as const;
		const config = {
			...DEFAULT_TEST_CONFIG,
			bytesMax: 10,
			bytesWindowSeconds: 60,
			requestsWindowSeconds: 60,
		};
		const statementCounter = { count: 0 };
		const environment = countingEnvironment(statementCounter);

		await checkIngestRateLimit(subject, 6, config, environment);
		await expect(
			checkIngestRateLimit(subject, 5, config, environment),
		).rejects.toMatchObject({
			data: { current: 11, reason: INGEST_LIMIT_REASONS.byteLimit },
		});
		expect(statementCounter.count).toBe(2);

		await checkIngestRateLimit(subject, 3, config, environment);
		expect(statementCounter.count).toBe(3);
		expect(await readCounter(userId)).toMatchObject({
			byteCount: 9,
			requestCount: 3,
		});
	});

	test("charges the request for a known-too-large byte retry", async () => {
		const userId = await createCounterUser("byte-cache-request-charge");
		const subject = { id: userId, kind: "user" } as const;
		const config = {
			...DEFAULT_TEST_CONFIG,
			bytesMax: 10,
			bytesWindowSeconds: 60,
			requestsWindowSeconds: 60,
		};
		const statementCounter = { count: 0 };
		const environment = countingEnvironment(statementCounter);

		await checkIngestRateLimit(subject, 6, config, environment);
		await expect(
			checkIngestRateLimit(subject, 5, config, environment),
		).rejects.toMatchObject({
			data: { current: 11, reason: INGEST_LIMIT_REASONS.byteLimit },
		});
		await expect(
			checkIngestRateLimit(subject, 5, config, environment),
		).rejects.toMatchObject({
			data: { current: 11, reason: INGEST_LIMIT_REASONS.byteLimit },
		});

		expect(statementCounter.count).toBe(3);
		expect(await readCounter(userId)).toMatchObject({
			byteCount: 6,
			requestCount: 3,
		});
	});

	test("sheds repeat rejections once the request cache is armed", async () => {
		const userId = await createCounterUser("byte-and-request-cache");
		const subject = { id: userId, kind: "user" } as const;
		const config = {
			...DEFAULT_TEST_CONFIG,
			bytesMax: 10,
			bytesWindowSeconds: 60,
			requestsMax: 3,
			requestsWindowSeconds: 60,
		};
		const statementCounter = { count: 0 };
		const environment = countingEnvironment(statementCounter);
		const byteRejection = {
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 11,
				limit: 10,
				reason: INGEST_LIMIT_REASONS.byteLimit,
				windowSeconds: 60,
			},
		};

		await checkIngestRateLimit(subject, 6, config, environment);
		await expect(
			checkIngestRateLimit(subject, 5, config, environment),
		).rejects.toMatchObject(byteRejection);
		await expect(
			checkIngestRateLimit(subject, 5, config, environment),
		).rejects.toMatchObject(byteRejection);
		await expect(
			checkIngestRateLimit(subject, 5, config, environment),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 4,
				limit: 3,
				reason: INGEST_LIMIT_REASONS.requestLimit,
				windowSeconds: 60,
			},
		});
		expect(statementCounter.count).toBe(4);

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await expect(
				checkIngestRateLimit(subject, 5, config, environment),
			).rejects.toMatchObject({
				data: {
					current: 4,
					reason: INGEST_LIMIT_REASONS.requestLimit,
				},
			});
		}
		expect(statementCounter.count).toBe(4);
		expect(await readCounter(userId)).toMatchObject({
			byteCount: 6,
			requestCount: 3,
		});
	});
});

describe("ingest rate-limit oRPC errors", () => {
	test("shares one user's keys while keeping different users isolated", async () => {
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

		const requestLimited = await callIngest(
			{
				content: "",
				projectPath: "/test/rate-limit",
				sessionId: `request-limit-${crypto.randomUUID()}`,
				source: "claude_code",
			},
			sameUserApiKey.key,
		);
		expect(requestLimited.status).toBe(429);
		expect(readRpcErrorData(requestLimited.body)).toEqual({
			current: 2,
			limit: 1,
			reason: INGEST_LIMIT_REASONS.requestLimit,
			windowSeconds: 3600,
		});

		const isolatedUser = await callIngest(
			{
				content: "ab",
				projectPath: "/test/rate-limit",
				sessionId: `isolated-user-${crypto.randomUUID()}`,
				source: "claude_code",
			},
			otherUserApiKey.key,
		);
		expect(isolatedUser.status).toBe(429);
		expect(readRpcErrorData(isolatedUser.body)).toEqual({
			current: 2,
			limit: 1,
			reason: INGEST_LIMIT_REASONS.byteLimit,
			windowSeconds: 3600,
		});
	});

	test("fails closed with the SERVICE_UNAVAILABLE shape over HTTP", async () => {
		const unavailableServer = await startApiTestServer(
			{},
			"apps/api/src/__tests__/fixtures/unavailable-ingest-rate-limit-server.ts",
		);
		try {
			const unavailable = await callIngest(
				{
					content: "a",
					projectPath: "/test/rate-limit",
					sessionId: `database-unavailable-${crypto.randomUUID()}`,
					source: "claude_code",
				},
				apiKey.key,
				unavailableServer.baseUrl,
			);

			expect(unavailable.status).toBe(503);
			expect(readRpcError(unavailable.body)).toEqual({
				code: "SERVICE_UNAVAILABLE",
				reason: "ingest_rate_limit_unavailable",
				retryAfterMs: 1_000,
			});
		} finally {
			await unavailableServer.stop();
		}
	});
});

async function createCounterApiKey(
	userId: string,
	label: string,
): Promise<string> {
	const id = `${TEST_KEY_PREFIX}-key-${label}`;
	await firstDatabase`
		INSERT INTO apikey (id, key, reference_id)
		VALUES (${id}, ${crypto.randomUUID()}, ${userId})
	`;
	return id;
}

async function createCounterUser(label: string): Promise<string> {
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

function countingEnvironment(statementCounter: {
	count: number;
}): IngestRateLimitEnvironment {
	return {
		execute(statement, parameters) {
			statementCounter.count += 1;
			return firstInstance.execute(statement, parameters);
		},
	};
}

async function readCounter(userId: string) {
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
		WHERE user_id = ${userId}
	`;
	assert(row);
	return row;
}

async function countUserCounters(userId: string): Promise<number> {
	const rows = await firstDatabase<Array<{ count: number }>>`
		SELECT COUNT(*)::int AS count
		FROM ingest_rate_limit_counter
		WHERE user_id = ${userId}
	`;
	return rows[0]?.count ?? 0;
}

async function readApiKeyOwner(apiKeyId: string): Promise<string> {
	const [row] = await firstDatabase<Array<{ userId: string }>>`
		SELECT reference_id AS "userId"
		FROM apikey
		WHERE id = ${apiKeyId}
	`;
	assert(row);
	return row.userId;
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

async function callIngest(
	input: IngestSessionInput,
	apiKeyValue = apiKey.key,
	baseUrl = server.baseUrl,
) {
	const response = await fetch(`${baseUrl}/rpc/ingestSession`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKeyValue,
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
