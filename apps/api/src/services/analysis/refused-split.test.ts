import { describe, expect, test } from "bun:test";
import { parseError } from "@clickhouse/client-web";
import type { ClickHouseStatement } from "../../clickhouse.js";
import { measureStatement } from "../../handlers/analysis/measure-statement.js";
import {
	mergePatternRows,
	patternStatement,
} from "../../handlers/analysis/pattern-statement.js";
import {
	digestReader,
	runDigest,
} from "../../handlers/analysis/retro-digest.js";
import {
	childBudget,
	halves,
	inOrder,
	joinBudgets,
	LimitRefusal,
	partConcurrency,
	runSplit,
	SPLIT_STATEMENTS,
	splitBudget,
	windowDays,
} from "./refused-split.js";
import { mergeDigestRows } from "./retro-digest-merge.js";
import type { MeasureParams } from "./retro-measure-sql.js";
import { runSql, type SqlEnv } from "./sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";

const today = new Date("2026-11-04T10:00:00Z");
const month = {
	from: "2026-10-06",
	to: "2026-11-03",
	limit: 20,
} satisfies MeasureParams;

const MEMORY =
	"Query memory limit exceeded: would use 521.13 MiB, maximum: 512.00 MiB. (MEMORY_LIMIT_EXCEEDED)";
const TIME =
	"Timeout exceeded: elapsed 10.05 s, maximum: 10 s. (TIMEOUT_EXCEEDED)";

const refusal = (text: string) =>
	parseError(`Code: 241. DB::Exception: ${text} (version 26.8.2.1)\n`);

const memory = () =>
	new LimitRefusal({
		kind: "fatal",
		message: "The query needed more than 512 MiB of memory",
		fragment: null,
		fix: "",
		limit: "memory",
	});

