import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
const LEASE_TABLE = "rudel.f16_revision_cutover_lease_20260826";
const PRESERVATION_MIGRATION = "20260826090550_f16_preservation.sql";
const SKILL_RECEIPTS_MIGRATION =
	"20260826090550_f16_skill_receipts_rebuild.sql";
const SKILL_USES_MIGRATION = "20260826090550_f16_skill_uses_rebuild.sql";
const SKILL_VERSION_CONTENTS_MIGRATION =
	"20260826090550_f16_skill_version_contents_rebuild.sql";
const CUTOVER_MIGRATION = "20260826090551_auto.sql";
const BACKFILL_MIGRATION = "20260826090600_f16_backfill.sql";
const CLEANUP_MIGRATION = "20260826090610_f16_cleanup.sql";
const CODEX_BACKFILL_MAX_BLOCK_SIZE = 4;
const VERIFICATION_MAX_BLOCK_SIZE = 8;
const CUTOVER_RECOVERY_MARKER = "-- RECOVERY: F16-CUTOVER-AFTER-RENAME";
const SKILL_REBUILD_RECOVERY_MARKER =
	"-- RECOVERY: F16-SKILL-REBUILD-AFTER-EXCHANGE";

export const F16_MIGRATIONS: readonly string[] = [
	PRESERVATION_MIGRATION,
	SKILL_RECEIPTS_MIGRATION,
	SKILL_USES_MIGRATION,
	SKILL_VERSION_CONTENTS_MIGRATION,
	CUTOVER_MIGRATION,
	BACKFILL_MIGRATION,
	CLEANUP_MIGRATION,
];

const SKILL_REBUILD_TABLES = new Map<string, readonly [string, string]>([
	[
		SKILL_RECEIPTS_MIGRATION,
		["skill_receipts", "skill_receipts_f16_uint64_backup_20260826"],
	],
	[
		SKILL_USES_MIGRATION,
		["skill_uses", "skill_uses_f16_uint64_backup_20260826"],
	],
	[
		SKILL_VERSION_CONTENTS_MIGRATION,
		[
			"skill_version_contents",
			"skill_version_contents_f16_uint64_backup_20260826",
		],
	],
]);

const MIGRATIONS_DIR = resolve(import.meta.dir, "..", "chx", "migrations");

const PRESERVATION_LIVE_VERIFICATION_SQL = `
SELECT throwIf(
	count() != 4
	OR countIf(receipt.table_name = '') > 0
	OR countIf(receipt.source_physical_rows > receipt.snapshot_physical_rows) > 0
	OR countIf(
		receipt.source_equal_key_version_groups
			> receipt.snapshot_equal_key_version_groups
	) > 0
	OR countIf(receipt.snapshot_physical_rows != live.snapshot_physical_rows) > 0
	OR countIf(
		receipt.snapshot_equal_key_version_groups
			!= live.snapshot_equal_key_version_groups
	) > 0,
	'F16 preservation live revalidation failed: a snapshot changed after its durable receipt'
)
FROM
(
	SELECT
		'claude_sessions' AS table_name,
		(SELECT count() FROM rudel.claude_sessions_f16_backfill_source_20260826)
			AS snapshot_physical_rows,
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.claude_sessions_f16_backfill_source_20260826
				GROUP BY organization_id, session_date, session_id, ingested_at
				HAVING count() > 1
			)
		) AS snapshot_equal_key_version_groups
	UNION ALL
	SELECT
		'codex_sessions',
		(SELECT count() FROM rudel.codex_sessions_f16_backfill_source_20260826),
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.codex_sessions_f16_backfill_source_20260826
				GROUP BY organization_id, session_date, session_id, ingested_at
				HAVING count() > 1
			)
		)
	UNION ALL
	SELECT
		'session_analytics',
		(SELECT count() FROM rudel.session_analytics_f16_backfill_source_20260826),
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.session_analytics_f16_backfill_source_20260826
				GROUP BY source, organization_id, user_id, session_id, ingested_at
				HAVING count() > 1
			)
		)
	UNION ALL
	SELECT
		'session_language_signals',
		(SELECT count() FROM rudel.session_language_signals_f16_backfill_source_20260826),
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.session_language_signals_f16_backfill_source_20260826
				GROUP BY organization_id, session_date, session_id, source, scanned_at
				HAVING count() > 1
			)
		)
) AS live
LEFT JOIN
(
	SELECT
		table_name,
		source_physical_rows,
		snapshot_physical_rows,
		source_equal_key_version_groups,
		snapshot_equal_key_version_groups
	FROM rudel.f16_revision_cutover_verification_20260826 FINAL
	WHERE phase = 'preservation'
) AS receipt USING (table_name)`;

