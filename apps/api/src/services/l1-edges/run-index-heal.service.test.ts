import { describe, expect, test } from "bun:test";
import { TRANSCRIPT_RECORDS_PARSER_VERSION } from "@rudel/api-routes/transcript-records";
import type postgres from "postgres";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { sessionScopeId } from "./l1-edge-ids.js";
import {
	buildHealCensusStatement,
	buildHealSelectionStatement,
	classifyClickHouseFailure,
	decideHealThrottle,
	type HealRow,
	healTier,
	orderHealOrganizations,
	planHealRows,
	type Reparser,
	type RunIndexHealConfig,
	readRunIndexHealConfig,
	runRunIndexHealTick,
} from "./run-index-heal.service.js";

const CURRENT = TRANSCRIPT_RECORDS_PARSER_VERSION;
const OLD = TRANSCRIPT_RECORDS_PARSER_VERSION - 1;

const config = (
	overrides: Partial<RunIndexHealConfig> = {},
): RunIndexHealConfig => ({
	...readRunIndexHealConfig({
		L1_EDGES_WORKER_ENABLED: "true",
		VITE_ADMIN_ORGANIZATION_ID: "admin",
		RETRO_TOOLS_WORKSPACES: "retro",
		RUN_INDEX_HEAL_DEPRIORITIZED_ORGS: "data",
	}),
	...overrides,
});

const row = (
	organizationId: string,
	sessionId: string,
	overrides: Partial<HealRow> = {},
): HealRow => ({
	organization_id: organizationId,
	user_id: "u1",
	session_id: sessionId,
	source: "claude_code",
	revision_text: "10",
	parser_version: CURRENT,
	session_date: "2026-11-01 10:00:00.000",
	reason: "index_version",
	...overrides,
});

const censusRow = (
	organizationId: string,
	stale: number,
	lastSessionAt: string,
) => ({
	organization_id: organizationId,
	sessions: stale,
	stale,
	index_stale: stale,
	parser_stale: 0,
	last_session_at: lastSessionAt,
});

function fakeClickHouse(input: {
	load?: number;
	census?: ReturnType<typeof censusRow>[];
	rows?: Record<string, HealRow[]>;
	fail?: "load" | "census" | "selection";
	error?: Error;
}) {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {
			throw new Error("the heal never writes through execute");
		},
		insert: async () => {
			throw new Error("the heal never inserts");
		},
		async query<T>(statement: ClickHouseStatement): Promise<T[]> {
			statements.push(statement);
			const kind = statement.query.includes("LoadAverage1")
				? "load"
				: statement.query.includes("countIf")
					? "census"
					: "selection";
			if (input.fail === kind) throw input.error ?? new Error("boom");
			if (kind === "load") return [{ value: input.load ?? 1 }] as T[];
			if (kind === "census") return (input.census ?? []) as T[];
			const organizationId = String(statement.query_params?.organizationId);
			const limit = Number(statement.query_params?.limit);
			const reparseOnly = statement.query_params?.reparseOnly === 1;
			const rows = (input.rows?.[organizationId] ?? []).filter(
				(row) => !reparseOnly || row.reason === "current",
			);
			const indexStale = rows.filter((row) => row.reason !== "current");
			const parserOnly = rows.filter((row) => row.reason === "current");
			return [...indexStale, ...parserOnly].slice(0, limit) as T[];
		},
	};
	return { executor, statements };
}

