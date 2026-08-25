import { describe, expect, test } from "bun:test";
import { parseError } from "@clickhouse/client-web";
import { isRetryableProcessingError } from "../services/r2-ingest-processing-error.js";

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
	])("keeps ClickHouse server error %s/%s terminal", (code, type) => {
		const error = parseError(
			`Code: ${code}. DB::Exception: synthetic deterministic failure. (${type})`,
		);

		expect(error).toMatchObject({ code, type });
		expect(isRetryableProcessingError(error)).toBe(false);
	});

	test("keeps unknown validation failures terminal", () => {
		expect(
			isRetryableProcessingError(new Error("deterministic schema rejection")),
		).toBe(false);
	});
});
