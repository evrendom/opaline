#!/usr/bin/env bun

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

interface ManagedProcess {
	child: ChildProcess;
	label: string;
}

const ROOT_DIR = resolve(import.meta.dirname, "..");
const API_DIR = join(ROOT_DIR, "apps/api");
const WEB_DIR = join(ROOT_DIR, "apps/web");
const API_ENV_PATH = join(API_DIR, ".env.local");
const STRIPE_WEBHOOK_EVENTS = [
	"checkout.session.completed",
	"checkout.session.async_payment_succeeded",
	"checkout.session.expired",
	"customer.subscription.created",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"customer.subscription.pending_update_applied",
	"customer.subscription.pending_update_expired",
	"invoice.paid",
	"invoice.payment_succeeded",
	"invoice.payment_action_required",
	"invoice.payment_failed",
	"invoice.finalization_failed",
].join(",");

async function main(): Promise<void> {
	const environment = readSandboxEnvironment();
	environment.STRIPE_API_KEY = environment.STRIPE_SECRET_KEY;
	environment.STRIPE_WEBHOOK_SECRET = await readStripeWebhookSecret(environment);
	await runDatabaseMigrations(environment);
	process.stdout.write(
		"Stripe sandbox ready at http://localhost:4011/{workspace}/settings/workspace\n",
	);
	await supervise([
		spawnCommand(
			"Stripe webhook forwarder",
			"stripe",
			[
				"listen",
				"--skip-update",
				"--events",
				STRIPE_WEBHOOK_EVENTS,
				"--forward-to",
				"localhost:4010/api/webhooks/stripe",
			],
			ROOT_DIR,
			environment,
		),
		spawnBun("API", ["--watch", "src/index.ts"], API_DIR, environment),
		spawnBun(
			"billing worker",
			["run", "billing:sandbox:worker"],
			API_DIR,
			environment,
		),
		spawnBun("web", ["run", "dev"], WEB_DIR, environment),
	]);
}

async function readStripeWebhookSecret(
	environment: NodeJS.ProcessEnv,
): Promise<string> {
	const command = spawn(
		"stripe",
		["listen", "--print-secret", "--skip-update"],
		{
			cwd: ROOT_DIR,
			env: environment,
			stdio: ["ignore", "pipe", "inherit"],
		},
	);
	let output = "";
	command.stdout?.setEncoding("utf8");
	command.stdout?.on("data", (chunk: string) => {
		output += chunk;
	});
	const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
		command.once("error", rejectExit);
		command.once("exit", resolveExit);
	});
	const secret = output.trim();
	if (exitCode !== 0 || !secret.startsWith("whsec_")) {
		throw new Error(
			"Stripe CLI could not provide a sandbox webhook secret. Install the Stripe CLI and retry.",
		);
	}
	return secret;
}

function readSandboxEnvironment(): NodeJS.ProcessEnv {
	if (!existsSync(API_ENV_PATH)) {
		throw new Error(
			"apps/api/.env.local is missing. Run the Stripe sandbox setup first.",
		);
	}
	const environment = {
		...process.env,
		...parseEnvFile(readFileSync(API_ENV_PATH, "utf8")),
	};
	if (environment.STRIPE_BILLING_MODE !== "sandbox") {
		throw new Error("STRIPE_BILLING_MODE must be sandbox");
	}
	const connectionString = environment.PG_CONNECTION_STRING?.trim();
	if (!connectionString) throw new Error("PG_CONNECTION_STRING is required");
	const databaseHost = new URL(connectionString).hostname;
	if (!["127.0.0.1", "::1", "localhost"].includes(databaseHost)) {
		throw new Error("Sandbox billing requires a loopback PostgreSQL database");
	}
	return environment;
}

function parseEnvFile(source: string): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const rawLine of source.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
		if (!match) continue;
		const [, name, rawValue] = match;
		if (!name || rawValue === undefined) continue;
		const quoted = rawValue.match(/^(['"])(.*)\1$/u);
		environment[name] = quoted?.[2] ?? rawValue;
	}
	return environment;
}

async function runDatabaseMigrations(
	environment: NodeJS.ProcessEnv,
): Promise<void> {
	const migration = spawn(
		"bun",
		["run", "--cwd", "packages/sql-schema", "migrate"],
		{
			cwd: ROOT_DIR,
			env: environment,
			stdio: "inherit",
		},
	);
	const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
		migration.once("error", rejectExit);
		migration.once("exit", resolveExit);
	});
	if (exitCode !== 0) {
		throw new Error(
			"PostgreSQL migration failed. Start the local PostgreSQL service and retry.",
		);
	}
}

function spawnBun(
	label: string,
	args: readonly string[],
	cwd: string,
	environment: NodeJS.ProcessEnv,
): ManagedProcess {
	return spawnCommand(label, "bun", args, cwd, environment);
}

function spawnCommand(
	label: string,
	command: string,
	args: readonly string[],
	cwd: string,
	environment: NodeJS.ProcessEnv,
): ManagedProcess {
	return {
		child: spawn(command, args, { cwd, env: environment, stdio: "inherit" }),
		label,
	};
}

async function supervise(processes: readonly ManagedProcess[]): Promise<never> {
	let stopping = false;
	const stopAll = (signal: NodeJS.Signals = "SIGTERM") => {
		if (stopping) return;
		stopping = true;
		for (const { child } of processes) {
			if (child.exitCode === null && child.signalCode === null) child.kill(signal);
		}
	};
	process.once("SIGINT", () => stopAll("SIGINT"));
	process.once("SIGTERM", () => stopAll("SIGTERM"));
	const result = await Promise.race(
		processes.map(
			({ child, label }) =>
				new Promise<{ code: number | null; label: string }>(
					(resolveExit, rejectExit) => {
						child.once("error", rejectExit);
						child.once("exit", (code) => resolveExit({ code, label }));
					},
				),
		),
	);
	const wasStopping = stopping;
	stopAll();
	if (!wasStopping) {
		throw new Error(
			`${result.label} exited unexpectedly (${result.code ?? "unknown"})`,
		);
	}
	process.exit(result.code ?? 0);
}

void main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`dev:billing-sandbox: ${message}\n`);
	process.exitCode = 1;
});
