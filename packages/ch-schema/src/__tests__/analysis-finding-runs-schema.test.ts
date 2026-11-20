import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { ANALYSIS_FINDING_RUNS_MIGRATION } from "../../scripts/migrate-analysis-finding-runs.js";
import {
	FINDING_RUNS_COLUMNS,
	FINDING_RUNS_COMMENT,
	FINDING_RUNS_ORDER_BY,
} from "../finding-runs.js";

const sql = await Bun.file(
	new URL(
		`../../chx/migrations/${ANALYSIS_FINDING_RUNS_MIGRATION}`,
		import.meta.url,
	),
).text();
/** Comments as this migration created them; run index 7 changed them
 * (20261028150000_run_activity_end.sql). */
const ORIGINAL_COMMENTS: Readonly<Record<string, string>> = {
	minutes:
		"Wall-clock minutes from the first record to the last non-meta record. Copied from the run's committed run index build when the analysis was saved.",
	active_minutes:
		"Sum of the gaps between non-meta records, each capped at five minutes. Copied from the run's committed run index build when the analysis was saved.",
};
const quoted = (text: string) =>
	`'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

test("the finding runs migration creates only the table, with every defined column, key and comment in order", () => {
	const statements = extractExecutableStatements(sql);
	expect(statements).toHaveLength(1);
	const [create = ""] = statements;
	expect(create).toStartWith(
		"CREATE TABLE IF NOT EXISTS rudel.analysis_finding_runs",
	);
	const declared = [
		...create.matchAll(/^ {2}`([a-z0-9_]+)` (.+) COMMENT '/gmu),
	];
	expect(declared.map((match) => [match[1], match[2]])).toEqual(
		FINDING_RUNS_COLUMNS.map((column) => [column.name, column.type]),
	);
	for (const column of FINDING_RUNS_COLUMNS)
		expect(create).toContain(
			`\`${column.name}\` ${column.type} COMMENT ${quoted(ORIGINAL_COMMENTS[column.name] ?? column.comment)}`,
		);
	const key = FINDING_RUNS_ORDER_BY.map((name) => `\`${name}\``).join(", ");
	expect(create).toContain(
		") ENGINE = ReplacingMergeTree(visibility_revision)",
	);
	expect(create).toContain(`PRIMARY KEY (${key})`);
	expect(create).toContain(`ORDER BY (${key})`);
	expect(create).toContain(`COMMENT ${quoted(FINDING_RUNS_COMMENT)}`);
	expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
});

test("bootstrap applies the finding runs migration through its runner", () => {
	expect(
		readFileSync(
			new URL("../../scripts/bootstrap.ts", import.meta.url),
			"utf8",
		),
	).toContain(
		`"${ANALYSIS_FINDING_RUNS_MIGRATION}",\n\t\t"migrate-analysis-finding-runs.ts",`,
	);
	const manifest = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { scripts: Record<string, string> };
	expect(manifest.scripts["ch:migrate:analysis-finding-runs"]).toBe(
		"bun scripts/migrate-analysis-finding-runs.ts",
	);
});
