#!/usr/bin/env bun

import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import postgres from "postgres";

interface CliCredentials {
	user: {
		email: string;
		id: string;
	};
}

interface BrowserSession {
	active_organization_id: string | null;
	expires_at: Date;
	token: string;
}

interface ResolvedApiEnvironment {
	environment: NodeJS.ProcessEnv;
	source: string;
}

const ROOT_DIR = resolve(import.meta.dirname, "..");
const API_DIR = join(ROOT_DIR, "apps/api");
const WEB_DIR = join(ROOT_DIR, "apps/web");
const MARKETING_DIR = join(ROOT_DIR, "apps/marketing");
const DEFAULT_API_ORIGIN = "http://localhost:4010";
const DEFAULT_WEB_ORIGIN = "http://localhost:4011";
const DEFAULT_MARKETING_ORIGIN = "http://127.0.0.1:4322";

async function main(): Promise<void> {
	const checkOnly = parseArgs(process.argv.slice(2));
	const { environment: apiEnvironment, source } = resolveApiEnvironment();
	const credentials = readCliCredentials();
	const session = await findCurrentBrowserSession(
		apiEnvironment.PG_CONNECTION_STRING as string,
		credentials,
	);
	const bearerToken = signBetterAuthSessionToken(
		session.token,
		apiEnvironment.BETTER_AUTH_SECRET as string,
	);

	log(
		`Real session ready for ${credentials.user.email} (expires ${session.expires_at.toISOString()}; API env: ${source}).`,
	);

	if (checkOnly) {
		await verifyRunningApiIfAvailable(bearerToken, credentials.user.id);
		return;
	}
	const runningApiState = await probeRunningApi(
		bearerToken,
		credentials.user.id,
	);
	if (runningApiState === "different-user") {
		throw new Error(
			"Port 4010 is occupied by an API with a different auth environment. Stop that API before running dev:real.",
		);
	}
	const runningMarketingState = await probeRunningMarketing();
	if (runningMarketingState === "different-app") {
		throw new Error(
			"Port 4322 is occupied by a different app. Stop that process before running dev:real.",
		);
	}

	const webEnvironment: NodeJS.ProcessEnv = {
		...process.env,
		RUDEL_API_BEARER_TOKEN: bearerToken,
		RUDEL_API_TARGET: DEFAULT_API_ORIGIN,
	};
	const localApiEnvironment: NodeJS.ProcessEnv = {
		...apiEnvironment,
		ALLOWED_ORIGIN: DEFAULT_WEB_ORIGIN,
		APP_URL: DEFAULT_API_ORIGIN,
		PORT: "4010",
		TRUSTED_ORIGINS: mergeOrigins(
			apiEnvironment.TRUSTED_ORIGINS,
			DEFAULT_WEB_ORIGIN,
			"http://127.0.0.1:4011",
		),
	};

	log("Starting the real authenticated app:");
	log("  marketing  http://127.0.0.1:4322/instantv2");
	log("  product    http://127.0.0.1:4011/session");
	log("  API        http://127.0.0.1:4010");

	const processes: Array<{ child: ChildProcess; label: string }> = [];
	if (runningApiState === "authenticated") {
		log("Reusing the authenticated API already running on port 4010.");
	} else {
		processes.push(
			spawnProcess("API", ["src/index.ts"], API_DIR, localApiEnvironment),
		);
	}
	processes.push(
		spawnProcess(
			"product",
			["run", "dev", "--", "--host", "127.0.0.1", "--port", "4011", "--strictPort"],
			WEB_DIR,
			webEnvironment,
		),
	);
	if (runningMarketingState === "matching") {
		log("Reusing the Opaline marketing server already running on port 4322.");
	} else {
		processes.push(
			spawnProcess(
				"marketing",
				["run", "dev", "--", "--host", "127.0.0.1", "--port", "4322"],
				MARKETING_DIR,
				{
					...process.env,
					// Astro auto-detaches dev servers when it detects an agent. Marking
					// the child explicitly keeps it in this launcher's process group.
					ASTRO_DEV_BACKGROUND: "1",
				},
			),
		);
	}
	await runProcesses(processes);
}

function parseArgs(args: readonly string[]): boolean {
	if (args.length === 0) return false;
	if (args.length === 1 && args[0] === "--check") return true;
	throw new Error("Usage: bun run dev:real [--check]");
}

