import { AsyncLocalStorage } from "node:async_hooks";
import { setPriority } from "node:os";
import type { ClickHouseSettings } from "@clickhouse/client-web";

const background = new AsyncLocalStorage<true>();
let threadIsBackground = false;

export const BACKGROUND_CLICKHOUSE_MAX_THREADS = 2;
export const BACKGROUND_WORKERS_ENV = "OPALINE_BACKGROUND_WORKERS";

export function runAsBackgroundWork<T>(work: () => Promise<T>): Promise<T> {
	return background.run(true, work);
}

export function isBackgroundWork(): boolean {
	return threadIsBackground || background.getStore() === true;
}

/**
 * Everything this thread does is background work: its ClickHouse statements run
 * at the background priority, below the dashboard's reads. For the threads that
 * run jobs and imports end to end (maintenance, local import).
 */
export function markThreadAsBackgroundWork(): void {
	threadIsBackground = true;
}

export function withBackgroundClickHouseSettings(
	settings: ClickHouseSettings | undefined,
): ClickHouseSettings | undefined {
	if (!isBackgroundWork()) return settings;
	const requested = Number(settings?.max_threads ?? 0);
	return {
		...settings,
		max_threads:
			requested > 0
				? Math.min(requested, BACKGROUND_CLICKHOUSE_MAX_THREADS)
				: BACKGROUND_CLICKHOUSE_MAX_THREADS,
	};
}

let lowered: Promise<boolean> | undefined;

export function lowerWorkerThreadPriority(
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> {
	if (env[BACKGROUND_WORKERS_ENV] !== "1") return Promise.resolve(false);
	lowered ??= lowerCurrentThread();
	return lowered;
}

const QOS_CLASS_UTILITY = 0x11;
const LINUX_BACKGROUND_NICE = 19;

async function lowerCurrentThread(): Promise<boolean> {
	try {
		if (process.platform === "darwin") {
			// macOS: pthread_set_qos_class_self_np(QOS_CLASS_UTILITY) lowers only the calling thread (CPU and I/O priority below the HTTP thread and the user's apps, still allowed on performance cores); os.setPriority would renice the whole process.
			const { dlopen, FFIType } = await import("bun:ffi");
			const library = dlopen("/usr/lib/libSystem.B.dylib", {
				pthread_set_qos_class_self_np: {
					args: [FFIType.u32, FFIType.i32],
					returns: FFIType.i32,
				},
			});
			const result = library.symbols.pthread_set_qos_class_self_np(
				QOS_CLASS_UTILITY,
				0,
			);
			library.close();
			return result === 0;
		}
		if (process.platform === "linux") {
			// Linux keeps the nice value per thread, so setpriority on pid 0 from a worker thread lowers only that thread.
			setPriority(LINUX_BACKGROUND_NICE);
			return true;
		}
		return false;
	} catch {
		return false;
	}
}
