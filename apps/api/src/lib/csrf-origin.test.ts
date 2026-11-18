import { describe, expect, test } from "bun:test";
import {
	CSRF_ORIGIN_FORBIDDEN_CODE,
	enforceCookieCsrfOrigin,
} from "./csrf-origin.js";

const ALLOWED_ORIGIN = "https://app.rudel.test";
const ALLOWED_ORIGINS = [ALLOWED_ORIGIN];
const SESSION_COOKIE = "better-auth.session_token=signed-session";

describe("cookie-authenticated CSRF origin guard", () => {
	test.each([
		"GET",
		"HEAD",
		"OPTIONS",
	])("allows the safe %s method without an Origin", (method) => {
		expect(
			guardRequest("/rpc/analytics/sessions/list", {
				headers: { Cookie: SESSION_COOKIE },
				method,
			}),
		).toBeNull();
	});

	test("allows an unsafe cookie request from an exact trusted origin", () => {
		expect(
			guardRequest("/rpc/analytics/sessions/delete", {
				headers: {
					Cookie: SESSION_COOKIE,
					Origin: ALLOWED_ORIGIN,
				},
				method: "POST",
			}),
		).toBeNull();
	});

	test.each([
		["missing", undefined],
		["untrusted", "https://attacker.example"],
		["opaque", "null"],
	])("rejects an unsafe cookie request with a %s Origin", async (_, origin) => {
		const headers = new Headers({ Cookie: SESSION_COOKIE });
		if (origin) headers.set("Origin", origin);
		const response = guardRequest("/rpc/analytics/sessions/delete", {
			headers,
			method: "POST",
		});

		expect(response?.status).toBe(403);
		expect(await response?.json()).toEqual({
			error: {
				code: CSRF_ORIGIN_FORBIDDEN_CODE,
				message:
					"Cookie-authenticated unsafe requests require an allowed Origin header.",
			},
		});
	});

	test("does not treat unrelated or empty cookies as session authentication", () => {
		for (const cookie of [
			"analytics_id=abc",
			"better-auth.session_token=",
			"__Secure-better-auth.session_token=   ",
		]) {
			expect(
				guardRequest("/rpc/analytics/sessions/delete", {
					headers: { Cookie: cookie },
					method: "DELETE",
				}),
			).toBeNull();
		}
	});

	test("recognizes the secure production session cookie", async () => {
		const response = guardRequest("/api/profile/avatar", {
			headers: {
				Cookie: "__Secure-better-auth.session_token=signed-session",
			},
			method: "POST",
		});

		expect(response?.status).toBe(403);
	});

	test("keeps the CLI bearer API-key creation path exempt", () => {
		expect(
			guardRequest("/api/auth/api-key/create", {
				headers: {
					Authorization: "Bearer signed-session-token",
					Cookie: SESSION_COOKIE,
				},
				method: "POST",
			}),
		).toBeNull();
	});

	test("keeps CLI API-key RPC uploads exempt", () => {
		expect(
			guardRequest("/rpc/ingestSession", {
				headers: {
					Cookie: SESSION_COOKIE,
					"X-API-Key": "rudel-api-key",
				},
				method: "POST",
			}),
		).toBeNull();
	});

	test("does not exempt malformed credentials", async () => {
		for (const headers of [
			new Headers({
				Authorization: "Basic credential",
				Cookie: SESSION_COOKIE,
			}),
			new Headers({
				Authorization: "Bearer   ",
				Cookie: SESSION_COOKIE,
			}),
			new Headers({ Cookie: SESSION_COOKIE, "X-API-Key": "   " }),
		]) {
			const response = guardRequest("/rpc/ingestSession", {
				headers,
				method: "POST",
			});
			expect(response?.status).toBe(403);
		}
	});

	test("allows cookieless CLI device-flow posts", () => {
		for (const path of ["/api/auth/device/code", "/api/auth/device/token"]) {
			expect(guardRequest(path, { method: "POST" })).toBeNull();
		}
	});
});

function guardRequest(pathname: string, init?: RequestInit): Response | null {
	return enforceCookieCsrfOrigin({
		allowedOrigins: ALLOWED_ORIGINS,
		request: new Request(`https://api.rudel.test${pathname}`, init),
	});
}
