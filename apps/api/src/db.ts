import * as schema from "@rudel/sql-schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.PG_CONNECTION_STRING;
if (!connectionString) {
	throw new Error("PG_CONNECTION_STRING environment variable is required");
}
const requiredConnectionString = connectionString;

const postgresClientOptions = {
	connect_timeout: 10,
	idle_timeout: 20,
	max: 5,
	max_lifetime: 60 * 30,
	prepare: false,
} as const;

const client = postgres(requiredConnectionString, postgresClientOptions);
export const sqlClient = client;
export const db = drizzle(client, { schema });

export function createIngestProcessingSqlClient(): postgres.Sql {
	return postgres(requiredConnectionString, {
		...postgresClientOptions,
		max: 1,
	});
}
