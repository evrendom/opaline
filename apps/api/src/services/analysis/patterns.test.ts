import { describe, expect, test } from "bun:test";
import { PATTERN_KINDS } from "@rudel/api-routes";
import type { ClickHouseStatement } from "../../clickhouse.js";
import {
	mergePatternRows,
	patternStatement,
} from "../../handlers/analysis/pattern-statement.js";
import {
	errorFamily,
	FIX_TYPES,
	failingCallKey,
	PARENT_CALL_SQL,
	PATTERN_PREFIX,
	PATTERN_SIGNALS,
	patternDrillSql,
	patternFamilies,
	patternKindOf,
	patternsListSql,
	patternsVerifySql,
	promptThemesSql,
	shardWindows,
} from "./patterns-sql.js";
import type { MeasureParams } from "./retro-measure-sql.js";
import { cohortSelect } from "./retro-measures.js";
import { runSql, SQL_LIMITS } from "./sql-gateway.js";
import { prepareAgentSql, type SqlWindow } from "./sql-guard.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";
import { SQL_VIEWS } from "./sql-views.js";

const today = new Date("2026-11-04T10:00:00Z");
const params: MeasureParams = {
	from: "2026-10-06",
	to: "2026-11-03",
	repository: "athena",
	limit: 20,
};

function guarded(sql: string) {
	const windows = new Map<string, SqlWindow[]>();
	const prepared = prepareAgentSql(
		sql,
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				{
					windowColumn: view.windowColumn,
					statement: (window: SqlWindow) => {
						windows.set(view.name, [...(windows.get(view.name) ?? []), window]);
						return view.sql(false, window);
					},
				},
			]),
		),
		new Set(),
	);
	return { prepared, windows };
}

function statements(): { label: string; sql: string }[] {
	return patternFamilies(PATTERN_KINDS).flatMap((part) => [
		{
			label: `list ${part.family}`,
			sql: patternsListSql(params, part.family, {
				kinds: part.kinds,
				minCount: 2,
			}),
		},
		{
			label: `verify ${part.family}`,
			sql: patternsVerifySql(params, part.family, {
				kinds: part.kinds,
				minCount: 2,
				since: "2026-10-20",
			}),
		},
		{
			label: `verify ${part.family} at the last setup change`,
			sql: patternsVerifySql(params, part.family, {
				kinds: part.kinds,
				minCount: 2,
				ids: [`${PATTERN_PREFIX[part.kinds[0] ?? "failing_call"]}_0123456789`],
			}),
		},
		{
			label: `drill ${part.family}`,
			sql: patternDrillSql(
				params,
				part.family,
				`${PATTERN_PREFIX[part.kinds[0] ?? "failing_call"]}_0123456789`,
			),
		},
	]);
}

