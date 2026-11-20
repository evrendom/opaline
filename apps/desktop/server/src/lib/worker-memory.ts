import { isSelfHosted } from "./self-hosted.js";

/**
 * A worker's heap keeps the size of the largest job it ran, and only an
 * ended worker gives it back. A self-hosted server, which runs on the user's
 * machine for weeks, ends a worker after a job of this many bytes; the next
 * job starts a new one.
 */
export const WORKER_RECYCLE_BYTES = 32 * 1024 * 1024;

/** Jobs adding up to this many bytes end a worker too, so mid-size jobs cannot ratchet its heap up. */
export const WORKER_RECYCLE_TOTAL_BYTES = 256 * 1024 * 1024;

/** An import worker without work this long ends; a new one starts in about 130 ms. */
export const WORKER_IDLE_MS = 30_000;

export function recyclesWorkerAfter(
	bytes: number,
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return bytes >= WORKER_RECYCLE_BYTES && isSelfHosted(env);
}
