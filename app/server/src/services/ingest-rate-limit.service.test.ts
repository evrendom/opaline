import { describe, expect, mock, test } from "bun:test";
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
	test("returns the existing request-limit 429 discriminator", async () => {
		const execute = mock(() =>
			Promise.resolve([
				{
					byteAllowed: false,
					byteCount: "80",
					byteResetAfterSeconds: 120,
					requestAllowed: false,
					requestCount: "2",
					requestResetAfterSeconds: 60,
				},
			]),
		);

		await expect(
			checkIngestRateLimit({ id: "user-2", kind: "user" }, 20, TEST_CONFIG, {
				execute,
			}),
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
					byteResetAfterSeconds: 120,
					requestAllowed: true,
					requestCount: "2",
					requestResetAfterSeconds: 60,
				},
			]),
		);

		await expect(
			checkIngestRateLimit({ id: "user-3", kind: "user" }, 20, TEST_CONFIG, {
				execute,
			}),
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
			checkIngestRateLimit({ id: "user-4", kind: "user" }, 1, TEST_CONFIG, {
				execute,
			}),
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
			checkIngestRateLimit({ id: "user-5", kind: "user" }, 1, TEST_CONFIG, {
				execute,
			}),
		).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			data: { reason: "ingest_rate_limit_unavailable" },
		});
	});

	test("uses the owning user as the authoritative limiter subject", () => {
		expect(resolveIngestRateLimitSubject("user-1")).toEqual({
			id: "user-1",
			kind: "user",
		});
	});
});
