import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { IngestSessionInputSchema } from "../index.js";

const VALID_INPUT = {
	content: '{"type":"user","timestamp":"2026-08-27T10:00:00.000Z"}',
	projectPath: "/test/idempotency",
	sessionId: "idempotency-contract",
	source: "claude_code" as const,
};

describe("IngestSessionInputSchema operation identity", () => {
	test("accepts an absent operation ID for backward compatibility", () => {
		const result = IngestSessionInputSchema.safeParse(VALID_INPUT);

		expect(result.success).toBe(true);
		assert(result.success);
		expect(result.data.operationId).toBeUndefined();
	});

	test("accepts a UUID operation ID", () => {
		const operationId = "00000000-0000-4000-8000-000000000010";
		const result = IngestSessionInputSchema.safeParse({
			...VALID_INPUT,
			operationId,
		});

		expect(result.success).toBe(true);
		assert(result.success);
		expect(result.data.operationId).toBe(operationId);
	});

	test("rejects a non-UUID operation ID", () => {
		const result = IngestSessionInputSchema.safeParse({
			...VALID_INPUT,
			operationId: "retry-operation-10",
		});

		expect(result.success).toBe(false);
	});
});
