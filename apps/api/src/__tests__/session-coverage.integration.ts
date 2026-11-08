import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import { computeCoverage } from "../services/analysis/coverage.js";
import { RUN_INDEX_VERSION } from "../services/analysis/run-index-sql.js";
import { purgeClickHouseRows } from "../services/org-session.service.js";
import { recordSessionInventory } from "../services/session-inventory.service.js";

setDefaultTimeout(60_000);

const clickhouse = getClickhouse();
const org = `coverage-${crypto.randomUUID()}`;
const alice = `alice-${crypto.randomUUID()}`;
const bob = `bob-${crypto.randomUUID()}`;
const now = new Date("2026-11-07T12:00:00.000Z");
const everything = {
	window: null,
	repository: null,
	latest: null,
	sessions: null,
};
const writable = { assertWritable: async () => undefined };

afterAll(async () => {
	for (const table of [
		"rudel.session_inventory",
		"rudel.session_analytics",
		"rudel.transcript_records",
		"rudel.run_index",
	])
		await purgeClickHouseRows(table, "organization_id = {org:String}", {
			org,
		});
});

async function held(
	userId: string,
	sessionId: string,
	options: { lines: number | null; index: "current" | "older" | null },
) {
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				source: "claude_code",
				organization_id: org,
				user_id: userId,
				session_id: sessionId,
				session_date: "2026-11-05 10:00:00.000",
				project_path: "/work/app",
				revision: "7",
			},
		],
	});
	if (options.lines !== null)
		await clickhouse.insert({
			table: "rudel.transcript_records",
			asyncInsert: false,
			values: [
				{
					organization_id: org,
					user_id: userId,
					session_id: sessionId,
					source: "claude_code",
					agent_id: "",
					revision: "7",
					parser_version: TRANSCRIPT_RECORDS_PARSER_VERSION,
					record_idx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
					block_idx: 0,
					head: JSON.stringify({ lineCount: options.lines }),
				},
			],
		});
	if (options.index !== null)
		await clickhouse.insert({
			table: "rudel.run_index",
			asyncInsert: false,
			values: [
				{
					organization_id: org,
					user_id: userId,
					session_id: sessionId,
					revision: "7",
					parser_version:
						options.index === "current"
							? TRANSCRIPT_RECORDS_PARSER_VERSION
							: TRANSCRIPT_RECORDS_PARSER_VERSION - 1,
					index_version: RUN_INDEX_VERSION,
					build_revision: "1",
					agent_id: "",
					start_record: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
					row_kind: "receipt",
				},
			],
		});
}

const local = (sessionId: string, lines: number, modifiedAt: string) => ({
	sessionId,
	source: "claude_code" as const,
	mainLines: lines - 1,
	subagentLines: 1,
	subagentFiles: 1,
	mainBytes: 100,
	subagentBytes: 10,
	modifiedAt,
	startedAt: "2026-11-05T10:00:00.000Z",
});

test("a result counts what the workspace misses against the members' inventories, and unknown stays unknown", async () => {
	await held(alice, "complete", { lines: 10, index: "current" });
	await held(alice, "behind", { lines: 6, index: "older" });
	await held(alice, "unextracted", { lines: null, index: null });
	await held(bob, "bobs", { lines: 4, index: "current" });

	const before = await computeCoverage(
		clickhouse,
		{ organizationId: org, userId: null },
		everything,
		now,
	);
	expect(before).toMatchObject({
		sessions: 4,
		current: 2,
		olderIndex: 1,
		notIndexed: 1,
		inventory: null,
	});
	expect(before.line).toContain("on members' machines: unknown");

	await recordSessionInventory(
		clickhouse,
		{ organizationId: org, userId: alice },
		{
			cliVersion: "0.17.0",
			sessions: [
				local("complete", 10, "2026-11-05T11:00:00.000Z"),
				local("behind", 9, "2026-11-05T11:00:00.000Z"),
				local("unextracted", 3, "2026-11-05T11:00:00.000Z"),
				local("never-sent", 5, "2026-11-07T11:59:00.000Z"),
				local("gone-later", 5, "2026-11-05T11:00:00.000Z"),
			],
		},
		{ reportedAt: new Date("2026-11-07T11:59:30.000Z"), ...writable },
	);
	await recordSessionInventory(
		clickhouse,
		{ organizationId: org, userId: alice },
		{
			cliVersion: "0.17.0",
			sessions: [
				local("complete", 10, "2026-11-05T11:00:00.000Z"),
				local("behind", 9, "2026-11-05T11:00:00.000Z"),
				local("unextracted", 3, "2026-11-05T11:00:00.000Z"),
				local("never-sent", 5, "2026-11-07T11:59:00.000Z"),
			],
		},
		{ reportedAt: new Date("2026-11-07T12:00:00.000Z"), ...writable },
	);

	const after = await computeCoverage(
		clickhouse,
		{ organizationId: org, userId: null },
		everything,
		now,
	);
	expect(after.inventory).toEqual({
		membersReporting: 1,
		membersInScope: 2,
		oldestReportAt: "2026-11-07T12:00:00.000Z",
		allRepositories: false,
		onMachines: 4,
		missing: 1,
		partial: 1,
		unchecked: 1,
		live: 1,
		omitted: 0,
	});
	expect(after.line).toBe(
		"coverage: 4 sessions in scope; 2 indexed at current versions, 1 at older versions, 1 not indexed; on members' machines (1 of 2 members reporting, oldest report 0 min ago): 1 not uploaded, 1 partly uploaded (+1 not comparable), 1 live (changed within 15 min of the report)",
	);

	const bobOnly = await computeCoverage(
		clickhouse,
		{ organizationId: org, userId: bob },
		everything,
		now,
	);
	expect(bobOnly).toMatchObject({ sessions: 1, inventory: null });

	await purgeClickHouseRows(
		"rudel.session_inventory",
		"user_id = {userId:String}",
		{ userId: alice },
	);
	expect(
		(
			await computeCoverage(
				clickhouse,
				{ organizationId: org, userId: null },
				everything,
				now,
			)
		).inventory,
	).toBeNull();
});
