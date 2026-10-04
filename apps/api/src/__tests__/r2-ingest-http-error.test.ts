import { describe, expect, test } from "bun:test";
import { toR2IngestCommitOrpcError } from "../services/r2-ingest-http-error.js";
import {
	R2IngestCommitError,
	R2IngestCommitQueuedError,
} from "../services/r2-ingest-processing-error.js";

describe("R2 ingest HTTP error mapping", () => {
	test("maps materialization queue timeouts to retryable HTTP responses", () => {
		const error = toR2IngestCommitOrpcError(
			new R2IngestCommitError(
				"R2_INGEST_GATE_QUEUE_TIMEOUT",
				"R2 materialization timed out while queued",
				true,
			),
		);

		expect(error).toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			data: {
				reason: "R2_INGEST_GATE_QUEUE_TIMEOUT",
				retryAfterMs: 1_000,
			},
			status: 503,
		});
	});

	test("answers a stored, queued commit with the reason released CLIs poll on", () => {
		const error = toR2IngestCommitOrpcError(new R2IngestCommitQueuedError());

		expect(error).toMatchObject({
			code: "SERVICE_UNAVAILABLE",
			data: {
				queued: true,
				reason: "R2_INGEST_JOB_RETRY_LATER",
				retryAfterMs: 1_000,
			},
			status: 503,
		});
	});

	test("keeps permanent completion errors non-retryable", () => {
		const error = toR2IngestCommitOrpcError(
			new R2IngestCommitError(
				"R2_INGEST_COMPLETION_RECEIPT_INVALID",
				"Invalid completion receipt",
				false,
			),
		);

		expect(error).toMatchObject({
			code: "BAD_REQUEST",
			data: { reason: "R2_INGEST_COMPLETION_RECEIPT_INVALID" },
			status: 400,
		});
	});
});
