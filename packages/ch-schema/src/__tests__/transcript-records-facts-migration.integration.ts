import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	runTranscriptRecordsMigration,
	TRANSCRIPT_RECORDS_FACTS_MIGRATION,
	TRANSCRIPT_RECORDS_MIGRATION,
} from "../../scripts/migrate-transcript-records.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const executor = createClickHouseExecutor({
	url,
	username: resolveClickHouseUsername(process.env, url),
	password: process.env.CLICKHOUSE_PASSWORD ?? "",
	database: "default",
});
const fresh = `opaline_records_fresh_${Date.now()}`;
const installed = `opaline_records_installed_${Date.now()}`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${fresh}`);
	await executor.execute(`DROP DATABASE IF EXISTS ${installed}`);
	await executor.close();
});

const read = async (name: string, database: string) =>
	(
		await readFile(
			resolve(import.meta.dir, "../../chx/migrations", name),
			"utf8",
		)
	).replaceAll("rudel", database);
async function setup(database: string) {
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalExecutor = createClickHouseExecutor({
		url: url ?? "",
		username: resolveClickHouseUsername(process.env, url ?? ""),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database,
	});
	return {
		journalExecutor,
		options: {
			executor,
			journalStore: createJournalStore(journalExecutor),
			migrationSql: await read(TRANSCRIPT_RECORDS_MIGRATION, database),
			factsMigrationSql: await read(
				TRANSCRIPT_RECORDS_FACTS_MIGRATION,
				database,
			),
			targetDatabase: database,
			// One server: no replica lag to wait for, and drift must fail fast.
			readBack: { attempts: 1, delayMs: 0 },
		},
	};
}

test("a fresh install creates the table with every fact column, journaled once", async () => {
	const { journalExecutor, options } = await setup(fresh);
	await runTranscriptRecordsMigration(options);
	await runTranscriptRecordsMigration(options);
	const columns = await executor.query<{
		name: string;
		compression_codec: string;
	}>(
		`SELECT name, compression_codec FROM system.columns WHERE database = '${fresh}' AND table = 'transcript_records' AND name IN ('agent_version', 'facts', 'text')`,
	);
	expect(
		columns.map((column) => [column.name, column.compression_codec]).sort(),
	).toEqual([
		["agent_version", ""],
		["facts", "CODEC(ZSTD(3))"],
		["text", "CODEC(ZSTD(3))"],
	]);
	expect(
		(await options.journalStore.readJournal()).applied
			.map((entry) => entry.name)
			.sort(),
	).toEqual(
		[TRANSCRIPT_RECORDS_MIGRATION, TRANSCRIPT_RECORDS_FACTS_MIGRATION].sort(),
	);
	await journalExecutor.close();
});

test("an installed table gains the fact columns, keeps its rows as not recorded, and rejects drift without journaling", async () => {
	const { journalExecutor, options } = await setup(installed);
	for (const statement of extractExecutableStatements(options.migrationSql))
		await executor.execute(statement);
	await options.journalStore.appendEntry({
		name: TRANSCRIPT_RECORDS_MIGRATION,
		checksum: checksumSQL(options.migrationSql),
		appliedAt: new Date().toISOString().replace("Z", ""),
	});
	await executor.execute(
		`INSERT INTO ${installed}.transcript_records (organization_id, user_id, session_id, source, agent_id, revision, record_idx, block_idx, turn_idx, ts, session_date, kind, subtype, tool_name, command_class, is_error, exit_code, call_id, file_path, file_op, spawned_agent_id, byte_start, byte_len, text_chars, parser_version, head, tail, text)
		 VALUES ('org', 'user', 'legacy', 'claude_code', '', 1, 3, 0, 1, now64(3), now64(3), 'tool_result', '', 'Bash', '', false, 0, 'call', '', '', '', 0, 10, 4, 5, '', '', 'text')`,
	);

	// A column with another comment is rejected and the facts step is not journaled.
	await executor.execute(
		`ALTER TABLE ${installed}.transcript_records ADD COLUMN agent_version LowCardinality(String) COMMENT 'another comment'`,
	);
	await expect(runTranscriptRecordsMigration(options)).rejects.toThrow(
		"fact columns mismatch: agent_version",
	);
	const factsEntries = async () =>
		(await options.journalStore.readJournal()).applied.filter(
			(entry) => entry.name === TRANSCRIPT_RECORDS_FACTS_MIGRATION,
		);
	expect(await factsEntries()).toHaveLength(0);
	await executor.execute(
		`ALTER TABLE ${installed}.transcript_records DROP COLUMN agent_version`,
	);
	// Drop the columns the failed run added, so the upgrade starts from the installed table.
	for (const column of [
		"entrypoint",
		"denial_kind",
		"duration_ms",
		"timed_out_after_ms",
		"interrupted",
		"git_operation",
		"mcp_server",
		"mcp_tool",
		"attribution_skill",
		"facts",
	])
		await executor.execute(
			`ALTER TABLE ${installed}.transcript_records DROP COLUMN IF EXISTS ${column}`,
		);

	await runTranscriptRecordsMigration(options);
	await runTranscriptRecordsMigration(options);
	const rows = await executor.query<Record<string, unknown>>(
		`SELECT session_id, agent_version, denial_kind, duration_ms, interrupted, git_operation, facts FROM ${installed}.transcript_records`,
	);
	expect(rows).toEqual([
		{
			session_id: "legacy",
			agent_version: "",
			denial_kind: "",
			duration_ms: null,
			interrupted: null,
			git_operation: [],
			facts: {},
		},
	]);
	expect((await factsEntries()).map((entry) => entry.checksum)).toEqual([
		checksumSQL(options.factsMigrationSql),
	]);
	await expect(
		runTranscriptRecordsMigration({
			...options,
			factsMigrationSql: `${options.factsMigrationSql}\nSELECT 1;\n`,
		}),
	).rejects.toThrow("checksum mismatch");
	await journalExecutor.close();
});
