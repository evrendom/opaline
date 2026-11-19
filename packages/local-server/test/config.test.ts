import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getClickHouseLayout,
	renderClickHouseConfig,
	renderClickHouseOverlay,
	renderClickHouseUsers,
	writeClickHouseConfig,
} from "../src/clickhouse-config.js";
import {
	getPostgresConnectionString,
	getPostgresLayout,
	getPostgresStartArgs,
	probePostgres,
} from "../src/postgres.js";
import {
	readRunningService,
	startDetachedService,
	stopService,
	tailFile,
} from "../src/processes.js";
import { resolveCheckoutDistribution } from "../src/server-distribution.js";
import {
	desktopAppEnvironment,
	getServerEnvironment,
} from "../src/server-runner.js";
import type { ServerState } from "../src/server-state.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-selfhost-config-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("ClickHouse config", () => {
	test("the overlay carries the self-hosting limits and compatibility", () => {
		const overlay = renderClickHouseOverlay(3 * 1024 * 1024 * 1024);
		expect(overlay).toContain("<listen_host>127.0.0.1</listen_host>");
		expect(overlay).toContain("<ttl>event_date + INTERVAL 3 DAY DELETE</ttl>");
		expect(overlay).toContain("<old_parts_lifetime>120</old_parts_lifetime>");
		expect(overlay).toContain(
			"<max_server_memory_usage>3221225472</max_server_memory_usage>",
		);
		expect(overlay).toContain("<mark_cache_size>268435456</mark_cache_size>");
		expect(overlay).toMatch(
			/<policies>\s*<s3>\s*<volumes>\s*<default>\s*<disk>default<\/disk>/u,
		);
		expect(overlay).toMatch(/<query_log>\s*<database>system<\/database>/u);
	});

	test("an idle ClickHouse polls its insert queue and memory rarely", () => {
		const overlay = renderClickHouseOverlay(3 * 1024 * 1024 * 1024);
		expect(overlay).toContain("<async_insert_threads>4</async_insert_threads>");
		expect(overlay).toContain(
			"<memory_worker_period_ms>1000</memory_worker_period_ms>",
		);
		expect(renderClickHouseUsers("p")).toContain(
			"<log_queries_min_type>QUERY_FINISH</log_queries_min_type>",
		);
		expect(renderClickHouseUsers("p")).toContain(
			"<async_insert_poll_timeout_ms>50</async_insert_poll_timeout_ms>",
		);
	});

	test("the base config keeps every path inside the data directory", () => {
		const layout = getClickHouseLayout(join(root, "a&b"));
		const config = renderClickHouseConfig(layout, {
			httpPort: 18123,
			tcpPort: 19000,
			password: "x",
			maxServerMemoryBytes: 4 * 1024 ** 3,
		});
		expect(config).toContain("<http_port>18123</http_port>");
		expect(config).toContain("<tcp_port>19000</tcp_port>");
		expect(config).toContain(
			`<path>${join(root, "a&amp;b", "clickhouse", "data")}/</path>`,
		);
		expect(config).toContain(
			`${join(root, "a&amp;b", "clickhouse", "users.xml")}`,
		);
		expect(config).not.toContain("listen_host");
		expect(config).not.toContain("mysql_port");
	});

	test("users.xml stores only a password hash and allows loopback only", () => {
		const users = renderClickHouseUsers("s3cret");
		const hash = createHash("sha256").update("s3cret").digest("hex");
		expect(users).toContain(
			`<password_sha256_hex>${hash}</password_sha256_hex>`,
		);
		expect(users).not.toContain("s3cret");
		expect(users).toContain("<ip>127.0.0.1</ip>");
		expect(users).toContain("<ip>::1</ip>");
		expect(users).not.toContain("::/0");
		expect(users).toContain("<log_queries>1</log_queries>");
		expect(users).toContain(
			"<query_plan_merge_expressions>0</query_plan_merge_expressions>",
		);
	});

	test("files are written privately", () => {
		const layout = writeClickHouseConfig(root, {
			httpPort: 1,
			tcpPort: 2,
			password: "p",
			maxServerMemoryBytes: 3 * 1024 * 1024 * 1024,
		});
		for (const path of [
			layout.configPath,
			layout.overlayPath,
			layout.usersPath,
		])
			expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});