function windowOf(query: string): { from: string; to: string } | null {
	const found =
		/session_start >= toDateTime64\('(\d{4}-\d{2}-\d{2}) 00:00:00', 3, 'UTC'\) AND session_start < toDateTime64\('(\d{4}-\d{2}-\d{2}) 00:00:00'/u.exec(
			query,
		);
	if (!found?.[1] || !found[2]) return null;
	const to = new Date(Date.parse(`${found[2]}T00:00:00Z`) - 86_400_000)
		.toISOString()
		.slice(0, 10);
	return { from: found[1], to };
}

const isAgent = (statement: ClickHouseStatement) =>
	statement.clickhouse_settings?.readonly === "1" &&
	!statement.query.startsWith("EXPLAIN");

function gateway(
	answer: (
		window: { from: string; to: string } | null,
		query: string,
	) => Record<string, unknown>[] | Error,
) {
	const sent: { from: string; to: string }[] = [];
	const queries: string[] = [];
	return {
		sent,
		queries,
		env: {
			executor: {
				close: async () => {},
				execute: async () => {},
				insert: async () => {},
				query: async <T>(statement: ClickHouseStatement) => {
					if (!isAgent(statement)) return [] as T[];
					queries.push(statement.query);
					const window = windowOf(statement.query);
					if (window) sent.push(window);
					const rows = answer(window, statement.query);
					if (rows instanceof Error) throw rows;
					return rows as T[];
				},
			},
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
			limiter: {
				withAgentQuerySlot: async <T>(_: string, work: () => Promise<T>) =>
					work(),
			},
			githubRepositories: async () => [],
		},
	};
}

const caller = {
	workspaceId: "ws-1",
	reader: { userId: "u-1", role: "admin" as const, ownSessionsOnly: false },
};

describe("a refused window splits into halves", () => {
	test("halves cover the window without overlap and stop at one day", () => {
		expect(halves(month)).toEqual([
			{ ...month, to: "2026-10-20" },
			{ ...month, from: "2026-10-21" },
		]);
		expect(halves({ from: "2026-10-06", to: "2026-10-07" })).toEqual([
			{ from: "2026-10-06", to: "2026-10-06" },
			{ from: "2026-10-07", to: "2026-10-07" },
		]);
		expect(halves({ from: "2026-10-06", to: "2026-10-06" })).toBeNull();
	});

	test("a memory refusal runs the halves, then only a refused half's quarters, one after another and in order", async () => {
		const budget = splitBudget();
		const ran: string[] = [];
		const outcome = await runSplit(
			"patterns text",
			month,
			async (window) => {
				ran.push(`${window.from}..${window.to}`);
				if (windowDays(window) > 14) throw memory();
				return `${window.from}..${window.to}`;
			},
			budget,
		);
		expect(ran).toEqual([
			"2026-10-06..2026-11-03",
			"2026-10-06..2026-10-20",
			"2026-10-06..2026-10-13",
			"2026-10-14..2026-10-20",
			"2026-10-21..2026-11-03",
		]);
		expect(outcome).toEqual({
			ok: true,
			values: [
				"2026-10-06..2026-10-13",
				"2026-10-14..2026-10-20",
				"2026-10-21..2026-11-03",
			],
		});
		expect(budget.notes).toEqual([
			"patterns text ran as 3 windows after a memory refusal",
		]);
		expect(budget.partial).toEqual([]);
	});

	test("a window that runs needs no note", async () => {
		const budget = splitBudget();
		const outcome = await runSplit("x", month, async () => 1, budget);
		expect(outcome).toEqual({ ok: true, values: [1] });
		expect(budget.notes).toEqual([]);
	});

	test(`a stage takes at most ${SPLIT_STATEMENTS} statements; then it is partial and says where, and nothing of it is kept`, async () => {
		const budget = splitBudget();
		let statements = 0;
		const outcome = await runSplit(
			"repeated_commands",
			month,
			async (window) => {
				statements += 1;
				if (windowDays(window) > 5) throw memory();
				return window;
			},
			budget,
		);
		expect(statements).toBe(SPLIT_STATEMENTS);
		expect(outcome.ok).toBe(false);
		expect(budget.partial).toEqual([
			"partial: repeated_commands refused at 2026-10-21..2026-11-03 (a memory refusal; its 8 statements are used)",
		]);
		expect(budget.notes).toEqual([]);
	});

	test("past the call's wall cap no statement starts", async () => {
		let clock = 0;
		const budget = splitBudget({ now: () => clock });
		const outcome = await runSplit(
			"patterns theme",
			month,
			async (window) => {
				clock += 100_000;
				if (windowDays(window) > 20) throw memory();
				return window;
			},
			budget,
		);
		expect(outcome.ok).toBe(false);
		expect(budget.partial).toEqual([
			"partial: patterns theme refused at 2026-10-21..2026-11-03 (past the call's 180 s wall cap after a memory refusal)",
		]);
	});

	test("one day that is refused is partial; a latest-sessions cohort is never split by time", async () => {
		const budget = splitBudget();
		const day = { ...month, from: "2026-11-03" };
		expect(
			await runSplit(
				"digest edits",
				day,
				async () => {
					throw memory();
				},
				budget,
			),
		).toMatchObject({ ok: false });
		const latest = await runSplit(
			"digest edits",
			{ ...month, latest: 50 },
			async () => {
				throw memory();
			},
			budget,
		);
		expect(latest.ok).toBe(false);
		expect(budget.partial).toEqual([
			"partial: digest edits refused at 2026-11-03..2026-11-03 (a memory refusal; one day is the smallest window)",
			"partial: digest edits refused at 2026-10-06..2026-11-03 (a memory refusal; a latest-sessions cohort is not split by time)",
		]);
	});

	test("an error that is not a memory or time refusal is not split", async () => {
		let statements = 0;
		await expect(
			runSplit(
				"x",
				month,
				async () => {
					statements += 1;
					throw new Error("connection reset");
				},
				splitBudget(),
			),
		).rejects.toThrow("connection reset");
		expect(statements).toBe(1);
	});
});

describe("tool stages refused by the gateway", () => {
	test("the sql tool is refused as before: one statement, fatal, never split", async () => {
		const { env, queries } = gateway(() => refusal(MEMORY));
		const outcome = await runSql(
			caller,
			{ query: "SELECT count() FROM runs", title: "x" },
			env,
		);
		expect(outcome).toMatchObject({ ok: false, error: { kind: "fatal" } });
		expect(queries).toHaveLength(1);
	});

	test("patterns list: each family over 20 days is refused, runs as halves and merges with exact members", async () => {
		const piece = (sids: string[], uids: string[]) => ({
			id: "fc_0123456789",
			kind: "failing_call",
			signature: "bun test fails",
			count: 3,
			runs: 2,
			sessions: sids.length,
			members: uids.length,
			minutes: 1.5,
			first_seen: "2026-10-07",
			last_seen: "2026-10-30",
			weekly: "1 0 0 0 1",
			examples: [`${sids[0]}#1`],
			sids,
			uids,
		});
		const { env, sent } = gateway((window, query) => {
			if (!window) return [];
			if (windowDays(window) > 20)
				return refusal(query.includes("th_ev") ? TIME : MEMORY);
			if (!query.includes("tx_calls")) return [];
			return window.from === month.from
				? [piece(["s1", "s2"], ["u1", "u2"])]
				: [
						piece(["s3"], ["u2", "u3"]),
						{ ...piece(["s4"], ["u3"]), id: "fc_x", count: 1 },
					];
		});
		const statement = patternStatement(
			{ action: "list", ...month, minCount: 2, limit: 20 },
			today,
		);
		const outcome = await runSql(caller, statement, env);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		const [header = "", row = ""] = outcome.result.table.split("\n");
		const cells = Object.fromEntries(
			header.split(" | ").map((name, index) => [name, row.split(" | ")[index]]),
		);
		expect(cells).toMatchObject({
			id: "fc_0123456789",
			count: "6",
			runs: "4",
			sessions: "3",
			members: "3",
			minutes: "3",
		});
		expect(outcome.result.columns).not.toContain("uids");
		expect(outcome.result.rows).toBe(1);
		expect(outcome.result.notices).toContain(
			"patterns text ran as 2 windows after a memory refusal",
		);
		expect(
			outcome.result.notices.find((notice) =>
				notice.startsWith(
					"patterns theme ran as 2 windows after a time refusal",
				),
			),
		).toContain("lower bound");
		expect(sent.filter((window) => windowDays(window) > 20)).toHaveLength(5);
	});

	test("patterns list: a family refused past its budget is partial, the others are kept", async () => {
		const { env } = gateway((window, query) => {
			if (!window) return [];
			if (query.includes("in_ev")) return refusal(MEMORY);
			return [];
		});
		const outcome = await runSql(
			caller,
			patternStatement(
				{ action: "list", ...month, minCount: 2, limit: 20 },
				today,
			),
			env,
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.result.notices).toContain(
			"partial: patterns ci refused at 2026-10-06..2026-10-06 (a memory refusal; one day is the smallest window)",
		);
	});

	test("every stage refused: the call is refused and says where", async () => {
		const { env } = gateway((window) => (window ? refusal(MEMORY) : []));
		const outcome = await runSql(
			caller,
			measureStatement({ name: "repeated_commands", ...month }, today),
			env,
		);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.error.kind).toBe("fatal");
		expect(outcome.error.message).toContain(
			"partial: repeated_commands refused at",
		);
	});

	test("repeated_commands: windows merge by family, sessions add up, members and variants by id", async () => {
		const piece = (
			from: string,
			rows: {
				calls: number;
				sessions: number;
				uids: string[];
				variants: [number, string, string, number, string][];
				ex: [number, string, string, string, number];
			},
		) => ({
			family: "git status",
			calls: rows.calls,
			failed: 1,
			minutes: from === month.from ? 0.25 : 0.5,
			sessions: rows.sessions,
			uids: rows.uids,
			variants: rows.variants,
			ex: rows.ex,
		});
		const families = (rows: ReturnType<typeof piece>[]) => [
			{
				families: rows.map((row) => [
					row.family,
					row.calls,
					row.failed,
					row.minutes,
					row.sessions,
					row.uids,
					row.variants.map((variant) => [variant[1], variant[0]]),
					row.variants,
					row.ex,
				]),
			},
		];
		const { env } = gateway((window) => {
			if (!window) return [];
			if (windowDays(window) > 20) return refusal(MEMORY);
			return families(
				window.from === month.from
					? [
							piece(month.from, {
								calls: 5,
								sessions: 2,
								uids: ["u1", "u2"],
								variants: [
									[4, "11", "git status", 0.1, "c1"],
									[1, "12", "git status -s", 0.2, "c2"],
								],
								ex: [0.2, "git status -s", "s1", "", 3],
							}),
							{
								...piece(month.from, {
									calls: 1,
									sessions: 1,
									uids: ["u1"],
									variants: [[1, "13", "ls", 0, "c3"]],
									ex: [0, "ls", "s1", "", 1],
								}),
								family: "ls",
							},
						]
					: [
							piece("2026-10-21", {
								calls: 3,
								sessions: 1,
								uids: ["u2", "u3"],
								variants: [[3, "12", "git  status -s", 0.4, "c9"]],
								ex: [0.4, "git  status -s", "s7", "a1", 2],
							}),
						],
			);
		});
		const outcome = await runSql(
			caller,
			measureStatement({ name: "repeated_commands", ...month }, today),
			env,
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.result.columns).toEqual([
			"family",
			"calls",
			"failed",
			"group_call_time",
			"sessions",
			"members",
			"variants",
			"example",
			"session_id",
			"agent_id",
			"turn_idx",
		]);
		expect(outcome.result.table.split("\n").slice(1)).toEqual([
			'git status | 8 | 2 | 0.8 | 3 | 3 | ["4× git status","4× git  status -s"] | git  status -s | s7 | a1 | 2',
		]);
		expect(outcome.result.notices[0]).toStartWith(
			"repeated_commands ran as 2 windows after a memory refusal; calls, failed, group_call_time and sessions are summed",
		);
	});
});

