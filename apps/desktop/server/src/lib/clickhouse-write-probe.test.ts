import { describe, expect, test } from "bun:test";
import { ClickHouseError } from "@clickhouse/client-web";
import {
	describeFailure,
	insertProbeRequest,
	probeClickHouseWrite,
	readProbeRequest,
	WRITE_PROBE_LIMITS,
	type WriteProbeClient,
} from "./clickhouse-write-probe.js";
import { summarizeHealth } from "./dependency-health.js";

const PROBE_ID = "8e0a3c4b-6f0e-4e43-9d61-1d6f3c6b2a10";
const T0 = Date.parse("2026-11-04T14:10:00.000Z");

type Step =
	| { ms: number; rows: { probe_id: string }[] }
	| { ms: number; error: unknown };

function fakeClient(insert: Step, reads: Step[]) {
	let clock = T0;
	const calls: {
		kind: "command" | "query";
		params: Record<string, unknown>;
	}[] = [];
	const run = async (step: Step | undefined) => {
		if (!step) throw new Error("unexpected request");
		clock += step.ms;
		if ("error" in step) throw step.error;
		return step.rows;
	};
	const client = {
		command: async (params: Record<string, unknown>) => {
			calls.push({ kind: "command", params });
			await run(insert);
			return { query_id: String(params.query_id) };
		},
		query: async (params: Record<string, unknown>) => {
			calls.push({ kind: "query", params });
			const rows = await run(reads.shift());
			return { json: async () => rows };
		},
	} as unknown as WriteProbeClient;
	const sleeps: number[] = [];
	return {
		client,
		calls,
		sleeps,
		runtime: {
			probeId: PROBE_ID,
			now: () => clock,
			sleep: async (ms: number) => {
				sleeps.push(ms);
				clock += ms;
			},
		},
	};
}

const found = (ms = 40) => ({ ms, rows: [{ probe_id: PROBE_ID }] });
const empty = (ms = 40) => ({ ms, rows: [] });
const timeoutError = new ClickHouseError({
	message: "Timeout exceeded: elapsed 10.001 seconds",
	code: "159",
	type: "TIMEOUT_EXCEEDED",
});

describe("ClickHouse write probe requests", () => {
	test("the insert waits for its acknowledgement with a 10 second server budget the client outlasts", () => {
		const request = insertProbeRequest(PROBE_ID);
		expect(request.query).toContain("async_insert = 1");
		expect(request.query).toContain("wait_for_async_insert = 1");
		expect(request.query).toContain(
			"async_insert_use_adaptive_busy_timeout = 0",
		);
		expect(request.query).toContain("async_insert_busy_timeout_ms = 200");
		expect(request.query).toContain(JSON.stringify({ probe_id: PROBE_ID }));
		expect(request.query_id).toBe(`health-write-${PROBE_ID}`);
		expect(request.clickhouse_settings).toEqual({
			max_execution_time: 10,
			wait_for_async_insert_timeout: 10,
		});
		expect(WRITE_PROBE_LIMITS.insertRequestTimeoutMs).toBeGreaterThan(
			request.clickhouse_settings.max_execution_time * 1_000,
		);
	});

	test("each read is uncached, replica-consistent and has its own query id", () => {
		const request = readProbeRequest(PROBE_ID, 2);
		expect(request.query_params).toEqual({ probeId: PROBE_ID });
		expect(request.query_id).toBe(`health-read-${PROBE_ID}-2`);
		expect(request.clickhouse_settings).toMatchObject({
			max_execution_time: 2,
			use_query_cache: 0,
			select_sequential_consistency: "1",
		});
		expect(WRITE_PROBE_LIMITS.readRequestTimeoutMs).toBeGreaterThan(
			request.clickhouse_settings.max_execution_time * 1_000,
		);
	});

	test("failures keep their ClickHouse code and never their message", () => {
		expect(describeFailure(timeoutError)).toEqual({
			failure: "timeout",
			exception_code: "159",
		});
		expect(
			describeFailure(
				new ClickHouseError({
					message: "denied",
					code: "497",
					type: "ACCESS_DENIED",
				}),
			),
		).toEqual({ failure: "clickhouse", exception_code: "497" });
		expect(describeFailure(new Error("Timeout error."))).toEqual({
			failure: "timeout",
			exception_code: null,
		});
		expect(describeFailure(new Error("The user aborted a request."))).toEqual({
			failure: "timeout",
			exception_code: null,
		});
		expect(describeFailure(new TypeError("fetch failed"))).toEqual({
			failure: "network",
			exception_code: null,
		});
	});
});

