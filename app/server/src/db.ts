import * as schema from "@rudel/sql-schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) {
	throw new Error("PG_CONNECTION_STRING environment variable is required");
}
const requiredConnectionString = connectionString;

function readLockTimeoutMs(): number {
	const raw = process.env.PG_LOCK_TIMEOUT_MS;
	if (raw === undefined || raw === "") {
		return 30_000;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error("PG_LOCK_TIMEOUT_MS must be a positive integer");
	}
	return value;
}

const postgresClientOptions = {
	connect_timeout: 10,
	connection: {
		idle_in_transaction_session_timeout: 120_000,
		lock_timeout: readLockTimeoutMs(),
		statement_timeout: 120_000,
	},
	idle_timeout: 120,
	max: 5,
	max_lifetime: 60 * 30,
	prepare: false,
} as const;

const client = postgres(requiredConnectionString, postgresClientOptions);
export const sqlClient = client;
export const db = drizzle(client, { schema });
export const ingestProcessingSqlClient = postgres(requiredConnectionString, {
	...postgresClientOptions,
	max: 4,
});

// Live session appends and state reads. Their own small pool keeps a burst
// of them from starving dashboard and ingest queries of connections; appends
// write R2 before they take a connection and are gated below its size.
export const liveSessionSqlClient = postgres(requiredConnectionString, {
	...postgresClientOptions,
	max: 5,
});
