import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readdirSync,
	renameSync,
	rmdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Takes the lock released CLIs use for their settings (`.auto-upload-lock`,
 * same protocol), so a cleanup never interleaves with an older process that
 * is installing or repairing hooks. Returns undefined when the lock is held
 * by a live process: the caller skips and a later hook run tries again.
 */
export function withConfigLock<T>(
	configDir: string,
	operation: () => T,
): { value: T } | undefined {
	const directory = join(configDir, ".auto-upload-lock");
	const owner = `${process.pid}-${randomUUID()}`;
	const prepared = join(configDir, `.auto-upload-lock-${owner}`);
	mkdirSync(prepared, { mode: 0o700 });
	try {
		writeFileSync(join(prepared, owner), "", { mode: 0o600, flag: "wx" });
		for (let attempt = 0; ; attempt++) {
			try {
				renameSync(prepared, directory);
				break;
			} catch (error) {
				if (!hasCode(error, "EEXIST", "ENOTEMPTY", "EACCES", "EPERM"))
					throw error;
				if (attempt >= 2 || !removeDeadOwners(directory)) return undefined;
			}
		}
		try {
			return { value: operation() };
		} finally {
			rmSync(join(directory, owner), { force: true });
			removeEmptyDirectory(directory);
		}
	} finally {
		rmSync(prepared, { recursive: true, force: true });
	}
}

/** True when every owner was a process that no longer runs. */
function removeDeadOwners(directory: string): boolean {
	let owners: string[];
	try {
		owners = readdirSync(directory);
	} catch (error) {
		return hasCode(error, "ENOENT");
	}
	for (const owner of owners) {
		const pid = Number(/^(\d+)-[0-9a-f-]+$/u.exec(owner)?.[1]);
		if (!Number.isSafeInteger(pid) || pid <= 0 || isRunning(pid)) return false;
		try {
			unlinkSync(join(directory, owner));
		} catch (error) {
			if (!hasCode(error, "ENOENT")) return false;
		}
	}
	removeEmptyDirectory(directory);
	return true;
}

function removeEmptyDirectory(directory: string): void {
	try {
		rmdirSync(directory);
	} catch {
		// Another owner took it, or it is already gone.
	}
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !hasCode(error, "ESRCH");
	}
}

function hasCode(error: unknown, ...codes: string[]): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		codes.includes(error.code)
	);
}
