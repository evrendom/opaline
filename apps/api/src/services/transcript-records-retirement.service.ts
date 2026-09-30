import {
	decodeTranscriptRecordsReceipt,
	TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
} from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { MaintenanceDeadline } from "../lib/bounded-maintenance.js";
import { createTranscriptRecordsDeadline } from "./transcript-records-deadline.js";
import {
	MAX_RETIRED_GENERATIONS_PER_PASS,
	retireSupersededTranscriptRecordsGenerations,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
	TRANSCRIPT_RECORDS_TABLE,
} from "./transcript-records-ingest.service.js";

const MAX_SESSIONS_PER_PASS = 10;
const PASS_TIMEOUT_MS = 10_000;

interface RetirementSessionRow {
	organization_id: string;
	user_id: string;
	session_id: string;
	revision_text: string;
	parser_version: number;
	receipt_head: string;
}

export async function runTranscriptRecordsRetirementPass(
	options: {
		readonly executor?: ClickHouseExecutor;
		readonly deadline?: MaintenanceDeadline;
		readonly maxSessions?: number;
		readonly organizationId?: string;
	} = {},
) {
	const executor = options.executor ?? getClickhouse();
	const now = options.deadline?.now ?? Date.now;
	const startedAt = now();
	const maxSessions = options.maxSessions ?? MAX_SESSIONS_PER_PASS;
	if (
		!Number.isSafeInteger(maxSessions) ||
		maxSessions < 1 ||
		maxSessions > MAX_SESSIONS_PER_PASS
	) {
		throw new Error(
			`maxSessions must be between 1 and ${MAX_SESSIONS_PER_PASS}`,
		);
	}
	const deadline = createTranscriptRecordsDeadline({
		deadlineAt: Math.min(
			options.deadline?.deadlineAt ?? Infinity,
			startedAt + PASS_TIMEOUT_MS,
		),
		now,
		signal: undefined,
	});
	try {
		const sessions = await deadline.wait(() =>
			executor.query<RetirementSessionRow>({
				abortSignal: deadline.signal,
				clickhouse_settings: {
					max_bytes_to_read: String(2 * 1024 * 1024 * 1024),
					max_execution_time: 10,
					max_rows_to_read: "10000000",
					result_overflow_mode: "throw",
				},
				query: `
				SELECT organization_id, user_id, session_id,
					toString(newest_generation.1) AS revision_text,
					newest_generation.2 AS parser_version, receipt_head
				FROM (
				SELECT organization_id, user_id, session_id,
					max((revision, parser_version)) AS newest_generation,
					argMax(head, (revision, parser_version, JSONExtractString(head, 'publishedAt'))) AS receipt_head
				FROM ${getSafeClickHouseTable(TRANSCRIPT_RECORDS_TABLE)}
				WHERE agent_id = ''
					AND record_idx = {receiptRecordIdx:UInt32}
					AND block_idx = 0 AND kind = 'receipt'
					${options.organizationId === undefined ? "" : "AND organization_id = {organizationId:String}"}
				GROUP BY organization_id, user_id, session_id
				HAVING uniqExact((revision, parser_version)) > 1
					AND parseDateTime64BestEffortOrNull(JSONExtractString(receipt_head, 'publishedAt'), 3, 'UTC')
						<= fromUnixTimestamp64Milli({retireBefore:Int64}, 'UTC')
				)
				ORDER BY organization_id, user_id, session_id
				LIMIT {maxSessions:UInt32}
			`,
				query_params: {
					maxSessions,
					organizationId: options.organizationId,
					receiptRecordIdx: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
					retireBefore: startedAt - TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
				},
			}),
		);
		let generationsRetired = 0;
		let hasMore = sessions.length === maxSessions;
		for (const session of sessions) {
			const receipt = decodeTranscriptRecordsReceipt(session.receipt_head);
			if (receipt === undefined) continue;
			const retired = await deadline.wait(() =>
				retireSupersededTranscriptRecordsGenerations(
					executor,
					{
						organizationId: session.organization_id,
						sessionId: session.session_id,
						userId: session.user_id,
					},
					{
						abortSignal: deadline.signal,
						graceMs: TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
						now: new Date(startedAt),
						published: {
							revision: session.revision_text,
							parserVersion: session.parser_version,
						},
						publishedAtMs: Date.parse(receipt.publishedAt),
					},
				),
			);
			generationsRetired += retired;
			hasMore ||= retired === MAX_RETIRED_GENERATIONS_PER_PASS;
		}
		return {
			generationsRetired,
			hasMore,
			sessionsProcessed: sessions.length,
		};
	} finally {
		deadline.dispose();
	}
}