function resolveApiEnvironment(): ResolvedApiEnvironment {
	const explicitPath = process.env.RUDEL_API_ENV_FILE?.trim();
	if (explicitPath) {
		const filePath = resolve(explicitPath);
		if (!existsSync(filePath)) {
			throw new Error(`RUDEL_API_ENV_FILE does not exist: ${filePath}`);
		}
		return validateApiEnvironment(
			{ ...parseEnvFile(filePath), ...process.env },
			filePath,
		);
	}

	if (hasRequiredApiEnvironment(process.env)) {
		return { environment: { ...process.env }, source: "process environment" };
	}

	const candidates = [
		join(API_DIR, ".env.local"),
		join(ROOT_DIR, ".env.local"),
		"/tmp/rudel-api-env.txt",
	];
	for (const filePath of candidates) {
		if (!existsSync(filePath)) continue;
		const environment = { ...parseEnvFile(filePath), ...process.env };
		if (hasRequiredApiEnvironment(environment)) {
			return { environment, source: filePath };
		}
	}

	throw new Error(
		"Real dev needs PG_CONNECTION_STRING and BETTER_AUTH_SECRET. Set them in the environment or point RUDEL_API_ENV_FILE at the API env file.",
	);
}

function validateApiEnvironment(
	environment: NodeJS.ProcessEnv,
	source: string,
): ResolvedApiEnvironment {
	if (!hasRequiredApiEnvironment(environment)) {
		throw new Error(
			`${source} must define PG_CONNECTION_STRING and BETTER_AUTH_SECRET.`,
		);
	}
	return { environment, source };
}

function hasRequiredApiEnvironment(
	environment: NodeJS.ProcessEnv,
): boolean {
	return Boolean(
		environment.PG_CONNECTION_STRING?.trim() &&
			environment.BETTER_AUTH_SECRET?.trim(),
	);
}

