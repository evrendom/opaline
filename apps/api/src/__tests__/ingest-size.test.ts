import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import {
	INGEST_AGGREGATE_CONTENT_MAX_BYTES,
	INGEST_LIMIT_REASONS,
	IngestSessionInputSchema,
	LOCAL_INGEST_CONTENT_MAX_BYTES,
	LocalIngestSessionInputSchema,
} from "@rudel/api-routes";
import {
	clampIngestAggregateContentMaxBytes,
	enforceIngestAggregateSize,
	ingestContentCeiling,
	isLargeIngestSession,
	scaleSessionBudget,
} from "../lib/ingest-size.js";

const validBase = {
	source: "claude_code" as const,
	sessionId: "session-1",
	projectPath: "/test/project",
};

const MEBIBYTE = 1024 * 1024;

describe("session budget scaling", () => {
	test("keeps standard sessions on the base budget", () => {
		expect(isLargeIngestSession(128 * MEBIBYTE)).toBe(false);
		expect(isLargeIngestSession(128 * MEBIBYTE + 1)).toBe(true);
		expect(scaleSessionBudget(30_000, 1)).toBe(30_000);
		expect(scaleSessionBudget(30_000, 128 * MEBIBYTE)).toBe(30_000);
		expect(scaleSessionBudget(30_000, Number.NaN)).toBe(30_000);
	});

	test("scales proportionally above the standard size up to 2x", () => {
		expect(scaleSessionBudget(30_000, 192 * MEBIBYTE)).toBe(45_000);
		expect(scaleSessionBudget(30_000, 256 * MEBIBYTE)).toBe(60_000);
		expect(scaleSessionBudget(30_000, 1024 * MEBIBYTE)).toBe(60_000);
		expect(scaleSessionBudget(1_000_000, 200 * MEBIBYTE)).toBe(1_562_500);
	});
});

describe("enforceIngestAggregateSize", () => {
	test("clamps overrides to the production aggregate ceiling", () => {
		expect(clampIngestAggregateContentMaxBytes(1)).toBe(1);
		expect(
			clampIngestAggregateContentMaxBytes(
				INGEST_AGGREGATE_CONTENT_MAX_BYTES + 1,
			),
		).toBe(INGEST_AGGREGATE_CONTENT_MAX_BYTES);
		expect(clampIngestAggregateContentMaxBytes(Number.POSITIVE_INFINITY)).toBe(
			INGEST_AGGREGATE_CONTENT_MAX_BYTES,
		);
		expect(clampIngestAggregateContentMaxBytes(Number.NaN)).toBe(
			INGEST_AGGREGATE_CONTENT_MAX_BYTES,
		);
		expect(clampIngestAggregateContentMaxBytes(-1)).toBe(
			INGEST_AGGREGATE_CONTENT_MAX_BYTES,
		);
	});

	test("returns the exact UTF-8 byte count at the limit", () => {
		expect(
			enforceIngestAggregateSize({ ...validBase, content: "abcd" }, 4),
		).toBe(4);
	});

	test("rejects ASCII content over the byte limit with a 413 reason", () => {
		const error = captureError(() =>
			enforceIngestAggregateSize({ ...validBase, content: "abcde" }, 4),
		);
		expectTranscriptTooLargeError(error, 5, 4);
	});

	test("rejects multibyte content over the byte limit", () => {
		const error = captureError(() =>
			enforceIngestAggregateSize({ ...validBase, content: "é" }, 1),
		);
		expectTranscriptTooLargeError(error, 2, 1);
	});

	test("counts aggregate overflow across small subagents", () => {
		const error = captureError(() =>
			enforceIngestAggregateSize(
				{
					...validBase,
					content: "a",
					subagents: [
						{ agentId: "one", content: "bc" },
						{ agentId: "two", content: "de" },
					],
				},
				4,
			),
		);
		expectTranscriptTooLargeError(error, 5, 4);
	});
});

function captureError(operation: () => unknown): unknown {
	try {
		operation();
	} catch (error) {
		return error;
	}
	throw new Error("Expected operation to throw");
}

function expectTranscriptTooLargeError(
	error: unknown,
	actualBytes: number,
	maxBytes: number,
): void {
	expect(error).toBeInstanceOf(ORPCError);
	if (!(error instanceof ORPCError)) {
		throw new Error("Expected ORPCError");
	}
	expect(error.status).toBe(413);
	expect(error.data).toEqual({
		reason: INGEST_LIMIT_REASONS.transcriptTooLarge,
		maxBytes,
		actualBytes,
	});
}

describe("the local app's ceiling", () => {
	test("a server on the user's own Mac accepts sessions up to 1 GiB, the cloud stays at 256 MiB", () => {
		expect(ingestContentCeiling({})).toBe(INGEST_AGGREGATE_CONTENT_MAX_BYTES);
		expect(ingestContentCeiling({ OPALINE_SELF_HOSTED: "1" })).toBe(
			LOCAL_INGEST_CONTENT_MAX_BYTES,
		);
		const previous = process.env.OPALINE_SELF_HOSTED;
		process.env.OPALINE_SELF_HOSTED = "1";
		try {
			expect(
				clampIngestAggregateContentMaxBytes(LOCAL_INGEST_CONTENT_MAX_BYTES),
			).toBe(LOCAL_INGEST_CONTENT_MAX_BYTES);
		} finally {
			if (previous === undefined) delete process.env.OPALINE_SELF_HOSTED;
			else process.env.OPALINE_SELF_HOSTED = previous;
		}
		expect(
			clampIngestAggregateContentMaxBytes(LOCAL_INGEST_CONTENT_MAX_BYTES),
		).toBe(INGEST_AGGREGATE_CONTENT_MAX_BYTES);
	});

	test("the local session schema admits content the cloud schema rejects", () => {
		const base = {
			source: "codex",
			sessionId: "s",
			projectPath: "/p",
			subagents: [{ agentId: "a", content: "x" }],
		};
		const content = "x".repeat(INGEST_AGGREGATE_CONTENT_MAX_BYTES + 1);
		expect(
			IngestSessionInputSchema.safeParse({ ...base, content }).success,
		).toBe(false);
		expect(
			LocalIngestSessionInputSchema.safeParse({ ...base, content }).success,
		).toBe(true);
	});
});
