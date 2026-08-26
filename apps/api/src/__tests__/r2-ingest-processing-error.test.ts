import { describe, expect, test } from "bun:test";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { parseError } from "@clickhouse/client-web";
import { ORPCError } from "@orpc/server";
import {
	REDACTION_BUDGET_EXCEEDED_CODE,
	REDACTION_DID_NOT_CONVERGE_CODE,
	SECRET_FILTER_JSON_INTEGRITY_CODE,
	SESSION_OWNERSHIP_CONFLICT_CODE,
	SESSION_UPLOAD_SHRINK_REJECTED_CODE,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	IngestFilterWorkerOperationalError,
	SessionLanguageSignalScannerOperationalError,
} from "../services/ingest-worker-operational.error.js";
import {
	isDefinitelyPermanentProcessingError,
	isRetryableProcessingError,
} from "../services/r2-ingest-processing-error.js";

describe("R2 ingest processing error classification", () => {
	test("finds a real Bun connection-refused fetch error through nested causes", async () => {
		const server = Bun.serve({
			fetch: () => new Response("unused"),
			hostname: "127.0.0.1",
			port: 0,
		});
		const url = server.url;
		await server.stop(true);
		let fetchError: unknown = new Error("fetch unexpectedly succeeded");
		try {
			await fetch(url);
		} catch (error) {
			fetchError = error;
		}

		expect(fetchError).toMatchObject({ code: "ConnectionRefused" });
		expect(
			isRetryableProcessingError(
				new Error("ClickHouse request failed", { cause: fetchError }),
			),
		).toBe(true);
	});

	test.each([
		"FailedToOpenSocket",
		"ECONNREFUSED",
		"ETIMEDOUT",
		"EPIPE",
		"CONNECT_TIMEOUT",
		"CONNECTION_CLOSED",
	])("recognizes transient socket/database code %s", (code) => {
		expect(
			isRetryableProcessingError(
				Object.assign(new Error("transient transport failure"), { code }),
			),
		).toBe(true);
	});

	test("traverses AggregateError members without looping on cycles", () => {
		const cycle: { cause?: unknown } = {};
		cycle.cause = cycle;
		const aggregate = new AggregateError([
			cycle,
			Object.assign(new Error("socket unavailable"), {
				code: "FailedToOpenSocket",
			}),
		]);

		expect(isRetryableProcessingError(aggregate)).toBe(true);
		expect(isRetryableProcessingError(cycle)).toBe(false);
	});

	test("recognizes the ClickHouse web client timeout shape", () => {
		expect(isRetryableProcessingError(new Error("Timeout error."))).toBe(true);
	});

	test.each([
		["InternalError", 500],
		["ServiceUnavailable", 503],
		["ClientDisconnect", 400],
		["TooManyRequests", 429],
	])("recognizes R2 service error %s at HTTP %d", (name, httpStatusCode) => {
		const error = new S3ServiceException({
			$fault: "server",
			$metadata: { httpStatusCode },
			message: "synthetic R2 service failure",
			name,
		});

		expect(error).toMatchObject({
			$metadata: { httpStatusCode },
			name,
		});
		expect(isRetryableProcessingError(error)).toBe(true);
	});

	test("recognizes typed worker operational failures", () => {
		expect(
			isRetryableProcessingError(
				new IngestFilterWorkerOperationalError("filter worker crashed"),
			),
		).toBe(true);
		expect(
			isRetryableProcessingError(
				new SessionLanguageSignalScannerOperationalError(
					"language scanner timed out",
				),
			),
		).toBe(true);
	});

	test.each([
		["159", "TIMEOUT_EXCEEDED"],
		["202", "TOO_MANY_SIMULTANEOUS_QUERIES"],
		["203", "NO_FREE_CONNECTION"],
		["209", "SOCKET_TIMEOUT"],
		["210", "NETWORK_ERROR"],
		["242", "TABLE_IS_READ_ONLY"],
		["252", "TOO_MANY_PARTS"],
		["285", "TOO_FEW_LIVE_REPLICAS"],
		["319", "UNKNOWN_STATUS_OF_INSERT"],
		["999", "KEEPER_EXCEPTION"],
	])("recognizes ClickHouse server error %s/%s", (code, type) => {
		const error = parseError(
			`Code: ${code}. DB::Exception: synthetic transient failure. (${type})`,
		);

		expect(error).toMatchObject({ code, type });
		expect(isRetryableProcessingError(error)).toBe(true);
	});

	test.each([
		["53", "TYPE_MISMATCH"],
		["62", "SYNTAX_ERROR"],
	])("keeps ClickHouse server error %s/%s definitely permanent", (code, type) => {
		const error = parseError(
			`Code: ${code}. DB::Exception: synthetic deterministic failure. (${type})`,
		);

		expect(error).toMatchObject({ code, type });
		expect(isRetryableProcessingError(error)).toBe(false);
		expect(isDefinitelyPermanentProcessingError(error)).toBe(true);
	});

	test.each([
		"BAD_REQUEST",
		"PAYLOAD_TOO_LARGE",
		"UNAUTHORIZED",
		"FORBIDDEN",
		"CONFLICT",
		REDACTION_BUDGET_EXCEEDED_CODE,
		REDACTION_DID_NOT_CONVERGE_CODE,
		SECRET_FILTER_JSON_INTEGRITY_CODE,
		SESSION_OWNERSHIP_CONFLICT_CODE,
		SESSION_UPLOAD_SHRINK_REJECTED_CODE,
	])("recognizes permanent ingest policy error %s", (code) => {
		expect(
			isDefinitelyPermanentProcessingError(
				new ORPCError(code, { message: "synthetic permanent rejection" }),
			),
		).toBe(true);
	});

	test("recognizes schema validation while preserving novel errors", () => {
		const schemaError = z.object({ sessionId: z.string().uuid() }).safeParse({
			sessionId: "not-a-uuid",
		});
		expect(schemaError.success).toBe(false);
		if (schemaError.success) throw new Error("expected schema rejection");

		expect(isDefinitelyPermanentProcessingError(schemaError.error)).toBe(true);
		const novelError = new Error("future operational failure channel");
		expect(isRetryableProcessingError(novelError)).toBe(false);
		expect(isDefinitelyPermanentProcessingError(novelError)).toBe(false);
	});
});
