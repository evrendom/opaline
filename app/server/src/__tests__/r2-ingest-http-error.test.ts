import { describe, expect, test } from "bun:test";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import {
	isIngestStillProcessingBody,
	isIngestStillProcessingReply,
	toR2IngestCommitOrpcError,
} from "../services/r2-ingest-http-error.js";
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

	test("only a queued or busy commit is an ingest job still processing", () => {
		const reply = (error: R2IngestCommitError) =>
			isIngestStillProcessingReply(toR2IngestCommitOrpcError(error));

		expect(reply(new R2IngestCommitQueuedError())).toBe(true);
		expect(
			reply(
				new R2IngestCommitError(
					"R2_INGEST_JOB_BUSY",
					"Ingest job is already being processed",
					true,
				),
			),
		).toBe(true);
		for (const error of [
			new R2IngestCommitError(
				"R2_INGEST_JOB_RETRY_LATER",
				"Ingest job is waiting for dependency recovery and will be retried",
				true,
			),
			new R2IngestCommitError(
				"R2_INGEST_GATE_QUEUE_TIMEOUT",
				"R2 materialization timed out while queued",
				true,
			),
			new R2IngestCommitError(
				"R2_INGEST_JOB_FAILED",
				"Ingest job has exhausted its recovery attempts",
				false,
			),
		])
			expect(reply(error)).toBe(false);
		expect(
			isIngestStillProcessingReply(
				new ORPCError("INTERNAL_SERVER_ERROR", { data: { queued: true } }),
			),
		).toBe(false);
		expect(
			isIngestStillProcessingReply(
				new ORPCError("SERVICE_UNAVAILABLE", {
					data: { reason: "r2_ingest_processing_failed" },
				}),
			),
		).toBe(false);
		expect(
			isIngestStillProcessingReply(new Error("Ingest job is queued")),
		).toBe(false);
	});

	test("the reply's wire body says the same, and anything else in a 5xx body does not", async () => {
		const bodyOf = async (error: Error) => {
			const handler = new RPCHandler({
				commit: os.handler(() => {
					throw error;
				}),
			});
			const { response } = await handler.handle(
				new Request("http://localhost/rpc/commit", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}",
				}),
				{ prefix: "/rpc", context: {} },
			);
			return (await response?.text()) ?? "";
		};

		expect(
			isIngestStillProcessingBody(
				await bodyOf(
					toR2IngestCommitOrpcError(new R2IngestCommitQueuedError()),
				),
			),
		).toBe(true);
		expect(
			isIngestStillProcessingBody(
				await bodyOf(
					new ORPCError("SERVICE_UNAVAILABLE", {
						data: { reason: "r2_ingest_processing_failed" },
					}),
				),
			),
		).toBe(false);
		expect(
			isIngestStillProcessingBody(await bodyOf(new Error("queued: true"))),
		).toBe(false);
		expect(isIngestStillProcessingBody("not json")).toBe(false);
		expect(isIngestStillProcessingBody("null")).toBe(false);
	});
});
