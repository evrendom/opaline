import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	isLocalClickHouseEndpoint,
	resolveClickHouseUsername,
} from "../src/clickhouse-connection.js";

const CONTROLLED_LOG_COMMENT = "rudel-f16-controlled-migration";
const RUN_QUERY_PREFIX = `rudel-f16-${crypto.randomUUID()}`;
const CUTOVER_MIGRATION = "20260826090551_auto.sql";
const CUTOVER_RECOVERY_MARKER = "-- RECOVERY: F16-CUTOVER-AFTER-RENAME";
const F16_MIGRATIONS = [
	"20260826090550_f16_preservation.sql",
	CUTOVER_MIGRATION,
	"20260826090600_f16_backfill.sql",
	"20260826090610_f16_cleanup.sql",
];
const MIGRATIONS_DIR = resolve(import.meta.dir, "..", "chx", "migrations");

interface CutoverStateRow {
	backup_count: number | string;
}

interface MigrationRuntime {
	barrierClients: readonly MigrationHttpClient[];
	barrierTimeoutMs: number;
	executor: ClickHouseExecutor;
	primaryClient: MigrationHttpClient;
}

interface MigrationHttpClient {
	close: () => Promise<void>;
	command: (query: string, timeoutMs?: number) => Promise<void>;
	query: <TRow>(query: string) => Promise<TRow[]>;
}

function readRequiredPositiveInteger(name: string): number {
	const raw = process.env[name]?.trim();
	if (!raw || !/^[1-9][0-9]*$/u.test(raw)) {
		throw new Error(`${name} must be set to a positive integer`);
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${name} exceeds the safe integer range`);
	}
	return value;
}

function readPositiveInteger(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	if (!/^[1-9][0-9]*$/u.test(raw)) {
		throw new Error(`${name} must be a positive integer`);
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${name} exceeds the safe integer range`);
	}
	return value;
}

function readWriterUrls(primaryUrl: string): readonly string[] {
	const configured = process.env.F16_CLICKHOUSE_WRITER_URLS?.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	if (!isLocalClickHouseEndpoint(primaryUrl) && !configured?.length) {
		throw new Error(
			"F16_CLICKHOUSE_WRITER_URLS is required for a remote cutover so every production writer path is polled",
		);
	}
	const urls = new Set([primaryUrl, ...(configured ?? [])]);
	for (const url of urls) {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error(`Unsupported ClickHouse writer URL protocol: ${url}`);
		}
	}
	return [...urls];
}

function createMigrationClient(input: {
	database: string;
	ddlTimeoutSeconds: number;
	password: string;
	requestTimeoutMs: number;
	url: string;
	username: string;
}): MigrationHttpClient {
	const endpoint = new URL(input.url);
	endpoint.searchParams.set("async_insert", "0");
	endpoint.searchParams.set("database", input.database);
	endpoint.searchParams.set("default_format", "JSONEachRow");
	endpoint.searchParams.set("distributed_ddl_output_mode", "throw");
	endpoint.searchParams.set(
		"distributed_ddl_task_timeout",
		String(input.ddlTimeoutSeconds),
	);
	endpoint.searchParams.set("log_comment", CONTROLLED_LOG_COMMENT);
	endpoint.searchParams.set("wait_end_of_query", "1");
	const authorization = `Basic ${Buffer.from(
		`${input.username}:${input.password}`,
	).toString("base64")}`;

	async function request(
		query: string,
		timeoutMs = input.requestTimeoutMs,
	): Promise<string> {
		const requestEndpoint = new URL(endpoint);
		requestEndpoint.searchParams.set(
			"query_id",
			`${RUN_QUERY_PREFIX}-${crypto.randomUUID()}`,
		);
		const response = await fetch(requestEndpoint, {
			body: query,
			headers: { Authorization: authorization },
			method: "POST",
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body = await response.text();
		if (!response.ok) {
			throw new Error(
				`ClickHouse migration request failed (${response.status}): ${body}`,
			);
		}
		return body;
	}

	return {
		close: () => Promise.resolve(),
		async command(query, timeoutMs) {
			await request(query, timeoutMs);
		},
		async query<TRow>(query: string) {
			const body = await request(query);
			const rows: TRow[] = body
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line));
			return rows;
		},
	};
}

function createExecutor(client: MigrationHttpClient): ClickHouseExecutor {
	return {
		async close() {
			await client.close();
		},
		async execute(sql) {
			await client.command(sql);
		},
		async insert(params) {
			const values = params.values.map((row) => JSON.stringify(row)).join("\n");
			await client.command(
				`INSERT INTO ${params.table} FORMAT JSONEachRow\n${values}`,
			);
		},
		listSchemaObjects() {
			return Promise.resolve([]);
		},
		listTableDetails() {
			return Promise.resolve([]);
		},
		async query<T>(sql: string) {
			return client.query<T>(sql);
		},
	};
}

