import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MAIN = join(import.meta.dir, "main.ts");
const CHECKOUT = resolve(import.meta.dir, "../../../../..");
const home = mkdtempSync(join(tmpdir(), "opaline-main-"));

afterAll(() => {
	rmSync(home, { recursive: true, force: true });
});

async function start(env: Record<string, string>) {
	const child = Bun.spawn([process.execPath, MAIN], {
		cwd: home,
		env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function closedPort(): number {
	const listener = Bun.listen({
		hostname: "127.0.0.1",
		port: 0,
		socket: { data() {} },
	});
	const { port } = listener;
	listener.stop(true);
	return port;
}

test("a bad environment stops the server with every problem listed and nothing else", async () => {
	const result = await start({
		PORT: "http",
		CLICKHOUSE_FLAVOR: "nas",
		OPALINE_SETUP_TOKEN: "short",
		STRIPE_SECRET_KEY: "sk_live_x",
	});

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toBe(
		[
			"Opaline cannot start:",
			'  - PORT must be a port number, not "http"',
			"  - PG_CONNECTION_STRING is not set: the Postgres URL, e.g. postgres://opaline@127.0.0.1:5432/opaline",
			"  - CLICKHOUSE_URL is not set: the ClickHouse HTTP endpoint, e.g. http://127.0.0.1:8123",
			'  - CLICKHOUSE_FLAVOR must be auto, oss or cloud, not "nas"',
			"  - BETTER_AUTH_SECRET is not set: a random secret of at least 32 characters (openssl rand -base64 32)",
			"  - OPALINE_SETUP_TOKEN must be at least 16 characters",
			"",
		].join("\n"),
	);
});

test("a valid environment announces itself, makes the data directory and stops on an unreachable Postgres without printing its password", async () => {
	const port = closedPort();
	const dataDir = join(home, "data", "server");

	const result = await start({
		PG_CONNECTION_STRING: `postgres://opaline:pg-password-123@127.0.0.1:${port}/opaline`,
		CLICKHOUSE_URL: "http://127.0.0.1:8123",
		BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
		OPALINE_DATA_DIR: dataDir,
		OPALINE_VERSION: "1.2.3",
		STRIPE_SECRET_KEY: "sk_live_x",
		SENTRY_API_DSN: "https://sentry.invalid/1",
	});

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr.split("\n")).toEqual([
		`opaline: version 1.2.3 (checkout ${CHECKOUT})`,
		"opaline: ignoring STRIPE_SECRET_KEY, SENTRY_API_DSN (never called when self-hosted)",
		`opaline: Cannot reach Postgres at postgres://opaline:***@127.0.0.1:${port}/opaline: connect ECONNREFUSED 127.0.0.1:${port}`,
		"",
	]);
	expect(existsSync(dataDir)).toBe(true);
});