const POST_BACKFILL_LIVE_VERIFICATION_SQL = `
SELECT throwIf(
	count() != 4
	OR countIf(receipt.table_name = '') > 0
	OR countIf(receipt.expected_logical_rows != receipt.canonical_logical_rows) > 0
	OR countIf(receipt.canonical_logical_rows != live.canonical_logical_rows) > 0,
	'F16 post-backfill live revalidation failed: a canonical changed after its durable receipt'
)
FROM
(
	SELECT
		'claude_sessions' AS table_name,
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.claude_sessions
				GROUP BY organization_id, session_date, session_id
			)
		) AS canonical_logical_rows
	UNION ALL
	SELECT
		'codex_sessions',
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.codex_sessions
				GROUP BY organization_id, session_date, session_id
			)
		)
	UNION ALL
	SELECT
		'session_analytics',
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.session_analytics
				GROUP BY source, organization_id, user_id, session_id
			)
		)
	UNION ALL
	SELECT
		'session_language_signals',
		(
			SELECT count()
			FROM
			(
				SELECT 1
				FROM rudel.session_language_signals
				GROUP BY organization_id, session_date, session_id, source
			)
		)
) AS live
LEFT JOIN
(
	SELECT
		table_name,
		expected_logical_rows,
		canonical_logical_rows
	FROM rudel.f16_revision_cutover_postbackfill_verification_20260826 FINAL
) AS receipt USING (table_name)`;

interface CutoverStateRow {
	backup_count: number | string;
}

interface SkillRebuildStateRow {
	backup_type: string;
	canonical_type: string;
}

interface TopologyHostRow {
	host_name: string;
}

interface DetachedCommandStatusRow {
	detached_active: number | string;
	detached_exception_code: number | string;
	detached_failed: number | string;
	detached_finished: number | string;
	detached_started: number | string;
}

interface F16TopologySingleNode {
	mode: "single-node";
}

interface F16TopologyCloudMultiNode {
	clusterName: string;
	expectedReplicaCount: number;
	mode: "cloud-multi-node";
}

export type F16Topology = F16TopologySingleNode | F16TopologyCloudMultiNode;

export interface MigrationHttpClient {
	close: () => Promise<void>;
	command: (query: string, timeoutMs?: number) => Promise<void>;
	query: <TRow>(query: string, timeoutMs?: number) => Promise<TRow[]>;
}

export interface MigrationJournalEntry {
	appliedAt: string;
	checksum: string;
	name: string;
}

export interface MigrationJournal {
	applied: readonly MigrationJournalEntry[];
}

export interface MigrationJournalStore {
	appendEntry: (entry: MigrationJournalEntry) => Promise<void>;
	readJournal: () => Promise<MigrationJournal>;
}

export interface MigrationRuntime {
	autoApproveCheckpoints: boolean;
	backfillBucketCount: number;
	barrierClients: readonly MigrationHttpClient[];
	barrierTimeoutMs: number;
	executor: ClickHouseExecutor;
	leaseAcquiredAt: string;
	leaseOwnerRunId: string;
	primaryClient: MigrationHttpClient;
	runQueryPrefix: string;
	sleep: (milliseconds: number) => Promise<void>;
	timeNow: () => number;
	topology: F16Topology;
}

