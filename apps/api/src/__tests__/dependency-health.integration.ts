import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { createClient } from "@clickhouse/client-web";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import postgres from "postgres";
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
	for (const missingPrivilege of ["INSERT", "SELECT"]) {
		test(`reports ClickHouse unavailable when SELECT 1 succeeds but storage ${missingPrivilege} is denied`, async () => {
			const url = process.env.CLICKHOUSE_URL;
			expect(url).toBeTruthy();
			const admin = createClient({
				url,
				username: resolveClickHouseUsername(process.env, url),
				password: process.env.CLICKHOUSE_PASSWORD || "",
			});
			const username = `health_${crypto.randomUUID().replaceAll("-", "")}`;
			const restricted = createClient({ url, username, password: "" });
			await admin.command({
				query: `CREATE USER ${username} IDENTIFIED WITH no_password`,
			});
			try {
				const allowedPrivilege =
					missingPrivilege === "INSERT" ? "SELECT" : "INSERT";
				await admin.command({
					query: `GRANT ${allowedPrivilege} ON rudel.dependency_health_probes TO ${username}`,
				});
				const trivial = await restricted.query({
					query: "SELECT 1 AS healthy",
					format: "JSONEachRow",
				});
				expect(await trivial.json()).toEqual([{ healthy: 1 }]);
				const base = await start({
					CLICKHOUSE_USERNAME: username,
					CLICKHOUSE_USER: username,
					CLICKHOUSE_PASSWORD: "",
				});
				const response = await fetch(`${base}/health/ready`);
				expect(response.status).toBe(503);
				expect(await response.json()).toMatchObject({
					status: "unavailable",
					dependencies: {
						postgres: { status: "ok" },
						clickhouse: { status: "unavailable" },
						// Without INSERT, reads still serve analytics; without SELECT they cannot.
						clickhouse_read: {
							status: missingPrivilege === "INSERT" ? "ok" : "unavailable",
						},
					},
				});
				// Granting the missing privilege makes the same real storage probe pass.
				await admin.command({
					query: `GRANT ${missingPrivilege} ON rudel.dependency_health_probes TO ${username}`,
				});
				const recovered = await start({
					CLICKHOUSE_USERNAME: username,
					CLICKHOUSE_USER: username,
					CLICKHOUSE_PASSWORD: "",
				});
				expect((await fetch(`${recovered}/health/ready`)).status).toBe(200);
			} finally {
				await restricted.close();
				await admin.command({ query: `DROP USER ${username}` });
				await admin.close();
			}
		}, 15_000);
	}

	test("reports Postgres unavailable when SELECT 1 succeeds on a read-only connection", async () => {
		const url = process.env.PG_CONNECTION_STRING;
		if (!url) throw new Error("PG_CONNECTION_STRING is required");
		const admin = postgres(url);
		const username = `health_${crypto.randomUUID().replaceAll("-", "")}`;
		const restrictedUrl = new URL(url);
		restrictedUrl.username = username;
		restrictedUrl.password = "health-test-only";
		const restricted = postgres(restrictedUrl.toString());
		await admin.unsafe(
			`CREATE ROLE ${username} LOGIN PASSWORD 'health-test-only'`,
		);
		try {
			await admin.unsafe(
				`GRANT SELECT, INSERT, DELETE ON dependency_health_probe TO ${username}`,
			);
			await admin.unsafe(
				`ALTER ROLE ${username} SET default_transaction_read_only = on`,
			);
			expect([...(await restricted`SELECT 1 AS healthy`)]).toEqual([
				{ healthy: 1 },
			]);
			const base = await start({
				PG_CONNECTION_STRING: restrictedUrl.toString(),
			});
			const response = await fetch(`${base}/health/ready`);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({
				dependencies: {
					postgres: { status: "unavailable" },
					clickhouse: { status: "ok" },
				},
			});
		} finally {
			await restricted.end();
			await admin.unsafe(`DROP OWNED BY ${username}`);
			await admin.unsafe(`DROP ROLE ${username}`);
			await admin.end();
		}
	}, 15_000);

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
					clickhouse_read: { status: "ok", duration_ms: expect.any(Number) },
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
					clickhouse_read: {
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
					clickhouse_read: {
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
