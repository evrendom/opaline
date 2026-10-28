import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { FINDING_RUNS_COLUMNS } from "../finding-runs.js";
import { RUN_INDEX_COLUMNS, RUN_REQUEST_COLUMNS } from "../run-index.js";
import { WEEKLY_TOTALS_MEASURES } from "../weekly-totals.js";

const MIGRATION = "20261028150000_run_activity_end.sql";
const sql = readFileSync(
	new URL(`../../chx/migrations/${MIGRATION}`, import.meta.url),
	"utf8",
);

/** Each table's columns and the comments the migration gives them. */
function commentsOf(statements: readonly string[]) {
	return Object.fromEntries(
		statements.map((statement) => {
			const table = /^ALTER TABLE rudel\.(\w+)/u.exec(statement)?.[1] ?? "";
			const comments = [
				...statement.matchAll(/COMMENT COLUMN (\w+) '((?:[^'\\]|\\.)*)'/gu),
			].map(([, name, text]) => [name, text?.replaceAll("\\'", "'")]);
			return [table, Object.fromEntries(comments)];
		}),
	);
}

const commentOf = (
	columns: readonly { comment: string; name: string }[],
	name: string,
) => columns.find((column) => column.name === name)?.comment;

test("the run activity end migration only comments, as the tables define them", () => {
	const statements = extractExecutableStatements(sql);
	expect(sql).not.toMatch(
		/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY COLUMN\b|\bADD COLUMN\b/u,
	);
	expect(commentsOf(statements)).toEqual({
		run_index: {
			ended_at: commentOf(RUN_INDEX_COLUMNS, "ended_at"),
			minutes: commentOf(RUN_INDEX_COLUMNS, "minutes"),
			active_minutes: commentOf(RUN_INDEX_COLUMNS, "active_minutes"),
		},
		run_requests: { ended_at: commentOf(RUN_REQUEST_COLUMNS, "ended_at") },
		weekly_totals: {
			minutes: commentOf(WEEKLY_TOTALS_MEASURES, "minutes"),
			active_minutes: commentOf(WEEKLY_TOTALS_MEASURES, "active_minutes"),
		},
		analysis_finding_runs: {
			minutes: commentOf(FINDING_RUNS_COLUMNS, "minutes"),
			active_minutes: commentOf(FINDING_RUNS_COLUMNS, "active_minutes"),
		},
	});
	// No column still says it ends at the last non-meta record.
	for (const columns of [
		RUN_INDEX_COLUMNS,
		RUN_REQUEST_COLUMNS,
		WEEKLY_TOTALS_MEASURES,
		FINDING_RUNS_COLUMNS,
	])
		for (const name of ["ended_at", "minutes", "active_minutes"])
			expect(commentOf(columns, name) ?? "").not.toContain("non-meta");
});

test("production and bootstrap apply the run activity end migration", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { scripts: Record<string, string> };
	expect(manifest.scripts["ch:migrate:production"]).toContain(
		"ch:migrate:run-activity-end",
	);
	expect(manifest.scripts["ch:migrate:run-activity-end"]).toBe(
		"bun scripts/migrate-run-activity-end.ts",
	);
	const bootstrap = readFileSync(
		new URL("../../scripts/bootstrap.ts", import.meta.url),
		"utf8",
	);
	expect(bootstrap).toContain(
		`["${MIGRATION}", "migrate-run-activity-end.ts"]`,
	);
});
