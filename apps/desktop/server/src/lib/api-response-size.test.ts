import { describe, expect, test } from "bun:test";
import {
	API_RESPONSE_TOO_LARGE_CODE,
	enforceApiResponseSize,
} from "./api-response-size.js";

describe("API serialized response size guard", () => {
	test("allows a response exactly at the byte ceiling", async () => {
		const response = new Response("éé");
		expect(
			await enforceApiResponseSize({
				maxBytes: 4,
				pathname: "/rpc/example",
				response,
			}),
		).toBe(response);
	});

	test("returns a structured 413 one serialized byte over the ceiling", async () => {
		const guarded = await enforceApiResponseSize({
			maxBytes: 4,
			pathname: "/api/example",
			response: new Response("12345", {
				headers: { "Access-Control-Allow-Origin": "https://app.example" },
			}),
		});

		expect(guarded.status).toBe(413);
		expect(guarded.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
		expect(await guarded.json()).toEqual({
			error: {
				code: API_RESPONSE_TOO_LARGE_CODE,
				data: { maxBytes: 4 },
				message:
					"The serialized API response exceeds the supported size limit.",
			},
		});
	});

	test("exempts health and non-API responses", async () => {
		const health = new Response("oversized");
		const staticAsset = new Response("oversized");
		expect(
			await enforceApiResponseSize({
				maxBytes: 1,
				pathname: "/health",
				response: health,
			}),
		).toBe(health);
		expect(
			await enforceApiResponseSize({
				maxBytes: 1,
				pathname: "/assets/app.js",
				response: staticAsset,
			}),
		).toBe(staticAsset);
	});
});
