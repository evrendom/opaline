import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	acquireMigrationLease,
	appendJournalEntryWithReconciliation,
	applyBackfillExecutionProfile,
	createMigrationClient,
	expandBucketedStatement,
	type F16Topology,
	type MigrationHttpClient,
	type MigrationJournal,
	type MigrationJournalEntry,
	type MigrationJournalStore,
	type MigrationRuntime,
	runBarrier,
	runF16MigrationCore,
	validateJournalPrefix,
	validateReplicaTopology,
	waitForOrphanedQueries,
} from "../../scripts/migrate-f16.js";

function createExecutor(client: MigrationHttpClient): ClickHouseExecutor {
	return {
		close: client.close,
		execute: client.command,
		async insert() {},
		listSchemaObjects: () => Promise.resolve([]),
		listTableDetails: () => Promise.resolve([]),
		query: client.query,
	};
}

function createRuntime(input: {
	barrierClients: readonly MigrationHttpClient[];
	barrierTimeoutMs: number;
	leaseOwnerRunId: string;
	sleep: (milliseconds: number) => Promise<void>;
	timeNow: () => number;
	topology: F16Topology;
}): MigrationRuntime {
	const primaryClient = input.barrierClients[0];
	if (!primaryClient) throw new Error("test runtime requires a primary client");
	return {
		autoApproveCheckpoints: false,
		backfillBucketCount: 1,
		barrierClients: input.barrierClients,
		barrierTimeoutMs: input.barrierTimeoutMs,
		executor: createExecutor(primaryClient),
		leaseAcquiredAt: "2026-08-27T08:00:00.000Z",
		leaseOwnerRunId: input.leaseOwnerRunId,
		primaryClient,
		runQueryPrefix: `rudel-f16-${input.leaseOwnerRunId}`,
		sleep: input.sleep,
		timeNow: input.timeNow,
		topology: input.topology,
	};
}

function createNoopClient(): MigrationHttpClient {
	return {
		close: () => Promise.resolve(),
		command: () => Promise.resolve(),
		query: () => Promise.resolve([]),
	};
}