function createRuntime(): MigrationRuntime {
	const primaryUrl =
		process.env.CLICKHOUSE_URL?.trim() || "http://localhost:8123";
	const database = process.env.CLICKHOUSE_DB?.trim() || "default";
	const username = resolveClickHouseUsername(process.env, primaryUrl);
	const password = process.env.CLICKHOUSE_PASSWORD ?? "";
	const requestTimeoutMs = readRequiredPositiveInteger(
		"F16_MIGRATION_REQUEST_TIMEOUT_MS",
	);
	const ddlTimeoutSeconds = readPositiveInteger(
		"F16_DDL_TASK_TIMEOUT_SECONDS",
		900,
	);
	if (requestTimeoutMs <= (ddlTimeoutSeconds + 60) * 1_000) {
		throw new Error(
			"F16_MIGRATION_REQUEST_TIMEOUT_MS must exceed the distributed DDL timeout by at least 60 seconds",
		);
	}
	const barrierTimeoutMs = readPositiveInteger(
		"F16_CATALOG_BARRIER_TIMEOUT_MS",
		120_000,
	);
	if (barrierTimeoutMs >= requestTimeoutMs) {
		throw new Error(
			"F16_CATALOG_BARRIER_TIMEOUT_MS must be lower than F16_MIGRATION_REQUEST_TIMEOUT_MS",
		);
	}
	const barrierClients = readWriterUrls(primaryUrl).map((url) =>
		createMigrationClient({
			database,
			ddlTimeoutSeconds,
			password,
			requestTimeoutMs,
			url,
			username,
		}),
	);
	const primaryClient = barrierClients[0];
	if (!primaryClient)
		throw new Error("No ClickHouse migration client was created");
	return {
		barrierClients,
		barrierTimeoutMs,
		executor: createExecutor(primaryClient),
		primaryClient,
	};
}

async function runBarrier(
	statement: string,
	runtime: MigrationRuntime,
): Promise<void> {
	const deadline = Date.now() + runtime.barrierTimeoutMs;
	let failures: readonly PromiseRejectedResult[] = [];
	while (Date.now() < deadline) {
		const attemptTimeoutMs = Math.max(1, deadline - Date.now());
		const results = await Promise.allSettled(
			runtime.barrierClients.map((client) =>
				client.command(statement, attemptTimeoutMs),
			),
		);
		failures = results.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failures.length === 0) return;
		if (Date.now() >= deadline) break;
		await runtime.primaryClient.command(
			"SELECT sleepEachRow(1) FROM numbers(1) SETTINGS max_block_size = 1",
			Math.max(1, deadline - Date.now()),
		);
	}
	const messages = failures
		.map((failure) => String(failure.reason))
		.join(" | ");
	throw new Error(`F16 catalog barrier timed out: ${messages}`);
}

async function executeMigrationSql(
	sql: string,
	runtime: MigrationRuntime,
): Promise<void> {
	for (const statement of extractExecutableStatements(sql)) {
		if (statement.includes(" AS f16_poll_")) {
			await runBarrier(statement, runtime);
		} else {
			await runtime.executor.execute(statement);
		}
	}
}

async function waitForOrphanedQueries(
	runtime: MigrationRuntime,
): Promise<void> {
	await runBarrier(
		`SELECT throwIf(
			count() != 0,
			'F16 recovery barrier: a previous controlled query is still active'
		) AS f16_poll_no_orphaned_queries
		FROM system.processes
		WHERE query_id != currentQueryID()
			AND startsWith(query_id, 'rudel-f16-')
			AND NOT startsWith(query_id, '${RUN_QUERY_PREFIX}')`,
		runtime,
	);
}

async function selectCutoverSql(
	name: string,
	sql: string,
	runtime: MigrationRuntime,
): Promise<string> {
	if (name !== CUTOVER_MIGRATION) return sql;
	const [state] = await runtime.executor.query<CutoverStateRow>(`
		SELECT countIf(name IN (
			'claude_sessions_f16_backup_20260826',
			'codex_sessions_f16_backup_20260826',
			'session_analytics_f16_backup_20260826',
			'session_language_signals_f16_backup_20260826'
		)) AS backup_count
		FROM system.tables
		WHERE database = 'rudel'
	`);
	const backupCount = Number(state?.backup_count ?? 0);
	if (backupCount === 0) return sql;
	if (backupCount !== 4) {
		throw new Error(
			`F16 cutover recovery requires either zero or four backups; observed ${backupCount}`,
		);
	}
	const markerIndex = sql.indexOf(CUTOVER_RECOVERY_MARKER);
	if (markerIndex < 0) {
		throw new Error("F16 cutover recovery marker is missing");
	}
	const markerEnd = sql.indexOf("\n", markerIndex);
	if (markerEnd < 0) {
		throw new Error("F16 cutover recovery marker has no executable tail");
	}
	console.log(`Recovering ${name} after the atomic rename marker`);
	return sql.slice(markerEnd + 1);
}

async function run(): Promise<void> {
	const runtime = createRuntime();
	try {
		await waitForOrphanedQueries(runtime);
		const journalStore = createJournalStore(runtime.executor);
		const journal = await journalStore.readJournal();
		let missingEarlierPhase = false;
		for (const phase of F16_MIGRATIONS) {
			const applied = journal.applied.some((entry) => entry.name === phase);
			if (!applied) {
				missingEarlierPhase = true;
			} else if (missingEarlierPhase) {
				throw new Error(
					`F16 journal is out of order at ${phase}; stop for journal/state reconciliation`,
				);
			}
		}
		for (const name of F16_MIGRATIONS) {
			const path = resolve(MIGRATIONS_DIR, name);
			const sql = await readFile(path, "utf8");
			const checksum = checksumSQL(sql);
			const applied = journal.applied.find((entry) => entry.name === name);
			if (applied) {
				if (applied.checksum && applied.checksum !== checksum) {
					throw new Error(
						`Applied F16 migration checksum mismatch for ${name}`,
					);
				}
				console.log(`Already applied: ${name}`);
				continue;
			}
			const executableSql = await selectCutoverSql(name, sql, runtime);
			await executeMigrationSql(executableSql, runtime);
			await journalStore.appendEntry({
				appliedAt: new Date().toISOString().replace("Z", ""),
				checksum,
				name,
			});
			journal.applied.push({
				appliedAt: new Date().toISOString().replace("Z", ""),
				checksum,
				name,
			});
			console.log(`Applied: ${name}`);
		}
	} finally {
		await Promise.all(runtime.barrierClients.map((client) => client.close()));
	}
}

if (import.meta.main) {
	run().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
