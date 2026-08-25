import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { API_RESPONSE_TOO_LARGE_CODE } from "../lib/api-response-size.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

let server: ApiTestServer | undefined;

beforeAll(async () => {
	server = await startApiTestServer({
		PG_CONNECTION_STRING:
			"postgres://postgres:postgres@localhost:5432/rudel-response-size",
	});
});

afterAll(async () => {
	await server?.stop();
});

describe("final API response byte guard", () => {
	test("replaces an oversized serialized API response with a bounded 413", async () => {
		const response = await fetch(
			`${server?.baseUrl}/api/__test/oversized-response`,
		);

		expect(response.status).toBe(413);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/u);
		expect(await response.json()).toEqual({
			error: {
				code: API_RESPONSE_TOO_LARGE_CODE,
				data: { maxBytes: 3_750_000 },
				message:
					"The serialized API response exceeds the supported size limit.",
			},
		});
	});

	test("keeps the health route outside the API response guard", async () => {
		const response = await fetch(`${server?.baseUrl}/health`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
	});
});
