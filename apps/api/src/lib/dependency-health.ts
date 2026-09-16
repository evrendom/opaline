import { createClient } from "@clickhouse/client-web";
import { resolveClickHouseUsername } from "@rudel/ch-schema/connection";
import postgres from "postgres";

const TIMEOUT_MS = 3_000;
const CACHE_MS = 5_000;

interface DependencyStatus {
	status: "ok" | "unavailable";
	duration_ms: number;
}

interface HealthResult {
	status: "ok" | "unavailable";
	dependencies: { postgres: DependencyStatus; clickhouse: DependencyStatus };
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
	const [postgresStatus, clickhouseStatus] = await Promise.all([
		measureDependency(checkPostgres),
		measureDependency(checkClickHouse),
	]);
	const healthy =
		postgresStatus.status === "ok" && clickhouseStatus.status === "ok";
	return {
		status: healthy ? "ok" : "unavailable",
		dependencies: { postgres: postgresStatus, clickhouse: clickhouseStatus },
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
		connection: { statement_timeout: 2_000 },
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			sql`SELECT 1`,
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
		const result = await client.query({
			query: "SELECT 1 AS healthy",
			format: "JSONEachRow",
			abort_signal: AbortSignal.timeout(TIMEOUT_MS),
			clickhouse_settings: { max_execution_time: 2 },
		});
		const rows = await result.json<{ healthy: number }>();
		if (rows[0]?.healthy !== 1) throw new Error("Unexpected health response");
	} finally {
		await client.close();
	}
}