describe("ClickHouse write probe outcomes", () => {
	test("ok: the insert is acknowledged and the first read returns the UUID", async () => {
		const fake = fakeClient({ ms: 900, rows: [] }, [found(30)]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report).toEqual({
			probe_id: PROBE_ID,
			outcome: "ok",
			slow_insert: false,
			started_at: "2026-11-04T14:10:00.000Z",
			finished_at: "2026-11-04T14:10:00.930Z",
			duration_ms: 930,
			insert: {
				query_id: `health-write-${PROBE_ID}`,
				started_at: "2026-11-04T14:10:00.000Z",
				duration_ms: 900,
				failure: null,
				exception_code: null,
			},
			reads: [
				{
					query_id: `health-read-${PROBE_ID}-0`,
					started_at: "2026-11-04T14:10:00.900Z",
					duration_ms: 30,
					failure: null,
					exception_code: null,
					rows: 1,
				},
			],
			visible_after_ms: 30,
		});
		expect(fake.calls.map((call) => call.params.query_id)).toEqual([
			`health-write-${PROBE_ID}`,
			`health-read-${PROBE_ID}-0`,
		]);
	});

	test("a successful insert slower than 3 seconds is ok and flagged as a slow write", async () => {
		const fake = fakeClient({ ms: 4_200, rows: [] }, [found()]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report.outcome).toBe("ok");
		expect(report.slow_insert).toBe(true);
	});

	test("insert_timeout: the server's TIMEOUT_EXCEEDED is kept with its code and nothing is read", async () => {
		const fake = fakeClient({ ms: 10_050, error: timeoutError }, []);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report).toMatchObject({
			outcome: "insert_timeout",
			slow_insert: true,
			duration_ms: 10_050,
			insert: {
				failure: "timeout",
				exception_code: "159",
				duration_ms: 10_050,
			},
			reads: [],
			visible_after_ms: null,
		});
		expect(fake.calls).toHaveLength(1);
	});

	test("insert_timeout: the client deadline when the server never answers", async () => {
		const fake = fakeClient(
			{ ms: 12_000, error: new Error("Timeout error.") },
			[],
		);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report.outcome).toBe("insert_timeout");
		expect(report.insert).toMatchObject({
			failure: "timeout",
			exception_code: null,
		});
	});

	test("insert_failed: a refused insert is an availability failure, not a slow write", async () => {
		const denied = new ClickHouseError({
			message: "Not enough privileges",
			code: "497",
			type: "ACCESS_DENIED",
		});
		const fake = fakeClient({ ms: 20, error: denied }, []);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report).toMatchObject({
			outcome: "insert_failed",
			slow_insert: false,
			insert: { failure: "clickhouse", exception_code: "497" },
		});
	});

	test("read_failed: a failing read is not retried and not reported as a miss", async () => {
		const readError = new ClickHouseError({
			message: "Memory limit exceeded",
			code: "241",
			type: "MEMORY_LIMIT_EXCEEDED",
		});
		const fake = fakeClient({ ms: 800, rows: [] }, [
			{ ms: 15, error: readError },
		]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report).toMatchObject({
			outcome: "read_failed",
			reads: [
				{
					query_id: `health-read-${PROBE_ID}-0`,
					failure: "clickhouse",
					exception_code: "241",
					rows: null,
				},
			],
			visible_after_ms: null,
		});
		expect(fake.sleeps).toEqual([]);
	});

	test("delayed_visibility: the initial miss and the time until the row was visible are kept", async () => {
		const fake = fakeClient({ ms: 1_000, rows: [] }, [
			empty(20),
			empty(20),
			found(20),
		]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report.outcome).toBe("delayed_visibility");
		expect(report.reads.map((read) => read.rows)).toEqual([0, 0, 1]);
		expect(report.reads.map((read) => read.query_id)).toEqual([
			`health-read-${PROBE_ID}-0`,
			`health-read-${PROBE_ID}-1`,
			`health-read-${PROBE_ID}-2`,
		]);
		expect(fake.sleeps).toEqual([250, 500]);
		expect(report.visible_after_ms).toBe(20 + 250 + 20 + 500 + 20);
	});

	test("not_visible: every read succeeds empty within the bounded retries", async () => {
		const fake = fakeClient({ ms: 1_000, rows: [] }, [
			empty(),
			empty(),
			empty(),
			empty(),
		]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report.outcome).toBe("not_visible");
		expect(report.reads).toHaveLength(4);
		expect(report.visible_after_ms).toBeNull();
		expect(fake.sleeps).toEqual([...WRITE_PROBE_LIMITS.readbackRetryDelaysMs]);
	});

	test("not_visible: retries stop at the readback budget", async () => {
		const fake = fakeClient({ ms: 500, rows: [] }, [empty(2_900), empty(900)]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report.outcome).toBe("not_visible");
		expect(report.reads).toHaveLength(2);
		expect(fake.sleeps).toEqual([250]);
	});

	test("a row with another UUID is not a successful read-after-write", async () => {
		const fake = fakeClient({ ms: 500, rows: [] }, [
			{ ms: 10, rows: [{ probe_id: "00000000-0000-4000-8000-000000000000" }] },
			empty(),
			empty(),
			empty(),
		]);
		const report = await probeClickHouseWrite(fake.client, fake.runtime);
		expect(report.outcome).toBe("not_visible");
	});
});