describe("the digest's windows", () => {
	test("calls ranked: windows merge exactly, top ids and the example are chosen over every window, and each metric counts its keys", () => {
		const lead = (ex: string, w: number, sn: number, sid: string) => [
			[ex, `label ${ex}`],
			[w, sn, sid],
		];
		const merged = mergeDigestRows([
			{
				ranked: [
					[
						"families",
						[
							[
								"git",
								4,
								1,
								2.04,
								2,
								[
									[1.5, 3, 1, "s2"],
									[0.54, 1, 0, "s1"],
								],
								...lead("s2#4", 1.5, 3, "s2"),
								4,
							],
						],
					],
					[
						"inline_scripts",
						[["python3: def f()", 2, 0, 0, 2, [], "", "", "", 0]],
					],
				],
			},
			{
				ranked: [
					[
						"families",
						[
							[
								"git",
								2,
								0,
								3.02,
								2,
								[
									[3, 1, 0, "s9"],
									[0.02, 1, 0, "s8"],
								],
								...lead("s9#1", 3, 1, "s9"),
								2,
							],
						],
					],
					[
						"inline_scripts",
						[["python3: def f()", 1, 0, 0, 1, [], "", "", "", 0]],
					],
				],
			},
		]);
		expect(merged.ranked).toEqual([
			[
				"families",
				[["git", 6, 1, 5.1, 4, ["s9", "s2", "s1"], "s9#1", "label s9#1", 6]],
				1,
			],
			["inline_scripts", [["python3: def f()", 3, 0, 0, 3, [], "", "", 0]], 1],
		]);
	});

	test("counts add up, lists keep their order and caps, and links are kept once", () => {
		const merged = mergeDigestRows([
			{
				repeat_totals: [2, 1],
				repeats: [["fix it", 3, "s1", 2]],
				models: [["opus", 4, 1, 3]],
				links: [["parent_thread", "s1", "s2", "claude", "codex"]],
				share: [10, 2, 8, 1, 0, 0, 1, 0],
			},
			{
				repeat_totals: [1, 1],
				repeats: [["again", 5, "s7", 1]],
				models: [
					["opus", 2, 1, 2],
					["sonnet", 9, 1, 9],
				],
				links: [["parent_thread", "s1", "s2", "claude", "codex"]],
				share: [5, 1, 5, 1, 0, 0, 1, 0],
			},
		]);
		expect(merged).toEqual({
			repeat_totals: [3, 2],
			repeats: [
				["again", 5, "s7", 1],
				["fix it", 3, "s1", 2],
			],
			models: [
				["sonnet", 9, 1, 9],
				["opus", 6, 2, 5],
			],
			links: [["parent_thread", "s1", "s2", "claude", "codex"]],
			share: [15, 3, 13, 2, 0, 0, 2, 0],
		});
		expect(() => mergeDigestRows([{ unheard: 1 }, { unheard: 2 }])).toThrow(
			"digest column unheard has no merge",
		);
	});

	test("a stage refused down to one day is unknown, not 0, and the footer says where", async () => {
		const session = [
			"s1",
			"claude",
			"",
			1,
			2,
			0,
			0,
			3,
			2,
			1,
			2,
			0,
			[],
			1,
			"u1",
		];
		const refusedEdits: string[] = [];
		const text = (
			await runDigest(
				{
					workspaceId: "ws-1",
					view: async (query, cohort) => {
						if (query.includes("p.uid)) AS sessions"))
							return [{ sessions: [session] }];
						if (query.includes("notEmpty(e.changed_files)")) {
							refusedEdits.push(String(windowOf(cohort)?.from));
							throw memory();
						}
						if (
							query.includes("AS ranked") &&
							windowDays(windowOf(cohort) ?? month) > 1
						)
							throw memory();
						return [];
					},
					trusted: async () => [],
				},
				{ from: "2026-11-02", to: "2026-11-03" },
				today,
			)
		).text;
		expect(refusedEdits).toEqual(["2026-11-02", "2026-11-02"]);
		expect(text).toContain(
			"- skipped: unknown, not 0: digest edits refused at 2026-11-02..2026-11-02 (a memory refusal; one day is the smallest window)",
		);
		expect(text.split("\n").slice(-2)).toEqual([
			"digest calls ranked ran as 2 windows after a memory refusal",
			"partial: digest edits refused at 2026-11-02..2026-11-02 (a memory refusal; one day is the smallest window)",
		]);
		const setup = text.split("## a.")[1]?.split("## b.")[0] ?? "";
		expect(setup).not.toMatch(/^- (?!skipped)/mu);
	});
});

