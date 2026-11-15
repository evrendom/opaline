import { execFile, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const SERVICE_NAMES = ["clickhouse", "postgres", "server"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

const MAX_LOG_BYTES = 20 * 1024 * 1024;

const PidRecordSchema = z.object({
	pid: z.number().int().positive(),
	marker: z.string(),
	startedAt: z.string(),
});

export type PidRecord = z.infer<typeof PidRecordSchema>;

export interface ServicePaths {
	readonly pidFile: string;
	readonly logFile: string;
}

export function getServicePaths(
	dataDir: string,
	name: ServiceName,
): ServicePaths {
	return {
		pidFile: join(dataDir, "run", `${name}.pid`),
		logFile: join(dataDir, "logs", `${name}.log`),
	};
}

export async function readRunningService(
	dataDir: string,
	name: ServiceName,
): Promise<PidRecord | undefined> {
	const { pidFile } = getServicePaths(dataDir, name);
	if (!existsSync(pidFile)) return undefined;
	let record: PidRecord;
	try {
		record = PidRecordSchema.parse(JSON.parse(readFileSync(pidFile, "utf8")));
	} catch {
		rmSync(pidFile, { force: true });
		return undefined;
	}
	if (!isAlive(record.pid)) {
		rmSync(pidFile, { force: true });
		return undefined;
	}
	const commandLine = await readCommandLine(record.pid);
	if (commandLine !== undefined && !commandLine.includes(record.marker)) {
		rmSync(pidFile, { force: true });
		return undefined;
	}
	return record;
}

export function startDetachedService(options: {
	readonly dataDir: string;
	readonly name: ServiceName;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: NodeJS.ProcessEnv;
	readonly cwd: string;
	readonly marker: string;
}): PidRecord {
	const { pidFile, logFile } = getServicePaths(options.dataDir, options.name);
	mkdirSync(join(options.dataDir, "run"), { recursive: true, mode: 0o700 });
	mkdirSync(join(options.dataDir, "logs"), { recursive: true, mode: 0o700 });
	rotateLog(logFile);
	const log = openSync(logFile, "a", 0o600);
	try {
		writeFileSync(
			log,
			`\n--- ${new Date().toISOString()} opaline server starting ${options.name} ---\n`,
		);
		const child = spawn(options.command, [...options.args], {
			cwd: options.cwd,
			env: options.env,
			detached: true,
			stdio: ["ignore", log, log],
		});
		child.on("error", () => {});
		if (child.pid === undefined)
			throw new Error(`Could not start ${options.command}`);
		child.unref();
		const record: PidRecord = {
			pid: child.pid,
			marker: options.marker,
			startedAt: new Date().toISOString(),
		};
		writeFileSync(pidFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
		return record;
	} finally {
		closeSync(log);
	}
}

export async function stopService(
	dataDir: string,
	name: ServiceName,
	options: { readonly signal: NodeJS.Signals; readonly timeoutMs: number },
): Promise<"stopped" | "killed" | "not-running"> {
	const record = await readRunningService(dataDir, name);
	if (!record) return "not-running";
	const { pidFile } = getServicePaths(dataDir, name);
	signal(record.pid, options.signal);
	if (await waitForExit(record.pid, options.timeoutMs)) {
		rmSync(pidFile, { force: true });
		return "stopped";
	}
	signal(record.pid, "SIGKILL");
	await waitForExit(record.pid, 5_000);
	rmSync(pidFile, { force: true });
	return "killed";
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export async function waitForExit(
	pid: number,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return true;
		await sleep(100);
	}
	return !isAlive(pid);
}

export function tailFile(path: string, lines: number): string {
	if (!existsSync(path)) return "";
	const size = statSync(path).size;
	const start = Math.max(0, size - 256 * 1024);
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(size - start);
		const bytesRead = readInto(fd, buffer, start);
		return buffer
			.subarray(0, bytesRead)
			.toString("utf8")
			.split("\n")
			.slice(-lines - 1)
			.join("\n")
			.trimEnd();
	} finally {
		closeSync(fd);
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInto(fd: number, buffer: Buffer, position: number): number {
	let offset = 0;
	while (offset < buffer.length) {
		const read = readSync(
			fd,
			buffer,
			offset,
			buffer.length - offset,
			position + offset,
		);
		if (read === 0) break;
		offset += read;
	}
	return offset;
}

function rotateLog(path: string): void {
	if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES)
		renameSync(path, `${path}.1`);
}

function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch {}
}

function readCommandLine(pid: number): Promise<string | undefined> {
	if (process.platform === "linux") {
		try {
			return Promise.resolve(
				readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "),
			);
		} catch {
			return Promise.resolve(undefined);
		}
	}
	return new Promise((resolve) => {
		execFile(
			"ps",
			["-o", "command=", "-p", String(pid)],
			{ encoding: "utf8", timeout: 5_000 },
			(error, stdout) => resolve(error ? undefined : stdout.trim()),
		);
	});
}
