import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CSRF_ORIGIN_FORBIDDEN_CODE } from "../lib/csrf-origin.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const TEST_PATH = "/__test/ingest-filter-queue-metrics";
const SESSION_COOKIE = "better-auth.session_token=signed-session";

let server: ApiTestServer;

beforeAll(async () => {
	server = await startApiTestServer({
		PG_CONNECTION_STRING:
			"postgres://postgres:postgres@localhost:5432/rudel-csrf-origin",
	});
});

afterAll(async () => {
	await server?.stop();
});

describe("HTTP CSRF origin enforcement", () => {
	test("rejects a cookie-authenticated unsafe request before dispatch", async () => {
		const response = await postWithHeaders({ Cookie: SESSION_COOKIE });

		expect(response.status).toBe(403);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/u);
		expect(await response.json()).toEqual({
			error: {
				code: CSRF_ORIGIN_FORBIDDEN_CODE,
				message:
					"Cookie-authenticated unsafe requests require an allowed Origin header.",
			},
		});
	});

	test("allows a cookie-authenticated unsafe request from the configured origin", async () => {
		const response = await postWithHeaders({
			Cookie: SESSION_COOKIE,
			Origin: "http://localhost",
		});

		expect(response.status).toBe(200);
	});

	test("keeps bearer and API-key CLI request shapes exempt", async () => {
		for (const credentialHeaders of [
			new Headers({ Authorization: "Bearer cli-session-token" }),
			new Headers({ "X-API-Key": "cli-ingest-api-key" }),
		]) {
			credentialHeaders.set("Cookie", SESSION_COOKIE);
			const response = await postWithHeaders(credentialHeaders);
			expect(response.status).toBe(200);
		}
	});

	test("keeps public GET routes exempt", async () => {
		const response = await fetch(`${server.baseUrl}/health`, {
			headers: {
				Cookie: SESSION_COOKIE,
				Origin: "https://attacker.example",
			},
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
	});
});

function postWithHeaders(headers: RequestInit["headers"]): Promise<Response> {
	return fetch(`${server.baseUrl}${TEST_PATH}`, {
		headers,
		method: "POST",
	});
}