describe("severity shards", () => {
	test("a refused shard leaves the other shards' hits, marked as a lower bound", async () => {
		const text = (
			await runDigest(
				{
					workspaceId: "ws-1",
					view: async (query, cohort) => {
						if (query.includes("p.uid)) AS sessions"))
							return [{ sessions: [DIGEST_SESSION] }];
						if (!query.includes("AS severity")) return [];
						if ((windowOf(cohort)?.from ?? "") >= "2026-10-27") throw memory();
						return [
							{
								severity: [
									[
										"destructive",
										"git reset --hard",
										2,
										1,
										[["s1#1", "git reset --hard"]],
									],
								],
							},
						];
					},
					trusted: async () => [],
				},
				{ from: "2026-10-20", to: "2026-11-02" },
				today,
			)
		).text;
		const severity = text.split("## i.")[1]?.split("## j.")[0] ?? "";
		expect(severity).toContain("git reset --hard 4 (up to 2 sess)");
		expect(severity).toContain(
			"- skipped: lower bound, a window is missing: digest severity commands 2026-10-27..2026-11-02 refused at 2026-10-27..2026-10-27",
		);
	});
});

describe("distinct sessions and members merge by id", () => {
	test("a pattern seen in two windows counts each session and member once", () => {
		const row = (sids: string[], uids: string[]) => ({
			id: "fc_1",
			kind: "failing_call",
			count: 2,
			runs: 2,
			sessions: sids.length,
			members: uids.length,
			minutes: 1,
			sids,
			uids,
		});
		const [merged] = mergePatternRows(
			[row(["s1", "s2"], ["u1", "u2"]), row(["s2", "s3"], ["u2", "u3"])],
			2,
			20,
		);
		expect(merged).toMatchObject({ sessions: 3, members: 3, count: 4 });
		expect(merged).not.toHaveProperty("uids");
		expect(merged).not.toHaveProperty("sids");
		expect(merged).not.toHaveProperty("lower_bound");
	});

	test("a window that hit its per-kind cap or its session id cap makes the merged counts lower bounds", () => {
		const row = (id: string, kind: string, sids: string[], cut: boolean) => ({
			id,
			kind,
			count: 3,
			runs: 3,
			sessions: sids.length,
			members: 1,
			minutes: 1,
			sids,
			uids: ["u1"],
			kind_cut: cut,
		});
		const many = Array.from({ length: 1000 }, (_, i) => `s${i}`);
		const merged = mergePatternRows(
			[
				row("fc_1", "failing_call", ["s1", "s2", "s3"], false),
				row("fc_2", "failing_call", many, false),
				row("co_1", "correction", ["s1", "s2", "s3"], true),
				row("co_1", "correction", ["s4"], false),
			],
			2,
			20,
		);
		expect(
			Object.fromEntries(merged.map((item) => [item.id, item.lower_bound])),
		).toEqual({
			fc_2: "lower bound: a window listed only 1000 of its sessions",
			fc_1: "",
			co_1: "lower bound: a window kept only its top correction patterns",
		});
		expect(merged[0]).not.toHaveProperty("kind_cut");
	});
});