export interface F16RunnerDependencies {
	journalStore: MigrationJournalStore;
	loadMigration: (name: string) => Promise<string>;
	log: (message: string) => void;
	phaseNames: readonly string[];
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

function readBackfillBucketCount(): number {
	const value = readPositiveInteger("F16_BACKFILL_BUCKET_COUNT", 1);
	if (value > 4096) {
		throw new Error("F16_BACKFILL_BUCKET_COUNT must be at most 4096");
	}
	return value;
}

function readWriterUrls(primaryUrl: string): readonly string[] {
	const configured = process.env.F16_CLICKHOUSE_WRITER_URLS?.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	if (!isLocalClickHouseEndpoint(primaryUrl) && !configured?.length) {
		throw new Error(
			"F16_CLICKHOUSE_WRITER_URLS is required for a remote cutover so every independently routed writer path is checked",
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

function readTopology(primaryUrl: string): F16Topology {
	const configuredMode = process.env.F16_CLICKHOUSE_TOPOLOGY?.trim();
	const mode =
		configuredMode ||
		(isLocalClickHouseEndpoint(primaryUrl) ? "single-node" : "");
	if (mode === "single-node") {
		if (!isLocalClickHouseEndpoint(primaryUrl)) {
			throw new Error(
				"F16_CLICKHOUSE_TOPOLOGY=single-node is forbidden for a remote endpoint",
			);
		}
		return { mode };
	}
	if (mode !== "cloud-multi-node") {
		throw new Error(
			"F16_CLICKHOUSE_TOPOLOGY must be cloud-multi-node for a remote cutover",
		);
	}
	const clusterName = process.env.F16_CLUSTER_NAME?.trim() || "default";
	const expectedReplicaCount = readRequiredPositiveInteger(
		"F16_EXPECTED_REPLICA_COUNT",
	);
	return { clusterName, expectedReplicaCount, mode };
}

function readAutoApproval(primaryUrl: string, topology: F16Topology): boolean {
	const value = process.env.F16_NONPROD_AUTO_APPROVE_CHECKPOINTS?.trim();
	if (!value) return false;
	if (value !== "ci-only") {
		throw new Error(
			"F16_NONPROD_AUTO_APPROVE_CHECKPOINTS only accepts the literal ci-only",
		);
	}
	const isCi = process.env.CI === "true" || process.env.CI === "1";
	if (
		!isCi ||
		!isLocalClickHouseEndpoint(primaryUrl) ||
		topology.mode !== "single-node"
	) {
		throw new Error(
			"F16_NONPROD_AUTO_APPROVE_CHECKPOINTS=ci-only requires CI=true, a local ClickHouse endpoint, and single-node topology",
		);
	}
	return true;
}

function quoteSqlString(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function createMigrationClient(input: {
	database: string;
	detachedNoEvidenceTimeoutMs?: number;
	detachedStatusPollIntervalMs?: number;
	ddlTimeoutSeconds: number;
	maxBytesBeforeExternalGroupBy: number;
	maxBytesBeforeExternalSort: number;
	maxMemoryUsage: number;
	maxTemporaryDataOnDiskBytes: number;
	password: string;
	requestTimeoutMs: number;
	runQueryPrefix: string;
	topology: F16Topology;
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
	endpoint.searchParams.set(
		"max_bytes_before_external_group_by",
		String(input.maxBytesBeforeExternalGroupBy),
	);
	endpoint.searchParams.set(
		"max_bytes_before_external_sort",
		String(input.maxBytesBeforeExternalSort),
	);
	endpoint.searchParams.set("max_memory_usage", String(input.maxMemoryUsage));
	endpoint.searchParams.set(
		"max_temporary_data_on_disk_size_for_query",
		String(input.maxTemporaryDataOnDiskBytes),
	);
	endpoint.searchParams.set("skip_unavailable_shards", "0");
	endpoint.searchParams.set("wait_end_of_query", "1");
	const authorization = `Basic ${Buffer.from(
		`${input.username}:${input.password}`,
	).toString("base64")}`;

	function sendRequest(
		requestEndpoint: URL,
		query: string,
		timeoutMs: number,
	): Promise<{ body: string; statusCode: number }> {
		const requestTransport =
			requestEndpoint.protocol === "https:" ? httpsRequest : httpRequest;
		return new Promise((resolveRequest, rejectRequest) => {
			let settled = false;
			const finish = (
				result: { body: string; statusCode: number } | Error,
			): void => {
				if (settled) return;
				settled = true;
				clearTimeout(deadline);
				if (result instanceof Error) {
					rejectRequest(result);
					return;
				}
				resolveRequest(result);
			};
			const request = requestTransport(
				requestEndpoint,
				{
					headers: {
						Authorization: authorization,
						"Content-Length": Buffer.byteLength(query),
						"Content-Type": "text/plain; charset=utf-8",
					},
					method: "POST",
				},
				(response) => {
					let body = "";
					response.setEncoding("utf8");
					response.on("data", (chunk: string) => {
						body += chunk;
					});
					response.once("aborted", () => {
						finish(new Error("ClickHouse migration response was aborted"));
					});
					response.once("error", finish);
					response.once("end", () => {
						finish({ body, statusCode: response.statusCode ?? 0 });
					});
				},
			);
			const deadline = setTimeout(() => {
				finish(new Error("The operation timed out."));
				request.destroy();
			}, timeoutMs);
			request.once("error", finish);
			request.end(query);
		});
	}

	function readDetachedCount(
		row: DetachedCommandStatusRow,
		key: keyof DetachedCommandStatusRow,
	): number {
		const value = Number(row[key]);
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error(`Invalid detached command status field ${key}`);
		}
		return value;
	}

	async function reconcileDetachedCommand(
		detachedQueryId: string,
		absoluteDeadlineMs: number,
	): Promise<void> {
		const processSource =
			input.topology.mode === "cloud-multi-node"
				? `clusterAllReplicas(${quoteSqlString(
						input.topology.clusterName,
					)}, system.processes)`
				: "system.processes";
		const queryLogSource =
			input.topology.mode === "cloud-multi-node"
				? `clusterAllReplicas(${quoteSqlString(
						input.topology.clusterName,
					)}, system.query_log)`
				: "system.query_log";
		const quotedQueryId = quoteSqlString(detachedQueryId);
		const noEvidenceDeadlineMs = Math.min(
			absoluteDeadlineMs,
			Date.now() + (input.detachedNoEvidenceTimeoutMs ?? 60_000),
		);
		let observedQuery = false;
		let lastStatus = "no terminal status observed";
		while (Date.now() < absoluteDeadlineMs) {
			const remainingMs = absoluteDeadlineMs - Date.now();
			const statusEndpoint = new URL(endpoint);
			statusEndpoint.searchParams.set(
				"query_id",
				`${input.runQueryPrefix}-reconcile-${crypto.randomUUID()}`,
			);
			const statusQuery = `
				SELECT
					(SELECT count() FROM ${processSource}
					 WHERE query_id = ${quotedQueryId}
						OR initial_query_id = ${quotedQueryId}) AS detached_active,
					(SELECT countIf(type = 'QueryStart') FROM ${queryLogSource}
					 WHERE event_date >= today() - 1 AND query_id = ${quotedQueryId}) AS detached_started,
					(SELECT countIf(type = 'QueryFinish') FROM ${queryLogSource}
					 WHERE event_date >= today() - 1 AND query_id = ${quotedQueryId}) AS detached_finished,
					(SELECT countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing'))
					 FROM ${queryLogSource}
					 WHERE event_date >= today() - 1 AND query_id = ${quotedQueryId}) AS detached_failed,
					(SELECT maxIf(exception_code, type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing'))
					 FROM ${queryLogSource}
					 WHERE event_date >= today() - 1 AND query_id = ${quotedQueryId}) AS detached_exception_code
				SETTINGS skip_unavailable_shards=0
				FORMAT JSONEachRow`;
			let response: { body: string; statusCode: number } | undefined;
			try {
				response = await sendRequest(
					statusEndpoint,
					statusQuery,
					Math.max(1, Math.min(30_000, remainingMs)),
				);
			} catch (error) {
				lastStatus = String(error);
			}
			if (response) {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					lastStatus = `status census HTTP ${response.statusCode}`;
				} else {
					let validZeroCensus = false;
					try {
						const line = response.body
							.split("\n")
							.find((candidate) => candidate.trim().length > 0);
						if (!line) throw new Error("empty detached command status");
						const row = JSON.parse(line) as DetachedCommandStatusRow;
						const active = readDetachedCount(row, "detached_active");
						const started = readDetachedCount(row, "detached_started");
						const finished = readDetachedCount(row, "detached_finished");
						const failed = readDetachedCount(row, "detached_failed");
						const exceptionCode = readDetachedCount(
							row,
							"detached_exception_code",
						);
						observedQuery ||=
							active > 0 || started > 0 || finished > 0 || failed > 0;
						validZeroCensus =
							active === 0 && started === 0 && finished === 0 && failed === 0;
						lastStatus = `active=${active} started=${started} finished=${finished} failed=${failed}`;
						if (active === 0 && failed > 0) {
							throw new Error(
								`Detached ClickHouse command failed with exception code ${exceptionCode}`,
							);
						}
						if (active === 0 && finished > 0) return;
					} catch (error) {
						if (
							error instanceof Error &&
							error.message.startsWith("Detached ClickHouse command failed")
						) {
							throw error;
						}
						lastStatus = String(error);
					}
					if (
						validZeroCensus &&
						!observedQuery &&
						Date.now() >= noEvidenceDeadlineMs
					) {
						throw new Error(
							`Detached ClickHouse command has no server-side evidence after HTTP 504: ${lastStatus}`,
						);
					}
				}
			}
			const sleepMs = Math.min(
				input.detachedStatusPollIntervalMs ?? 1_000,
				absoluteDeadlineMs - Date.now(),
			);
			if (sleepMs > 0) {
				await new Promise<void>((resolveSleep) => {
					setTimeout(resolveSleep, sleepMs);
				});
			}
		}
		throw new Error(
			`Detached ClickHouse command did not reach a terminal state before the request deadline: ${lastStatus}`,
		);
	}

	async function request(
		query: string,
		timeoutMs = input.requestTimeoutMs,
		acceptDetachedCommandSuccess = false,
	): Promise<string> {
		const absoluteDeadlineMs = Date.now() + timeoutMs;
		const requestEndpoint = new URL(endpoint);
		const queryId = `${input.runQueryPrefix}-${crypto.randomUUID()}`;
		requestEndpoint.searchParams.set("query_id", queryId);
		const response = await sendRequest(requestEndpoint, query, timeoutMs);
		if (response.statusCode === 504) {
			await reconcileDetachedCommand(queryId, absoluteDeadlineMs);
			if (acceptDetachedCommandSuccess) return "";
			throw new Error(
				"Detached ClickHouse query finished after HTTP 504, but its response body is unavailable",
			);
		}
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(
				`ClickHouse migration request failed (${response.statusCode}): ${response.body}`,
			);
		}
		return response.body;
	}

	return {
		close: () => Promise.resolve(),
		async command(query, timeoutMs) {
			await request(query, timeoutMs, true);
		},
		async query<TRow>(query: string, timeoutMs?: number) {
			const body = await request(query, timeoutMs);
			const rows: TRow[] = body
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line));
			return rows;
		},
	};
}

export function createExecutor(
	client: MigrationHttpClient,
): ClickHouseExecutor {
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
	const maxMemoryUsage = readPositiveInteger(
		"F16_MAX_MEMORY_USAGE_BYTES",
		2_147_483_648,
	);
	const maxBytesBeforeExternalSort = readPositiveInteger(
		"F16_MAX_BYTES_BEFORE_EXTERNAL_SORT",
		268_435_456,
	);
	const maxBytesBeforeExternalGroupBy = readPositiveInteger(
		"F16_MAX_BYTES_BEFORE_EXTERNAL_GROUP_BY",
		268_435_456,
	);
	if (
		maxBytesBeforeExternalSort >= maxMemoryUsage ||
		maxBytesBeforeExternalGroupBy >= maxMemoryUsage
	) {
		throw new Error(
			"F16 external spill thresholds must be lower than F16_MAX_MEMORY_USAGE_BYTES",
		);
	}
	const maxTemporaryDataOnDiskBytes = readPositiveInteger(
		"F16_MAX_TEMPORARY_DATA_ON_DISK_BYTES",
		4_294_967_296,
	);
	const topology = readTopology(primaryUrl);
	const runId = crypto.randomUUID();
	const runQueryPrefix = `rudel-f16-${runId}`;
	const barrierClients = readWriterUrls(primaryUrl).map((url) =>
		createMigrationClient({
			database,
			ddlTimeoutSeconds,
			maxBytesBeforeExternalGroupBy,
			maxBytesBeforeExternalSort,
			maxMemoryUsage,
			maxTemporaryDataOnDiskBytes,
			password,
			requestTimeoutMs,
			runQueryPrefix,
			topology,
			url,
			username,
		}),
	);
	const primaryClient = barrierClients[0];
	if (!primaryClient) {
		throw new Error("No ClickHouse migration client was created");
	}
	return {
		autoApproveCheckpoints: readAutoApproval(primaryUrl, topology),
		backfillBucketCount: readBackfillBucketCount(),
		barrierClients,
		barrierTimeoutMs,
		executor: createExecutor(primaryClient),
		leaseAcquiredAt: new Date().toISOString(),
		leaseOwnerRunId: runId,
		primaryClient,
		runQueryPrefix,
		sleep: (milliseconds) =>
			new Promise((resolveSleep) => {
				setTimeout(resolveSleep, milliseconds);
			}),
		timeNow: Date.now,
		topology,
	};
}

export async function runBarrier(
	statement: string,
	runtime: MigrationRuntime,
): Promise<void> {
	const deadline = runtime.timeNow() + runtime.barrierTimeoutMs;
	let failures: readonly PromiseRejectedResult[] = [];
	while (runtime.timeNow() < deadline) {
		const attemptTimeoutMs = Math.max(1, deadline - runtime.timeNow());
		const results = await Promise.allSettled(
			runtime.barrierClients.map((client) =>
				client.command(statement, attemptTimeoutMs),
			),
		);
		failures = results.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failures.length === 0) return;
		const remainingMs = deadline - runtime.timeNow();
		if (remainingMs <= 0) break;
		await runtime.sleep(Math.min(1_000, remainingMs));
	}
	const messages = failures
		.map((failure) => String(failure.reason))
		.join(" | ");
	throw new Error(`F16 catalog barrier timed out: ${messages}`);
}

