import { describe, expect, test } from "bun:test";
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

	test("keeps unknown validation failures terminal", () => {
		expect(
			isRetryableProcessingError(new Error("deterministic schema rejection")),
		).toBe(false);
	});
});
