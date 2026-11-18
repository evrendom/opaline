import { afterAll, expect, test } from "bun:test";
import { ConvexCallError, createConvexHttpClient } from "./convex-http.js";

// A local stand-in for a Convex deployment: it records each request and
// answers as Convex's HTTP API does for the function path it was sent.
const requests: {
	url: string;
	authorization: string | null;
	contentType: string | null;
	body: unknown;
}[] = [];
const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const body: unknown = await request.json();
		requests.push({
			url: new URL(request.url).pathname,
			authorization: request.headers.get("authorization"),
			contentType: request.headers.get("content-type"),
			body,
		});
		const path =
			typeof body === "object" && body !== null && "path" in body
				? body.path
				: undefined;
		switch (path) {
			case "analyses:get":
				return Response.json({
					status: "success",
					value: { id: "a_1", topics: ["x"] },
					logLines: ["quoted evidence"],
				});
			case "steps:create":
				return Response.json(
					{
						status: "error",
						errorMessage: "Uncaught ConvexError: full; args: secret",
						errorData: { kind: "analysisFull", child: "steps" },
					},
					{ status: 560 },
				);
			case "queries:create":
				return Response.json(
					{
						status: "error",
						errorMessage: "Uncaught Error: bad args sk-live-secret",
					},
					{ status: 560 },
				);
			case "queries:get":
				return new Response("ArgumentValidationError: sk-live-secret", {
					status: 400,
				});
			case "queries:list":
				return new Response("<html>gateway</html>", { status: 200 });
			case "analyses:recent":
				// Answers only after the client has given up.
				return Bun.sleep(1_000).then(() =>
					Response.json({ status: "success", value: [] }),
				);
			default:
				return Response.json({ status: "weird" });
		}
	},
});
afterAll(() => server.stop(true));

const call = createConvexHttpClient(`${server.url.origin}/`);
const options = () => ({ token: "t0k3n", signal: AbortSignal.timeout(5_000) });

test("a successful call posts the path and JSON args to the function type's endpoint and returns the value", async () => {
	const value = await call(
		"query",
		"analyses:get",
		{ id: "a_1", nested: { kept: [1, null, "x"], dropped: undefined } },
		options(),
	);
	expect(value).toEqual({ id: "a_1", topics: ["x"] });
	expect(requests.at(-1)).toEqual({
		url: "/api/query",
		authorization: "Bearer t0k3n",
		contentType: "application/json",
		body: {
			path: "analyses:get",
			args: { id: "a_1", nested: { kept: [1, null, "x"] } },
			format: "json",
		},
	});

	await call("mutation", "analyses:get", {}, options());
	expect(requests.at(-1)?.url).toBe("/api/mutation");
	await call("action", "analyses:get", {}, options());
	expect(requests.at(-1)?.url).toBe("/api/action");
});

test("a ConvexError keeps its data and drops the server's message", async () => {
	const error = await failure(() =>
		call("mutation", "steps:create", { step: {} }, options()),
	);
	expect(error.failure).toEqual({
		kind: "convexError",
		data: { kind: "analysisFull", child: "steps" },
	});
	expect(error.message).toBe("Convex steps:create failed (ConvexError)");
});

test("a plain function error names only the function", async () => {
	const error = await failure(() =>
		call("mutation", "queries:create", {}, options()),
	);
	expect(error.failure).toEqual({ kind: "functionError" });
	expect(error.message).toBe("Convex queries:create failed (Error)");
});

test("HTTP errors and malformed answers name only the function and status", async () => {
	const http = await failure(() => call("query", "queries:get", {}, options()));
	expect(http.failure).toEqual({ kind: "httpError", status: 400 });
	expect(http.message).toBe("Convex queries:get failed (HTTP 400)");

	for (const path of ["queries:list", "unknown:fn"]) {
		const invalid = await failure(() => call("query", path, {}, options()));
		expect(invalid.failure).toEqual({ kind: "invalidResponse" });
		expect(invalid.message).not.toContain("gateway");
	}
});

test("values JSON would silently change are refused before anything is sent", async () => {
	const sent = requests.length;
	for (const args of [
		{ at: new Date(0) },
		{ count: Number.NaN },
		{ count: 1n },
		{ items: [undefined] },
		{ map: new Map() },
	]) {
		const error = await failure(() =>
			call("mutation", "analyses:get", args, options()),
		);
		expect(error.failure).toEqual({ kind: "invalidArguments" });
	}
	expect(requests.length).toBe(sent);
});

test("an aborted call rejects with the abort reason's error", async () => {
	const controller = new AbortController();
	const pending = call(
		"query",
		"analyses:recent",
		{},
		{
			token: "t0k3n",
			signal: controller.signal,
		},
	);
	controller.abort();
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });

	await expect(
		call(
			"query",
			"analyses:recent",
			{},
			{
				token: "t0k3n",
				signal: AbortSignal.timeout(50),
			},
		),
	).rejects.toMatchObject({ name: "TimeoutError" });
});

test("deployment URLs are checked as ConvexHttpClient checks them", () => {
	for (const url of [
		"",
		"intent-swordfish-667.convex.cloud",
		"ftp://x.convex.cloud",
		"https://intent-swordfish-667.convex.site",
	])
		expect(() => createConvexHttpClient(url)).toThrow(
			"Invalid Convex deployment URL",
		);
	expect(() =>
		createConvexHttpClient("https://intent-swordfish-667.convex.cloud"),
	).not.toThrow();
});

async function failure(run: () => Promise<unknown>): Promise<ConvexCallError> {
	const error = await run().then(
		() => undefined,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(ConvexCallError);
	if (!(error instanceof ConvexCallError))
		throw new Error("expected a ConvexCallError");
	return error;
}