function counted(queries: number) {
	const quota = createMemorySqlQuota({ queries, windowMs: 3_600_000 });
	const taken: string[] = [];
	return {
		taken,
		quota: {
			...quota,
			take: (workspaceId: string) => {
				taken.push(workspaceId);
				return quota.take(workspaceId);
			},
		},
	};
}

const DIGEST_SESSION = [
	"s1",
	"claude",
	"",
	1,
	2,
	0,
	0,
	3,
	2,
	1,
	2,
	0,
	[],
	1,
	"u1",
];

describe("one query of the quota per tool call", () => {
	test("a split patterns list takes one query of the quota for all its statements", async () => {
		const { env, queries } = gateway((window, query) =>
			window && windowDays(window) > 20 && query.includes("tx_calls")
				? refusal(MEMORY)
				: [],
		);
		const { quota, taken } = counted(1);
		const statement = patternStatement(
			{ action: "list", ...month, minCount: 2, limit: 20 },
			today,
		);
		const outcome = await runSql(caller, statement, { ...env, quota });
		expect(outcome.ok).toBe(true);
		expect(queries.length).toBeGreaterThan(statement.parts.queries.length);
		expect(taken).toEqual(["ws-1"]);
		const sent = queries.length;
		const spent = await runSql(caller, statement, { ...env, quota });
		expect(spent).toMatchObject({
			ok: false,
			error: {
				kind: "fatal",
				message:
					"The workspace used its SQL quota of 1 queries (sql and run calls) per 60 minutes.",
			},
		});
		expect(queries.length).toBe(sent);
	});

	test("a digest that runs every stage takes one query of the quota", async () => {
		const { env, queries } = gateway((_window, query) =>
			query.includes("p.uid)) AS sessions")
				? [{ sessions: [DIGEST_SESSION] }]
				: [],
		);
		const { quota, taken } = counted(1);
		const digest = await runDigest(
			digestReader(caller, { ...env, quota } as SqlEnv),
			{ from: "2026-11-02", to: "2026-11-03" },
			today,
		);
		expect(digest.text).toContain("retro digest");
		expect(queries.length).toBeGreaterThan(20);
		expect(taken).toEqual(["ws-1"]);
	});

	test("a spent quota refuses the digest before any statement, with the quota's message", async () => {
		const { env, queries } = gateway(() => []);
		const { quota } = counted(0);
		await expect(
			runDigest(
				digestReader(caller, { ...env, quota } as SqlEnv),
				{ from: "2026-11-02", to: "2026-11-03" },
				today,
			),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: expect.stringContaining(
				"used its SQL quota of 0 queries (sql and run calls) per 60 minutes",
			),
		});
		expect(queries).toEqual([]);
	});
});

