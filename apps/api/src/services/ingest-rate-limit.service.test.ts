import { describe, expect, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { INGEST_LIMIT_REASONS } from "@rudel/api-routes";
import {
	checkIngestRateLimit,
	type IngestRateLimitConfig,
	resolveIngestRateLimitSubject,
} from "./ingest-rate-limit.service.js";

const TEST_CONFIG: IngestRateLimitConfig = {
	bytesMax: 100,
	bytesWindowSeconds: 120,
	requestsMax: 2,
	requestsWindowSeconds: 60,
};

describe("Postgres ingest rate-limit service", () => {
	test("executes one atomic upsert with both fixed-window limits", async () => {
		const execute = mock(
			(_statement: string, _parameters: readonly (number | string | null)[]) =>
				Promise.resolve([
					{
						byteAllowed: true,
						byteCount: "40",
						requestAllowed: true,
						requestCount: "1",
					},
				]),
		);

		await checkIngestRateLimit(
			{ id: "api-key-1", kind: "api_key" },
			40,
			TEST_CONFIG,
			{ execute },
		);

		expect(execute).toHaveBeenCalledTimes(1);
		const call = execute.mock.calls[0];
		assert(call);
		const [statement, parameters] = call;
		expect(statement).toContain("INSERT INTO ingest_rate_limit_counter");
		expect(statement).toContain("ON CONFLICT (limiter_key) DO UPDATE");
		expect(statement).toContain("request_window_started_at");
		expect(statement).toContain("byte_window_started_at");
		expect(statement).toContain("RETURNING");
		expect(parameters).toEqual([
			"api_key:api-key-1",
			"api-key-1",
			null,
			40,
			2,
			100,
			60,
			120,
		]);
	});

	test("returns the existing request-limit 429 discriminator", async () => {
		const execute = mock(() =>
			Promise.resolve([
				{
					byteAllowed: false,
					byteCount: "80",
					requestAllowed: false,
					requestCount: "2",
				},
			]),
		);

		await expect(
			checkIngestRateLimit(
				{ id: "api-key-2", kind: "api_key" },
				20,
				TEST_CONFIG,
				{ execute },
			),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 3,
				limit: 2,
				reason: INGEST_LIMIT_REASONS.requestLimit,
				windowSeconds: 60,
			},
		});
	});

	test("returns the existing byte-limit 429 discriminator", async () => {
		const execute = mock(() =>
			Promise.resolve([
				{
					byteAllowed: false,
					byteCount: "90",
					requestAllowed: true,
					requestCount: "2",
				},
			]),
		);

		await expect(
			checkIngestRateLimit(
				{ id: "api-key-3", kind: "api_key" },
				20,
				TEST_CONFIG,
				{ execute },
			),
		).rejects.toMatchObject({
			code: "TOO_MANY_REQUESTS",
			data: {
				current: 110,
				limit: 100,
				reason: INGEST_LIMIT_REASONS.byteLimit,
				windowSeconds: 120,
			},
		});
	});

	test("fails closed when Postgres throws", async () => {
		const execute = mock(() => Promise.reject(new Error("database offline")));

		await expect(
			checkIngestRateLimit(
				{ id: "api-key-4", kind: "api_key" },
				1,
				TEST_CONFIG,
				{ execute },
			),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			data: {
				reason: "ingest_rate_limit_unavailable",
				retryAfterMs: 1_000,
			},
		});
	});

	test("fails closed when Postgres returns an invalid decision", async () => {
		const execute = mock(() => Promise.resolve([]));

		await expect(
			checkIngestRateLimit(
				{ id: "api-key-5", kind: "api_key" },
				1,
				TEST_CONFIG,
				{ execute },
			),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			data: { reason: "ingest_rate_limit_unavailable" },
		});
	});

	test("uses a separate durable bucket for legacy bearer users", () => {
		expect(resolveIngestRateLimitSubject("api-key-6", "user-1")).toEqual({
			id: "api-key-6",
			kind: "api_key",
		});
		expect(resolveIngestRateLimitSubject(null, "user-1")).toEqual({
			id: "user-1",
			kind: "legacy_user",
		});
	});
});
