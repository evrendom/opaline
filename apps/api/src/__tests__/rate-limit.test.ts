import { afterEach, describe, expect, test } from "bun:test";
import { IngestSessionInputSchema } from "@rudel/api-routes";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";
import {
	checkAnalyticsRateLimit,
	checkHookIngestRateLimit,
	checkManualIngestRateLimit,
	checkOrganizationSessionCountRateLimit,
	checkWrappedShareLookupRateLimit,
	getWrappedShareLookupRateLimitMetrics,
	WRAPPED_SHARE_LOOKUP_CAPACITY,
	WRAPPED_SHARE_LOOKUP_MAX_REQUESTS,
	WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS,
	WRAPPED_SHARE_LOOKUP_WINDOW_MS,
} from "../rate-limit.js";

describe("IngestSessionInputSchema metadata field limits", () => {
	const validBase = {
		source: "claude_code" as const,
		sessionId: "abc-123",
		projectPath: "/home/user/project",
		content: '{"type":"user","timestamp":"2026-01-01T00:00:00Z"}',
	};

	test("accepts metadata fields within 200 char limit", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			sessionId: "a".repeat(200),
			projectPath: "b".repeat(200),
			gitRemote: "c".repeat(200),
			gitBranch: "d".repeat(200),
			gitSha: "e".repeat(200),
			packageName: "f".repeat(200),
			packageType: "g".repeat(200),
			organizationId: "h".repeat(200),
		});
		expect(result.success).toBe(true);
	});

	test("rejects sessionId over 200 chars", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			sessionId: "a".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	test("rejects projectPath over 200 chars", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			projectPath: "a".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	test("rejects gitRemote over 200 chars", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			gitRemote: "a".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	test("rejects gitBranch over 200 chars", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			gitBranch: "a".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	test("rejects organizationId over 200 chars", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			organizationId: "a".repeat(201),
		});
		expect(result.success).toBe(false);
	});

	test("rejects more than 512 subagents", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			subagents: Array.from({ length: 513 }, (_, index) => ({
				agentId: `agent-${index}`,
				content: "content",
			})),
		});
		expect(result.success).toBe(false);
	});

	test("rejects subagent agentId over 200 chars", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			subagents: [{ agentId: "a".repeat(201), content: "content" }],
		});
		expect(result.success).toBe(false);
	});

	test("rejects duplicate subagent agentId values", () => {
		const result = IngestSessionInputSchema.safeParse({
			...validBase,
			subagents: [
				{ agentId: "agent-1", content: "first" },
				{ agentId: "agent-1", content: "second" },
			],
		});
		expect(result.success).toBe(false);
	});
});

describe("readPositiveSafeIntegerEnv", () => {
	afterEach(() => {
		delete process.env.TEST_LIMIT;
	});

	test("uses the default when the variable is absent", () => {
		delete process.env.TEST_LIMIT;
		expect(readPositiveSafeIntegerEnv("TEST_LIMIT", 42)).toBe(42);
	});

	test("accepts a positive safe integer", () => {
		process.env.TEST_LIMIT = "123";
		expect(readPositiveSafeIntegerEnv("TEST_LIMIT", 42)).toBe(123);
	});

	test("fails closed for invalid values", () => {
		for (const invalidValue of [
			"",
			"0",
			"-1",
			"1.5",
			"abc",
			"Infinity",
			"9007199254740992",
		]) {
			process.env.TEST_LIMIT = invalidValue;
			expect(() => readPositiveSafeIntegerEnv("TEST_LIMIT", 42)).toThrow(
				"TEST_LIMIT must be a positive safe integer",
			);
		}
	});
});

describe("checkAnalyticsRateLimit", () => {
	test("allows requests under the limit", () => {
		const userId = `test-under-${Date.now()}`;
		expect(() => checkAnalyticsRateLimit(userId)).not.toThrow();
	});

	test("throws after exceeding the limit", () => {
		const userId = `test-over-${Date.now()}`;
		// Default is 90 requests per 60 seconds
		for (let i = 0; i < 90; i++) {
			checkAnalyticsRateLimit(userId);
		}
		expect(() => checkAnalyticsRateLimit(userId)).toThrow(
			"Rate limit exceeded",
		);
	});

	test("different users have independent limits", () => {
		const userA = `test-a-${Date.now()}`;
		const userB = `test-b-${Date.now()}`;
		for (let i = 0; i < 90; i++) {
			checkAnalyticsRateLimit(userA);
		}
		// userA is exhausted, userB should still work
		expect(() => checkAnalyticsRateLimit(userB)).not.toThrow();
	});
});

