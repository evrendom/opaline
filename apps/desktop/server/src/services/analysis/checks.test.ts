import { describe, expect, test } from "bun:test";
import { checkQuery, createMemoryCheckStore } from "./checks.js";
import { prepareAgentSql, type SqlWindow } from "./sql-guard.js";
import { SQL_VIEWS } from "./sql-views.js";

const today = new Date("2026-11-04T10:00:00Z");

function passesGuard(sql: string): boolean {
	return prepareAgentSql(
		sql,
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				{
					windowColumn: view.windowColumn,
					statement: (window: SqlWindow) => view.sql(false, window),
				},
			]),
		),
		new Set(),
	).ok;
}

describe("checks", () => {
	test("a runs condition is tested over the newest runs and run over a window, per run or per session", () => {
		const definition = {
			kind: "runs" as const,
			where: "failed_calls >= 10",
			target: "run" as const,
		};
		const tested = checkQuery("many failures", definition, {
			kind: "last",
			last: 500,
			today,
		});
		if ("error" in tested) throw new Error(tested.error);
		expect(tested.over).toBe("the last 500 runs");
		expect(tested.query).toContain(
			"run_id IN (SELECT run_id FROM runs ORDER BY started_at DESC, run_id LIMIT 500)",
		);
		expect(tested.query).toContain("AND (\nfailed_calls >= 10\n\t\t)");
		expect(tested.query).toContain("count() OVER () AS matches");
		expect(tested.cohort).toBeUndefined();
		expect(passesGuard(tested.query)).toBe(true);

		const run = checkQuery(
			"many failures",
			{ ...definition, target: "session" },
			{ kind: "window", from: "2026-10-06", to: "2026-11-03", today },
		);
		if ("error" in run) throw new Error(run.error);
		expect(run.over).toBe("runs that started 2026-10-06..2026-11-03");
		expect(run.query).toContain(
			"started_at >= toDateTime64('2026-10-06 00:00:00', 3, 'UTC') AND started_at < toDateTime64('2026-11-04 00:00:00', 3, 'UTC')",
		);
		expect(run.query).toContain("GROUP BY user_id, session_id");
		expect(passesGuard(run.query)).toBe(true);
	});

	test("a condition that escapes its parentheses is refused by the guard like any sql", () => {
		const escaped = checkQuery(
			"escape",
			{
				kind: "runs",
				where: "1) UNION ALL SELECT * FROM system.tables WHERE (1",
				target: "run",
			},
			{ kind: "last", last: 10, today },
		);
		if ("error" in escaped) throw new Error(escaped.error);
		expect(passesGuard(escaped.query)).toBe(false);
	});

	test("a measure check keeps the measure's rows at or above the threshold over its cohort", () => {
		const built = checkQuery(
			"cat keeps failing",
			{
				kind: "measure",
				measure: "time_lost_by_cause",
				column: "failed_calls",
				min: 20,
				repository: "athena",
			},
			{ kind: "last", last: 50, today },
		);
		if ("error" in built) throw new Error(built.error);
		expect(built.query).toContain("WHERE failed_calls >= 20");
		expect(built.over).toBe("the last 50 sessions in 'athena'");
		expect(built.cohort).toContain("LIMIT 50");
		expect(passesGuard(built.query)).toBe(true);
		expect(
			checkQuery(
				"x",
				{ kind: "measure", measure: "cohort", column: "nope", min: 1 },
				{ kind: "last", last: 5, today },
			),
		).toEqual({
			error:
				"cohort has no column nope; it has session_start, runs, main_runs, active_time, cost, re_asks, frustration",
		});
		expect(
			checkQuery(
				"x",
				{ kind: "measure", measure: "cost", column: "x", min: 1 },
				{ kind: "last", last: 5, today },
			),
		).toEqual({ error: "cost is not a measure measures action=run can run" });
	});

	test("checks are saved off and listed only to their author", async () => {
		const store = createMemoryCheckStore(() => today);
		const owner = { workspaceId: "w", authorId: "a" };
		const check = await store.create({
			...owner,
			name: "n",
			definition: { kind: "runs", where: "1", target: "run" },
		});
		expect(check).toMatchObject({ enabled: false, name: "n" });
		expect(check.id).toStartWith("ck_");
		expect(await store.list(owner)).toEqual([check]);
		expect(await store.list({ workspaceId: "w", authorId: "b" })).toEqual([]);
		expect(
			await store.get({ workspaceId: "w", authorId: "b" }, check.id),
		).toBeNull();
		expect(await store.get(owner, check.id)).toEqual(check);
	});
});
