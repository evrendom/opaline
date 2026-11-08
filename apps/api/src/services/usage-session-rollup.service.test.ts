import { afterEach, describe, expect, test } from "bun:test";
import { USAGE_SESSION_ROLLUP_COLUMNS } from "@rudel/ch-schema/usage-session-rollups";
import {
	USAGE_EVENT_EXTRACTION_VERSION,
	USAGE_EVENT_IDENTITY_VERSION,
	USAGE_EVENT_MODEL_RATE_CARD_VERSION,
	type UsageEvent,
} from "@rudel/usage-events";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	MAINTENANCE_DEADLINE_MS,
	planMaintenanceBudgets,
} from "../handlers/l1-edges-maintenance.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import {
	isUsageRollupBackfillEnabled,
	isUsageRollupWriteEnabled,
	shouldReadUsageRollups,
} from "../lib/env.js";
import {
	buildDateRangeWindowSql,
	buildUsageEventAnalyticsCte,
	buildUsageEventCandidateCtes,
} from "./usage-event-analytics.service.js";
import { writeUsageExtraction } from "./usage-event-ingest.service.js";
import {
	buildUsageSessionRollupBackoffSql,
	buildUsageSessionRollupInsertSql,
	buildUsageSessionRollupParams,
	fingerprintUsageRollupBuild,
	refreshUsageSessionRollupAfterWrite,
	USAGE_ROLLUP_BUILD_VERSION,
	USAGE_ROLLUP_INGEST_MAX_EXECUTION_SECONDS,
	type UsageRollupSessionKey,
} from "./usage-session-rollup.service.js";
import {
	backfillUsageSessionRollups,
	buildUsageRollupCandidatesStatement,
} from "./usage-session-rollup-backfill.service.js";

const previousWrites = process.env.USAGE_ROLLUP_WRITES_ENABLED;
afterEach(() => {
	if (previousWrites === undefined)
		delete process.env.USAGE_ROLLUP_WRITES_ENABLED;
	else process.env.USAGE_ROLLUP_WRITES_ENABLED = previousWrites;
});

describe("usage rollup switches", () => {
	test("reads rollups only for listed workspaces, or every one with all, never a skipped one", () => {
		const listed = { USAGE_ROLLUP_ORG_IDS: " org-a , org-b " };
		expect(shouldReadUsageRollups("org-a", listed)).toBe(true);
		expect(shouldReadUsageRollups("org-c", listed)).toBe(false);
		expect(shouldReadUsageRollups("org-a", {})).toBe(false);
		const all = {
			USAGE_ROLLUP_BACKFILL_SKIP_ORG_IDS: "internal-1,internal-2",
			USAGE_ROLLUP_ORG_IDS: "all",
		};
		expect(shouldReadUsageRollups("org-c", all)).toBe(true);
		expect(shouldReadUsageRollups("internal-2", all)).toBe(false);
		expect(
			shouldReadUsageRollups("internal-2", {
				...all,
				USAGE_ROLLUP_ORG_IDS: "all,internal-2",
			}),
		).toBe(false);
		expect(
			shouldReadUsageRollups("internal-1", {
				USAGE_ROLLUP_BACKFILL_SKIP_ORG_IDS: "internal-1",
				USAGE_ROLLUP_ORG_IDS: "internal-1",
			}),
		).toBe(false);
	});

	test("the backfill is off and ingest writes are on unless switched, in any spelling", () => {
		expect(isUsageRollupBackfillEnabled({})).toBe(false);
		for (const on of ["true", "TRUE", "1", "on", " yes "])
			expect(
				isUsageRollupBackfillEnabled({ USAGE_ROLLUP_BACKFILL_ENABLED: on }),
			).toBe(true);
		expect(
			isUsageRollupBackfillEnabled({ USAGE_ROLLUP_BACKFILL_ENABLED: "maybe" }),
		).toBe(false);
		expect(isUsageRollupWriteEnabled({})).toBe(true);
		for (const off of ["false", "FALSE", "0", "off", "No"])
			expect(
				isUsageRollupWriteEnabled({ USAGE_ROLLUP_WRITES_ENABLED: off }),
			).toBe(false);
		expect(
			isUsageRollupWriteEnabled({ USAGE_ROLLUP_WRITES_ENABLED: "typo" }),
		).toBe(true);
	});
});