describe("pattern statements", () => {
	test("each passes the sql guard and stays within the statement size ClickHouse is given", () => {
		for (const { label, sql } of statements()) {
			const { prepared } = guarded(sql);
			expect({ label, ok: prepared.ok }).toEqual({ label, ok: true });
			const bytes = prepared.ok
				? Buffer.byteLength(prepared.prepared.sql, "utf8")
				: 0;
			expect({ label, fits: bytes < SQL_LIMITS.statementBytes }).toEqual({
				label,
				fits: true,
			});
		}
	});

	test("each reads calls at most once, from the window start, so one statement holds one calls scan", () => {
		for (const { label, sql } of statements()) {
			const calls = guarded(sql).windows.get("calls") ?? [];
			expect({ label, scans: calls.length <= 1 }).toEqual({
				label,
				scans: true,
			});
			for (const window of calls)
				expect(window.from).toBe(
					"toDateTime64 ( '2026-10-06 00:00:00' , 3 , 'UTC' )",
				);
		}
	});

	test("every signal the SQL emits has a fix type from the fixed list, and every id prefix names its kind", () => {
		const sql = statements()
			.map((statement) => statement.sql)
			.join("\n");
		for (const sub of [
			"same_command",
			"edit_check_fail",
			"edit_churn",
			"hunted",
			"dead_end",
			"overwritten",
			"unchecked",
			"ci_failed",
		])
			expect(sql).toContain(`'${sub}'`);
		for (const [sub, signal] of Object.entries(PATTERN_SIGNALS)) {
			expect({ sub, fix: signal.fix in FIX_TYPES }).toEqual({
				sub,
				fix: true,
			});
			expect(PATTERN_KINDS).toContain(signal.kind);
		}
		for (const kind of PATTERN_KINDS)
			expect(patternKindOf(`${PATTERN_PREFIX[kind]}_0123456789`)).toBe(kind);
		expect(patternKindOf("zz_0123456789")).toBeUndefined();
	});

	test("the failing call kinds are each named in the SQL and mapped to their fix", () => {
		const text = patternsListSql(params, "text", {
			kinds: ["failing_call"],
			minCount: 2,
		});
		const expected: Record<string, string> = {
			hook_block: "agents_md_rule",
			permission_denial: "allowlist",
			missing_executable: "install_or_agents_md",
			stale_edit: "pretooluse_hook",
			wrong_cwd: "pretooluse_hook",
			argument_error: "tool_schema",
			empty_search: "navigation_pointer",
			not_found: "navigation_pointer",
			command_error: "script_and_pointer",
		};
		for (const [sub, fix] of Object.entries(expected)) {
			expect(text).toContain(`'${sub}'`);
			expect(PATTERN_SIGNALS[sub]?.fix).toBe(fix as never);
		}
		expect(text).toContain("'doc'");
		expect(text).not.toContain("lint_rule_or_hook");
		expect(Object.keys(FIX_TYPES)).not.toContain("lint_rule_or_hook");
		for (const [sub, signal] of Object.entries(PATTERN_SIGNALS))
			if (signal.kind === "correction")
				expect({
					sub,
					fix: ["instruction", "doc", "skill"].includes(signal.fix),
				}).toEqual({ sub, fix: true });
	});

	test("a failing call is keyed by its error family, never by its signal or command class, and keeps its variants", () => {
		const text = patternsListSql(params, "text", {
			kinds: ["failing_call"],
			minCount: 2,
		});
		expect(text).not.toContain("concat(tupleElement(x, 3), '|'");
		expect(text).toContain("AS family");
		expect(text).toContain("sumMap([variant]");
		expect(text).toContain("sessions >= 3");
		expect(text).toContain("parent != '' OR failing_inner = 0");
		expect(PARENT_CALL_SQL).toBe("ifNull(parent_call_id, '')");
	});
});

describe("patterns as tool calls", () => {
	test("list reads every family, a kind only its own, and drill and verify of one id only that kind's", () => {
		const scope = {
			repository: "athena",
			from: "2026-10-06",
			to: "2026-11-03",
		};
		const list = patternStatement(
			{ action: "list", ...scope, minCount: 2, limit: 20 },
			today,
		);
		expect(list.parts.queries.length).toBe(5);
		expect(list.cohort).toBe(cohortSelect({ ...params, limit: 20 }));
		expect(list.measure).toMatchObject({
			name: "patterns",
			from: "2026-10-06",
			to: "2026-11-03",
		});
		expect(
			patternStatement(
				{
					action: "list",
					...scope,
					kind: "correction",
					minCount: 2,
					limit: 20,
				},
				today,
			).parts.queries.length,
		).toBe(1);
		expect(
			patternStatement(
				{ action: "drill", ...scope, id: "fc_0123456789", limit: 50 },
				today,
			).parts.queries.length,
		).toBe(1);
		expect(
			patternStatement(
				{ action: "drill", ...scope, id: "rl_0123456789", limit: 50 },
				today,
			).parts.queries.length,
		).toBe(2);
		expect(
			patternStatement(
				{
					action: "verify",
					...scope,
					id: "in_0123456789",
					minCount: 2,
					limit: 10,
				},
				today,
			).parts.queries.length,
		).toBe(2);
		expect(() =>
			patternStatement(
				{ action: "drill", ...scope, id: "zz_0123456789", limit: 50 },
				today,
			),
		).toThrow("is not a pattern id");
	});

	test("the gateway runs each statement in order and ranks the merged rows by minutes", async () => {
		const seen: ClickHouseStatement[] = [];
		const row = (id: string, kind: string, minutes: number, count: number) => ({
			id,
			kind,
			minutes,
			count,
			runs: 2,
			sessions: 3,
			session_id: "s1",
		});
		const answers = [
			[row("fc_1", "failing_call", 3, 4)],
			[row("wr_1", "wrong_route", 9, 2), row("rl_1", "retry_loop", 3, 9)],
			[row("co_1", "correction", 90, 3)],
			[row("in_1", "incomplete", 1, 2)],
			[row("th_1", "theme", 0, 5)],
		];
		const env = {
			executor: {
				close: async () => {},
				execute: async () => {},
				insert: async () => {},
				query: async <T>(statement: ClickHouseStatement) => {
					seen.push(statement);
					if (statement.query.startsWith("EXPLAIN")) return [] as T[];
					if (statement.clickhouse_settings?.readonly !== "1") return [] as T[];
					return (answers.shift() ?? []) as T[];
				},
			},
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 10, windowMs: 3_600_000 }),
			limiter: {
				withAgentQuerySlot: async <T>(_: string, work: () => Promise<T>) =>
					work(),
			},
			githubRepositories: async () => ["101"],
		};
		const statement = patternStatement(
			{
				action: "list",
				repository: "athena",
				from: "2026-10-06",
				to: "2026-11-03",
				minCount: 2,
				limit: 3,
			},
			today,
		);
		const outcome = await runSql(
			{
				workspaceId: "ws-1",
				reader: { userId: "u-1", role: "member", ownSessionsOnly: false },
			},
			statement,
			env,
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(
			outcome.result.table.split("\n").map((line) => line.split(" | ")[0]),
		).toEqual(["id", "wr_1", "rl_1", "fc_1", "in_1", "co_1", "th_1"]);
		expect(outcome.result.query).toBe(statement.query);
		const agent = seen.filter(
			(item) =>
				item.clickhouse_settings?.readonly === "1" &&
				!item.query.startsWith("EXPLAIN"),
		);
		expect(agent.length).toBeGreaterThanOrEqual(4);
	});
});

