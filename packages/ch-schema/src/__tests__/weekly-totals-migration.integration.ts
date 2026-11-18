import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { checksumSQL, createJournalStore } from "chkit/dist/bin/lib.js";
import {
	NOT_FOUND_UNKNOWN_MIGRATION,
	runNotFoundUnknownMigration,
} from "../../scripts/migrate-not-found-unknown.js";
import {
	RUN_INDEX_MIGRATION,
	runRunIndexMigration,
} from "../../scripts/migrate-run-index.js";
import {
	runWeeklyTotalsMigration,
	WEEKLY_TOTALS_MIGRATION,
} from "../../scripts/migrate-weekly-totals.js";
import { resolveClickHouseUsername } from "../clickhouse-connection.js";
import { weeklyTotalsSnapshotSql } from "../weekly-totals.js";

const url = process.env.CLICKHOUSE_URL;
if (!url) throw new Error("CLICKHOUSE_URL is required");
const connect = (database: string) =>
	createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database,
	});
const executor = connect("default");
const database = `opaline_weekly_totals_${Date.now()}`;
/** A journal with no entry, as on an installation that has the objects but not the journal row. */
const otherJournal = `${database}_journal`;
afterAll(async () => {
	await executor.execute(`DROP DATABASE IF EXISTS ${otherJournal} SYNC`);
	await executor.execute(`DROP DATABASE IF EXISTS ${database} SYNC`);
	await executor.close();
});

const migration = async (name: string) =>
	(
		await readFile(
			resolve(import.meta.dir, "../../chx/migrations", name),
			"utf8",
		)
	).replaceAll("rudel.", `${database}.`);

const RUN_COLUMNS =
	"organization_id, user_id, session_id, revision, parser_version, index_version, build_revision, agent_id, start_record, row_kind, source, started_at, session_date, unrecorded_facts, tool_calls, denied_calls, git_operations, usage_observations, cost_usd, output_tokens, not_found";

/** A run index row in RUN_COLUMNS order; `start` 4294967295 is the receipt. */
function row(values: {
	org?: string;
	session: string;
	source?: "claude_code" | "codex";
	parser?: number;
	build: number;
	start: number;
	at: string;
	unrecorded?: string[];
	toolCalls?: number;
	denied?: number | null;
	git?: string[];
	usage?: number;
	cost?: number | null;
	output?: number | null;
	notFound?: number | null;
	/** Run index version; not_found is known from index 3. */
	index?: number;
}): string {
	const receipt = values.start === 4294967295;
	const sql = (value: number | null | undefined) =>
		value === null || value === undefined ? "NULL" : String(value);
	return `('${values.org ?? "org"}', 'u1', '${values.session}', 1, ${values.parser ?? 9}, ${values.index ?? 3}, ${values.build}, '', ${values.start}, '${receipt ? "receipt" : "run"}', '${values.source ?? "claude_code"}', '${values.at}', '2026-09-01 09:00:00.000', [${(values.unrecorded ?? []).map((fact) => `'${fact}'`).join(", ")}], ${values.toolCalls ?? 0}, ${values.denied === undefined ? 0 : sql(values.denied)}, [${(values.git ?? []).map((op) => `'${op}'`).join(", ")}], ${values.usage ?? 0}, ${sql(values.cost)}, ${sql(values.output)}, ${values.notFound === undefined ? 0 : sql(values.notFound)})`;
}

