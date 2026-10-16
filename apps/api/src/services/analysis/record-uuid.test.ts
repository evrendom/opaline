import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	buildRecordUuidLookupStatement,
	describeRecordUuidHit,
	findRecordsByUuid,
	isRecordUuid,
	RECORD_UUID_MAX_HITS,
	recordUuidExpandId,
	recordUuidNotFound,
} from "./record-uuid.js";

const UUID = "0c5f2b9e-3d41-4a8f-b6e2-7f9d1c3a5e02";
const flat = (sql: string) => sql.replaceAll(/\s+/gu, " ");

describe("record uuid lookup", () => {
	test("a record id is a UUID; run ids and other ids are not", () => {
		expect(isRecordUuid(UUID)).toBe(true);
		expect(isRecordUuid(UUID.toUpperCase())).toBe(true);
		expect(isRecordUuid("user/claude_code/session//4")).toBe(false);
		expect(isRecordUuid(`${UUID}x`)).toBe(false);
		expect(isRecordUuid("toolu_01ABC")).toBe(false);
		expect(isRecordUuid("")).toBe(false);
	});

	test("the statement stays in the workspace, reads only committed generations and binds every value", () => {
		const statement = buildRecordUuidLookupStatement("ws", UUID.toUpperCase());
		const sql = flat(statement.query);
		// Both reads of record_uuid name the workspace, the key prefix the
		// bloom filter index works inside.
		expect(
			sql.match(
				/organization_id = \{organizationId:String\} AND record_uuid IN \{uuids:Array\(String\)\}/gu,
			),
		).toHaveLength(2);
		// Each session's newest receipt pins the generation read.
		expect(sql).toContain(
			"AND agent_id = '' AND record_idx = {receipt:UInt32} AND block_idx = 0 ORDER BY user_id, session_id, revision DESC, parser_version DESC LIMIT 1 BY user_id, session_id",
		);
		expect(sql).toContain(
			"(user_id, session_id, revision, parser_version) IN (SELECT user_id, session_id, revision, parser_version FROM committed)",
		);
		expect(sql).toContain("AND record_idx < {receipt:UInt32}");
		// One row per line, oldest session first.
		expect(sql).toContain(
			"GROUP BY user_id, source, session_id, agent_id, record_idx ORDER BY min(session_date), min(ts), session_id, agent_id, record_idx LIMIT {limit:UInt32}",
		);
		expect(sql).not.toContain(UUID.toLowerCase());
		expect(sql).not.toContain("text");
		expect(statement.query_params).toEqual({
			organizationId: "ws",
			uuids: [UUID.toUpperCase(), UUID],
			receipt: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			limit: RECORD_UUID_MAX_HITS,
		});
		expect(
			buildRecordUuidLookupStatement("ws", UUID).query_params?.uuids,
		).toEqual([UUID]);
		expect(statement.clickhouse_settings?.result_overflow_mode).toBe("throw");
	});

	test("only sessions the caller may read are reported, each checked once", async () => {
		const row = (user: string, session: string, record: number) => ({
			user_id: user,
			source: "claude_code",
			session_id: session,
			agent_id: "",
			record_idx: record,
			block_idx: 0,
			turn_idx: 2,
		});
		const statements: string[] = [];
		const executor = {
			query: async (statement: { query: string }) => {
				statements.push(statement.query);
				return [
					row("u1", "original", 12),
					row("u2", "private", 12),
					row("u1", "gone", 3),
					row("u1", "resumed", 12),
					row("u3", "moved", 12),
				];
			},
		} as unknown as ClickHouseExecutor;
		const asked: string[] = [];
		const hits = await findRecordsByUuid(
			executor,
			"ws",
			UUID,
			async (sessionId) => {
				asked.push(sessionId);
				if (sessionId === "private")
					throw new ORPCError("FORBIDDEN", { message: "own only" });
				if (sessionId === "gone") throw new ORPCError("NOT_FOUND");
				// The session now belongs to another member than the row says.
				if (sessionId === "moved") return "u4";
				return "u1";
			},
		);
		expect(statements).toHaveLength(1);
		expect(asked).toEqual(["original", "private", "gone", "resumed", "moved"]);
		expect(hits.map(describeRecordUuidHit)).toEqual([
			"session original stream main r12 run 2",
			"session resumed stream main r12 run 2",
		]);
	});

	test("other failures of the owner check are not read as no access", async () => {
		const executor = {
			query: async () => [
				{
					user_id: "u1",
					source: "claude_code",
					session_id: "s",
					agent_id: "",
					record_idx: 1,
					block_idx: 0,
					turn_idx: 1,
				},
			],
		} as unknown as ClickHouseExecutor;
		await expect(
			findRecordsByUuid(executor, "ws", UUID, async () => {
				throw new Error("postgres is down");
			}),
		).rejects.toThrow("postgres is down");
	});

	test("hits read as the run view names records; the refusal says older sessions are unknown", () => {
		const hit = {
			userId: "u",
			source: "claude_code",
			sessionId: "s",
			agentId: "a1b2",
			recordIdx: 40,
			blockIdx: 1,
			turnIdx: 0,
		};
		expect(recordUuidExpandId(hit)).toBe("r40.1");
		expect(recordUuidExpandId({ ...hit, blockIdx: 0 })).toBe("r40");
		expect(describeRecordUuidHit(hit)).toBe(
			"session s stream subagent a1b2 r40.1 before the first run",
		);
		const refusal = recordUuidNotFound(UUID);
		expect(refusal.code).toBe("NOT_FOUND");
		expect(refusal.message).toContain("unknown, not missing");
	});
});