export function expandBucketedStatement(
	statement: string,
	bucketCount: number,
): readonly string[] {
	const countPlaceholder = "{f16_bucket_count:UInt64}";
	const idPlaceholder = "{f16_bucket_id:UInt64}";
	const hasCount = statement.includes(countPlaceholder);
	const hasId = statement.includes(idPlaceholder);
	if (!hasCount && !hasId) return [statement];
	if (!hasCount || !hasId) {
		throw new Error(
			"F16 bucketed statement has an incomplete placeholder pair",
		);
	}
	const statements: string[] = [];
	for (let bucketId = 0; bucketId < bucketCount; bucketId += 1) {
		statements.push(
			statement
				.replaceAll(countPlaceholder, String(bucketCount))
				.replaceAll(idPlaceholder, String(bucketId)),
		);
	}
	return statements;
}

export function applyBackfillExecutionProfile(statement: string): string {
	if (!/^\s*INSERT\s+INTO\s+rudel\.codex_sessions\s*\(/u.test(statement)) {
		return statement;
	}
	const settingsMarker = "SETTINGS async_insert=0";
	if (statement.split(settingsMarker).length !== 2) {
		throw new Error(
			"F16 Codex backfill must contain exactly one synchronous insert settings marker",
		);
	}
	return statement.replace(
		settingsMarker,
		`${settingsMarker}, max_block_size=${CODEX_BACKFILL_MAX_BLOCK_SIZE}, max_insert_block_size=${CODEX_BACKFILL_MAX_BLOCK_SIZE}, min_insert_block_size_rows=1, min_insert_block_size_bytes=1`,
	);
}

async function executeMigrationSql(
	sql: string,
	runtime: MigrationRuntime,
): Promise<void> {
	for (const statement of extractExecutableStatements(sql)) {
		const bucketedStatements = expandBucketedStatement(
			statement,
			runtime.backfillBucketCount,
		);
		for (const executableStatement of bucketedStatements) {
			if (executableStatement.includes(" AS f16_poll_")) {
				await runBarrier(executableStatement, runtime);
			} else {
				await runtime.executor.execute(
					applyBackfillExecutionProfile(executableStatement),
				);
			}
		}
	}
}

export async function validateReplicaTopology(
	runtime: MigrationRuntime,
	timeoutMs = runtime.barrierTimeoutMs,
): Promise<readonly string[]> {
	const source =
		runtime.topology.mode === "cloud-multi-node"
			? `clusterAllReplicas(${quoteSqlString(
					runtime.topology.clusterName,
				)}, system.one)`
			: "system.one";
	const rows = await runtime.primaryClient.query<TopologyHostRow>(
		`SELECT hostName() AS host_name FROM ${source} SETTINGS skip_unavailable_shards=0`,
		timeoutMs,
	);
	const hosts = [...new Set(rows.map((row) => row.host_name))].filter(
		(host) => host.length > 0,
	);
	const expectedReplicaCount =
		runtime.topology.mode === "cloud-multi-node"
			? runtime.topology.expectedReplicaCount
			: 1;
	if (
		hosts.length !== expectedReplicaCount ||
		rows.length !== expectedReplicaCount
	) {
		throw new Error(
			`F16 replica topology mismatch: expected ${expectedReplicaCount}, observed ${rows.length} rows across ${hosts.length} hosts`,
		);
	}
	return hosts;
}

export async function waitForOrphanedQueries(
	runtime: MigrationRuntime,
): Promise<void> {
	const deadline = runtime.timeNow() + runtime.barrierTimeoutMs;
	let lastError: unknown = new Error("F16 orphan census did not run");
	while (runtime.timeNow() < deadline) {
		const attemptTimeoutMs = Math.max(1, deadline - runtime.timeNow());
		try {
			await validateReplicaTopology(runtime, attemptTimeoutMs);
			const source =
				runtime.topology.mode === "cloud-multi-node"
					? `clusterAllReplicas(${quoteSqlString(
							runtime.topology.clusterName,
						)}, system.processes)`
					: "system.processes";
			await runtime.primaryClient.command(
				`SELECT throwIf(
					count() != 0,
					'F16 recovery barrier: a previous controlled query is still active'
				) AS f16_poll_no_orphaned_queries
				FROM ${source}
				WHERE
					(
						startsWith(query_id, 'rudel-f16-')
						OR startsWith(initial_query_id, 'rudel-f16-')
					)
					AND NOT (
						startsWith(query_id, ${quoteSqlString(runtime.runQueryPrefix)})
						OR startsWith(initial_query_id, ${quoteSqlString(runtime.runQueryPrefix)})
					)
				SETTINGS skip_unavailable_shards=0`,
				attemptTimeoutMs,
			);
			return;
		} catch (error) {
			lastError = error;
		}
		const remainingMs = deadline - runtime.timeNow();
		if (remainingMs <= 0) break;
		await runtime.sleep(Math.min(1_000, remainingMs));
	}
	throw new Error(
		`F16 cluster-wide orphan census timed out: ${String(lastError)}`,
	);
}

function leaseComment(runtime: MigrationRuntime): string {
	return `f16-controlled-migration owner_run_id=${runtime.leaseOwnerRunId} acquired_at=${runtime.leaseAcquiredAt}`;
}

export async function acquireMigrationLease(
	runtime: MigrationRuntime,
): Promise<void> {
	await runtime.primaryClient.command(`
		CREATE TABLE ${LEASE_TABLE}
		(
			owner_run_id String,
			acquired_at DateTime64(3, 'UTC')
		)
		ENGINE = MergeTree
		ORDER BY tuple()
		SETTINGS index_granularity = 1
		COMMENT ${quoteSqlString(leaseComment(runtime))}
	`);
	const tableSource =
		runtime.topology.mode === "cloud-multi-node"
			? `clusterAllReplicas(${quoteSqlString(
					runtime.topology.clusterName,
				)}, system.tables)`
			: "system.tables";
	const expectedReplicaCount =
		runtime.topology.mode === "cloud-multi-node"
			? runtime.topology.expectedReplicaCount
			: 1;
	await runBarrier(
		`SELECT throwIf(
			count() != ${expectedReplicaCount}
			OR countIf(comment = ${quoteSqlString(leaseComment(runtime))})
				!= ${expectedReplicaCount},
			'F16 lease acquisition barrier: lease table is not visible with exact owner metadata on every replica'
		) AS f16_poll_lease_created
		FROM ${tableSource}
		WHERE database = 'rudel'
			AND name = 'f16_revision_cutover_lease_20260826'
		SETTINGS skip_unavailable_shards=0`,
		runtime,
	);
	await runtime.primaryClient.command(`
		INSERT INTO ${LEASE_TABLE} (owner_run_id, acquired_at)
		SELECT
			${quoteSqlString(runtime.leaseOwnerRunId)},
			parseDateTime64BestEffort(${quoteSqlString(runtime.leaseAcquiredAt)}, 3, 'UTC')
	`);
}

export async function releaseMigrationLease(
	runtime: MigrationRuntime,
): Promise<void> {
	await runtime.primaryClient.command(`
		SELECT throwIf(
			countIf(comment = ${quoteSqlString(leaseComment(runtime))}) != 1,
			'F16 lease release refused: owner metadata changed or the lease is absent'
		)
		FROM system.tables
		WHERE database = 'rudel'
			AND name = 'f16_revision_cutover_lease_20260826'
	`);
	await runtime.primaryClient.command(`
		SELECT throwIf(
			countIf(
				owner_run_id = ${quoteSqlString(runtime.leaseOwnerRunId)}
				AND acquired_at = parseDateTime64BestEffort(
					${quoteSqlString(runtime.leaseAcquiredAt)}, 3, 'UTC'
				)
			) != 1,
			'F16 lease release refused: owner metadata changed or the lease is absent'
		)
		FROM ${LEASE_TABLE}
	`);
	await runtime.primaryClient.command(`DROP TABLE ${LEASE_TABLE} SYNC`);
	await runBarrier(
		`SELECT throwIf(
			count() != 0,
			'F16 lease release barrier: lease artifact is still visible'
		) AS f16_poll_lease_released
		FROM system.tables
		WHERE database = 'rudel'
			AND name = 'f16_revision_cutover_lease_20260826'`,
		runtime,
	);
}

function sqlAfterRecoveryMarker(sql: string, marker: string): string {
	const markerIndex = sql.indexOf(marker);
	if (markerIndex < 0) {
		throw new Error(`F16 recovery marker is missing: ${marker}`);
	}
	const markerEnd = sql.indexOf("\n", markerIndex);
	if (markerEnd < 0) {
		throw new Error(`F16 recovery marker has no executable tail: ${marker}`);
	}
	return sql.slice(markerEnd + 1);
}

async function selectCutoverSql(
	sql: string,
	runtime: MigrationRuntime,
): Promise<string> {
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
	return sqlAfterRecoveryMarker(sql, CUTOVER_RECOVERY_MARKER);
}

async function selectSkillRebuildSql(
	name: string,
	sql: string,
	runtime: MigrationRuntime,
): Promise<string> {
	const tables = SKILL_REBUILD_TABLES.get(name);
	if (!tables) return sql;
	const [canonicalTable, backupTable] = tables;
	const [state] = await runtime.executor.query<SkillRebuildStateRow>(`
		SELECT
			coalesce(maxIf(type, table = ${quoteSqlString(canonicalTable)}), '') AS canonical_type,
			coalesce(maxIf(type, table = ${quoteSqlString(backupTable)}), '') AS backup_type
		FROM system.columns
		WHERE database = 'rudel'
			AND name = 'extraction_seq'
			AND table IN (${quoteSqlString(canonicalTable)}, ${quoteSqlString(backupTable)})
	`);
	const canonicalType = state?.canonical_type ?? "";
	const backupType = state?.backup_type ?? "";
	if (
		canonicalType === "UInt64" &&
		(backupType === "" || backupType === "UInt128")
	) {
		return sql;
	}
	if (canonicalType === "UInt128" && backupType === "UInt64") {
		return sqlAfterRecoveryMarker(sql, SKILL_REBUILD_RECOVERY_MARKER);
	}
	throw new Error(
		`F16 skill rebuild state is invalid for ${canonicalTable}: canonical=${canonicalType || "missing"}, backup=${backupType || "missing"}`,
	);
}

async function selectMigrationSql(
	name: string,
	sql: string,
	runtime: MigrationRuntime,
): Promise<string> {
	if (name === CUTOVER_MIGRATION) return selectCutoverSql(sql, runtime);
	return selectSkillRebuildSql(name, sql, runtime);
}

export function validateJournalPrefix(
	journal: MigrationJournal,
	phaseNames: readonly string[],
): void {
	let missingEarlierPhase = false;
	for (const phase of phaseNames) {
		const applied = journal.applied.some((entry) => entry.name === phase);
		if (!applied) {
			missingEarlierPhase = true;
		} else if (missingEarlierPhase) {
			throw new Error(
				`F16 journal is out of order at ${phase}; stop for journal/state reconciliation`,
			);
		}
	}
}

export async function appendJournalEntryWithReconciliation(
	journalStore: MigrationJournalStore,
	entry: MigrationJournalEntry,
): Promise<void> {
	try {
		await journalStore.appendEntry(entry);
	} catch (appendError) {
		const reconciled = await journalStore.readJournal();
		const entries = reconciled.applied.filter(
			(candidate) => candidate.name === entry.name,
		);
		if (entries.some((candidate) => candidate.checksum !== entry.checksum)) {
			throw new Error(
				`F16 journal reconciliation found a checksum mismatch for ${entry.name}`,
			);
		}
		if (entries.some((candidate) => candidate.checksum === entry.checksum)) {
			return;
		}
		throw appendError;
	}
}

async function verifyPreservationSnapshots(
	runtime: MigrationRuntime,
): Promise<void> {
	await runtime.primaryClient.command(
		`${PRESERVATION_LIVE_VERIFICATION_SQL}\nSETTINGS max_block_size=${VERIFICATION_MAX_BLOCK_SIZE}`,
	);
}

async function verifyPostBackfill(runtime: MigrationRuntime): Promise<void> {
	await runtime.primaryClient.command(
		`${POST_BACKFILL_LIVE_VERIFICATION_SQL}\nSETTINGS max_block_size=${VERIFICATION_MAX_BLOCK_SIZE}`,
	);
}

async function autoApprovePreservation(
	runtime: MigrationRuntime,
): Promise<void> {
	if (!runtime.autoApproveCheckpoints) return;
	await verifyPreservationSnapshots(runtime);
	await runtime.primaryClient.command(`
		INSERT INTO rudel.f16_revision_cutover_control_20260826
			(checkpoint, approved, approved_by, approved_at, evidence_reference)
		SELECT
			'preservation_verified',
			1,
			'f16-ci-evidence-auto-approval',
			greatest(
				now64(3),
				(SELECT max(verified_at) + toIntervalMillisecond(1)
				 FROM rudel.f16_revision_cutover_verification_20260826 FINAL
				 WHERE phase = 'preservation')
			),
			'ci-only:live-preservation-revalidation'
	`);
}

async function autoApprovePostBackfill(
	runtime: MigrationRuntime,
): Promise<void> {
	if (!runtime.autoApproveCheckpoints) return;
	await verifyPreservationSnapshots(runtime);
	await verifyPostBackfill(runtime);
	await runtime.primaryClient.command(`
		INSERT INTO rudel.f16_revision_cutover_control_20260826
			(checkpoint, approved, approved_by, approved_at, evidence_reference)
		SELECT
			'post_backfill_verified',
			1,
			'f16-ci-evidence-auto-approval',
			greatest(
				now64(3),
				(SELECT max(verified_at) + toIntervalMillisecond(1)
				 FROM rudel.f16_revision_cutover_postbackfill_verification_20260826 FINAL)
			),
			'ci-only:live-post-backfill-revalidation'
	`);
}

export async function runF16MigrationCore(
	runtime: MigrationRuntime,
	dependencies: F16RunnerDependencies,
): Promise<void> {
	await acquireMigrationLease(runtime);
	try {
		await validateReplicaTopology(runtime);
		await waitForOrphanedQueries(runtime);
		const initialJournal = await dependencies.journalStore.readJournal();
		validateJournalPrefix(initialJournal, dependencies.phaseNames);
		const appliedEntries = [...initialJournal.applied];
		const preservationApplied = appliedEntries.some(
			(entry) => entry.name === PRESERVATION_MIGRATION,
		);
		const cleanupApplied = appliedEntries.some(
			(entry) => entry.name === CLEANUP_MIGRATION,
		);
		if (preservationApplied && !cleanupApplied) {
			await verifyPreservationSnapshots(runtime);
			await autoApprovePreservation(runtime);
		}
		const backfillApplied = appliedEntries.some(
			(entry) => entry.name === BACKFILL_MIGRATION,
		);
		if (backfillApplied && !cleanupApplied) {
			await autoApprovePostBackfill(runtime);
		}
		for (const name of dependencies.phaseNames) {
			const sql = await dependencies.loadMigration(name);
			const checksum = checksumSQL(sql);
			const applied = appliedEntries.find((entry) => entry.name === name);
			if (applied) {
				if (applied.checksum && applied.checksum !== checksum) {
					throw new Error(
						`Applied F16 migration checksum mismatch for ${name}`,
					);
				}
				dependencies.log(`Already applied: ${name}`);
				continue;
			}
			const executableSql = await selectMigrationSql(name, sql, runtime);
			await executeMigrationSql(executableSql, runtime);
			const entry = {
				appliedAt: new Date().toISOString().replace("Z", ""),
				checksum,
				name,
			};
			await appendJournalEntryWithReconciliation(
				dependencies.journalStore,
				entry,
			);
			appliedEntries.push(entry);
			dependencies.log(`Applied: ${name}`);
			if (name === PRESERVATION_MIGRATION) {
				await verifyPreservationSnapshots(runtime);
				await autoApprovePreservation(runtime);
			}
			if (name === BACKFILL_MIGRATION) {
				await autoApprovePostBackfill(runtime);
			}
		}
	} finally {
		await releaseMigrationLease(runtime);
	}
}

async function run(): Promise<void> {
	const runtime = createRuntime();
	try {
		const journalStore = createJournalStore(runtime.executor);
		await runF16MigrationCore(runtime, {
			journalStore,
			loadMigration: (name) => readFile(resolve(MIGRATIONS_DIR, name), "utf8"),
			log: console.log,
			phaseNames: F16_MIGRATIONS,
		});
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
