import { createClient } from "@clickhouse/client-web";
import { getLogger } from "@logtape/logtape";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import postgres from "postgres";
import {
	HEALTHY_WRITE_PROBE_OUTCOMES,
	probeClickHouseWrite,
	WRITE_PROBE_LIMITS,
	type WriteProbeOutcome,
	type WriteProbeReport,
} from "./clickhouse-write-probe.js";

const logger = getLogger(["rudel", "api", "health"]);

const TIMEOUT_MS = 3_000;
const CACHE_MS = 30_000;

interface DependencyStatus {
	status: "ok" | "unavailable" | "idle";
	duration_ms: number;
}

interface ClickHouseWriteStatus extends DependencyStatus {
	outcome: WriteProbeOutcome;
	probe: WriteProbeReport;
}

export type HealthAlert = "availability" | "slow_write" | "visibility";

export interface HealthResult {
	status: "ok" | "unavailable";
	alerts: HealthAlert[];
	dependencies: {
		postgres: DependencyStatus;
		clickhouse: ClickHouseWriteStatus;
		clickhouse_read: DependencyStatus;
		clickhouse_ping: DependencyStatus;
	};
}

let pending: Promise<HealthResult> | undefined;
let cached: { result: HealthResult; expiresAt: number } | undefined;

// This is readiness for external monitoring, separate from process liveness.
// Coalesce concurrent probes and briefly cache to bound connection pressure.
export async function getDependencyHealthResponse(): Promise<Response> {
	const result =
		cached && Date.now() < cached.expiresAt
			? cached.result
			: await getPendingCheck();
	return Response.json(result, {
		status: result.status === "ok" ? 200 : 503,
		headers: { "Cache-Control": "no-store" },
	});
}

function getPendingCheck(): Promise<HealthResult> {
	pending ??= checkDependencies()
		.then((result) => {
			cached = { result, expiresAt: Date.now() + CACHE_MS };
			return result;
		})
		.finally(() => {
			pending = undefined;
		});
	return pending;
}

async function checkDependencies(): Promise<HealthResult> {
	const [
		postgresStatus,
		clickhouseProbe,
		clickhouseReadStatus,
		clickhousePingStatus,
	] = await Promise.all([
		postgresIsIdle().then((idle) =>
			idle
				? { status: "idle" as const, duration_ms: 0 }
				: measureDependency(checkPostgres),
		),
		checkClickHouseWrite(),
		measureDependency(checkClickHouseRead),
		measureDependency(checkClickHousePing),
	]);
	const result = summarizeHealth(
		postgresStatus,
		clickhouseProbe,
		clickhouseReadStatus,
		clickhousePingStatus,
	);
	logWriteProbe(clickhouseProbe, result.alerts);
	return result;
}

export function summarizeHealth(
	postgresStatus: DependencyStatus,
	probe: WriteProbeReport,
	clickhouseReadStatus: DependencyStatus,
	clickhousePingStatus: DependencyStatus,
): HealthResult {
	const clickhouse: ClickHouseWriteStatus = {
		status: HEALTHY_WRITE_PROBE_OUTCOMES.has(probe.outcome)
			? "ok"
			: "unavailable",
		duration_ms: probe.duration_ms,
		outcome: probe.outcome,
		probe,
	};
	const alerts: HealthAlert[] = [];
	if (
		postgresStatus.status === "unavailable" ||
		clickhouseReadStatus.status === "unavailable" ||
		probe.outcome === "insert_failed" ||
		probe.outcome === "read_failed"
	)
		alerts.push("availability");
	if (probe.slow_insert) alerts.push("slow_write");
	if (probe.outcome === "delayed_visibility" || probe.outcome === "not_visible")
		alerts.push("visibility");
	return {
		status:
			postgresStatus.status !== "unavailable" && clickhouse.status === "ok"
				? "ok"
				: "unavailable",
		alerts,
		dependencies: {
			postgres: postgresStatus,
			clickhouse,
			clickhouse_read: clickhouseReadStatus,
			clickhouse_ping: clickhousePingStatus,
		},
	};
}

function logWriteProbe(probe: WriteProbeReport, alerts: HealthAlert[]): void {
	const properties = { ...probe, alerts };
	const message =
		"ClickHouse write probe {outcome} in {duration_ms} ms (probe {probe_id})";
	if (probe.outcome === "ok" && !probe.slow_insert)
		logger.info(message, properties);
	else if (HEALTHY_WRITE_PROBE_OUTCOMES.has(probe.outcome))
		logger.warn(message, properties);
	else logger.error(message, properties);
}

async function postgresIsIdle(): Promise<boolean> {
	const { cronGate } = await import("../services/idle-activity.js");
	return !(await cronGate()).run;
}

async function measureDependency(
	check: () => Promise<void>,
): Promise<DependencyStatus> {
	const started = performance.now();
	try {
		await check();
		return {
			status: "ok",
			duration_ms: Math.round(performance.now() - started),
		};
	} catch {
		// Never expose connection strings, credentials, SQL, or provider errors.
		return {
			status: "unavailable",
			duration_ms: Math.round(performance.now() - started),
		};
	}
}

async function checkPostgres(): Promise<void> {
	const url = process.env.PG_CONNECTION_STRING;
	if (!url) throw new Error("Postgres is not configured");
	const sql = postgres(url, {
		max: 1,
		prepare: false,
		connect_timeout: 2,
		connection: { statement_timeout: 2_000, synchronous_commit: "on" },
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			(async () => {
				const probeId = crypto.randomUUID();
				// These are separate autocommitted statements: a rollback-only test
				// would not establish that the database can commit a write.
				await sql`INSERT INTO dependency_health_probe (id) VALUES (${probeId})`;
				const rows = await sql<{ id: string }[]>`
					SELECT id FROM dependency_health_probe WHERE id = ${probeId}`;
				if (rows[0]?.id !== probeId)
					throw new Error("Postgres storage probe was not readable");
				await sql`DELETE FROM dependency_health_probe
					WHERE id = ${probeId} OR created_at < now() - interval '1 day'`;
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Postgres health timeout")),
					TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		// Also terminates an outstanding connect/query after the deadline.
		await sql.end({ timeout: 0 });
	}
}

async function checkClickHouseWrite(): Promise<WriteProbeReport> {
	const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
	const client = createClient({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD || "",
		database: "default",
		request_timeout: WRITE_PROBE_LIMITS.insertRequestTimeoutMs,
	});
	try {
		return await probeClickHouseWrite(client);
	} finally {
		await client.close();
	}
}

// Reads a stored row without writing, so slow inserts do not report analytics
// as unavailable.
async function checkClickHouseRead(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
	const client = createClient({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD || "",
		database: "default",
		request_timeout: TIMEOUT_MS,
	});
	try {
		const result = await client.query({
			query: "SELECT probe_id FROM rudel.dependency_health_probes LIMIT 1",
			format: "JSONEachRow",
			abort_signal: AbortSignal.timeout(TIMEOUT_MS),
			clickhouse_settings: {
				max_execution_time: 2,
				timeout_before_checking_execution_speed: 0,
				max_rows_to_read: "100000",
				max_bytes_to_read: "1048576",
				use_query_cache: 0,
			},
		});
		await result.json();
	} finally {
		await client.close();
	}
}

async function checkClickHousePing(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
	const client = createClient({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD || "",
		database: "default",
		request_timeout: TIMEOUT_MS,
	});
	try {
		const result = await client.ping({
			select: true,
			abort_signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!result.success) throw result.error;
	} finally {
		await client.close();
	}
}
