import { createClient } from "@clickhouse/client-web";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import postgres from "postgres";

const TIMEOUT_MS = 3_000;
const CACHE_MS = 30_000;

interface DependencyStatus {
	status: "ok" | "unavailable";
	duration_ms: number;
}

interface HealthResult {
	status: "ok" | "unavailable";
	dependencies: {
		postgres: DependencyStatus;
		clickhouse: DependencyStatus;
		clickhouse_read: DependencyStatus;
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
	const [postgresStatus, clickhouseStatus, clickhouseReadStatus] =
		await Promise.all([
			measureDependency(checkPostgres),
			measureDependency(checkClickHouse),
			measureDependency(checkClickHouseRead),
		]);
	// Readiness stays strict: an acknowledged ClickHouse write is required.
	// The read check only tells the app whether analytics can still be served
	// while writes are slow.
	const healthy =
		postgresStatus.status === "ok" && clickhouseStatus.status === "ok";
	return {
		status: healthy ? "ok" : "unavailable",
		dependencies: {
			postgres: postgresStatus,
			clickhouse: clickhouseStatus,
			clickhouse_read: clickhouseReadStatus,
		},
	};
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

async function checkClickHouse(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
	const client = createClient({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD || "",
		database: "default",
		request_timeout: TIMEOUT_MS,
	});
	try {
		// SELECT 1 only exercises the query frontend. Require an acknowledged
		// storage write and an uncached read of that exact row instead. A fresh ID
		// prevents old canary data or query-cache hits from masking an outage.
		const probeId = crypto.randomUUID();
		const signal = AbortSignal.timeout(TIMEOUT_MS);
		await client.command({
			query: `INSERT INTO rudel.dependency_health_probes (probe_id)
				SETTINGS async_insert = 1, wait_for_async_insert = 1,
					async_insert_use_adaptive_busy_timeout = 0,
					async_insert_busy_timeout_ms = 200
				FORMAT JSONEachRow ${JSON.stringify({ probe_id: probeId })}`,
			abort_signal: signal,
			clickhouse_settings: { max_execution_time: 2 },
		});
		const result = await client.query({
			query: `SELECT probe_id FROM rudel.dependency_health_probes
				WHERE probe_id = {probeId:UUID} LIMIT 1`,
			query_params: { probeId },
			format: "JSONEachRow",
			abort_signal: signal,
			clickhouse_settings: {
				max_execution_time: 2,
				timeout_before_checking_execution_speed: 0,
				max_rows_to_read: "100000",
				max_bytes_to_read: "1048576",
				use_query_cache: 0,
			},
		});
		const rows = await result.json<{ probe_id: string }>();
		if (rows[0]?.probe_id !== probeId)
			throw new Error("ClickHouse storage probe was not readable");
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