function fakeSql(
	input: {
		pending?: number;
		recentFailures?: number;
		organizations?: string[];
		scopes?: { scope_id: string; pending: boolean }[];
	} = {},
) {
	const queued: {
		organizationId: string;
		scopeIds: string[];
		priority: unknown;
	}[] = [];
	const sql = {
		unsafe: async (query: string, params: unknown[] = []) => {
			if (query.includes("recent_failures"))
				return [
					{
						pending: String(input.pending ?? 0),
						recent_failures: String(input.recentFailures ?? 0),
					},
				];
			if (query.startsWith("SELECT id, name FROM organization"))
				return (params[0] as string[])
					.filter((id) => (input.organizations ?? [id]).includes(id))
					.map((id) => ({ id, name: id }));
			if (query.includes("FROM l1_edge_scope")) {
				const ids = params[1] as string[];
				return (input.scopes ?? [])
					.filter((scope) => ids.includes(scope.scope_id))
					.map((scope) => ({ ...scope, frozen_reason: null, input: {} }));
			}
			if (query.includes("INSERT INTO l1_edge_scope")) {
				const scopeIds = params[2] as string[];
				queued.push({
					organizationId: params[0] as string,
					scopeIds,
					priority: params[6],
				});
				return scopeIds.map(() => ({ "?column?": 1 }));
			}
			throw new Error(`unexpected statement: ${query}`);
		},
	} as unknown as postgres.Sql;
	return { sql, queued };
}

const deadline = (now = () => 0) => ({ deadlineAt: 240_000, now });
const scope = (sessionId: string) =>
	sessionScopeId({ userId: "u1", source: "claude_code", sessionId });

describe("the run index heal configuration", () => {
	test("is on with bounded defaults, reparse off, and fails loudly on typos", () => {
		const defaults = readRunIndexHealConfig({});
		expect(defaults).toMatchObject({
			enabled: true,
			workerEnabled: false,
			reparse: false,
			maxPerTick: 25,
			maxReparsePerTick: 10,
			maxPending: 100,
			maxRecentFailures: 3,
			slowMs: 30_000,
			maxLoad: 12,
			adminOrganizationId: null,
		});
		expect(
			readRunIndexHealConfig({ RUN_INDEX_HEAL_ENABLED: "false" }).enabled,
		).toBe(false);
		expect(
			readRunIndexHealConfig({ L1_EDGES_ENQUEUE_ENABLED: "false" }).enabled,
		).toBe(false);
		expect(() =>
			readRunIndexHealConfig({ RUN_INDEX_HEAL_ENABLED: "yes" }),
		).toThrow("RUN_INDEX_HEAL_ENABLED");
		expect(() =>
			readRunIndexHealConfig({ RUN_INDEX_HEAL_MAX_PER_TICK: "0" }),
		).toThrow("RUN_INDEX_HEAL_MAX_PER_TICK");
		expect(
			readRunIndexHealConfig({ RUN_INDEX_HEAL_MAX_PENDING: "0" }).maxPending,
		).toBe(0);
	});

	test("reads the retro workspaces as the retro tools do", () => {
		expect(
			readRunIndexHealConfig({ RETRO_TOOLS_WORKSPACES: "*" })
				.retroOrganizationIds,
		).toBe("all");
		expect([
			...(readRunIndexHealConfig({ RETRO_TOOLS_WORKSPACES: "*,a" })
				.retroOrganizationIds as Set<string>),
		]).toEqual([]);
		expect([
			...(readRunIndexHealConfig({ RETRO_TOOLS_WORKSPACES: " a , b " })
				.retroOrganizationIds as Set<string>),
		]).toEqual(["a", "b"]);
	});
});