describe("usage rollup read path", () => {
	const window = {
		includeNativeDescendants: false,
		sessionsSql:
			"SELECT 'o' AS organization_id, 'u' AS user_id, 's' AS source, 'x' AS session_id",
	};

	test("prices the stored groups with the events path's SQL from the candidates on", () => {
		const events = buildUsageEventAnalyticsCte({ window }, false, "events");
		const rollups = buildUsageEventAnalyticsCte({ window }, false, "rollups");
		expect(rollups).toContain("FROM rudel.usage_session_rollups FINAL");
		expect(rollups).toContain("AND is_consistent = 1");
		expect(rollups).not.toContain("rudel.usage_events");
		expect(events).not.toContain("rudel.usage_session_rollups");
		const tail = (sql: string) =>
			sql.slice(sql.indexOf("usage_event_pricing_groups AS ("));
		expect(tail(rollups)).toBe(tail(events));
		const head = (sql: string) =>
			sql.slice(0, sql.indexOf("usage_event_pricing_candidates AS ("));
		expect(head(events)).toContain("latest_usage_records AS (");
		expect(head(rollups)).not.toContain("latest_usage_records AS (");
		expect(head(rollups)).toContain("usage_window_sessions AS (");
	});

	test("the dashboard's date window finds usage days in the rollups", () => {
		expect(buildDateRangeWindowSql("rollups")).toContain(
			"FROM rudel.usage_session_rollups",
		);
		expect(buildDateRangeWindowSql("rollups")).toContain("usage_dates");
		expect(buildDateRangeWindowSql("rollups")).not.toContain(
			"rudel.usage_events",
		);
		expect(buildDateRangeWindowSql()).toContain("FROM rudel.usage_events");
	});
});

