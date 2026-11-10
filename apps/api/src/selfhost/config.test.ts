import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelfHostConfig, SelfHostConfigError } from "./config.js";
import { quoteIdentifier, redact } from "./postgres.js";

const base = {
	PG_CONNECTION_STRING: "postgres://opaline@127.0.0.1:5432/opaline",
	CLICKHOUSE_URL: "http://127.0.0.1:8123",
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

function problems(env: Record<string, string | undefined>): readonly string[] {
	try {
		readSelfHostConfig(env);
	} catch (error) {
		if (error instanceof SelfHostConfigError) return error.problems;
		throw error;
	}
	return [];
}

test("defaults: loopback on port 4100, the public origin is the app origin, and a cron secret is made up", () => {
	const { config, env } = readSelfHostConfig(base);
	expect(config).toMatchObject({
		port: 4100,
		host: "127.0.0.1",
		appUrl: "http://localhost:4100",
		allowedOrigin: "http://localhost:4100",
		webDir: null,
		setupToken: null,
		sqlQuotaPerHour: null,
		openSignup: false,
		githubHistoryDays: 90,
	});
	expect(config.cronSecret.length).toBeGreaterThanOrEqual(16);
	expect(env).toEqual({
		OPALINE_SELF_HOSTED: "1",
		PORT: "4100",
		APP_URL: "http://localhost:4100",
		ALLOWED_ORIGIN: "http://localhost:4100",
		CRON_SECRET: config.cronSecret,
		NODE_ENV: "production",
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "all",
		USAGE_ROLLUP_ORG_IDS: "all",
		USAGE_ROLLUP_BACKFILL_ENABLED: "1",
		SKILL_ANALYTICS_CUTOVER_MODE: "all",
	});
});

test("the read paths production turns on by environment are on, and the environment still wins", () => {
	const { env } = readSelfHostConfig({
		...base,
		USAGE_ROLLUP_ORG_IDS: "",
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "off",
	});
	expect(env).toMatchObject({
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "off",
		USAGE_ROLLUP_ORG_IDS: "all",
		USAGE_ROLLUP_BACKFILL_ENABLED: "1",
		SKILL_ANALYTICS_CUTOVER_MODE: "all",
	});
});

test("explicit settings are kept, origins are normalized", () => {
	const web = mkdtempSync(join(tmpdir(), "opaline-web-"));
	writeFileSync(join(web, "index.html"), "<!doctype html>");
	const { config, env } = readSelfHostConfig({
		...base,
		PORT: "4200",
		HOST: "0.0.0.0",
		APP_URL: "https://opaline.acme.lan/",
		CRON_SECRET: "cron-secret-0123456789",
		OPALINE_SETUP_TOKEN: "setup-token-0123456789",
		OPALINE_WEB_DIR: web,
		NODE_ENV: "development",
	});
	expect(config).toMatchObject({
		port: 4200,
		host: "0.0.0.0",
		appUrl: "https://opaline.acme.lan",
		allowedOrigin: "https://opaline.acme.lan",
		cronSecret: "cron-secret-0123456789",
		setupToken: "setup-token-0123456789",
		webDir: web,
	});
	expect(env.NODE_ENV).toBe("development");
	expect(
		readSelfHostConfig({ ...base, HOST: "192.168.2.74" }).config.appUrl,
	).toBe("http://192.168.2.74:4100");
});

test("every problem is reported at once, in words a user can act on", () => {
	const found = problems({
		PORT: "http",
		APP_URL: "localhost:4100/app",
		CLICKHOUSE_URL: "http://nas.local:8123",
		CLICKHOUSE_FLAVOR: "nas",
		BETTER_AUTH_SECRET: "short",
		OPALINE_SETUP_TOKEN: "short",
		CRON_SECRET: "short",
		OPALINE_WEB_DIR: "/nonexistent/dist",
	});
	expect(found).toEqual([
		'PORT must be a port number, not "http"',
		'APP_URL must be an origin like http://localhost:4100, not "localhost:4100/app"',
		'ALLOWED_ORIGIN must be an origin like http://localhost:4100, not "localhost:4100/app"',
		"PG_CONNECTION_STRING is not set: the Postgres URL, e.g. postgres://opaline@127.0.0.1:5432/opaline",
		expect.stringContaining("CLICKHOUSE_USERNAME is required for a non-local"),
		'CLICKHOUSE_FLAVOR must be auto, oss or cloud, not "nas"',
		"BETTER_AUTH_SECRET must be at least 32 characters",
		"OPALINE_SETUP_TOKEN must be at least 16 characters",
		"CRON_SECRET must be at least 16 characters",
		"OPALINE_WEB_DIR=/nonexistent/dist has no index.html; point it at the built web app (apps/web/dist)",
	]);
	expect(
		problems({
			...base,
			PG_CONNECTION_STRING: "mysql://x",
			CLICKHOUSE_URL: "nas:8123",
		}),
	).toEqual([
		"PG_CONNECTION_STRING must start with postgres:// or postgresql://",
		"CLICKHOUSE_URL must be an http:// or https:// URL of the ClickHouse HTTP interface",
	]);
	expect(
		problems({
			...base,
			CLICKHOUSE_URL: "http://192.168.2.74:8123",
			CLICKHOUSE_USERNAME: "opaline",
		}),
	).toEqual([]);
});

test("Postgres identifiers are quoted and passwords never printed", () => {
	expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
	expect(redact("postgres://opaline:secret@db:5432/opaline")).toBe(
		"postgres://opaline:***@db:5432/opaline",
	);
	expect(redact("not a url")).toBe("the configured PG_CONNECTION_STRING");
});

test("object storage env is checked at startup: incomplete S3, S3 next to R2 and partial R2 are refused", () => {
	expect(
		problems({ ...base, S3_BUCKET: "opaline", S3_ENDPOINT: "http://nas:8333" }),
	).toEqual([
		"S3_ACCESS_KEY_ID is not set: it is needed for S3 object storage",
		"S3_SECRET_ACCESS_KEY is not set: it is needed for S3 object storage",
	]);
	expect(
		problems({
			...base,
			S3_ACCESS_KEY_ID: "k",
			S3_BUCKET: "opaline",
			S3_ENDPOINT: "http://nas:8333",
			S3_SECRET_ACCESS_KEY: "s",
			R2_ACCOUNT_ID: "a",
		}),
	).toEqual(["set either the S3_* variables or R2_ACCOUNT_ID, not both"]);
	expect(problems({ ...base, R2_ACCESS_KEY_ID: "b" })).toEqual([
		"R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set together to use Cloudflare R2",
	]);
	expect(
		problems({
			...base,
			OPALINE_DATA_DIR: "/tmp/opaline-data",
			S3_ACCESS_KEY_ID: "k",
			S3_BUCKET: "opaline",
			S3_ENDPOINT: "http://127.0.0.1:8333",
			S3_SECRET_ACCESS_KEY: "s",
		}),
	).toEqual([]);
});

test("sign-up is invite only and the SQL quota is off unless the environment says otherwise", () => {
	expect(
		readSelfHostConfig({
			...base,
			OPALINE_SQL_QUOTA_PER_HOUR: "600",
			OPALINE_OPEN_SIGNUP: "1",
		}).config,
	).toMatchObject({ sqlQuotaPerHour: 600, openSignup: true });
	expect(
		readSelfHostConfig({ ...base, OPALINE_OPEN_SIGNUP: "0" }).config.openSignup,
	).toBe(false);
	expect(
		problems({
			...base,
			OPALINE_SQL_QUOTA_PER_HOUR: "0",
			OPALINE_OPEN_SIGNUP: "yes",
		}),
	).toEqual([
		'OPALINE_SQL_QUOTA_PER_HOUR must be a whole number above 0, not "0"; leave it unset for no quota',
		'OPALINE_OPEN_SIGNUP must be 1 (anyone who reaches the server can sign up) or 0, not "yes"',
	]);
	expect(
		problems({ ...base, OPALINE_SQL_QUOTA_PER_HOUR: "12.5" }),
	).toHaveLength(1);
});

test("GitHub history is 90 days unless OPALINE_GITHUB_HISTORY_DAYS says 1 to 730", () => {
	expect(readSelfHostConfig(base).config.githubHistoryDays).toBe(90);
	expect(
		readSelfHostConfig({ ...base, OPALINE_GITHUB_HISTORY_DAYS: "7" }).config
			.githubHistoryDays,
	).toBe(7);
	expect(problems({ ...base, OPALINE_GITHUB_HISTORY_DAYS: "1000" })).toEqual([
		'OPALINE_GITHUB_HISTORY_DAYS must be a whole number of days from 1 to 730, not "1000"; leave it unset for 90',
	]);
});