describe("checkOrganizationSessionCountRateLimit", () => {
	test("allows five one-second pollers for one minute", () => {
		const userId = `test-session-count-polling-${Date.now()}`;
		const organizationId = "org-polling";

		expect(() => {
			for (let i = 0; i < 300; i++) {
				checkOrganizationSessionCountRateLimit(userId, organizationId);
			}
		}).not.toThrow();
	});

	test("blocks sustained traffic above the refresh limit", () => {
		const userId = `test-session-count-over-${Date.now()}`;
		const organizationId = "org-over";

		for (let i = 0; i < 300; i++) {
			checkOrganizationSessionCountRateLimit(userId, organizationId);
		}

		expect(() =>
			checkOrganizationSessionCountRateLimit(userId, organizationId),
		).toThrow("Session count refresh is temporarily limited");
	});

	test("keeps organization limits independent", () => {
		const userId = `test-session-count-orgs-${Date.now()}`;

		for (let i = 0; i < 300; i++) {
			checkOrganizationSessionCountRateLimit(userId, "org-at-limit");
		}

		expect(() =>
			checkOrganizationSessionCountRateLimit(userId, "org-fresh"),
		).not.toThrow();
	});
});

describe("checkWrappedShareLookupRateLimit", () => {
	test("evicts expired share entries", () => {
		const realNow = Date.now;
		let now = realNow();
		Date.now = () => now;

		try {
			const shareId = `expiring-share-${now}`;
			const source = `expiring-source-${now}`;
			checkWrappedShareLookupRateLimit(shareId, source);

			now += WRAPPED_SHARE_LOOKUP_WINDOW_MS + 1;

			for (
				let index = 0;
				index < WRAPPED_SHARE_LOOKUP_MAX_REQUESTS;
				index += 1
			) {
				checkWrappedShareLookupRateLimit(shareId, source);
			}

			expect(() => checkWrappedShareLookupRateLimit(shareId, source)).toThrow(
				"Wrapped share lookup is temporarily rate limited",
			);

			now += WRAPPED_SHARE_LOOKUP_WINDOW_MS + 1;
			expect(getWrappedShareLookupRateLimitMetrics()).toMatchObject({
				cardinality: 0,
				sourceCardinality: 0,
			});
		} finally {
			Date.now = realNow;
		}
	});

	test("rejects one source before unique IDs can churn the cache", () => {
		const realNow = Date.now;
		let now = realNow();
		Date.now = () => now;

		try {
			const source = `churning-source-${crypto.randomUUID()}`;

			for (
				let index = 0;
				index < WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS;
				index += 1
			) {
				checkWrappedShareLookupRateLimit(
					`churning-share-${crypto.randomUUID()}`,
					source,
				);
			}

			const metricsBeforeRejection = getWrappedShareLookupRateLimitMetrics();

			expect(() =>
				checkWrappedShareLookupRateLimit(
					`churning-share-${crypto.randomUUID()}`,
					source,
				),
			).toThrow("Wrapped share lookup is temporarily rate limited");
			expect(getWrappedShareLookupRateLimitMetrics()).toMatchObject({
				cardinality: metricsBeforeRejection.cardinality,
				rejectedTraffic: metricsBeforeRejection.rejectedTraffic + 1,
			});

			now += WRAPPED_SHARE_LOOKUP_WINDOW_MS + 1;
			getWrappedShareLookupRateLimitMetrics();
		} finally {
			Date.now = realNow;
		}
	});

	test("keeps a throttled share while the same source churns IDs", () => {
		const testId = crypto.randomUUID();
		const shareId = `protected-share-${testId}`;
		const source = `churning-source-${testId}`;

		for (
			let request = 0;
			request < WRAPPED_SHARE_LOOKUP_MAX_REQUESTS;
			request += 1
		) {
			checkWrappedShareLookupRateLimit(shareId, source);
		}

		const remainingSourceRequests =
			WRAPPED_SHARE_LOOKUP_SOURCE_MAX_REQUESTS -
			WRAPPED_SHARE_LOOKUP_MAX_REQUESTS;
		for (let request = 0; request < remainingSourceRequests; request += 1) {
			checkWrappedShareLookupRateLimit(
				`attacker-share-${testId}-${request}`,
				source,
			);
		}

		const metricsBeforeRejection = getWrappedShareLookupRateLimitMetrics();
		expect(() =>
			checkWrappedShareLookupRateLimit(
				`rejected-attacker-share-${testId}`,
				source,
			),
		).toThrow("Wrapped share lookup is temporarily rate limited");
		expect(() =>
			checkWrappedShareLookupRateLimit(shareId, `second-source-${testId}`),
		).toThrow("Wrapped share lookup is temporarily rate limited");
		expect(getWrappedShareLookupRateLimitMetrics()).toMatchObject({
			cardinality: metricsBeforeRejection.cardinality,
			evictions: metricsBeforeRejection.evictions,
			rejectedTraffic: metricsBeforeRejection.rejectedTraffic + 2,
		});
	});

	test("bounds cardinality and throttles a valid share after capacity eviction", () => {
		const testId = crypto.randomUUID();
		const metricsBeforeFlood = getWrappedShareLookupRateLimitMetrics();

		for (let index = 0; index <= WRAPPED_SHARE_LOOKUP_CAPACITY; index += 1) {
			checkWrappedShareLookupRateLimit(
				`${testId}-${index}`,
				`${testId}-source-${index}`,
			);
		}

		const metricsAfterFlood = getWrappedShareLookupRateLimitMetrics();
		expect(metricsAfterFlood).toMatchObject({
			cardinality: WRAPPED_SHARE_LOOKUP_CAPACITY,
		});
		expect(metricsAfterFlood.evictions).toBeGreaterThan(
			metricsBeforeFlood.evictions,
		);

		const evictedShareId = `${testId}-0`;
		for (let index = 0; index < WRAPPED_SHARE_LOOKUP_MAX_REQUESTS; index += 1) {
			checkWrappedShareLookupRateLimit(evictedShareId, `${testId}-valid`);
		}

		expect(() =>
			checkWrappedShareLookupRateLimit(evictedShareId, `${testId}-valid`),
		).toThrow("Wrapped share lookup is temporarily rate limited");
	});
});

