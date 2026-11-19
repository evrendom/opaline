import { expect, test } from "bun:test";
import { sqlOutCommand } from "./cli-hint.js";
import {
	findPeekPlan,
	renderFindPeek,
	renderSqlPeek,
	searchPeekQuery,
	sqlString,
} from "./peek.js";

const now = new Date("2026-11-04T12:00:00Z");

const peekOf = (rows: Record<string, unknown>[], groups = rows.length) => ({
	rows: groups,
	chars: 1_000,
	columns: Object.keys(rows[0] ?? {}),
	head: rows,
	ms: 120,
});

test("a find peek counts on the runs view, weighted by what the source lists, within from..to", () => {
	const plan = findPeekPlan(
		{
			source: "tool",
			from: "2026-10-06",
			to: "2026-11-03",
			repository: "web",
			cause: "hook: blocked",
			groupBy: "session",
		},
		now,
	);
	expect(plan?.query).toContain("FROM runs");
	expect(plan?.query).toContain("toUInt64(failed_calls) AS w");
	expect(plan?.query).toContain("failed_calls > 0");
	expect(plan?.query).toContain("repository = 'web'");
	expect(plan?.query).toContain(
		"started_at >= toDateTime64('2026-10-06 00:00:00', 3, 'UTC')",
	);
	expect(plan?.notApplied).toContain("cause");
	expect(findPeekPlan({ source: "weekly" }, now)).toBeNull();
});

test("calls peeks of a week count commands exactly on the calls view, longer ones tool calls on runs", () => {
	const week = findPeekPlan(
		{
			source: "calls",
			from: "2026-10-28",
			to: "2026-11-03",
			groupBy: "commandFingerprint",
		},
		now,
	);
	expect(week?.query).toContain("FROM calls");
	expect(week?.groupLabel).toBe("fingerprint");
	const month = findPeekPlan(
		{ source: "calls", from: "2026-10-01", to: "2026-11-03" },
		now,
	);
	expect(month?.query).toContain("FROM runs");
	expect(month?.unit).toContain("commands are a subset");
});

test("a find peek renders totals, the largest groups, the size of the full call and a suggestion, under 1,500 characters", () => {
	const args = {
		source: "runs",
		repository: "athena",
		from: "2026-10-06",
		to: "2026-11-03",
	};
	const plan = findPeekPlan(args, now);
	if (!plan) throw new Error("no plan");
	const rows = Array.from({ length: 5 }, (_, index) => ({
		key: `github.com/acme/repository-with-a-long-name-${index}`,
		n: 900 - index,
		sessions: 40,
		total_rows: 3_969,
		total_sessions: 214,
		total_first: "2026-10-06 08:08:00.000",
		total_last: "2026-11-03 20:10:00.000",
	}));
	const text = renderFindPeek(args, plan, peekOf(rows, 5), now);
	expect(text).toStartWith(
		"peek find source=runs 2026-10-06..2026-11-03: 3,969 runs in 214 sessions, 2026-10-06T08:08..2026-11-03T20:10",
	);
	expect(text).toContain("80 pages at limit 50");
	expect(text).toContain("use groupBy=week, repository or session");
	expect(text).toContain(
		"\ntoo large to page through here. If the opaline CLI is available, to compute on all of it, run: opaline pull --repo athena --from 2026-10-06 --to 2026-11-03\npeek:",
	);
	expect(text).not.toContain("output");
	expect(text.length).toBeLessThan(1_500);
});

test("an sql peek shows rows, size, columns and first rows on one line each", () => {
	const query = "SELECT session_id, text FROM calls";
	const peek = {
		rows: 450,
		chars: 90_000,
		columns: ["session_id", "text"],
		head: [{ session_id: "s1", text: "line one\nline two" }],
		ms: 300,
	};
	const text = renderSqlPeek("sql", peek, 200, sqlOutCommand(query));
	expect(text).toContain(
		"peek sql: 450 rows, 90,000 chars as JSON (~200 a row)",
	);
	expect(text).toContain("s1 | line one line two");
	expect(text).toContain("the rest needs aggregating in SQL\n");
	expect(text).toContain(
		'If the opaline CLI is available, to compute on all of it, run: opaline sql "SELECT session_id, text FROM calls" --out rows.jsonl',
	);
	expect(text).not.toContain("output");
	const small = renderSqlPeek(
		"sql",
		{ ...peek, rows: 20, chars: 4_000 },
		200,
		sqlOutCommand(query),
	);
	expect(small).toContain("suggest: small");
	expect(small).not.toContain("opaline sql");
});

test("strings are quoted for ClickHouse and search peeks count exact matches", () => {
	expect(sqlString("it's \\ here")).toBe("'it\\'s \\\\ here'");
	expect(
		searchPeekQuery({ text: "npm", filters: { since: "2026-10-30" } }, now),
	).toBe("SELECT * FROM search('npm', 'exact', '7')");
});
