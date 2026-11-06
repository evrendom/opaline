import { describe, expect, test } from "bun:test";
import type { TupleParam } from "@clickhouse/client-web";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { TRANSCRIPT_RECORDS_RETIRE_GRACE_MS } from "../transcript-records-ingest.service.js";
import { retireRunIndexSnapshots } from "./run-index.service.js";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const HOUR_AGO = NOW.getTime() - 3_600_000;

function snapshot(
	sessionId: string,
	revision: string,
	build: string,
	receipt: boolean,
	builtMs = HOUR_AGO,
) {
	return {
		user_id: "u1",
		session_id: sessionId,
		revision_text: revision,
		parser_version: 12,
		index_version: 7,
		build_text: build,
		receipts: receipt ? 1 : 0,
		receipt_built_ms: receipt ? builtMs : 0,
		written_ms: builtMs,
	};
}

function recording(
	options: { pendingTable?: string; emptyTable?: string } = {},
) {
	const reads: ClickHouseStatement[] = [];
	const deletes: ClickHouseStatement[] = [];
	const executor = {
		async query(statement: ClickHouseStatement) {
			if (statement.query.includes("system.mutations"))
				return [
					{
						pending:
							statement.query_params?.table === options.pendingTable ? 1 : 0,
					},
				];
			if (statement.query.startsWith("SELECT 1 AS found"))
				return options.emptyTable !== undefined &&
					statement.query.includes(`rudel.${options.emptyTable} `)
					? []
					: [{ found: 1 }];
			reads.push(statement);
			return [
				snapshot("s1", "300", "30", true),
				snapshot("s1", "200", "20", true),
				snapshot("s1", "100", "10", false),
				snapshot("s2", "500", "50", true, NOW.getTime() - 60_000),
				snapshot("s2", "400", "40", true),
			];
		},
		async execute(statement: ClickHouseStatement) {
			deletes.push(statement);
		},
	} as unknown as ClickHouseExecutor;
	return { executor, reads, deletes };
}

const sessions = [
	{ userId: "u1", sessionId: "s1" },
	{ userId: "u1", sessionId: "s2" },
];

describe("retireRunIndexSnapshots", () => {
	test("reads the sessions once and deletes setup, requests, then runs by full snapshot key", async () => {
		const run = recording();
		const retirement = await retireRunIndexSnapshots(
			run.executor,
			"org1",
			sessions,
			{ graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS, now: NOW },
		);

		expect(run.reads).toHaveLength(1);
		expect(run.reads[0]?.query).toContain(
			"(user_id, session_id) IN {sessions:Array(Tuple(String, String))}",
		);
		expect(retirement).toMatchObject({
			snapshots: 2,
			retired: 2,
			settled: true,
		});
		expect(run.deletes.map((statement) => statement.query)).toEqual(
			["run_setup", "run_requests", "run_index"].map(
				(table) =>
					`DELETE FROM rudel.${table} WHERE organization_id = {organizationId:String} AND (user_id, session_id, revision, parser_version, index_version, build_revision) IN {keys:Array(Tuple(String, String, UInt64, UInt16, UInt16, UInt64))}`,
			),
		);
		expect(
			(run.deletes[0]?.query_params?.keys as TupleParam[]).map(
				(key) => key.values,
			),
		).toEqual([
			["u1", "s1", 100n, 12, 7, 10n],
			["u1", "s1", 200n, 12, 7, 20n],
		]);
	});

	test("skips the DELETE of a table with no row of the snapshots and goes on", async () => {
		const run = recording({ emptyTable: "run_setup" });
		const retirement = await retireRunIndexSnapshots(
			run.executor,
			"org1",
			sessions,
			{ graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS, now: NOW },
		);
		expect(retirement).toMatchObject({ retired: 2, settled: true });
		expect(retirement.outcomes.map((outcome) => outcome.status)).toEqual([
			"empty",
			"completed",
			"completed",
		]);
		expect(run.deletes.map((statement) => statement.query)).toEqual([
			expect.stringContaining("DELETE FROM rudel.run_requests "),
			expect.stringContaining("DELETE FROM rudel.run_index "),
		]);
	});

	test("keeps the run index rows while an earlier delete of the same snapshots is unsettled", async () => {
		const run = recording({ pendingTable: "run_requests" });
		const retirement = await retireRunIndexSnapshots(
			run.executor,
			"org1",
			sessions,
			{ graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS, now: NOW },
		);

		expect(retirement).toMatchObject({ retired: 0, settled: false });
		expect(retirement.outcomes.map((outcome) => outcome.status)).toEqual([
			"completed",
			"deferred",
		]);
		expect(run.deletes.map((statement) => statement.query)).toEqual([
			expect.stringContaining("DELETE FROM rudel.run_setup "),
		]);
	});
});