describe("F16 controlled migration runner core", () => {
	test("uses only the remaining barrier timeout budget on retries", async () => {
		let now = 10_000;
		let attempts = 0;
		const timeoutBudgets: number[] = [];
		const client: MigrationHttpClient = {
			close: () => Promise.resolve(),
			async command(_query, timeoutMs) {
				timeoutBudgets.push(timeoutMs ?? 0);
				attempts += 1;
				if (attempts === 1) throw new Error("not visible yet");
			},
			query: () => Promise.resolve([]),
		};
		const runtime = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 2_500,
			leaseOwnerRunId: "timeout-budget",
			sleep: (milliseconds) => {
				now += milliseconds;
				return Promise.resolve();
			},
			timeNow: () => now,
			topology: { mode: "single-node" },
		});

		await runBarrier("SELECT 1 AS f16_poll_test", runtime);

		expect(timeoutBudgets).toEqual([2_500, 1_500]);
	});

	test("reconciles an ambiguous committed journal append and rejects out-of-order phases", async () => {
		const applied: MigrationJournalEntry[] = [];
		const store: MigrationJournalStore = {
			async appendEntry(entry) {
				applied.push(entry);
				throw new Error("connection closed after server commit");
			},
			readJournal: () => Promise.resolve({ applied }),
		};
		const entry = {
			appliedAt: "2026-08-27T08:00:00.000",
			checksum: "same-checksum",
			name: "phase-a.sql",
		};

		await appendJournalEntryWithReconciliation(store, entry);
		expect(applied).toEqual([entry]);

		const outOfOrder: MigrationJournal = {
			applied: [
				{
					appliedAt: "2026-08-27T08:00:00.000",
					checksum: "b",
					name: "phase-b.sql",
				},
			],
		};
		expect(() =>
			validateJournalPrefix(outOfOrder, ["phase-a.sql", "phase-b.sql"]),
		).toThrow("journal is out of order at phase-b.sql");
	});

	test("uses clusterAllReplicas for a validated multi-node orphan census", async () => {
		const queries: string[] = [];
		const commands: string[] = [];
		const client: MigrationHttpClient = {
			close: () => Promise.resolve(),
			command(query) {
				commands.push(query);
				return Promise.resolve();
			},
			query<_TRow>(query: string) {
				queries.push(query);
				return Promise.resolve(
					JSON.parse(
						JSON.stringify([
							{ host_name: "replica-a" },
							{ host_name: "replica-b" },
						]),
					),
				);
			},
		};
		const runtime = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 10_000,
			leaseOwnerRunId: "replica-census",
			sleep: () => Promise.resolve(),
			timeNow: Date.now,
			topology: {
				clusterName: "default",
				expectedReplicaCount: 2,
				mode: "cloud-multi-node",
			},
		});

		await waitForOrphanedQueries(runtime);

		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain("clusterAllReplicas('default', system.one)");
		expect(commands).toHaveLength(1);
		expect(commands[0]).toContain(
			"clusterAllReplicas('default', system.processes)",
		);
		expect(commands[0]).toContain("initial_query_id");
		expect(commands[0]).toContain("skip_unavailable_shards=0");
	});

	test("fails closed when multi-node topology capability is unavailable", async () => {
		const client: MigrationHttpClient = {
			close: () => Promise.resolve(),
			command: () => Promise.resolve(),
			query: () => Promise.reject(new Error("UNKNOWN_TABLE_FUNCTION")),
		};
		const runtime = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 10_000,
			leaseOwnerRunId: "missing-cluster-capability",
			sleep: () => Promise.resolve(),
			timeNow: Date.now,
			topology: {
				clusterName: "default",
				expectedReplicaCount: 2,
				mode: "cloud-multi-node",
			},
		});

		await expect(validateReplicaTopology(runtime)).rejects.toThrow(
			"UNKNOWN_TABLE_FUNCTION",
		);
	});

	test("excludes a second runner until the first runner releases the lease", async () => {
		let leaseHeld = false;
		let releaseMigration: (() => void) | undefined;
		let signalLeaseAcquired: (() => void) | undefined;
		const migrationGate = new Promise<void>((resolveGate) => {
			releaseMigration = resolveGate;
		});
		const leaseAcquired = new Promise<void>((resolveLease) => {
			signalLeaseAcquired = resolveLease;
		});
		const client: MigrationHttpClient = {
			close: () => Promise.resolve(),
			async command(query) {
				if (query.includes("CREATE TABLE rudel.f16_revision_cutover_lease")) {
					if (leaseHeld) throw new Error("TABLE_ALREADY_EXISTS");
					leaseHeld = true;
					signalLeaseAcquired?.();
					return;
				}
				if (query.includes("DROP TABLE rudel.f16_revision_cutover_lease")) {
					leaseHeld = false;
				}
			},
			query<_TRow>(query: string) {
				const rows = query.includes("hostName()")
					? [{ host_name: "single-node" }]
					: [];
				return Promise.resolve(JSON.parse(JSON.stringify(rows)));
			},
		};
		const journalStore: MigrationJournalStore = {
			appendEntry: () => Promise.resolve(),
			readJournal: () => Promise.resolve({ applied: [] }),
		};
		const runtimeA = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 10_000,
			leaseOwnerRunId: "runner-a",
			sleep: () => Promise.resolve(),
			timeNow: Date.now,
			topology: { mode: "single-node" },
		});
		const runtimeB = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 10_000,
			leaseOwnerRunId: "runner-b",
			sleep: () => Promise.resolve(),
			timeNow: Date.now,
			topology: { mode: "single-node" },
		});
		const dependencies = {
			journalStore,
			loadMigration: async () => {
				await migrationGate;
				return "SELECT 1";
			},
			log: () => {},
			phaseNames: ["phase-a.sql"],
		};

		const firstRun = runF16MigrationCore(runtimeA, dependencies);
		await leaseAcquired;
		await expect(runF16MigrationCore(runtimeB, dependencies)).rejects.toThrow(
			"TABLE_ALREADY_EXISTS",
		);
		expect(leaseHeld).toBe(true);
		releaseMigration?.();
		await firstRun;
		expect(leaseHeld).toBe(false);
	});

	test("revalidates live preservation snapshots before loading a later phase", async () => {
		let loadedPhases = 0;
		const client: MigrationHttpClient = {
			close: () => Promise.resolve(),
			command(query) {
				if (query.includes("snapshot changed after its durable receipt")) {
					return Promise.reject(new Error("late snapshot truncate detected"));
				}
				return Promise.resolve();
			},
			query<_TRow>(query: string) {
				const rows = query.includes("hostName()")
					? [{ host_name: "single-node" }]
					: [];
				return Promise.resolve(JSON.parse(JSON.stringify(rows)));
			},
		};
		const runtime = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 10_000,
			leaseOwnerRunId: "live-preservation-recheck",
			sleep: () => Promise.resolve(),
			timeNow: Date.now,
			topology: { mode: "single-node" },
		});
		const journalStore: MigrationJournalStore = {
			appendEntry: () => Promise.resolve(),
			readJournal: () =>
				Promise.resolve({
					applied: [
						{
							appliedAt: "2026-08-27T08:00:00.000",
							checksum: "preserved",
							name: "20260826090550_f16_preservation.sql",
						},
					],
				}),
		};

		await expect(
			runF16MigrationCore(runtime, {
				journalStore,
				loadMigration: () => {
					loadedPhases += 1;
					return Promise.resolve("SELECT 1");
				},
				log: () => {},
				phaseNames: [
					"20260826090550_f16_preservation.sql",
					"20260826090551_auto.sql",
				],
			}),
		).rejects.toThrow("late snapshot truncate detected");
		expect(loadedPhases).toBe(0);
	});

	test("expands deterministic bucket placeholders and rejects partial markers", () => {
		const statement =
			"SELECT {f16_bucket_id:UInt64}, {f16_bucket_count:UInt64}";
		expect(expandBucketedStatement(statement, 3)).toEqual([
			"SELECT 0, 3",
			"SELECT 1, 3",
			"SELECT 2, 3",
		]);
		expect(() =>
			expandBucketedStatement("SELECT {f16_bucket_id:UInt64}", 2),
		).toThrow("incomplete placeholder pair");
	});

	test("scopes the four-row execution profile to Codex backfill inserts", () => {
		const codexStatement =
			"INSERT INTO rudel.codex_sessions (session_id) SETTINGS async_insert=0 SELECT session_id FROM source";
		expect(applyBackfillExecutionProfile(codexStatement)).toContain(
			"SETTINGS async_insert=0, max_block_size=4, max_insert_block_size=4, min_insert_block_size_rows=1, min_insert_block_size_bytes=1",
		);
		const claudeStatement =
			"INSERT INTO rudel.claude_sessions (session_id) SETTINGS async_insert=0 SELECT session_id FROM source";
		expect(applyBackfillExecutionProfile(claudeStatement)).toBe(
			claudeStatement,
		);
		const preservationStatement =
			"INSERT INTO rudel.codex_sessions_f16_backfill_source_20260826 (session_id) SETTINGS async_insert=0 SELECT session_id FROM source";
		expect(applyBackfillExecutionProfile(preservationStatement)).toBe(
			preservationStatement,
		);
		expect(() =>
			applyBackfillExecutionProfile(
				"INSERT INTO rudel.codex_sessions (session_id) SELECT session_id FROM source",
			),
		).toThrow("exactly one synchronous insert settings marker");
	});

	test("reconciles detached HTTP 504 commands by exact query id", async () => {
		let terminal: "failed" | "finished" = "finished";
		const originalQueryIds: string[] = [];
		const statusQueries: string[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = await request.text();
				if (body.includes("AS detached_active")) {
					statusQueries.push(body);
					return new Response(
						`${JSON.stringify({
							detached_active: 0,
							detached_exception_code: terminal === "failed" ? 241 : 0,
							detached_failed: terminal === "failed" ? 1 : 0,
							detached_finished: terminal === "finished" ? 1 : 0,
							detached_started: 1,
						})}\n`,
					);
				}
				const queryId = new URL(request.url).searchParams.get("query_id");
				if (queryId) originalQueryIds.push(queryId);
				return new Response("gateway timeout", { status: 504 });
			},
		});
		const client = createMigrationClient({
			database: "default",
			ddlTimeoutSeconds: 60,
			maxBytesBeforeExternalGroupBy: 1024,
			maxBytesBeforeExternalSort: 1024,
			maxMemoryUsage: 4096,
			maxTemporaryDataOnDiskBytes: 8192,
			password: "test-password",
			requestTimeoutMs: 5_000,
			runQueryPrefix: "rudel-f16-test",
			topology: { mode: "single-node" },
			url: `http://127.0.0.1:${server.port}`,
			username: "test-user",
		});
		try {
			await expect(
				client.command("SELECT detached_success"),
			).resolves.toBeUndefined();
			await expect(client.query("SELECT detached_query")).rejects.toThrow(
				"response body is unavailable",
			);
			terminal = "failed";
			await expect(client.command("SELECT detached_failure")).rejects.toThrow(
				"Detached ClickHouse command failed with exception code 241",
			);
			expect(originalQueryIds).toHaveLength(3);
			for (const queryId of originalQueryIds) {
				expect(
					statusQueries.some((query) =>
						query.includes(`query_id = '${queryId}'`),
					),
				).toBe(true);
			}
		} finally {
			await client.close();
			server.stop(true);
		}
	});

	test("requires a valid zero census before declaring no detached evidence", async () => {
		let censusAttempts = 0;
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = await request.text();
				if (!body.includes("AS detached_active")) {
					return new Response("gateway timeout", { status: 504 });
				}
				censusAttempts += 1;
				if (censusAttempts === 1) {
					return new Response("census unavailable", { status: 503 });
				}
				if (censusAttempts === 2) {
					return new Response("not-json");
				}
				return new Response(
					`${JSON.stringify({
						detached_active: 0,
						detached_exception_code: 0,
						detached_failed: 0,
						detached_finished: 0,
						detached_started: 0,
					})}\n`,
				);
			},
		});
		const client = createMigrationClient({
			database: "default",
			detachedNoEvidenceTimeoutMs: 1,
			detachedStatusPollIntervalMs: 5,
			ddlTimeoutSeconds: 60,
			maxBytesBeforeExternalGroupBy: 1024,
			maxBytesBeforeExternalSort: 1024,
			maxMemoryUsage: 4096,
			maxTemporaryDataOnDiskBytes: 8192,
			password: "test-password",
			requestTimeoutMs: 1_000,
			runQueryPrefix: "rudel-f16-test",
			topology: { mode: "single-node" },
			url: `http://127.0.0.1:${server.port}`,
			username: "test-user",
		});
		try {
			await expect(client.command("SELECT detached_missing")).rejects.toThrow(
				"no server-side evidence",
			);
			expect(censusAttempts).toBe(3);
		} finally {
			await client.close();
			server.stop(true);
		}
	});

	test("a directly acquired lease remains fail-closed until explicit release", async () => {
		const client = createNoopClient();
		const runtime = createRuntime({
			barrierClients: [client],
			barrierTimeoutMs: 1_000,
			leaseOwnerRunId: "owner-metadata",
			sleep: () => Promise.resolve(),
			timeNow: Date.now,
			topology: { mode: "single-node" },
		});

		await expect(acquireMigrationLease(runtime)).resolves.toBeUndefined();
	});
});