describe("usage rollup build", () => {
	test("inserts every column from the events path's own pricing groups", () => {
		const sql = buildUsageSessionRollupInsertSql();
		expect(sql).toStartWith(
			`INSERT INTO rudel.usage_session_rollups (${USAGE_SESSION_ROLLUP_COLUMNS.map((column) => column.name).join(", ")})`,
		);
		expect(sql).toContain(
			buildUsageEventCandidateCtes(
				"(organization_id, user_id, source, session_id) IN (SELECT organization_id, user_id, source, session_id FROM usage_rollup_keys)",
			),
		);
		expect(sql).toContain(`${USAGE_ROLLUP_BUILD_VERSION} AS build_version`);
		expect(sql).toContain("FROM usage_rollup_keys AS k");
		expect(Number.isInteger(USAGE_ROLLUP_BUILD_VERSION)).toBe(true);
		expect(USAGE_ROLLUP_BUILD_VERSION).toBeGreaterThan(0);
		expect(USAGE_ROLLUP_BUILD_VERSION).toBeLessThan(2 ** 32);
	});

	test("passes the sessions as parallel arrays", () => {
		expect(buildUsageSessionRollupParams([key("1"), key("2")])).toEqual({
			organizationIds: ["org-1", "org-1"],
			sessionIds: ["session-1", "session-2"],
			sources: ["claude_code", "claude_code"],
			userIds: ["user-1", "user-1"],
		});
	});

	test("the build fingerprint covers the whole insert SQL, not just the grouping", () => {
		const sql = buildUsageSessionRollupInsertSql();
		expect(
			fingerprintUsageRollupBuild(
				sql.replace(
					`${USAGE_ROLLUP_BUILD_VERSION} AS build_version`,
					"{rollupBuildVersion} AS build_version",
				),
			),
		).toBe(USAGE_ROLLUP_BUILD_VERSION);
		expect(sql).toContain("toDateTime64(0, 3, 'UTC') AS retry_after");
	});

	test("a back-off keeps a session's stored groups and only delays its next rebuild", () => {
		const sql = buildUsageSessionRollupBackoffSql();
		expect(sql).toContain("r.receipt_generation AS receipt_generation");
		expect(sql).toContain("r.is_consistent AS is_consistent");
		expect(sql).toContain("r.uncached_input_tokens AS uncached_input_tokens");
		expect(sql).toContain("r.built_at AS built_at");
		expect(sql).toContain(
			"now64(3, 'UTC') + INTERVAL 60 MINUTE AS retry_after",
		);
		expect(sql).not.toContain("usage_events");
	});

	test("a failed refresh never fails the usage write", async () => {
		const executor = recordingExecutor(() => {
			throw new Error("ClickHouse is down");
		});
		await expect(
			refreshUsageSessionRollupAfterWrite(executor.executor, key("1")),
		).resolves.toBe(false);
		expect(executor.executed).toHaveLength(1);
	});

	test("USAGE_ROLLUP_WRITES_ENABLED=off skips the refresh", async () => {
		process.env.USAGE_ROLLUP_WRITES_ENABLED = "off";
		const executor = recordingExecutor();
		await expect(
			refreshUsageSessionRollupAfterWrite(executor.executor, key("1")),
		).resolves.toBe(false);
		expect(executor.executed).toHaveLength(0);
	});

	test("a purged owner's upload never writes a rollup", async () => {
		const executor = recordingExecutor();
		await expect(
			refreshUsageSessionRollupAfterWrite(executor.executor, key("1"), {
				assertWritable: async () => {
					throw new ClickHouseWriteFencedError();
				},
			}),
		).resolves.toBe(false);
		expect(executor.executed).toHaveLength(0);
	});

	test("every usage write rebuilds its session's rollup after the consistency check, bounded and abortable", async () => {
		const executor = recordingExecutor();
		const controller = new AbortController();
		const calls: string[] = [];
		await writeUsageExtraction(executor.executor, {
			...writeInput(),
			assertWritable: async () => {
				calls.push("fence");
			},
			signal: controller.signal,
		});
		expect(executor.order).toEqual(["insert", "query", "execute"]);
		expect(calls).toEqual(["fence"]);
		expect(executor.executed[0]?.query).toStartWith(
			"INSERT INTO rudel.usage_session_rollups",
		);
		expect(executor.executed[0]?.query_params).toEqual(
			buildUsageSessionRollupParams([key("1")]),
		);
		expect(executor.executed[0]?.abortSignal).toBe(controller.signal);
		expect(executor.executed[0]?.clickhouse_settings).toMatchObject({
			max_execution_time: USAGE_ROLLUP_INGEST_MAX_EXECUTION_SECONDS,
			select_sequential_consistency: "1",
		});
	});

	test("a batch writer can leave the rebuild to itself", async () => {
		const executor = recordingExecutor();
		await writeUsageExtraction(executor.executor, {
			...writeInput(),
			refreshRollup: false,
		});
		expect(executor.executed).toHaveLength(0);
	});
});