describe("long windows", () => {
	test("split the calls families into windows of at most 35 days, and the rows add up by pattern", () => {
		expect(
			shardWindows({ ...params, from: "2026-08-01", to: "2026-11-03" }).map(
				(shard) => `${shard.from}..${shard.to}`,
			),
		).toEqual([
			"2026-08-01..2026-09-01",
			"2026-09-02..2026-10-03",
			"2026-10-04..2026-11-03",
		]);
		expect(shardWindows(params).length).toBe(1);
		const statement = patternStatement(
			{
				action: "list",
				repository: "rudel",
				from: "2026-08-01",
				to: "2026-11-03",
				minCount: 2,
				limit: 20,
			},
			today,
		);
		expect(statement.parts.queries.length).toBe(9);
		expect(
			new Set(statement.parts.queries.map((part) => part.cohort)).size,
		).toBe(4);
		expect(
			mergePatternRows(
				[
					{
						id: "fc_1",
						count: 1,
						runs: 1,
						sessions: 1,
						members: 1,
						minutes: 2.5,
						first_seen: "2026-08-03",
						last_seen: "2026-08-03",
						weekly: "1 0 0",
						examples: '["s1#1"]',
						signature: "a",
					},
					{
						id: "fc_1",
						count: 2,
						runs: 2,
						sessions: 2,
						members: 1,
						minutes: 1,
						first_seen: "2026-09-10",
						last_seen: "2026-09-20",
						weekly: "0 1 1",
						examples: ["s2#4"],
						signature: "a",
					},
					{
						id: "fc_2",
						count: 5,
						runs: 1,
						sessions: 1,
						members: 1,
						minutes: 9,
						first_seen: "2026-08-03",
						last_seen: "2026-08-03",
						weekly: "1 0 0",
						examples: [],
						signature: "b",
					},
				],
				2,
				20,
			),
		).toEqual([
			{
				id: "fc_1",
				count: 3,
				runs: 3,
				sessions: 3,
				members: 1,
				minutes: 3.5,
				first_seen: "2026-08-03",
				last_seen: "2026-09-20",
				weekly: "1 1 1",
				examples: ["s1#1", "s2#4"],
				signature: "a",
			},
		]);
	});
});

