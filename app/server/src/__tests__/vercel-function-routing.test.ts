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
			publicPathPattern: /^\/team\/invite\//u,
		});
		const response = await handler(
			new Request(
				"https://example.test/api/invite?__opaline_path=%2Frpc%2Fhealth",
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

	test("materializes streamed response bodies for the Vercel Bun runtime", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"status":"ok"}'));
				controller.close();
			},
		});
		const handler = createVercelFunctionHandler({
			fetch: async () =>
				new Response(body, {
					headers: { "Content-Type": "application/json" },
				}),
			functionGroup: "test",
		});

		const response = await handler(
			new Request("https://example.test/api/rpc", { method: "POST" }),
		);

		expect(response.headers.get("Content-Length")).toBe("15");
		expect(await response.text()).toBe('{"status":"ok"}');
	});

	test("preserves bodyless responses without inventing a body", async () => {
		const handler = createVercelFunctionHandler({
			fetch: async () => new Response(null, { status: 204 }),
			functionGroup: "test",
		});

		const response = await handler(
			new Request("https://example.test/api/rpc", { method: "POST" }),
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("Content-Length")).toBeNull();
		expect(await response.text()).toBe("");
	});

	test("returns SSE headers and the first event before the stream completes", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode("event: connection\ndata: ready\n\n"),
				);
			},
		});
		const handler = createVercelFunctionHandler({
			fetch: async () =>
				new Response(body, {
					headers: { "Content-Type": "text/event-stream" },
				}),
			functionGroup: "cli-connection",
			streaming: true,
		});
		const response = await handler(
			new Request("https://example.test/api/cli/connections/id/events"),
		);
		expect(response.headers.get("Content-Length")).toBeNull();
		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		const first = await reader?.read();
		expect(new TextDecoder().decode(first?.value)).toContain("data: ready");
		await reader?.cancel();
	});
});