describe("the run index heal priority", () => {
	test("admin, then retro workspaces, then by recent activity, deprioritized last", () => {
		const ordered = orderHealOrganizations(
			[
				{ organizationId: "data", lastSessionAt: "2026-11-06 09:00:00.000" },
				{ organizationId: "quiet", lastSessionAt: "2026-10-01 09:00:00.000" },
				{ organizationId: "busy", lastSessionAt: "2026-11-05 09:00:00.000" },
				{ organizationId: "retro", lastSessionAt: "2026-09-01 09:00:00.000" },
				{ organizationId: "admin", lastSessionAt: "2026-01-01 09:00:00.000" },
				{ organizationId: "never", lastSessionAt: null },
			].map((organization) => ({
				...organization,
				sessions: 1,
				stale: 1,
				indexStale: 1,
				parserStale: 0,
			})),
			config(),
		);
		expect(
			ordered.map((organization) => [
				organization.organizationId,
				organization.tier,
			]),
		).toEqual([
			["admin", "admin"],
			["retro", "retro"],
			["busy", "active"],
			["quiet", "active"],
			["never", "active"],
			["data", "deprioritized"],
		]);
	});

	test("the admin workspace stays first even when listed as deprioritized, and deprioritized beats retro", () => {
		const tiers = config({
			deprioritizedOrganizationIds: new Set(["admin", "retro"]),
		});
		expect(healTier("admin", tiers)).toBe("admin");
		expect(healTier("retro", tiers)).toBe("deprioritized");
		expect(healTier("anyone", config({ retroOrganizationIds: "all" }))).toBe(
			"retro",
		);
	});
});

describe("the run index heal throttle", () => {
	test("skips when off, when nothing builds, on a backlog and on recent failures", () => {
		const on = config({ maxPending: 100, maxRecentFailures: 3 });
		expect(decideHealThrottle({ ...on, enabled: false }, null)).toBe(
			"disabled",
		);
		expect(decideHealThrottle({ ...on, workerEnabled: false }, null)).toBe(
			"worker_disabled",
		);
		expect(decideHealThrottle(on, null)).toBeNull();
		expect(
			decideHealThrottle(on, { pending: 100, recentFailures: 2 }),
		).toBeNull();
		expect(decideHealThrottle(on, { pending: 101, recentFailures: 0 })).toBe(
			"queue_backlog",
		);
		expect(decideHealThrottle(on, { pending: 0, recentFailures: 3 })).toBe(
			"recent_failures",
		);
	});

	test("tells a slow ClickHouse from a failing one", () => {
		expect(
			classifyClickHouseFailure(
				Object.assign(new Error("Timeout exceeded: elapsed 31 seconds"), {
					code: "159",
				}),
			),
		).toBe("clickhouse_slow");
		expect(classifyClickHouseFailure(new Error("Timeout error."))).toBe(
			"clickhouse_slow",
		);
		expect(
			classifyClickHouseFailure(
				Object.assign(new Error("Memory limit exceeded"), { code: "241" }),
			),
		).toBe("clickhouse_error");
	});
});