describe("error families", () => {
	test("variants of one error share a family, cut at the first colon, bracket or full stop after the first word", () => {
		const cases: Record<string, string> = {
			"apply_patch verification failed: Failed to find expected lines in <path>:":
				"apply_patch verification failed",
			"apply_patch verification failed: invalid hunk at line N, Unexpected line found":
				"apply_patch verification failed",
			"apply_patch verification failed: invalid patch: multiple operations":
				"apply_patch verification failed",
			"STOP: Do not use bunx.": "stop: do not use bunx",
			"STOP: Do not use yarn.": "stop: do not use yarn",
			"src<path>(N,N): error TSN: Type '…' is not assignable to type '…'.":
				"src<path>(n,n): error tsn",
			"Error: expect(received).toBe(expected) // Object.is equality":
				"error: expect",
			"error: expect(received).toEqual(expected)": "error: expect",
			"ClickHouse migration request failed (N): Code: N.":
				"clickhouse migration request failed",
			"(no output)": "(no output)",
			"": "",
		};
		for (const [masked, family] of Object.entries(cases))
			expect({ masked, family: errorFamily(masked) }).toEqual({
				masked,
				family,
			});
	});

	test("one error is one pattern across tools and commands, except MCP tools and errors without words", () => {
		const guard = errorFamily("STOP: Do not use bunx.");
		expect(failingCallKey("exec", "exec", guard)).toBe(
			failingCallKey("wait", "wait", guard),
		);
		expect(failingCallKey("exec_command", "biome", guard)).toBe(
			failingCallKey("exec", "exec", guard),
		);
		expect(failingCallKey("exec", "python3", "(no output)")).not.toBe(
			failingCallKey("exec", "bun test", "(no output)"),
		);
		expect(failingCallKey("exec", "exec", "^c")).toBe("exec|^c");
		expect(
			failingCallKey("mcp__a__read", "mcp__a__read", "not found"),
		).not.toBe(failingCallKey("mcp__b__read", "mcp__b__read", "not found"));
	});
});

describe("sections", () => {
	const row = (id: string, kind: string, extra: Record<string, unknown>) => ({
		id,
		kind,
		count: 3,
		runs: 3,
		sessions: 3,
		minutes: 1,
		...extra,
	});

	test("failures come first by sessions then minutes, then incomplete, correction and theme, each with a fifth of the limit", () => {
		const rows = [
			row("co_1", "correction", { minutes: 500 }),
			row("co_2", "correction", { minutes: 400 }),
			row("co_3", "correction", { minutes: 300 }),
			row("co_4", "correction", { minutes: 200 }),
			row("fc_1", "failing_call", { minutes: 0.5 }),
			row("fc_2", "failing_call", { minutes: 2 }),
			row("fc_3", "failing_call", { sessions: 9, minutes: 0.1 }),
			row("rl_1", "retry_loop", { minutes: 1 }),
			row("th_1", "theme", { sessions: 4, minutes: 900 }),
			row("th_2", "theme", { sessions: 9, minutes: 1 }),
		];
		expect(mergePatternRows(rows, 2, 10).map((item) => item.id)).toEqual([
			"fc_3",
			"fc_2",
			"rl_1",
			"fc_1",
			"co_1",
			"co_2",
			"co_3",
			"th_2",
			"th_1",
		]);
		expect(
			mergePatternRows(
				rows.filter((item) => item.kind === "correction"),
				2,
				2,
			).map((item) => item.id),
		).toEqual(["co_1", "co_2"]);
	});

	test("shards count sessions by their ids, and a failing call's variants add up by text", () => {
		const merged = mergePatternRows(
			[
				row("fc_1", "failing_call", {
					sessions: 2,
					sids: ["s1", "s2"],
					detail: ["5× exec: a", "1× wait: a"],
				}),
				row("fc_1", "failing_call", {
					sessions: 2,
					sids: ["s2", "s3"],
					detail: '["2× wait: a"]',
				}),
				row("fc_2", "failing_call", { sessions: 2, sids: ["s1", "s2"] }),
				row("fc_2", "failing_call", { sessions: 1, sids: ["s2"] }),
			],
			2,
			20,
		);
		expect(merged.map((item) => [item.id, item.sessions])).toEqual([
			["fc_1", 3],
		]);
		expect(merged[0]?.detail).toEqual(["5× exec: a", "3× wait: a"]);
		expect(merged[0]).not.toHaveProperty("sids");
	});
});

describe("prompt themes as a statement", () => {
	test("reads prompts and runs only, from the window start, scoped by repository, window and sessions", () => {
		const sql = promptThemesSql({
			repository: "athena",
			from: "2026-10-06",
			to: "2026-11-03",
			sessions: ["s-1", "s-2"],
		});
		const { prepared, windows } = guarded(sql);
		expect(prepared.ok).toBe(true);
		expect(windows.get("calls")).toBeUndefined();
		expect(sql).toContain("FROM prompts");
		expect(sql).toContain("session_id IN ('s-1', 's-2')");
		expect(sql).toContain("LIMIT 100 BY kind");
	});
});
