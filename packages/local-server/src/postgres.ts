import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

export const POSTGRES_USER = "opaline";
export const POSTGRES_DATABASE = "opaline";

export interface PostgresLayout {
	readonly dataPath: string;
}

export function getPostgresLayout(dataDir: string): PostgresLayout {
	return { dataPath: join(dataDir, "postgres", "data") };
}

export function readPostgresDataMajor(
	layout: PostgresLayout,
): number | undefined {
	const versionFile = join(layout.dataPath, "PG_VERSION");
	if (!existsSync(versionFile)) return undefined;
	const major = Number.parseInt(readFileSync(versionFile, "utf8").trim(), 10);
	return Number.isFinite(major) ? major : undefined;
}

export async function initializePostgres(options: {
	readonly binDir: string;
	readonly layout: PostgresLayout;
	readonly password: string;
	readonly scratchDir: string;
	readonly env: NodeJS.ProcessEnv;
}): Promise<void> {
	const passwordFile = join(options.scratchDir, `pg-password-${process.pid}`);
	writeFileSync(passwordFile, `${options.password}\n`, { mode: 0o600 });
	try {
		await run(
			join(options.binDir, "initdb"),
			[
				"-D",
				options.layout.dataPath,
				"-U",
				POSTGRES_USER,
				`--pwfile=${passwordFile}`,
				"--auth=scram-sha-256",
				"--encoding=UTF8",
				"--locale=C",
				"--no-instructions",
			],
			options.env,
		);
	} catch (error) {
		rmSync(options.layout.dataPath, { recursive: true, force: true });
		throw new Error(
			`initdb failed: ${error instanceof Error ? error.message : String(error)}${process.getuid?.() === 0 ? " (Postgres refuses to run as root; run opaline server as a regular user)" : ""}`,
		);
	} finally {
		rmSync(passwordFile, { force: true });
	}
	await runSingleUser(
		options.binDir,
		options.layout,
		`CREATE DATABASE ${POSTGRES_DATABASE};\n`,
		options.env,
	);
}

export function getPostgresStartArgs(
	layout: PostgresLayout,
	port: number,
): string[] {
	return [
		"-D",
		layout.dataPath,
		"-p",
		String(port),
		"-c",
		"listen_addresses=127.0.0.1",
		"-c",
		"unix_socket_directories=",
		"-c",
		"logging_collector=off",
	];
}

export function getPostgresConnectionString(
	port: number,
	password: string,
): string {
	return `postgres://${POSTGRES_USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${POSTGRES_DATABASE}`;
}

export type PostgresReadiness = "ready" | "starting" | "unreachable";

export function probePostgres(
	port: number,
	timeoutMs = 2_000,
): Promise<PostgresReadiness> {
	return new Promise((resolve) => {
		const socket = connect({ host: "127.0.0.1", port });
		let settled = false;
		const finish = (result: PostgresReadiness) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(timeoutMs, () => finish("unreachable"));
		socket.on("error", () => finish("unreachable"));
		socket.on("connect", () => socket.write(buildStartupMessage()));
		let buffered = Buffer.alloc(0);
		socket.on("data", (chunk: Buffer) => {
			buffered = Buffer.concat([buffered, chunk]);
			const type = String.fromCharCode(buffered[0] ?? 0);
			if (type === "R") return finish("ready");
			if (type !== "E") return finish("unreachable");
			if (buffered.length < 5) return;
			const length = buffered.readInt32BE(1);
			if (buffered.length < length + 1) return;
			const message = buffered.subarray(5, length + 1).toString("utf8");
			finish(message.includes("57P03") ? "starting" : "ready");
		});
	});
}

function buildStartupMessage(): Buffer {
	const parameters = Buffer.from(
		`user\0${POSTGRES_USER}\0database\0${POSTGRES_DATABASE}\0\0`,
		"utf8",
	);
	const message = Buffer.alloc(8 + parameters.length);
	message.writeInt32BE(message.length, 0);
	message.writeInt32BE(196_608, 4);
	parameters.copy(message, 8);
	return message;
}

function runSingleUser(
	binDir: string,
	layout: PostgresLayout,
	sql: string,
	env: NodeJS.ProcessEnv,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			join(binDir, "postgres"),
			[
				"--single",
				"-D",
				layout.dataPath,
				"-c",
				"exit_on_error=true",
				"postgres",
			],
			{ env, stdio: ["pipe", "pipe", "pipe"] },
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			output += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0 && !/\bERROR:/u.test(output)) resolve();
			else
				reject(
					new Error(
						`Postgres could not create the ${POSTGRES_DATABASE} database: ${output.trim().split("\n").slice(-3).join(" ")}`,
					),
				);
		});
		child.stdin.end(sql);
	});
}

function run(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			[...args],
			{ encoding: "utf8", env, timeout: 120_000 },
			(error, stdout, stderr) => {
				if (error) reject(new Error((stderr || error.message).trim()));
				else resolve(stdout);
			},
		);
	});
}
