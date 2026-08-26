import { describe, expect, test } from "bun:test";
import { createVercelFunctionHandler } from "../lib/vercel-function-handler.js";

describe("Vercel function routing", () => {
	test("restores the public pathname without leaking route captures", async () => {
		const handler = createVercelFunctionHandler({
			fetch: async (request) => Response.json({ url: request.url }),
			functionGroup: "test",
			publicPathPattern: /^\/rpc(?:\/.*)?$/u,
		});
		const response = await handler(
			new Request(
				"https://example.test/api/rpc?__opaline_path=%2Frpc%2Fhealth&routePath=health&keep=yes",
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			url: "https://example.test/rpc/health?keep=yes",
		});
	});

	test("rejects a rewritten pathname outside its function group", async () => {
		let called = false;
		const handler = createVercelFunctionHandler({
			fetch: async () => {
				called = true;
				return new Response("unexpected");
			},
			functionGroup: "test",
			publicPathPattern: /^\/wrapped\//u,
		});
		const response = await handler(
			new Request(
				"https://example.test/api/wrapped?__opaline_path=%2Frpc%2Fhealth",
			),
		);

		expect(response.status).toBe(404);
		expect(called).toBe(false);
	});

	test("leaves direct function requests unchanged", async () => {
		const handler = createVercelFunctionHandler({
			fetch: async (request) => Response.json({ url: request.url }),
			functionGroup: "test",
			publicPathPattern: /^\/rpc(?:\/.*)?$/u,
		});
		const response = await handler(
			new Request("https://example.test/api/rpc?keep=yes"),
		);

		expect(await response.json()).toEqual({
			url: "https://example.test/api/rpc?keep=yes",
		});
	});
});