describe("usage rollup backfill", () => {
	test("selects missing, stale, unsettled, inconsistent and older-build rows outside skipped workspaces and back-offs", () => {
		const statement = buildUsageRollupCandidatesStatement({
			limit: 300,
			skippedOrganizationIds: ["internal-1"],
		});
		expect(statement.query_params).toEqual({
			buildVersion: USAGE_ROLLUP_BUILD_VERSION,
			limit: 300,
			skipped: ["internal-1"],
		});
		expect(statement.query).toContain("FROM rudel.session_analytics");
		expect(statement.query).toContain(
			"WHERE organization_id NOT IN {skipped:Array(String)}",
		);
		expect(statement.query).toContain("WHERE r.retry_after <= now64(3)");
		expect(statement.query).toContain(
			"r.build_version != {buildVersion:UInt32}",
		);
		expect(statement.query).toContain("OR r.built_at < sa.ingested_at");
		expect(statement.query).toContain(
			"r.built_at < sa.ingested_at + INTERVAL 10 MINUTE",
		);
		expect(statement.query).toMatch(
			/OR \(r\.is_consistent = 0\s+AND r\.built_at < now64\(3\) - INTERVAL 60 MINUTE\)/u,
		);
		expect(statement.query).not.toContain("receipt_generation > 0");
		expect(statement.clickhouse_settings).toMatchObject({
			join_use_nulls: 0,
			max_execution_time: 5,
		});
	});

	test("isolates a failing batch: retries its sessions one by one and backs off only the failing one", async () => {
		const executor = recordingExecutor(undefined, () =>
			["1", "2", "3", "4"].map((index) => candidate(index)),
		);
		const attempts: string[][] = [];
		const backedOff: string[] = [];
		const result = await backfillUsageSessionRollups({
			backOff: async (_, sessions) => {
				backedOff.push(...sessions.map((session) => session.sessionId));
			},
			batchSize: 2,
			executor: executor.executor,
			refresh: async (_, sessions, options) => {
				expect(options?.maxExecutionSeconds).toBe(10);
				attempts.push(sessions.map((session) => session.sessionId));
				if (sessions.some((session) => session.sessionId === "session-2"))
					throw new Error("poison");
			},
			skippedOrganizationIds: [],
			sql: tombstones([]),
		});
		expect(attempts).toEqual([
			["session-1", "session-2"],
			["session-1"],
			["session-2"],
			["session-3", "session-4"],
		]);
		expect(backedOff).toEqual(["session-2"]);
		expect(result).toEqual({ candidates: 4, failed: 1, fenced: 0, written: 3 });
	});

	test("looks tombstones up once per run and again right before each batch", async () => {
		const executor = recordingExecutor(undefined, () =>
			["1", "2", "3", "4", "5"].map((index) =>
				candidate(index, index === "3" ? "purged-user" : "user-1"),
			),
		);
		const lookups: number[] = [];
		const purgedLater = new Set(["purged-user"]);
		const batches: string[][] = [];
		const result = await backfillUsageSessionRollups({
			batchSize: 2,
			executor: executor.executor,
			refresh: async (_, sessions) => {
				batches.push(sessions.map((session) => session.sessionId));
				purgedLater.add("user-1");
			},
			skippedOrganizationIds: [],
			sql: tombstones(purgedLater, lookups),
		});
		expect(lookups).toEqual([2, 1, 1]);
		expect(batches).toEqual([["session-1", "session-2"]]);
		expect(result).toEqual({ candidates: 5, failed: 0, fenced: 3, written: 2 });
	});

	test("stops at its time budget", async () => {
		let clock = 0;
		const executor = recordingExecutor(undefined, () =>
			["1", "2", "3"].map((index) => candidate(index)),
		);
		const result = await backfillUsageSessionRollups({
			batchSize: 1,
			budgetMs: 10,
			executor: executor.executor,
			now: () => clock,
			refresh: async () => {
				clock += 6;
			},
			skippedOrganizationIds: [],
			sql: tombstones([]),
		});
		expect(result).toEqual({ candidates: 3, failed: 0, fenced: 0, written: 2 });
	});
});

describe("edge cron budget", () => {
	test("the L1 pass, snapshots and rollups fit the shared deadline, worst case included", () => {
		const start = planMaintenanceBudgets(0);
		expect(start.l1PassMs).toBe(200_000);
		const afterL1 = planMaintenanceBudgets(start.l1PassMs + 2_000);
		expect(afterL1.contextSnapshotsMs).toBe(13_000);
		const afterSnapshots = planMaintenanceBudgets(
			start.l1PassMs + 2_000 + afterL1.contextSnapshotsMs + 15_000,
		);
		expect(afterSnapshots.usageRollupsMs).toBe(15_000);
		const worstEnd =
			start.l1PassMs +
			2_000 +
			afterL1.contextSnapshotsMs +
			15_000 +
			afterSnapshots.usageRollupsMs +
			5_000 +
			10_000 +
			5_000;
		expect(worstEnd).toBeLessThanOrEqual(MAINTENANCE_DEADLINE_MS);
		expect(MAINTENANCE_DEADLINE_MS).toBeLessThan(300_000);
		expect(planMaintenanceBudgets(260_000)).toEqual({
			contextSnapshotsMs: 0,
			l1PassMs: 0,
			usageRollupsMs: 0,
		});
	});
});

