import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const servers: ApiTestServer[] = [];
async function start(environment: Record<string, string> = {}) {
	const server = await startApiTestServer(environment);
	servers.push(server);
	return server.baseUrl;
}

afterAll(async () => {
	await Promise.all(servers.map((server) => server.stop()));
});

describe("database readiness", () => {
	test("runs real queries, supports concurrent probes and HEAD, and rejects mutations", async () => {
		const base = await start();
		const responses = await Promise.all(
			Array.from({ length: 3 }, () => fetch(`${base}/health/ready`)),
		);
		for (const response of responses) {
			expect(response.status).toBe(200);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.json()).toEqual({
				status: "ok",
				dependencies: {
					postgres: { status: "ok", duration_ms: expect.any(Number) },
					clickhouse: { status: "ok", duration_ms: expect.any(Number) },
				},
			});
		}
		const head = await fetch(`${base}/health/ready`, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");
		const post = await fetch(`${base}/health/ready`, { method: "POST" });
		expect(post.status).toBe(405);
		expect(post.headers.get("Allow")).toBe("GET, HEAD");
	}, 15_000);

	for (const dependency of ["postgres", "clickhouse", "both"]) {
		test(`returns 503 when ${dependency} is unavailable while liveness stays healthy`, async () => {
			const base = await start({
				...(dependency !== "clickhouse"
					? {
							PG_CONNECTION_STRING:
								"postgres://health:private-health-secret@127.0.0.1:1/health",
						}
					: {}),
				...(dependency !== "postgres"
					? { CLICKHOUSE_URL: "http://127.0.0.1:1" }
					: {}),
			});
			const response = await fetch(`${base}/health/ready`);
			expect(response.status).toBe(503);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.json()).toEqual({
				status: "unavailable",
				dependencies: {
					postgres: {
						status: dependency === "clickhouse" ? "ok" : "unavailable",
						duration_ms: expect.any(Number),
					},
					clickhouse: {
						status: dependency === "postgres" ? "ok" : "unavailable",
						duration_ms: expect.any(Number),
					},
				},
			});
			const liveness = await fetch(`${base}/health`);
			expect(liveness.status).toBe(200);
			expect(await liveness.json()).toEqual({ status: "ok" });
		}, 15_000);
	}

	test("bounds probes when real TCP connections accept but never answer", async () => {
		const sockets = new Set<Socket>();
		const blackhole = createServer((socket) => {
			sockets.add(socket);
			socket.on("error", () => {});
			socket.on("close", () => sockets.delete(socket));
		});
		blackhole.listen(0, "127.0.0.1");
		await new Promise<void>((resolve) => blackhole.once("listening", resolve));
		const address = blackhole.address();
		if (!address || typeof address === "string")
			throw new Error("TCP listener has no port");
		try {
			const base = await start({
				PG_CONNECTION_STRING: `postgres://health:private-health-secret@127.0.0.1:${address.port}/health`,
				CLICKHOUSE_URL: `http://127.0.0.1:${address.port}`,
			});
			const started = performance.now();
			const response = await fetch(`${base}/health/ready`);
			expect(performance.now() - started).toBeLessThan(4_500);
			expect(response.status).toBe(503);
			const body = await response.json();
			expect(body).toEqual({
				status: "unavailable",
				dependencies: {
					postgres: { status: "unavailable", duration_ms: expect.any(Number) },
					clickhouse: {
						status: "unavailable",
						duration_ms: expect.any(Number),
					},
				},
			});
			expect(JSON.stringify(body)).not.toContain("private-health-secret");
		} finally {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) =>
				blackhole.close((error) => (error ? reject(error) : resolve())),
			);
		}
	}, 15_000);
});
