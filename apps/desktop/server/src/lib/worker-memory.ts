import { isSelfHosted } from "./self-hosted.js";

/**
 * A worker's heap keeps the size of the largest job it ran, and only an
 * ended worker gives it back. A self-hosted server, which runs on the user's
 * machine for weeks, ends a worker after a job of this many bytes; the next
 * job starts a new one.
 */
export const WORKER_RECYCLE_BYTES = 32 * 1024 * 1024;

export function recyclesWorkerAfter(
	bytes: number,
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return bytes >= WORKER_RECYCLE_BYTES && isSelfHosted(env);
}