describe("checkHookIngestRateLimit", () => {
	test("allows requests under the limit", () => {
		const userId = `test-hook-under-${Date.now()}`;
		expect(() => checkHookIngestRateLimit(userId, "session-1")).not.toThrow();
	});

	test("repeated uploads of an existing session_id exhaust the cap", () => {
		const userId = `test-hook-dedup-${Date.now()}`;
		for (let i = 0; i < 500; i++) {
			checkHookIngestRateLimit(userId, "session-1");
		}
		expect(() => checkHookIngestRateLimit(userId, "session-1")).toThrow(
			"Rate limit exceeded",
		);
	});

	test("throws once distinct session_ids exceed the limit", () => {
		const userId = `test-hook-over-${Date.now()}`;
		// Default cap is 500 distinct sessions per hour.
		for (let i = 0; i < 500; i++) {
			checkHookIngestRateLimit(userId, `session-${i}`);
		}
		expect(() => checkHookIngestRateLimit(userId, "session-overflow")).toThrow(
			"Rate limit exceeded",
		);
	});

	test("different users have independent limits", () => {
		const userA = `test-hook-a-${Date.now()}`;
		const userB = `test-hook-b-${Date.now()}`;
		for (let i = 0; i < 500; i++) {
			checkHookIngestRateLimit(userA, `session-${i}`);
		}
		// userA is exhausted; userB starts fresh.
		expect(() =>
			checkHookIngestRateLimit(userB, "session-fresh"),
		).not.toThrow();
	});

	test("entries past the window are evicted, freeing slots", () => {
		const userId = `test-hook-evict-${Date.now()}`;
		const realNow = Date.now;
		let fakeTime = 1_700_000_000_000;
		Date.now = () => fakeTime;
		try {
			for (let i = 0; i < 500; i++) {
				checkHookIngestRateLimit(userId, `session-${i}`);
			}
			// Advance past the default 1h window. All seeded entries should
			// be evicted on the next call, freeing the cap.
			fakeTime += 3600 * 1000 + 1;
			expect(() =>
				checkHookIngestRateLimit(userId, "session-after-window"),
			).not.toThrow();
		} finally {
			Date.now = realNow;
		}
	});
});

describe("checkManualIngestRateLimit", () => {
	test("allows requests under the cap", () => {
		const userId = `test-manual-under-${Date.now()}`;
		expect(() => checkManualIngestRateLimit(userId, "session-1")).not.toThrow();
	});

	test("manual and hook caps are independent buckets", () => {
		const userId = `test-independent-${Date.now()}`;
		// A session in the manual bucket must not consume hook budget.
		checkManualIngestRateLimit(userId, "session-manual-1");
		// Hook bucket should still allow its full 500 distinct sessions.
		for (let i = 0; i < 500; i++) {
			checkHookIngestRateLimit(userId, `session-hook-${i}`);
		}
		// 501st new hook session throws — confirms hook cap is intact.
		expect(() =>
			checkHookIngestRateLimit(userId, "session-hook-overflow"),
		).toThrow("Rate limit exceeded");
	});
});