function key(index: string): UsageRollupSessionKey {
	return {
		organizationId: "org-1",
		sessionId: `session-${index}`,
		source: "claude_code",
		userId: "user-1",
	};
}

function recordingExecutor(
	onExecute?: (statement: ClickHouseStatement) => void,
	rows: () => object[] = () => [
		{
			active_event_count: 1,
			receipt_checksum: "d".repeat(64),
			receipt_count: 1,
			receipt_event_count: 1,
			receipt_is_complete: 1,
			receipt_version: "7",
		},
	],
) {
	const executed: ClickHouseStatement[] = [];
	const order: string[] = [];
	const executor: ClickHouseExecutor = {
		close: () => Promise.resolve(),
		execute: async (statement) => {
			order.push("execute");
			executed.push(statement);
			onExecute?.(statement);
		},
		insert: async () => {
			order.push("insert");
		},
		query: async <T>() => {
			order.push("query");
			return rows() as T[];
		},
	};
	return { executed, executor, order };
}

function candidate(index: string, userId = "user-1") {
	return {
		organization_id: "org-1",
		session_id: `session-${index}`,
		source: "claude_code",
		user_id: userId,
	};
}

function tombstones(purgedUserIds: Iterable<string>, lookups: number[] = []) {
	return {
		unsafe: async (_query: string, params: readonly string[][]) => {
			const users = params[0] ?? [];
			lookups.push(users.length);
			const purged = new Set(purgedUserIds);
			return users
				.filter((user) => purged.has(user))
				.map((user) => ({ target_id: user, target_type: "account" }));
		},
	} as unknown as Parameters<typeof backfillUsageSessionRollups>[0]["sql"];
}

function writeInput() {
	return {
		contentSha256: "a".repeat(64),
		extraction: {
			diagnostics: [],
			events: [usageEvent()],
			receipt: {
				checksum: "d".repeat(64),
				complete: true,
				eventCount: 1,
				eventIdentityVersion: USAGE_EVENT_IDENTITY_VERSION,
				extractionVersion: USAGE_EVENT_EXTRACTION_VERSION,
				modelRateCardVersion: USAGE_EVENT_MODEL_RATE_CARD_VERSION,
			},
			status: "complete" as const,
		},
		filterVersion: 1,
		generation: "7",
		ingestedAt: new Date("2026-08-03T12:00:00.000Z"),
		organizationId: "org-1",
		sessionDate: new Date("2026-08-03T11:00:00.000Z"),
		sessionId: "session-1",
		source: "claude_code" as const,
		userId: "user-1",
	};
}

function usageEvent(): UsageEvent {
	return {
		agentId: "",
		cacheReadInputTokens: 2,
		cacheWrite1hInputTokens: 0,
		cacheWriteInputTokens: 0,
		cacheWrite5mInputTokens: 0,
		contextInputTokens: 12,
		duplicateObservationCount: 0,
		eventId: "e".repeat(64),
		firstObservedLine: 1,
		identityKind: "message_id",
		inferenceGeo: "",
		inferenceSpeed: "",
		lineageId: "main",
		modelProvider: "anthropic",
		modelStatus: "resolved",
		occurredAt: "2026-08-03T11:00:00.000Z",
		organizationId: "org-1",
		outputTokens: 5,
		parentLineageId: "",
		qualityFlags: [],
		rawModel: "claude-sonnet-4-20250514",
		reasoningOutputTokens: 0,
		resolvedModel: "claude-sonnet-4-20250514",
		serviceTier: "standard",
		sessionId: "session-1",
		source: "claude_code",
		tokenSource: "provider_increment",
		uncachedInputTokens: 10,
		usageDate: "2026-08-03",
		userId: "user-1",
	};
}