function parseEnvFile(filePath: string): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(
			line,
		);
		if (!match) continue;

		const [, name, rawValue] = match;
		if (!name || rawValue === undefined) continue;
		const quoted = rawValue.match(/^(['"])(.*)\1$/u);
		environment[name] = quoted?.[2] ?? rawValue;
	}
	return environment;
}

function readCliCredentials(): CliCredentials {
	const configDirectory = process.env.RUDEL_CONFIG_DIR
		? resolve(process.env.RUDEL_CONFIG_DIR)
		: join(homedir(), ".rudel");
	const credentialsPath = join(configDirectory, "credentials.json");
	if (!existsSync(credentialsPath)) {
		throw new Error(
			`No Rudel CLI credentials found at ${credentialsPath}. Run the CLI login flow first.`,
		);
	}

	let value: unknown;
	try {
		value = JSON.parse(readFileSync(credentialsPath, "utf8"));
	} catch {
		throw new Error(`Could not parse Rudel CLI credentials at ${credentialsPath}.`);
	}

	if (!isCliCredentials(value)) {
		throw new Error(
			`Rudel CLI credentials at ${credentialsPath} do not include a valid user identity.`,
		);
	}
	return value;
}

function isCliCredentials(value: unknown): value is CliCredentials {
	if (typeof value !== "object" || value === null || !("user" in value)) {
		return false;
	}
	const user = value.user;
	return (
		typeof user === "object" &&
		user !== null &&
		"id" in user &&
		typeof user.id === "string" &&
		user.id.length > 0 &&
		"email" in user &&
		typeof user.email === "string" &&
		user.email.length > 0
	);
}

async function findCurrentBrowserSession(
	connectionString: string,
	credentials: CliCredentials,
): Promise<BrowserSession> {
	const sql = postgres(connectionString, {
		connect_timeout: 10,
		idle_timeout: 2,
		max: 1,
	});

	try {
		const rows = await sql<BrowserSession[]>`
			SELECT
				s.active_organization_id,
				s.expires_at,
				s.token
			FROM session AS s
			INNER JOIN "user" AS u ON u.id = s.user_id
			WHERE u.id = ${credentials.user.id}
				AND lower(u.email) = lower(${credentials.user.email})
				AND s.expires_at > now()
			ORDER BY
				(s.active_organization_id IS NOT NULL) DESC,
				s.updated_at DESC
			LIMIT 1
		`;
		const session = rows[0];
		if (!session) {
			throw new Error(
				`No active browser session exists for ${credentials.user.email}. Sign in to the real app once, then retry.`,
			);
		}
		return session;
	} finally {
		await sql.end({ timeout: 2 });
	}
}

function signBetterAuthSessionToken(token: string, secret: string): string {
	const signature = createHmac("sha256", secret)
		.update(token, "utf8")
		.digest("base64");
	return encodeURIComponent(`${token}.${signature}`);
}

async function verifyRunningApiIfAvailable(
	bearerToken: string,
	expectedUserId: string,
): Promise<void> {
	const state = await probeRunningApi(bearerToken, expectedUserId);
	if (state === "absent") {
		log("Check passed. The API is not currently running, so HTTP auth was not probed.");
		return;
	}
	if (state === "different-user") {
		throw new Error(
			"The running API rejected the derived session or returned a different user. Restart it with bun run dev:real so it uses the matching API environment.",
		);
	}
	log("Check passed. The running API accepted the real authenticated session.");
}

async function probeRunningApi(
	bearerToken: string,
	expectedUserId: string,
): Promise<"absent" | "authenticated" | "different-user"> {
	const health = await fetch(`${DEFAULT_API_ORIGIN}/health`).catch(() => null);
	if (!health?.ok) return "absent";

	const response = await fetch(`${DEFAULT_API_ORIGIN}/api/auth/get-session`, {
		headers: { authorization: `Bearer ${bearerToken}` },
	}).catch(() => null);
	if (!response?.ok) return "different-user";

	const body: unknown = await response.json();
	return hasAuthenticatedUser(body, expectedUserId)
		? "authenticated"
		: "different-user";
}

async function probeRunningMarketing(): Promise<
	"absent" | "matching" | "different-app"
> {
	const response = await fetch(`${DEFAULT_MARKETING_ORIGIN}/instantv2`, {
		signal: AbortSignal.timeout(2_000),
	}).catch(() => null);
	if (!response) return "absent";
	if (!response.ok) return "different-app";

	const html = await response.text();
	return html.includes("data-instant-v2-product-iframe")
		? "matching"
		: "different-app";
}

function hasAuthenticatedUser(value: unknown, expectedUserId: string): boolean {
	if (typeof value !== "object" || value === null || !("user" in value)) {
		return false;
	}
	const user = value.user;
	return (
		typeof user === "object" &&
		user !== null &&
		"id" in user &&
		user.id === expectedUserId
	);
}

function mergeOrigins(
	current: string | undefined,
	...required: readonly string[]
): string {
	return [
		...new Set([
			...(current ?? "").split(",").map((origin) => origin.trim()),
			...required,
		]),
	]
		.filter(Boolean)
		.join(",");
}

function spawnProcess(
	label: string,
	args: readonly string[],
	cwd: string,
	environment: NodeJS.ProcessEnv,
): { child: ChildProcess; label: string } {
	const child = spawn("bun", args, {
		cwd,
		env: environment,
		stdio: "inherit",
	});
	return { child, label };
}

async function runProcesses(
	processes: ReadonlyArray<{ child: ChildProcess; label: string }>,
): Promise<never> {
	let stopping = false;
	const stopAll = (signal: NodeJS.Signals = "SIGTERM") => {
		if (stopping) return;
		stopping = true;
		for (const { child } of processes) {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill(signal);
			}
		}
	};

	process.once("SIGINT", () => stopAll("SIGINT"));
	process.once("SIGTERM", () => stopAll("SIGTERM"));

	const result = await Promise.race(
		processes.map(
			({ child, label }) =>
				new Promise<{ code: number | null; label: string; signal: string | null }>(
					(resolveExit, rejectExit) => {
						child.once("error", rejectExit);
						child.once("exit", (code, signal) =>
							resolveExit({ code, label, signal }),
						);
					},
			),
		),
	);

	const wasStopping = stopping;
	stopAll();
	if (!wasStopping) {
		throw new Error(
			`${result.label} exited unexpectedly (${result.signal ?? result.code ?? "unknown"}).`,
		);
	}
	process.exit(result.code ?? 0);
}

function log(message: string): void {
	process.stdout.write(`${message}\n`);
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`dev:real: ${message}\n`);
	process.exitCode = 1;
});
