import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { RUN_INDEX_VERSION } from "./analysis/run-index-sql.js";
import {
	backfillContextSnapshots,
	buildContextSnapshotCandidatesStatement,
	readContextSnapshotBackfillSkippedOrgIds,
} from "./context-snapshot-backfill.service.js";

const candidates = [
	{ organization_id: "org-a", user_id: "u1", session_id: "s1" },
	{ organization_id: "org-gone", user_id: "u2", session_id: "s2" },
	{ organization_id: "org-a", user_id: "u1", session_id: "s3" },
];

function executor(rows: unknown[] = candidates) {
	return {
		query: async () => rows,
		insert: async () => {},
		execute: async () => {},
		close: async () => {},
	} as unknown as ClickHouseExecutor;
}

function database(purged: Set<string>) {
	return {
		unsafe: async (_query: string, params: string[]) =>
			purged.has(params[1] ?? "") ? [{ found: 1 }] : [],
	} as unknown as postgres.Sql;
}

describe("context snapshot backfill", () => {
	test("writes the missing snapshots and skips workspaces being purged", async () => {
		const written: string[] = [];
		const result = await backfillContextSnapshots({
			executor: executor(),
			sql: database(new Set(["org-gone"])),
			write: async (_executor, session, _now, beforeWrite) => {
				await beforeWrite?.();
				written.push(session.sessionId);
				return true;
			},
		});
		expect(written).toEqual(["s1", "s3"]);
		expect(result).toEqual({ candidates: 3, written: 2 });
	});

	test("stops at its budget", async () => {
		let clock = 0;
		const written: string[] = [];
		await backfillContextSnapshots({
			executor: executor(),
			sql: database(new Set()),
			budgetMs: 1_000,
			now: () => clock,
			write: async (_executor, session) => {
				written.push(session.sessionId);
				clock += 1_000;
				return true;
			},
		});
		expect(written).toEqual(["s1"]);
	});

	test("one failing session does not stop the rest, and a purge that starts mid-write wins", async () => {
		const purged = new Set<string>();
		const written: string[] = [];
		const result = await backfillContextSnapshots({
			executor: executor(),
			sql: database(purged),
			write: async (_executor, session, _now, beforeWrite) => {
				if (session.sessionId === "s1") throw new Error("no transcript");
				if (session.sessionId === "s2") purged.add("org-gone");
				await beforeWrite?.();
				written.push(session.sessionId);
				return true;
			},
		});
		expect(written).toEqual(["s3"]);
		expect(result.written).toBe(1);
	});

	test("asks for recent sessions first and leaves skipped workspaces out", () => {
		const statement = buildContextSnapshotCandidatesStatement({
			skippedOrganizationIds: ["internal"],
			limit: 40,
		});
		expect(statement.query).toContain("LEFT ANTI JOIN");
		expect(statement.query).toContain("rudel.session_context_snapshots");
		expect(statement.query).toContain(
			"organization_id NOT IN {skipped:Array(String)}",
		);
		expect(statement.query).toMatch(
			/ORDER BY r\.started >= now\(\) - INTERVAL 30 DAY DESC/u,
		);
		expect(statement.query_params).toEqual({
			skipped: ["internal"],
			limit: 40,
			indexVersion: RUN_INDEX_VERSION,
		});
		expect(statement.query).toContain(
			"WHERE index_version >= {indexVersion:UInt16}",
		);
		expect(
			readContextSnapshotBackfillSkippedOrgIds({
				CONTEXT_SNAPSHOT_BACKFILL_SKIP_ORG_IDS: " a, b, a ,",
			}),
		).toEqual(["a", "b"]);
	});
});
