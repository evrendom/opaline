import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	acquireMigrationLease,
	appendJournalEntryWithReconciliation,
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
