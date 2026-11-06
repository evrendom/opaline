import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import claudeSessions from "../db/schema/claude-sessions.js";
import codexSessions from "../db/schema/codex-sessions.js";
import runIndex, { RUN_INDEX_TEXT_COLUMNS } from "../db/schema/run-index.js";
import sessionLineage from "../db/schema/session-lineage.js";
import transcriptRecords from "../db/schema/transcript-records.js";

const MIGRATIONS = new URL("../../chx/migrations/", import.meta.url);
const RETENTION_MIGRATION = "20261011120000_l1_retention_removed.sql";
/** Raw transcripts, transcript records, the run index and lineage: kept until a deletion request. */
const KEPT_TABLES = [
	"claude_sessions",
	"codex_sessions",
	"transcript_records",
	"run_index",
	"session_lineage",
] as const;
/**
 * Operational or derived-phrase tables the owner decision does not cover, and
 * the weekly totals snapshots: each is a full rebuild from the run index, so
 * an expired snapshot loses nothing the newest one does not hold.
 */
const TABLES_WITH_TTL = [
	"dependency_health_probes",
	"mcp_tool_calls",
	"session_language_signals",
	"weekly_totals",
];

describe("L1 data is kept until a deletion request", () => {
	test("the raw, record and run index table definitions carry no TTL", () => {
		for (const definition of [
			claudeSessions,
			codexSessions,
			transcriptRecords,
			runIndex,
			sessionLineage,
		])
			expect(JSON.stringify(definition)).not.toContain('"ttl"');
	});

	test("the snapshot keeps a TTL only on tables the decision does not cover", async () => {
		const snapshot = (await Bun.file(
			new URL("../../chx/meta/snapshot.json", import.meta.url),
		).json()) as { definitions: { name: string; ttl?: string }[] };
		expect(
			snapshot.definitions
				.filter((definition) => definition.ttl)
				.map((definition) => definition.name)
				.sort(),
		).toEqual(TABLES_WITH_TTL);
		const runIndexColumns = snapshot.definitions.find(
			(definition) => definition.name === "run_index",
		) as unknown as { columns: { name: string; comment: string }[] };
		for (const column of runIndexColumns.columns)
			expect(column.comment).not.toContain("retention");
	});

	test("the forward migration removes each table TTL and each text column TTL, and nothing else", async () => {
		const sql = await Bun.file(new URL(RETENTION_MIGRATION, MIGRATIONS)).text();
		const statements = sql
			.split("\n")
			.filter((line) => !line.startsWith("--") && line.trim() !== "");
		const removals = statements.filter((line) => line.includes("REMOVE TTL"));
		expect(removals.sort()).toEqual(
			[
				...KEPT_TABLES.map((table) => `ALTER TABLE rudel.${table} REMOVE TTL;`),
				...RUN_INDEX_TEXT_COLUMNS.map(
					(column) =>
						`ALTER TABLE rudel.run_index MODIFY COLUMN ${column} REMOVE TTL;`,
				),
			].sort(),
		);
		expect(statements.filter((line) => !line.includes("REMOVE TTL"))).toSatisfy(
			(rest: string[]) =>
				rest.every((line) =>
					/^ALTER TABLE rudel\.run_index MODIFY COLUMN \w+ COMMENT '/u.test(
						line,
					),
				),
		);
		expect(sql).not.toMatch(/\bMODIFY TTL\b|\bDROP\b|\bDELETE\b|\bTRUNCATE\b/u);
	});

	test("no later migration puts a TTL back on those tables", async () => {
		const names = (await readdir(MIGRATIONS))
			.filter((name) => name.endsWith(".sql") && name > RETENTION_MIGRATION)
			.sort();
		for (const name of names) {
			const sql = await Bun.file(new URL(name, MIGRATIONS)).text();
			for (const table of KEPT_TABLES)
				expect(sql).not.toMatch(
					new RegExp(`ALTER TABLE rudel\\.${table}[^;]*\\bTTL\\b`, "u"),
				);
		}
	});
});