test("appends nightly snapshots of the committed run index builds per member, agent and week", async () => {
	await executor.execute(`CREATE DATABASE ${database}`);
	const journalExecutor = connect(database);
	const journalStore = createJournalStore(journalExecutor);
	const common = {
		executor,
		journalStore,
		targetDatabase: database,
		expectedStoragePolicy: "s3",
		// One server: no replica lag to wait for, and drift must fail fast.
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runRunIndexMigration({
		...common,
		migrationSql: await migration(RUN_INDEX_MIGRATION),
		expectedEngine: "ReplacingMergeTree",
	});
	const sql = await migration(WEEKLY_TOTALS_MIGRATION);
	const options = {
		...common,
		migrationSql: sql,
		expectedEngine: "MergeTree" as const,
	};
	await runWeeklyTotalsMigration(options);
	await runWeeklyTotalsMigration(options);
	expect(
		(await journalStore.readJournal()).applied
			.filter((entry) => entry.name === WEEKLY_TOTALS_MIGRATION)
			.map((entry) => entry.checksum),
	).toEqual([checksumSQL(sql)]);
	// Re-applied over the existing table and view (journal row missing): the
	// statements are CREATE ... IF NOT EXISTS, so nothing changes and it journals.
	await executor.execute(`CREATE DATABASE ${otherJournal}`);
	const otherExecutor = connect(otherJournal);
	const otherStore = createJournalStore(otherExecutor);
	await runWeeklyTotalsMigration({ ...options, journalStore: otherStore });
	expect(
		(await otherStore.readJournal()).applied.map((entry) => entry.name),
	).toEqual([WEEKLY_TOTALS_MIGRATION]);
	await otherExecutor.close();

	// OPL-384: not_found is summed over the runs that can record it; the view
	// is recreated with that query and the table keeps its snapshots.
	const notFound = {
		executor,
		journalStore,
		targetDatabase: database,
		migrationSql: await migration(NOT_FOUND_UNKNOWN_MIGRATION),
		readBack: { attempts: 1, delayMs: 0 },
	};
	await runNotFoundUnknownMigration(notFound);
	await runNotFoundUnknownMigration(notFound);
	await runWeeklyTotalsMigration(options);

	const RECEIPT = 4294967295;
	await executor.execute(
		`INSERT INTO ${database}.run_index (${RUN_COLUMNS}) VALUES
		${[
			// Superseded build of s1: never counted.
			row({
				session: "s1",
				build: 10,
				start: 1,
				at: "2026-09-01 10:00:00.000",
				toolCalls: 100,
			}),
			row({
				session: "s1",
				build: 10,
				start: RECEIPT,
				at: "2026-09-01 09:00:00.000",
			}),
			// Committed build of s1: a run in each of two weeks, and usage no run claims.
			row({
				session: "s1",
				build: 11,
				start: 1,
				at: "2026-09-01 10:00:00.000",
				toolCalls: 3,
				denied: 1,
				git: ["push"],
				notFound: 2,
				usage: 2,
				cost: 1.5,
				output: 10,
			}),
			row({
				session: "s1",
				build: 11,
				start: 9,
				at: "2026-09-08 10:00:00.000",
				toolCalls: 2,
				usage: 1,
				cost: 0.5,
				output: 4,
				notFound: 1,
			}),
			row({
				session: "s1",
				build: 11,
				start: RECEIPT,
				at: "2026-09-01 09:00:00.000",
				usage: 1,
				cost: 0.25,
				output: 5,
			}),
			// A build without its receipt (in flight or crashed): never counted.
			row({
				session: "s1",
				build: 12,
				start: 1,
				at: "2026-09-01 10:00:00.000",
				toolCalls: 1000,
			}),
			// A Codex parser 8 session: denials and gitOperation are not recordable.
			row({
				session: "s2",
				source: "codex",
				parser: 8,
				build: 5,
				start: 1,
				at: "2026-09-08 11:00:00.000",
				unrecorded: ["denied_calls", "git_operations", "not_found"],
				toolCalls: 4,
				denied: null,
				notFound: null,
			}),
			row({
				session: "s2",
				source: "codex",
				parser: 8,
				build: 5,
				start: RECEIPT,
				at: "2026-09-01 09:00:00.000",
				unrecorded: ["denied_calls", "git_operations"],
				denied: null,
			}),
		].join(",\n")}`,
	);
	// A retried write of s2's run, in a block of its own: FINAL counts it once.
	await executor.execute(
		`INSERT INTO ${database}.run_index (${RUN_COLUMNS}) VALUES
		${[
			row({
				session: "s2",
				source: "codex",
				parser: 8,
				build: 5,
				start: 1,
				at: "2026-09-08 11:00:00.000",
				unrecorded: ["denied_calls", "git_operations", "not_found"],
				toolCalls: 4,
				denied: null,
				notFound: null,
			}),
			row({
				org: "other",
				session: "s3",
				build: 1,
				start: 1,
				at: "2026-09-08 12:00:00.000",
				toolCalls: 7,
			}),
			row({
				org: "other",
				session: "s3",
				build: 1,
				start: RECEIPT,
				at: "2026-09-08 09:00:00.000",
			}),
		].join(",\n")}`,
	);

	const refresh = async () => {
		await executor.execute(`SYSTEM REFRESH VIEW ${database}.weekly_totals_mv`);
		await executor.execute(`SYSTEM WAIT VIEW ${database}.weekly_totals_mv`);
	};
	await refresh();
	await refresh();
	const snapshots = await executor.query<{ snapshots: string }>(
		`SELECT toString(uniqExact(refresh_id)) AS snapshots FROM ${database}.weekly_totals`,
	);
	expect(Number(snapshots[0]?.snapshots)).toBeGreaterThanOrEqual(2);

	// A newer snapshot still being written is not read.
	await executor.execute(
		`INSERT INTO ${database}.weekly_totals (refreshed_at, refresh_id, snapshot_rows, organization_id, user_id, agent, week, runs)
		 VALUES (now64(6) + 60, 'partial', 99, 'org', 'u1', 'claude_code', '2026-08-31', 1000)`,
	);
	const [latest] = await executor.query<{ refresh_id: string }>(
		weeklyTotalsSnapshotSql(`${database}.weekly_totals`),
	);
	expect(latest?.refresh_id).toBeDefined();
	expect(latest?.refresh_id).not.toBe("partial");

	const rows = await executor.query<Record<string, unknown>>(
		`SELECT user_id, agent, toString(week) AS week, toUInt32(runs) AS runs, toUInt32(sessions) AS sessions,
			toUInt32(sessions_started) AS sessions_started, toUInt32(tool_calls) AS tool_calls,
			toUInt32(denied_calls_known_runs) AS denied_known, CAST(denied_calls, 'Nullable(UInt32)') AS denied_calls,
			toUInt32(git_operations_known_runs) AS git_known, CAST(push_runs, 'Nullable(UInt32)') AS push_runs,
			toUInt32(usage_observations) AS usage_observations, round(cost_usd, 4) AS cost_usd,
			unattributed_cost_usd, CAST(output_tokens, 'Nullable(UInt32)') AS output_tokens,
			toUInt32(not_found_known_runs) AS not_found_known, CAST(not_found, 'Nullable(UInt32)') AS not_found
		FROM ${database}.weekly_totals
		WHERE organization_id = 'org' AND refresh_id = '${latest?.refresh_id}'
		ORDER BY agent, week`,
	);
	expect(rows).toEqual([
		{
			user_id: "u1",
			agent: "claude_code",
			week: "2026-08-31",
			runs: 1,
			sessions: 1,
			sessions_started: 1,
			tool_calls: 3,
			denied_known: 1,
			denied_calls: 1,
			git_known: 1,
			push_runs: 1,
			usage_observations: 3,
			cost_usd: 1.75,
			unattributed_cost_usd: 0.25,
			output_tokens: 15,
			not_found_known: 1,
			not_found: 2,
		},
		{
			user_id: "u1",
			agent: "claude_code",
			week: "2026-09-07",
			runs: 1,
			sessions: 1,
			sessions_started: 0,
			tool_calls: 2,
			denied_known: 1,
			denied_calls: 0,
			git_known: 1,
			push_runs: 0,
			usage_observations: 1,
			cost_usd: 0.5,
			unattributed_cost_usd: null,
			output_tokens: 4,
			not_found_known: 1,
			not_found: 1,
		},
		{
			user_id: "u1",
			agent: "codex",
			week: "2026-09-07",
			runs: 1,
			sessions: 1,
			sessions_started: 1,
			tool_calls: 4,
			denied_known: 0,
			denied_calls: null,
			git_known: 0,
			push_runs: null,
			usage_observations: 0,
			cost_usd: null,
			unattributed_cost_usd: null,
			output_tokens: null,
			// Unknown, not 0: no run of the row can record it.
			not_found_known: 0,
			not_found: null,
		},
	]);

	await executor.execute(
		// APPEND must be restated: a view cannot add or remove it after creation.
		`ALTER TABLE ${database}.weekly_totals_mv MODIFY REFRESH EVERY 1 HOUR APPEND`,
	);
	await expect(runWeeklyTotalsMigration(options)).rejects.toThrow(
		"Weekly totals view mismatch",
	);
	await journalExecutor.close();
}, 120_000);
