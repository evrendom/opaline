import { expect, test } from "bun:test";
import { atPublicOrigin } from "./public-request.js";

test("a request that came through a TLS proxy is read at the public https origin with its method, headers, body and signal", async () => {
	const abort = new AbortController();
	const body = new TextEncoder().encode("part bytes");
	const proxied = new Request(
		"http://opaline.acme.lan/api/selfhost/objects/part?upload=u1&part=1",
		{
			method: "PUT",
			headers: {
				"content-length": String(body.byteLength),
				"x-forwarded-proto": "https",
			},
			body,
			signal: abort.signal,
		},
	);

	const request = atPublicOrigin(proxied, "https://opaline.acme.lan");

	expect(request.url).toBe(
		"https://opaline.acme.lan/api/selfhost/objects/part?upload=u1&part=1",
	);
	expect(request.method).toBe("PUT");
	expect(request.headers.get("content-length")).toBe("10");
	expect(request.headers.get("x-forwarded-proto")).toBe("https");
	expect(await request.text()).toBe("part bytes");
	abort.abort();
	expect(request.signal.aborted).toBe(true);
});

test("a request already at the public origin is passed through as it is", () => {
	const direct = new Request("http://localhost:4100/health");
	expect(atPublicOrigin(direct, "http://localhost:4100")).toBe(direct);
});
