import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import {
	DEFAULT_GITHUB_HISTORY_DAYS,
	MAX_GITHUB_HISTORY_DAYS,
	parseGitHubHistoryDays,
	parseSqlQuotaPerHour,
} from "../lib/self-hosted.js";
import { objectStoreConfigurationProblems } from "../services/r2-ingest-storage.service.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface SelfHostConfig {
	readonly port: number;
	readonly host: string;
	readonly appUrl: string;
	readonly allowedOrigin: string;
	readonly webDir: string | null;
	readonly dataDir: string | null;
	readonly setupToken: string | null;
	readonly cronSecret: string;
	readonly sqlQuotaPerHour: number | null;
	readonly openSignup: boolean;
	readonly githubHistoryDays: number;
}

export class SelfHostConfigError extends Error {
	constructor(readonly problems: readonly string[]) {
		super(
			`Opaline cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
		);
		this.name = "SelfHostConfigError";
	}
}

const DEFAULT_PORT = 4100;
export const SELF_HOSTED_READ_PATHS = {
	USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "all",
	USAGE_ROLLUP_ORG_IDS: "all",
	USAGE_ROLLUP_BACKFILL_ENABLED: "1",
	SKILL_ANALYTICS_CUTOVER_MODE: "all",
} as const;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function readSelfHostConfig(env: Environment): {
	config: SelfHostConfig;
	env: Record<string, string>;
} {
	const problems: string[] = [];
	const require = (name: string, hint: string): string => {
		const value = env[name]?.trim();
		if (!value) problems.push(`${name} is not set: ${hint}`);
		return value ?? "";
	};

	const port = readPort(env.PORT, problems);
	const host = env.HOST?.trim() || "127.0.0.1";
	const appUrl = readOrigin(
		"APP_URL",
		env.APP_URL?.trim() ||
			`http://${LOOPBACK.has(host) || host === "0.0.0.0" ? "localhost" : host}:${port}`,
		problems,
	);
	const allowedOrigin = readOrigin(
		"ALLOWED_ORIGIN",
		env.ALLOWED_ORIGIN?.trim() || appUrl,
		problems,
	);

	const pg = require("PG_CONNECTION_STRING", "the Postgres URL, e.g. postgres://opaline@127.0.0.1:5432/opaline");
	if (pg && !/^postgres(?:ql)?:\/\//u.test(pg))
		problems.push(
			"PG_CONNECTION_STRING must start with postgres:// or postgresql://",
		);

	const clickhouse = require("CLICKHOUSE_URL", "the ClickHouse HTTP endpoint, e.g. http://127.0.0.1:8123");
	if (clickhouse) {
		if (!/^https?:\/\/[^/]/u.test(clickhouse))
			problems.push(
				"CLICKHOUSE_URL must be an http:// or https:// URL of the ClickHouse HTTP interface",
			);
		else
			try {
				resolveClickHouseUsername(env, clickhouse);
			} catch (error) {
				problems.push(error instanceof Error ? error.message : String(error));
			}
	}
	const flavor = env.CLICKHOUSE_FLAVOR?.trim().toLowerCase();
	if (flavor && !["auto", "oss", "cloud"].includes(flavor))
		problems.push(
			`CLICKHOUSE_FLAVOR must be auto, oss or cloud, not ${JSON.stringify(env.CLICKHOUSE_FLAVOR)}`,
		);

	const secret = require("BETTER_AUTH_SECRET", "a random secret of at least 32 characters (openssl rand -base64 32)");
	if (secret && secret.length < 32)
		problems.push("BETTER_AUTH_SECRET must be at least 32 characters");

	const setupToken = env.OPALINE_SETUP_TOKEN?.trim() || null;
	if (setupToken !== null && setupToken.length < 16)
		problems.push("OPALINE_SETUP_TOKEN must be at least 16 characters");

	const configuredCronSecret = env.CRON_SECRET?.trim() ?? "";
	if (configuredCronSecret && configuredCronSecret.length < 16)
		problems.push("CRON_SECRET must be at least 16 characters");
	const cronSecret =
		configuredCronSecret || randomBytes(24).toString("base64url");

	const webDir = env.OPALINE_WEB_DIR?.trim() || null;
	if (webDir !== null && !existsSync(join(webDir, "index.html")))
		problems.push(
			`OPALINE_WEB_DIR=${webDir} has no index.html; point it at the built web app (app/ui/dist)`,
		);
	const dataDir = env.OPALINE_DATA_DIR?.trim() || null;
	problems.push(...objectStoreConfigurationProblems(env));

	const rawSqlQuota = env.OPALINE_SQL_QUOTA_PER_HOUR?.trim() ?? "";
	const sqlQuotaPerHour = parseSqlQuotaPerHour(rawSqlQuota);
	if (rawSqlQuota && sqlQuotaPerHour === null)
		problems.push(
			`OPALINE_SQL_QUOTA_PER_HOUR must be a whole number above 0, not ${JSON.stringify(env.OPALINE_SQL_QUOTA_PER_HOUR)}; leave it unset for no quota`,
		);
	const rawOpenSignup = env.OPALINE_OPEN_SIGNUP?.trim() ?? "";
	if (rawOpenSignup && rawOpenSignup !== "1" && rawOpenSignup !== "0")
		problems.push(
			`OPALINE_OPEN_SIGNUP must be 1 (anyone who reaches the server can sign up) or 0, not ${JSON.stringify(env.OPALINE_OPEN_SIGNUP)}`,
		);

	const githubHistoryDays = parseGitHubHistoryDays(
		env.OPALINE_GITHUB_HISTORY_DAYS,
	);
	if (githubHistoryDays === null)
		problems.push(
			`OPALINE_GITHUB_HISTORY_DAYS must be a whole number of days from 1 to ${MAX_GITHUB_HISTORY_DAYS}, not ${JSON.stringify(env.OPALINE_GITHUB_HISTORY_DAYS)}; leave it unset for ${DEFAULT_GITHUB_HISTORY_DAYS}`,
		);

	if (problems.length > 0) throw new SelfHostConfigError(problems);

	return {
		config: {
			port,
			host,
			appUrl,
			allowedOrigin,
			webDir,
			dataDir,
			setupToken,
			cronSecret,
			sqlQuotaPerHour,
			openSignup: rawOpenSignup === "1",
			githubHistoryDays: githubHistoryDays ?? DEFAULT_GITHUB_HISTORY_DAYS,
		},
		env: {
			OPALINE_SELF_HOSTED: "1",
			PORT: String(port),
			APP_URL: appUrl,
			ALLOWED_ORIGIN: allowedOrigin,
			CRON_SECRET: cronSecret,
			NODE_ENV: env.NODE_ENV?.trim() || "production",
			...Object.fromEntries(
				Object.entries(SELF_HOSTED_READ_PATHS).map(([name, value]) => [
					name,
					env[name]?.trim() || value,
				]),
			),
		},
	};
}

function readPort(raw: string | undefined, problems: string[]): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		problems.push(`PORT must be a port number, not ${JSON.stringify(raw)}`);
		return DEFAULT_PORT;
	}
	return port;
}

function readOrigin(name: string, raw: string, problems: string[]): string {
	try {
		const url = new URL(raw);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			throw new Error("not an origin");
		return url.origin;
	} catch {
		problems.push(
			`${name} must be an origin like http://localhost:4100, not ${JSON.stringify(raw)}`,
		);
		return raw;
	}
}
