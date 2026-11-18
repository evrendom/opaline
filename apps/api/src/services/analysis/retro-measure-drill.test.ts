import { describe, expect, test } from "bun:test";
import { MeasuresRunInputSchema, SQL_QUERY_MAX_CHARS } from "@rudel/api-routes";
import {
	DRILL_KEYS,
	drillLabel,
	drillOf,
	drillSql,
	NOT_DRILLABLE,
} from "./retro-measure-drill.js";
import type { MeasureParams } from "./retro-measure-sql.js";
import { RETRO_MEASURES } from "./retro-measures.js";
import { prepareAgentSql, type SqlWindow } from "./sql-guard.js";
import { SQL_VIEWS } from "./sql-views.js";

const params: MeasureParams = {
	from: "2026-10-06",
	to: "2026-11-03",
	repository: "athena",
	limit: 50,
};

const rows: Record<string, Record<string, string>> = {
	time_lost_by_cause: { kind: "refused", cause: "Bash: hook's policy" },
	repeated_commands: { family: "bun run check-types" },
	files_hunted_before_edit: { file: "apps/api/src/index.ts" },
	local_pass_then_ci_fail: { outcome: "ci_failed" },
};

function guarded(sql: string) {
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
	);
}

describe("measure drill", () => {
	test("every query measure is either drillable by its row's key columns or says why not", () => {
		expect(
			RETRO_MEASURES.map((measure) => measure.name)
				.filter((name) => !DRILL_KEYS[name] && !NOT_DRILLABLE[name])
				.sort(),
		).toEqual([]);
		expect(Object.keys(rows).sort()).toEqual(Object.keys(DRILL_KEYS).sort());
	});

	test("each drill is one guarded statement that lists the sessions behind the row in the find groupBy=session shape", () => {
		for (const [name, drill] of Object.entries(rows)) {
			const sql = drillSql(name, params, drill);
			expect({ name, ok: guarded(sql).ok }).toEqual({ name, ok: true });
			expect(sql.length).toBeLessThan(SQL_QUERY_MAX_CHARS);
			for (const column of [
				"AS session_id",
				"AS repository",
				"AS started_at",
				"AS rows_matched",
				"AS first_seen",
				"AS last_seen",
				"AS group_run_time",
				"AS group_call_time",
				"AS failed_calls",
				"AS agent_id",
				"AS turn_idx",
			])
				expect({ name, column, has: sql.includes(column) }).toEqual({
					name,
					column,
					has: true,
				});
			expect(sql).toContain("picked AS (");
			expect(sql).toContain("LIMIT 50");
		}
	});

	test("the row's values are quoted into the statement, never spliced", () => {
		const sql = drillSql("time_lost_by_cause", params, {
			kind: "refused",
			cause: "Bash: hook's policy",
		});
		expect(sql).toContain("= 'Bash: hook\\'s policy'");
		expect(sql).toContain("= 'refused'");
		expect(
			drillSql("repeated_commands", params, rows.repeated_commands ?? {}),
		).toContain("'bun run check-types')");
		expect(
			drillSql("local_pass_then_ci_fail", params, { outcome: "ci_failed" }),
		).toContain("WHERE d.outcome = 'ci_failed'");
	});

	test("a drill must name exactly the measure's key columns, and only drillable measures take one", () => {
		expect(drillOf("repeated_commands", { family: "git status" })).toEqual({
			family: "git status",
		});
		expect(drillOf("time_lost_by_cause", { kind: "refused" })).toEqual({
			error:
				"drill for time_lost_by_cause names one row of its result by kind and cause, copied from that row; missing: cause",
		});
		expect(
			drillOf("files_hunted_before_edit", { file: "a", sessions: "2" }),
		).toEqual({
			error:
				"drill for files_hunted_before_edit names one row of its result by file, copied from that row; not a key: sessions",
		});
		const refused = drillOf("cohort", { session_id: "s1" });
		expect("error" in refused && refused.error).toStartWith(
			"cohort takes no drill: its rows are sessions already. Drillable: time_lost_by_cause (kind, cause)",
		);
		expect(drillLabel({ kind: "refused", cause: "x" })).toBe(
			"kind=refused, cause=x",
		);
	});

	test("run takes drill as an object of the row's values", () => {
		expect(
			MeasuresRunInputSchema.safeParse({
				name: "time_lost_by_cause",
				drill: { kind: "refused", cause: "Bash: hook" },
			}).success,
		).toBe(true);
		expect(
			MeasuresRunInputSchema.safeParse({ name: "cohort", drill: {} }).success,
		).toBe(false);
	});
});
