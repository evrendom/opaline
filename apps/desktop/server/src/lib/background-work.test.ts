import { expect, test } from "bun:test";
import {
	BACKGROUND_CLICKHOUSE_MAX_THREADS,
	isBackgroundWork,
	lowerWorkerThreadPriority,
	runAsBackgroundWork,
	withBackgroundClickHouseSettings,
} from "./background-work.js";

test("ClickHouse settings are untouched outside background work", () => {
	const settings = { max_execution_time: 30 };
	expect(withBackgroundClickHouseSettings(settings)).toBe(settings);
	expect(withBackgroundClickHouseSettings(undefined)).toBeUndefined();
	expect(isBackgroundWork()).toBe(false);
});

test("background work caps ClickHouse threads, across awaits", async () => {
	const seen = await runAsBackgroundWork(async () => {
		await Bun.sleep(1);
		return [
			withBackgroundClickHouseSettings({ max_execution_time: 30 }),
			withBackgroundClickHouseSettings({ max_threads: 8 }),
			withBackgroundClickHouseSettings({ max_threads: 1 }),
			withBackgroundClickHouseSettings(undefined),
		];
	});
	expect(seen).toEqual([
		{ max_execution_time: 30, max_threads: BACKGROUND_CLICKHOUSE_MAX_THREADS },
		{ max_threads: BACKGROUND_CLICKHOUSE_MAX_THREADS },
		{ max_threads: 1 },
		{ max_threads: BACKGROUND_CLICKHOUSE_MAX_THREADS },
	]);
	expect(isBackgroundWork()).toBe(false);
});

test("worker threads keep their priority unless background workers are on", async () => {
	expect(await lowerWorkerThreadPriority({})).toBe(false);
});

test("a background worker thread moves to the background band without slowing the main thread", async () => {
	if (process.platform !== "darwin" && process.platform !== "linux") return;
	const source = `
		const { lowerWorkerThreadPriority } = await import(${JSON.stringify(new URL("./background-work.ts", import.meta.url).href)});
		const lowered = await lowerWorkerThreadPriority({ OPALINE_BACKGROUND_WORKERS: "1" });
		let band = null;
		if (process.platform === "darwin") {
			const { dlopen, FFIType } = await import("bun:ffi");
			const lib = dlopen("/usr/lib/libSystem.B.dylib", { qos_class_self: { args: [], returns: FFIType.u32 } });
			band = lib.symbols.qos_class_self();
		} else {
			const { getPriority } = await import("node:os");
			band = getPriority();
		}
		postMessage({ lowered, band });
	`;
	const url = URL.createObjectURL(
		new Blob([source], { type: "text/javascript" }),
	);
	const worker = new Worker(url);
	const result = await new Promise<{ lowered: boolean; band: number }>(
		(resolve) => {
			worker.onmessage = (event) => resolve(event.data);
		},
	);
	worker.terminate();
	expect(result.lowered).toBe(true);
	expect(result.band).toBe(process.platform === "darwin" ? 0x11 : 19);
	const { getPriority } = await import("node:os");
	expect(getPriority()).toBe(0);
});
