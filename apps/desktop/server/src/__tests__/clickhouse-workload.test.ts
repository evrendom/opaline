import { afterAll, describe, expect, test } from "bun:test";
import { createClickHouseExecutor } from "../clickhouse.js";
import {
	clickHouseWorkloadForPath,
	runAsClickHouseWorkload,
} from "../clickhouse-workload.js";

const requests: URL[] = [];
const server = Bun.serve({
	fetch(request) {
		requests.push(new URL(request.url));
		return new Response("");
	},
	hostname: "127.0.0.1",
	port: 0,
});
const executor = createClickHouseExecutor({ url: server.url.toString() });

afterAll(async () => {
	await executor.close();
	await server.stop(true);
});

async function sentSettings(run: () => Promise<unknown>) {
	requests.length = 0;
	await run();
	const url = requests.at(-1);
	return {
		maxThreads: url?.searchParams.get("max_threads"),
		priority: url?.searchParams.get("priority"),
	};
}

describe("ClickHouse workload settings", () => {
	test("app reads run with moderate threads at the higher priority", async () => {
		expect(
			await sentSettings(() => executor.query({ query: "SELECT 1" })),
		).toEqual({ maxThreads: "4", priority: "1" });
	});

	test("background jobs run with fewer threads at a lower priority", async () => {
		expect(
			await sentSettings(() =>
				runAsClickHouseWorkload("background", () =>
					executor.execute({ query: "SELECT 1" }),
				),
			),
		).toEqual({ maxThreads: "2", priority: "5" });
	});

	test("a statement's own settings win", async () => {
		expect(
			await sentSettings(() =>
				runAsClickHouseWorkload("background", () =>
					executor.query({
						query: "SELECT 1",
						clickhouse_settings: { max_threads: 1 },
					}),
				),
			),
		).toEqual({ maxThreads: "1", priority: "5" });
	});

	test("cron functions are background, everything else interactive", () => {
		expect(clickHouseWorkloadForPath("/api/cron/l1-edges")).toBe("background");
		expect(clickHouseWorkloadForPath("/rpc/analytics/overview/costs")).toBe(
			"interactive",
		);
	});
});
