import { ORPCError } from "@orpc/server";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query, records } from "./sql.js";

/**
 * A record by the id its line carries in the raw transcript (Claude Code's
 * `uuid` on each JSONL line, `transcript_records.record_uuid` from parser 12):
 * where it is among the workspace's committed transcript generations. The
 * run tool opens a record by it (`run` with the id), so an agent never has
 * to search the raw transcript files for the line.
 */

/** A record id as Claude Code writes it: a UUID. */
const RECORD_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Most places one id is reported in: a resumed or forked session repeats its parent's lines. */
export const RECORD_UUID_MAX_HITS = 10;

export function isRecordUuid(id: string): boolean {
	return RECORD_UUID.test(id);
}

/** Where a record id is: the session, the stream, the line and its run number. */
export interface RecordUuidHit {
	readonly userId: string;
	readonly source: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly recordIdx: number;
	/** The first block of the line; every block of a line carries its id. */
	readonly blockIdx: number;
	/** Run number within the stream; 0 before its first prompt. */
	readonly turnIdx: number;
}

const HitRowSchema = z
	.object({
		user_id: z.string(),
		source: z.string(),
		session_id: z.string(),
		agent_id: z.string(),
		record_idx: z.number(),
		block_idx: z.number(),
		turn_idx: z.number(),
	})
	.transform(
		(row): RecordUuidHit => ({
			userId: row.user_id,
			source: row.source,
			sessionId: row.session_id,
			agentId: row.agent_id,
			recordIdx: row.record_idx,
			blockIdx: row.block_idx,
			turnIdx: row.turn_idx,
		}),
	);

/**
 * The lines that carry the id in the workspace, each session pinned to its
 * committed generation (newest receipt by revision, then parser version),
 * oldest session first. Both reads of `record_uuid` stay inside the
 * workspace's key range and skip granules by the `record_uuid_bloom` index;
 * the receipts are read by key for the few sessions that hold the id. The
 * caller checks who may read each session.
 */
export function buildRecordUuidLookupStatement(
	workspaceId: string,
	uuid: string,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH committed AS (
				SELECT user_id, session_id, revision, parser_version FROM ${records()}
				WHERE organization_id = {organizationId:String}
					AND (user_id, session_id) IN (
						SELECT user_id, session_id FROM ${records()}
						WHERE organization_id = {organizationId:String} AND record_uuid IN {uuids:Array(String)})
					AND agent_id = '' AND record_idx = {receipt:UInt32} AND block_idx = 0
				ORDER BY user_id, session_id, revision DESC, parser_version DESC
				LIMIT 1 BY user_id, session_id
			)
			SELECT user_id, toString(source) AS source, session_id, agent_id, record_idx,
				min(block_idx) AS block_idx, min(turn_idx) AS turn_idx
			FROM ${records()}
			WHERE organization_id = {organizationId:String} AND record_uuid IN {uuids:Array(String)}
				AND (user_id, session_id, revision, parser_version) IN (SELECT user_id, session_id, revision, parser_version FROM committed)
				AND record_idx < {receipt:UInt32}
			GROUP BY user_id, source, session_id, agent_id, record_idx
			ORDER BY min(session_date), min(ts), session_id, agent_id, record_idx
			LIMIT {limit:UInt32}`,
		query_params: {
			organizationId: workspaceId,
			// Claude Code writes lowercase; an id copied in upper case still matches.
			uuids: [...new Set([uuid, uuid.toLowerCase()])],
			receipt: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
			limit: RECORD_UUID_MAX_HITS,
		},
	};
}

/**
 * The places of a record id in the sessions the caller may read, oldest
 * session first. `ownerOf` refuses (NOT_FOUND, FORBIDDEN) a session the
 * caller may not read; such a session is left out as if the id were not in
 * it, so the answer never tells whether it exists there.
 */
export async function findRecordsByUuid(
	executor: ClickHouseExecutor,
	workspaceId: string,
	uuid: string,
	ownerOf: (sessionId: string) => Promise<string>,
): Promise<RecordUuidHit[]> {
	const hits = await query(
		executor,
		HitRowSchema,
		buildRecordUuidLookupStatement(workspaceId, uuid),
	);
	const readable = new Map<string, boolean>();
	const visible: RecordUuidHit[] = [];
	for (const hit of hits) {
		const key = JSON.stringify([hit.userId, hit.sessionId]);
		let may = readable.get(key);
		if (may === undefined) {
			may = await readableBy(ownerOf, hit);
			readable.set(key, may);
		}
		if (may) visible.push(hit);
	}
	return visible;
}

async function readableBy(
	ownerOf: (sessionId: string) => Promise<string>,
	hit: RecordUuidHit,
): Promise<boolean> {
	try {
		return (await ownerOf(hit.sessionId)) === hit.userId;
	} catch (error) {
		if (
			error instanceof ORPCError &&
			(error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
		)
			return false;
		throw error;
	}
}

/** The refusal when no readable session has the id. */
export function recordUuidNotFound(uuid: string): ORPCError<string, unknown> {
	return new ORPCError("NOT_FOUND", {
		message: `No record with id ${uuid} in the sessions you may read. Sessions indexed before transcript parser 12 keep no record ids, so for them it is unknown, not missing: find the record with sql or search instead.`,
	});
}

/** How a hit is named: `r<record>`, or `r<record>.<block>` past block 0, as the run view names records. */
export function recordUuidExpandId(hit: RecordUuidHit): string {
	return hit.blockIdx === 0
		? `r${hit.recordIdx}`
		: `r${hit.recordIdx}.${hit.blockIdx}`;
}

/** One line for a hit: its session, stream, record and run number. */
export function describeRecordUuidHit(hit: RecordUuidHit): string {
	const stream = hit.agentId === "" ? "main" : `subagent ${hit.agentId}`;
	const run = hit.turnIdx === 0 ? "before the first run" : `run ${hit.turnIdx}`;
	return `session ${hit.sessionId} stream ${stream} ${recordUuidExpandId(hit)} ${run}`;
}