describe("Postgres", () => {
	test("listens on 127.0.0.1 only, without a Unix socket", () => {
		const args = getPostgresStartArgs(getPostgresLayout(root), 5544);
		expect(args).toContain("listen_addresses=127.0.0.1");
		expect(args).toContain("unix_socket_directories=");
		expect(args.slice(0, 4)).toEqual([
			"-D",
			join(root, "postgres", "data"),
			"-p",
			"5544",
		]);
	});

	test("the connection string escapes the password", () => {
		expect(getPostgresConnectionString(5544, "a/b+c")).toBe(
			"postgres://opaline:a%2Fb%2Bc@127.0.0.1:5544/opaline",
		);
	});

	test("readiness distinguishes ready, starting and unreachable", async () => {
		const replies: Buffer[] = [
			Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 10]),
			errorMessage("57P03"),
			errorMessage("28P01"),
		];
		const results: string[] = [];
		for (const reply of replies) {
			const server = await listen((socket) => {
				socket.once("data", () => socket.end(reply));
			});
			results.push(await probePostgres(port(server)));
			server.close();
		}
		const closed = await listen(() => {});
		const closedPort = port(closed);
		closed.close();
		results.push(await probePostgres(closedPort));
		expect(results).toEqual(["ready", "starting", "ready", "unreachable"]);
	});
});

describe("server environment", () => {
	const distribution = {
		kind: "checkout" as const,
		root: "/srv/athena",
		entry: "/srv/athena/app/server/src/selfhost/main.ts",
		webDir: "/srv/athena/app/ui/dist",
		hasWebBuild: true,
		source: "checkout /srv/athena",
	};

	test("sets every variable of the contract", () => {
		const environment = getServerEnvironment(root, state(), distribution);
		expect(Object.keys(environment).sort()).toEqual(
			[
				"ALLOWED_ORIGIN",
				"APP_URL",
				"BETTER_AUTH_SECRET",
				"CLICKHOUSE_FLAVOR",
				"CLICKHOUSE_PASSWORD",
				"CLICKHOUSE_URL",
				"CLICKHOUSE_USERNAME",
				"CRON_SECRET",
				"HOST",
				"NODE_ENV",
				"OPALINE_DATA_DIR",
				"OPALINE_SELF_HOSTED",
				"OPALINE_SETUP_TOKEN",
				"OPALINE_WEB_DIR",
				"PG_CONNECTION_STRING",
				"PORT",
			].sort(),
		);
		expect(environment).toMatchObject({
			OPALINE_SELF_HOSTED: "1",
			PORT: "4100",
			HOST: "127.0.0.1",
			APP_URL: "http://localhost:4100",
			CLICKHOUSE_URL: "http://127.0.0.1:18123",
			CLICKHOUSE_USERNAME: "default",
			CLICKHOUSE_FLAVOR: "auto",
			OPALINE_WEB_DIR: "/srv/athena/app/ui/dist",
			OPALINE_DATA_DIR: join(root, "data"),
		});
	});

	test("says the desktop app is present only when the app started it", () => {
		expect(desktopAppEnvironment({ OPALINE_DESKTOP_APP: "1" })).toEqual({
			OPALINE_DESKTOP_APP: "1",
		});
		expect(desktopAppEnvironment({})).toEqual({});
		expect(desktopAppEnvironment({ OPALINE_DESKTOP_APP: "true" })).toEqual({});
	});

	test("without a web build the server runs API-only", () => {
		const environment = getServerEnvironment(root, state(), {
			...distribution,
			hasWebBuild: false,
		});
		expect(environment).not.toHaveProperty("OPALINE_WEB_DIR");
	});

	test("an external ClickHouse is passed through as configured", () => {
		const environment = getServerEnvironment(
			root,
			state({
				mode: "external",
				url: "http://nas.local:8123",
				user: "opaline",
				password: "pw",
			}),
			distribution,
		);
		expect(environment).toMatchObject({
			CLICKHOUSE_URL: "http://nas.local:8123",
			CLICKHOUSE_USERNAME: "opaline",
			CLICKHOUSE_PASSWORD: "pw",
		});
	});
});

