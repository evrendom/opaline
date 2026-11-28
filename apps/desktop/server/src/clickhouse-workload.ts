import { AsyncLocalStorage } from "node:async_hooks";
import type { ClickHouseSettings } from "@clickhouse/client-web";
import { isBackgroundWork } from "./lib/background-work.js";

export type ClickHouseWorkload = "interactive" | "background";

export const CLICKHOUSE_WORKLOAD_SETTINGS = {
	interactive: { max_threads: 4, priority: "1" },
	background: { max_threads: 2, priority: "5" },
} as const satisfies Record<ClickHouseWorkload, ClickHouseSettings>;

const workload = new AsyncLocalStorage<ClickHouseWorkload>();

export function runAsClickHouseWorkload<T>(
	kind: ClickHouseWorkload,
	run: () => T,
): T {
	return workload.run(kind, run);
}

// Background work (a scheduled job, a local import, the maintenance and import
// threads) is the background workload too, so the dashboard's reads run first.
export function currentClickHouseWorkload(): ClickHouseWorkload {
	return (
		workload.getStore() ?? (isBackgroundWork() ? "background" : "interactive")
	);
}

export function withClickHouseWorkloadSettings(
	settings: ClickHouseSettings | undefined,
): ClickHouseSettings {
	return {
		...CLICKHOUSE_WORKLOAD_SETTINGS[currentClickHouseWorkload()],
		...settings,
	};
}

export function clickHouseWorkloadForPath(
	pathname: string,
): ClickHouseWorkload {
	return pathname.startsWith("/api/cron/") ? "background" : "interactive";
}