describe("the run index heal selection", () => {
	test("a stale index is rebuilt at the parser it has; only sessions on the current index are reparsed", () => {
		const rows = [
			row("o", "a", { parser_version: OLD, reason: "index_version" }),
			row("o", "b", { reason: "generation" }),
			row("o", "c", { parser_version: OLD, reason: "current" }),
			row("o", "d", { parser_version: OLD, reason: "missing" }),
			row("o", "e", { reason: "current" }),
			row("o", "f", { parser_version: OLD, reason: "current" }),
		];
		const off = planHealRows(rows, { reparse: false, maxReparse: 10 });
		expect(off.reparse).toEqual([]);
		expect(off.index.map((r) => r.session_id)).toEqual(["a", "b", "d"]);
		expect(off.index.map((r) => r.parser_version)).toEqual([OLD, CURRENT, OLD]);

		const on = planHealRows(rows, { reparse: true, maxReparse: 1 });
		expect(on.index.map((r) => r.session_id)).toEqual(["a", "b", "d"]);
		expect(on.reparse.map((r) => r.session_id)).toEqual(["c"]);

		const roomy = planHealRows(rows, { reparse: true, maxReparse: 10 });
		expect(roomy.reparse.map((r) => r.session_id)).toEqual(["c", "f"]);
	});

	test("the selection puts stale indexes before parser-only staleness, and pages and narrows by it", () => {
		const first = buildHealSelectionStatement({
			organizationId: "o",
			reparse: true,
			slowMs: 20_000,
			limit: 7,
		});
		expect(first.query).toMatch(
			/ORDER BY toUInt8\(\(indexed\.present = 0[\s\S]*\) DESC, records\.last_session_date DESC/,
		);
		expect(first.query).toContain(
			"{reparseOnly:UInt8} = 0 OR NOT (indexed.present = 0",
		);
		expect(first.query_params).toMatchObject({ reparse: 1, reparseOnly: 0 });

		const narrowed = buildHealSelectionStatement({
			organizationId: "o",
			reparse: true,
			slowMs: 20_000,
			limit: 7,
			reparseOnly: true,
			after: {
				indexStale: true,
				sessionDate: "2026-11-01 10:00:00.000",
				userId: "u1",
				sessionId: "s",
			},
		});
		expect(narrowed.query).toContain("{afterIndexStale:UInt8}");
		expect(narrowed.query_params).toMatchObject({
			reparseOnly: 1,
			afterIndexStale: 1,
		});

		expect(
			buildHealSelectionStatement({
				organizationId: "o",
				reparse: false,
				slowMs: 20_000,
				limit: 7,
				reparseOnly: true,
			}).query_params,
		).toMatchObject({ reparse: 0, reparseOnly: 0 });
	});

	test("every statement is read-only, bounded and scoped", () => {
		const census = buildHealCensusStatement({ reparse: false, slowMs: 20_000 });
		expect(census.query).not.toContain("organizationIds");
		expect(census.clickhouse_settings).toMatchObject({
			readonly: "2",
			max_execution_time: 20,
			result_overflow_mode: "throw",
		});
		expect(
			buildHealCensusStatement({
				reparse: true,
				slowMs: 20_000,
				organizationIds: ["o"],
			}).query,
		).toContain("organization_id IN {organizationIds:Array(String)}");

		const first = buildHealSelectionStatement({
			organizationId: "o",
			reparse: false,
			slowMs: 20_000,
			limit: 7,
		});
		expect(first.query).toContain("organization_id = {organizationId:String}");
		expect(first.query).toContain(
			" DESC, records.last_session_date DESC, records.user_id DESC",
		);
		expect(first.query).not.toContain("afterSessionDate");
		expect(first.clickhouse_settings).toMatchObject({
			readonly: "2",
			max_result_rows: "7",
		});
		expect(first.query_params).toMatchObject({ limit: 7, reparse: 0 });
		const next = buildHealSelectionStatement({
			organizationId: "o",
			reparse: true,
			slowMs: 20_000,
			limit: 7,
			after: {
				indexStale: false,
				sessionDate: "2026-11-01 10:00:00.000",
				userId: "u1",
				sessionId: "s",
			},
		});
		expect(next.query).toContain("afterSessionDate");
		expect(next.query_params).toMatchObject({
			reparse: 1,
			afterSessionId: "s",
		});
	});
});

describe("a run index heal tick", () => {
	test("never touches ClickHouse while the queue is backed up or builds are failing", async () => {
		for (const state of [
			{ pending: 101, expected: "queue_backlog" },
			{ recentFailures: 3, expected: "recent_failures" },
		]) {
			const clickhouse = fakeClickHouse({});
			const pg = fakeSql(state);
			const result = await runRunIndexHealTick({
				sql: pg.sql,
				executor: clickhouse.executor,
				config: config(),
				deadline: deadline(),
			});
			expect(result).toMatchObject({
				status: "skipped",
				skipped: state.expected,
				queued: 0,
			});
			expect(clickhouse.statements).toHaveLength(0);
			expect(pg.queued).toHaveLength(0);
		}
	});

	test("skips when ClickHouse is loaded, slow or failing", async () => {
		const cases = [
			{ input: { load: 13 }, expected: "clickhouse_slow" },
			{ input: { fail: "load" as const }, expected: "clickhouse_error" },
			{ input: { fail: "census" as const }, expected: "clickhouse_error" },
			{
				input: {
					fail: "census" as const,
					error: Object.assign(new Error("Timeout exceeded"), {
						code: "159",
					}),
				},
				expected: "clickhouse_slow",
			},
		];
		for (const { input, expected } of cases) {
			const pg = fakeSql();
			const result = await runRunIndexHealTick({
				sql: pg.sql,
				executor: fakeClickHouse(input).executor,
				config: config(),
				deadline: deadline(),
			});
			expect(result).toMatchObject({ status: "skipped", skipped: expected });
			expect(pg.queued).toHaveLength(0);
		}

		let clock = 0;
		const slow = fakeClickHouse({ census: [censusRow("o", 1, "2026-11-01")] });
		const query = slow.executor.query.bind(slow.executor);
		slow.executor.query = async <T>(statement: ClickHouseStatement) => {
			const rows = await query<T>(statement);
			if (statement.query.includes("countIf")) clock += 31_000;
			return rows;
		};
		const pg = fakeSql();
		expect(
			await runRunIndexHealTick({
				sql: pg.sql,
				executor: slow.executor,
				config: config(),
				deadline: { deadlineAt: Number.MAX_SAFE_INTEGER, now: () => clock },
			}),
		).toMatchObject({ status: "skipped", skipped: "clickhouse_slow" });
		expect(pg.queued).toHaveLength(0);
	});

	test("queues at most N per tick at backfill priority, admin first, then retro, then the most recently active", async () => {
		const clickhouse = fakeClickHouse({
			census: [
				censusRow("data", 50, "2026-11-06 00:00:00.000"),
				censusRow("busy", 2, "2026-11-05 00:00:00.000"),
				censusRow("retro", 2, "2026-10-01 00:00:00.000"),
				censusRow("admin", 2, "2026-09-01 00:00:00.000"),
				censusRow("gone", 9, "2026-11-06 00:00:00.000"),
				censusRow("clean", 0, "2026-11-06 00:00:00.000"),
			],
			rows: {
				admin: [row("admin", "a1"), row("admin", "a2")],
				retro: [row("retro", "r1"), row("retro", "r2")],
				busy: [row("busy", "b1"), row("busy", "b2")],
				data: [row("data", "d1"), row("data", "d2")],
			},
		});
		const pg = fakeSql({
			organizations: ["admin", "retro", "busy", "data", "clean"],
			scopes: [{ scope_id: scope("r1"), pending: true }],
		});
		const result = await runRunIndexHealTick({
			sql: pg.sql,
			executor: clickhouse.executor,
			config: config({ maxPerTick: 4 }),
			deadline: deadline(),
		});
		expect(result).toMatchObject({
			status: "ran",
			skipped: null,
			queued: 4,
			alreadyQueued: 1,
			staleBefore: 65,
			remaining: 61,
		});
		expect(
			pg.queued.map((batch) => [batch.organizationId, batch.scopeIds]),
		).toEqual([
			["admin", [scope("a1"), scope("a2")]],
			["retro", [scope("r2")]],
			["busy", [scope("b1")]],
		]);
		expect(pg.queued.every((batch) => batch.priority === 1)).toBe(true);
		const selected = clickhouse.statements
			.filter((statement) => statement.query_params?.organizationId)
			.map((statement) => statement.query_params?.organizationId);
		expect(selected).toEqual(["admin", "retro", "busy"]);
	});

	test("with reparse on, stale indexes are queued first at their parser and only sessions on the current index are reparsed", async () => {
		const sessions = [
			row("o", "p1", { parser_version: OLD, reason: "current" }),
			row("o", "i1", { parser_version: OLD, reason: "index_version" }),
			row("o", "p2", { parser_version: OLD, reason: "current" }),
			row("o", "i2", { parser_version: OLD, reason: "missing" }),
			row("o", "i3", { reason: "generation" }),
		];
		const clickhouse = fakeClickHouse({
			census: [censusRow("o", 5, "2026-11-01 00:00:00.000")],
			rows: { o: sessions },
		});
		const pg = fakeSql();
		const reparsed: string[] = [];
		let retired = 0;
		const reparser: Reparser = {
			retire: async () => {
				retired++;
				return 3;
			},
			reparse: async (target) => {
				reparsed.push(target.session_id);
				return { outcome: "written", bytes: 10 };
			},
		};
		const result = await runRunIndexHealTick({
			sql: pg.sql,
			executor: clickhouse.executor,
			config: config({
				reparse: true,
				maxPerTick: 2,
				maxReparsePerTick: 1,
				maxPending: 0,
			}),
			deadline: deadline(),
			reparser,
		});
		expect(retired).toBe(1);
		expect(pg.queued.flatMap((batch) => batch.scopeIds)).toEqual([
			scope("i1"),
			scope("i2"),
		]);
		expect(reparsed).toEqual(["p1"]);
		expect(result).toMatchObject({
			queued: 2,
			reparsed: 1,
			selections: 2,
			retiredGenerations: 3,
			reparseOutcomes: { written: 1 },
		});
		const selections = clickhouse.statements.filter(
			(statement) => statement.query_params?.organizationId,
		);
		expect(selections.map((s) => s.query_params?.reparseOnly)).toEqual([0, 1]);
		expect(selections[1]?.query_params).toMatchObject({
			afterIndexStale: 1,
			afterSessionId: "i3",
		});
	});

	test("with reparse off, parser-stale sessions on a stale index are queued and nothing is reparsed", async () => {
		const clickhouse = fakeClickHouse({
			census: [censusRow("o", 3, "2026-11-01 00:00:00.000")],
			rows: {
				o: [
					row("o", "p1", { parser_version: OLD, reason: "current" }),
					row("o", "i1", { parser_version: OLD, reason: "index_version" }),
					row("o", "i2", { parser_version: OLD, reason: "pricing_version" }),
				],
			},
		});
		const pg = fakeSql();
		const reparser: Reparser = {
			retire: async () => 0,
			reparse: async () => {
				throw new Error("reparse is off");
			},
		};
		const result = await runRunIndexHealTick({
			sql: pg.sql,
			executor: clickhouse.executor,
			config: config({ reparse: false }),
			deadline: deadline(),
			reparser,
		});
		expect(result).toMatchObject({ queued: 2, reparsed: 0 });
		expect(pg.queued.flatMap((batch) => batch.scopeIds)).toEqual([
			scope("i1"),
			scope("i2"),
		]);
	});

	test("pages through an organization whose newest sessions are already queued", async () => {
		const sessions = Array.from({ length: 6 }, (_, index) =>
			row("o", `s${index}`),
		);
		const clickhouse = fakeClickHouse({
			census: [censusRow("o", 6, "2026-11-01 00:00:00.000")],
			rows: { o: sessions },
		});
		const query = clickhouse.executor.query.bind(clickhouse.executor);
		clickhouse.executor.query = async <T>(statement: ClickHouseStatement) => {
			if (
				statement.query_params?.organizationId &&
				statement.query_params.afterSessionId
			) {
				const after = Number(
					String(statement.query_params.afterSessionId).slice(1),
				);
				return sessions
					.slice(after + 1)
					.slice(0, Number(statement.query_params.limit)) as T[];
			}
			return query<T>(statement);
		};
		const pg = fakeSql({
			scopes: ["s0", "s1", "s2"].map((id) => ({
				scope_id: scope(id),
				pending: true,
			})),
		});
		const result = await runRunIndexHealTick({
			sql: pg.sql,
			executor: clickhouse.executor,
			config: config({ maxPerTick: 2, maxPending: 1 }),
			deadline: deadline(),
		});
		expect(result.selections).toBe(2);
		expect(pg.queued.flatMap((batch) => batch.scopeIds)).toEqual([
			scope("s3"),
			scope("s4"),
		]);
	});
});