describe("server checkout", () => {
	test("is used only when OPALINE_SERVER_DIR is set", () => {
		expect(resolveCheckoutDistribution({})).toBeUndefined();
		expect(
			String(resolveCheckoutDistribution({ OPALINE_SERVER_DIR: root })),
		).toContain("has no app/server/src/selfhost/main.ts");
	});

	test("finds the self-host entry point and the web build", () => {
		const entry = join(root, "app", "server", "src", "selfhost");
		mkdirSync(entry, { recursive: true });
		writeFileSync(join(entry, "main.ts"), "");
		expect(resolveCheckoutDistribution({ OPALINE_SERVER_DIR: root })).toEqual({
			kind: "checkout",
			root,
			entry: join(entry, "main.ts"),
			webDir: join(root, "app", "ui", "dist"),
			hasWebBuild: false,
			source: `checkout ${root}`,
		});
		mkdirSync(join(root, "app", "ui", "dist"), { recursive: true });
		writeFileSync(join(root, "app", "ui", "dist", "index.html"), "");
		expect(
			resolveCheckoutDistribution({ OPALINE_SERVER_DIR: root }),
		).toMatchObject({ hasWebBuild: true });
	});
});

describe("detached services", () => {
	test("start with a pid file and log, and stop cleanly", async () => {
		const script = join(root, "service.sh");
		writeFileSync(
			script,
			"#!/bin/sh\necho started\ntrap 'echo bye; exit 0' TERM\nwhile true; do sleep 0.1; done\n",
		);
		const record = startDetachedService({
			dataDir: root,
			name: "server",
			command: "/bin/sh",
			args: [script],
			env: { PATH: "/usr/bin:/bin" },
			cwd: root,
			marker: script,
		});
		const log = join(root, "logs", "server.log");
		for (let attempt = 0; attempt < 100; attempt++) {
			if (tailFile(log, 1) === "started") break;
			await Bun.sleep(50);
		}
		expect((await readRunningService(root, "server"))?.pid).toBe(record.pid);
		expect(statSync(join(root, "run", "server.pid")).mode & 0o777).toBe(0o600);
		expect(
			await stopService(root, "server", {
				signal: "SIGTERM",
				timeoutMs: 5_000,
			}),
		).toBe("stopped");
		expect(await readRunningService(root, "server")).toBeUndefined();
		expect(tailFile(log, 2)).toBe("started\nbye");
		expect(
			await stopService(root, "server", { signal: "SIGTERM", timeoutMs: 100 }),
		).toBe("not-running");
	});

	test("a pid that now belongs to another program is not ours", async () => {
		mkdirSync(join(root, "run"), { recursive: true });
		writeFileSync(
			join(root, "run", "postgres.pid"),
			JSON.stringify({
				pid: process.pid,
				marker: "/no/such/postgres/data",
				startedAt: new Date().toISOString(),
			}),
		);
		expect(await readRunningService(root, "postgres")).toBeUndefined();
		writeFileSync(join(root, "run", "postgres.pid"), "not json");
		expect(await readRunningService(root, "postgres")).toBeUndefined();
	});
});

function state(
	clickhouse: ServerState["clickhouse"] = {
		mode: "local",
		httpPort: 18123,
		tcpPort: 19000,
		user: "default",
		password: "ch",
	},
): ServerState {
	return {
		version: 1,
		createdAt: "2026-11-08T00:00:00.000Z",
		updatedAt: "2026-11-08T00:00:00.000Z",
		port: 4100,
		host: "127.0.0.1",
		publicUrl: "http://localhost:4100",
		secrets: {
			betterAuthSecret: "b".repeat(43),
			cronSecret: "c".repeat(43),
			setupToken: "s".repeat(43),
		},
		clickhouse,
		postgres: {
			port: 5544,
			user: "opaline",
			password: "pg",
			database: "opaline",
		},
	};
}

function errorMessage(code: string): Buffer {
	const body = Buffer.from(`SFATAL\0C${code}\0Mtest\0\0`, "utf8");
	const header = Buffer.alloc(5);
	header.write("E", 0);
	header.writeInt32BE(body.length + 4, 1);
	return Buffer.concat([header, body]);
}

function listen(handler: (socket: Socket) => void): Promise<Server> {
	return new Promise((resolve) => {
		const server = createServer(handler);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

function port(server: Server): number {
	const address = server.address();
	return typeof address === "object" && address ? address.port : 0;
}