describe("a self-hosted server runs independent statements two at a time", () => {
	const selfHosted = async <T>(work: () => Promise<T>): Promise<T> => {
		const previous = process.env.OPALINE_SELF_HOSTED;
		process.env.OPALINE_SELF_HOSTED = "1";
		try {
			return await work();
		} finally {
			if (previous === undefined) delete process.env.OPALINE_SELF_HOSTED;
			else process.env.OPALINE_SELF_HOSTED = previous;
		}
	};
	const jitter = (query: string) =>
		new Promise((resolve) =>
			setTimeout(resolve, query.length % 7 === 0 ? 0 : (query.length % 5) + 1),
		);

	test("inOrder keeps the order, runs at most the given number at once, and throws the first failure in order", async () => {
		let running = 0;
		let most = 0;
		const task =
			(value: number, ms: number, fail = false) =>
			async () => {
				running++;
				most = Math.max(most, running);
				await Bun.sleep(ms);
				running--;
				if (fail) throw new Error(`failed ${value}`);
				return value;
			};
		expect(
			await inOrder([task(1, 15), task(2, 1), task(3, 5), task(4, 1)], 2),
		).toEqual([1, 2, 3, 4]);
		expect(most).toBe(2);
		await expect(
			inOrder([task(1, 20, true), task(2, 1, true), task(3, 1)], 2),
		).rejects.toThrow("failed 1");
		expect(await inOrder([], 2)).toEqual([]);
		expect(partConcurrency()).toBe(1);
		expect(await selfHosted(async () => partConcurrency())).toBe(2);
	});

	test("child budgets keep each stage's notes and join them in stage order", () => {
		const budget = splitBudget({ now: () => 0 });
		const first = childBudget(budget);
		const second = childBudget(budget);
		second.notes.push("second");
		first.notes.push("first");
		first.partial.push("partial first");
		expect(first.deadline).toBe(budget.deadline);
		joinBudgets(budget, [first, second]);
		expect(budget.notes).toEqual(["first", "second"]);
		expect(budget.partial).toEqual(["partial first"]);
	});

	test("patterns list: the same rows and notices with refused and split families", async () => {
		const list = async () => {
			let running = 0;
			let most = 0;
			const { env } = gateway((window, query) => {
				if (!window) return [];
				if (windowDays(window) > 20)
					return refusal(query.includes("th_ev") ? TIME : MEMORY);
				if (query.includes("in_ev")) return refusal(MEMORY);
				return [];
			});
			const query = env.executor.query;
			env.executor.query = async <T>(statement: ClickHouseStatement) => {
				running++;
				most = Math.max(most, running);
				await jitter(statement.query);
				try {
					return await query<T>(statement);
				} finally {
					running--;
				}
			};
			const outcome = await runSql(
				caller,
				patternStatement(
					{ action: "list", ...month, minCount: 2, limit: 20 },
					today,
				),
				env,
			);
			if (!outcome.ok) throw new Error(outcome.error.message);
			const { id: _id, ...result } = outcome.result;
			return { result, most };
		};
		const one = await list();
		const two = await selfHosted(list);
		expect(one.most).toBe(1);
		expect(two.most).toBe(2);
		expect(two.result).toEqual(one.result);
		expect(one.result.notices.length).toBeGreaterThan(2);
	});

	test("digest: the same text with refused, split and partial stages", async () => {
		const digest = async () => {
			let running = 0;
			let most = 0;
			const result = await runDigest(
				{
					workspaceId: "ws-1",
					view: async (query, cohort) => {
						running++;
						most = Math.max(most, running);
						try {
							await jitter(query + cohort);
							if (query.includes("p.uid)) AS sessions"))
								return [{ sessions: [DIGEST_SESSION] }];
							if (query.includes("notEmpty(e.changed_files)")) throw memory();
							if (
								query.includes("AS ranked") &&
								windowDays(windowOf(cohort) ?? month) > 1
							)
								throw memory();
							if (query.includes("AS severity")) {
								if ((windowOf(cohort)?.from ?? "") >= "2026-10-27")
									throw memory();
								return [
									{
										severity: [
											[
												"destructive",
												"git reset --hard",
												2,
												1,
												[["s1#1", "git reset --hard"]],
											],
										],
									},
								];
							}
							return [];
						} finally {
							running--;
						}
					},
					trusted: async () => [],
				},
				{ from: "2026-10-20", to: "2026-11-02" },
				today,
			);
			return {
				text: result.text.replace(/, \d+(\.\d+)? s\n/u, "\n"),
				most,
			};
		};
		const one = await digest();
		const two = await selfHosted(digest);
		expect(one.most).toBe(1);
		expect(two.most).toBe(2);
		expect(two.text).toEqual(one.text);
		expect(one.text).toContain("lower bound, a window is missing");
		expect(one.text).toContain("unknown, not 0: digest edits refused");
	});
});
