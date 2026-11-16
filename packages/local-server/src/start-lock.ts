import { randomUUID } from "node:crypto";
import {
	linkSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isAlive, readProcessStart, sleep } from "./processes.js";

const DEFAULT_WAIT_MS = 15 * 60_000;
const POLL_MS = 500;
const START_TIME_SLACK_MS = 1_000;

export interface StartLockHolder {
	readonly pid: number;
	readonly token: string;
	readonly startedAt: string;
}

export interface StartLockOptions {
	readonly waitMs?: number;
	readonly pollMs?: number;
	readonly onWait?: (holder: StartLockHolder) => void;
	readonly isHolderRunning?: (holder: StartLockHolder) => Promise<boolean>;
}

export function getStartLockPath(dataDir: string): string {
	return join(dataDir, "run", "start.lock");
}

export async function withStartLock<T>(
	dataDir: string,
	run: () => Promise<T>,
	options: StartLockOptions = {},
): Promise<T | Error> {
	const acquired = await acquireStartLock(dataDir, options);
	if (acquired instanceof Error) return acquired;
	try {
		return await run();
	} finally {
		releaseStartLock(dataDir, acquired);
	}
}

export async function acquireStartLock(
	dataDir: string,
	options: StartLockOptions = {},
): Promise<StartLockHolder | Error> {
	const path = getStartLockPath(dataDir);
	mkdirSync(join(dataDir, "run"), { recursive: true, mode: 0o700 });
	const self: StartLockHolder = {
		pid: process.pid,
		token: randomUUID(),
		startedAt: new Date().toISOString(),
	};
	const isHolderRunning = options.isHolderRunning ?? holderIsRunning;
	const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS);
	let reported: string | undefined;
	for (;;) {
		if (tryCreate(path, self)) return self;
		const raw = readRaw(path);
		if (raw === undefined) continue;
		const holder = parseHolder(raw);
		if (!holder || !(await isHolderRunning(holder))) {
			removeIfUnchanged(path, raw);
			continue;
		}
		if (reported !== holder.token) {
			reported = holder.token;
			options.onWait?.(holder);
		}
		if (Date.now() >= deadline)
			return new Error(
				`Another start of the Opaline server in ${dataDir} (pid ${holder.pid}) is still running after ${Math.round((options.waitMs ?? DEFAULT_WAIT_MS) / 1000)} s. Wait for it to finish, or stop it, then start again.`,
			);
		await sleep(options.pollMs ?? POLL_MS);
	}
}

export function releaseStartLock(
	dataDir: string,
	holder: StartLockHolder,
): void {
	const path = getStartLockPath(dataDir);
	const raw = readRaw(path);
	if (raw !== undefined && parseHolder(raw)?.token === holder.token)
		removeIfUnchanged(path, raw);
}

async function holderIsRunning(holder: StartLockHolder): Promise<boolean> {
	if (holder.pid === process.pid) return true;
	if (!isAlive(holder.pid)) return false;
	const started = await readProcessStart(holder.pid);
	return (
		started === undefined ||
		started <= Date.parse(holder.startedAt) + START_TIME_SLACK_MS
	);
}

function tryCreate(path: string, holder: StartLockHolder): boolean {
	const temporary = `${path}.${holder.token}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(holder)}\n`, { mode: 0o600 });
	try {
		linkSync(temporary, path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	} finally {
		rmSync(temporary, { force: true });
	}
}

function removeIfUnchanged(path: string, seen: string): void {
	const aside = `${path}.${randomUUID()}.stale`;
	try {
		renameSync(path, aside);
	} catch {
		return;
	}
	const moved = readRaw(aside);
	if (moved !== seen)
		try {
			linkSync(aside, path);
		} catch {}
	rmSync(aside, { force: true });
}

function readRaw(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function parseHolder(raw: string): StartLockHolder | undefined {
	try {
		const value = JSON.parse(raw) as Partial<StartLockHolder>;
		if (
			Number.isInteger(value.pid) &&
			typeof value.token === "string" &&
			typeof value.startedAt === "string"
		)
			return value as StartLockHolder;
	} catch {}
	return undefined;
}