describe("readiness and alerts", () => {
	const up = { status: "ok" as const, duration_ms: 5 };
	const down = { status: "unavailable" as const, duration_ms: 3_000 };
	const probe = async (insert: Step, reads: Step[]) => {
		const fake = fakeClient(insert, reads);
		return probeClickHouseWrite(fake.client, fake.runtime);
	};

	test("each alert name appears in the body only as an alert", async () => {
		const health = summarizeHealth(
			up,
			await probe({ ms: 10_050, error: timeoutError }, []),
			up,
			up,
		);
		const body = JSON.stringify({ ...health, alerts: [] });
		for (const alert of ["availability", "slow_write", "visibility"])
			expect(body).not.toContain(`"${alert}"`);
	});

	test("ok is ready with no alerts", async () => {
		const health = summarizeHealth(
			up,
			await probe({ ms: 900, rows: [] }, [found()]),
			up,
			up,
		);
		expect(health.status).toBe("ok");
		expect(health.alerts).toEqual([]);
		expect(health.dependencies.clickhouse).toMatchObject({
			status: "ok",
			outcome: "ok",
			probe: { probe_id: PROBE_ID, slow_insert: false },
		});
	});

	test("a slow but acknowledged write stays ready and raises only slow_write", async () => {
		const health = summarizeHealth(
			up,
			await probe({ ms: 5_000, rows: [] }, [found()]),
			up,
			up,
		);
		expect(health.status).toBe("ok");
		expect(health.alerts).toEqual(["slow_write"]);
	});

	test("an insert timeout is not ready and is a slow write, not an availability failure", async () => {
		const health = summarizeHealth(
			up,
			await probe({ ms: 10_050, error: timeoutError }, []),
			up,
			up,
		);
		expect(health.status).toBe("unavailable");
		expect(health.alerts).toEqual(["slow_write"]);
	});

	test("delayed visibility stays ready and raises visibility", async () => {
		const health = summarizeHealth(
			up,
			await probe({ ms: 900, rows: [] }, [empty(), found()]),
			up,
			up,
		);
		expect(health.status).toBe("ok");
		expect(health.dependencies.clickhouse.outcome).toBe("delayed_visibility");
		expect(health.alerts).toEqual(["visibility"]);
	});

	test("a row that never appears is not ready and raises visibility", async () => {
		const health = summarizeHealth(
			up,
			await probe({ ms: 900, rows: [] }, [empty(), empty(), empty(), empty()]),
			up,
			up,
		);
		expect(health.status).toBe("unavailable");
		expect(health.dependencies.clickhouse.status).toBe("unavailable");
		expect(health.alerts).toEqual(["visibility"]);
	});

	test("a failed read-back or a failed independent read is an availability failure", async () => {
		const readFailed = summarizeHealth(
			up,
			await probe({ ms: 900, rows: [] }, [
				{ ms: 10, error: new TypeError("fetch failed") },
			]),
			up,
			up,
		);
		expect(readFailed.status).toBe("unavailable");
		expect(readFailed.alerts).toEqual(["availability"]);

		const readOnlyDown = summarizeHealth(
			up,
			await probe({ ms: 900, rows: [] }, [found()]),
			down,
			up,
		);
		expect(readOnlyDown.status).toBe("ok");
		expect(readOnlyDown.alerts).toEqual(["availability"]);
	});

	test("Postgres down is an availability failure; idle Postgres is not", async () => {
		const ok = await probe({ ms: 900, rows: [] }, [found()]);
		expect(summarizeHealth(down, ok, up, up)).toMatchObject({
			status: "unavailable",
			alerts: ["availability"],
		});
		expect(
			summarizeHealth({ status: "idle", duration_ms: 0 }, ok, up, up),
		).toMatchObject({ status: "ok", alerts: [] });
	});
});
