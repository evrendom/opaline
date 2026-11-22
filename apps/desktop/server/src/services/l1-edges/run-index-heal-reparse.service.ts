import { RAW_SESSION_TABLES } from "@rudel/api-routes";
import type { TranscriptSource } from "@rudel/api-routes/transcript-records";
import type postgres from "postgres";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import { assertNoClickHousePurgeTombstone } from "../clickhouse-purge-tombstone.service.js";
import {
	readRawRevision,
	toIsoUtc,
} from "../derived-records-reconciliation.service.js";
import {
	persistTranscriptRecordsBestEffort,
	readTranscriptRecordsExtractionConfig,
	type TranscriptRecordsExtractionConfig,
} from "../transcript-records-extraction.service.js";
import { enqueueSessionEdgesBestEffort } from "./l1-edge-enqueue.js";
import type {
	HealRow,
	ReparseOutcome,
	Reparser,
} from "./run-index-heal.service.js";

export const REPARSE_MAX_SESSION_BYTES = 64 * 1024 * 1024;
export const REPARSE_MAX_RUN_BYTES = 256 * 1024 * 1024;
const MIN_REMAINING_MS = 15_000;
const PROBE_SETTINGS = {
	readonly: "2",
	max_execution_time: 30,
	max_rows_to_read: "10000000",
	max_result_rows: "1",
	result_overflow_mode: "throw",
} as const;

export function createReparser(options: {
	readonly executor: ClickHouseExecutor;
	readonly sql: postgres.Sql;
	readonly config?: TranscriptRecordsExtractionConfig;
	readonly maxSessionBytes?: number;
	readonly maxRunBytes?: number;
}): Reparser {
	const { executor, sql } = options;
	const config = options.config ?? readTranscriptRecordsExtractionConfig();
	const maxSessionBytes = options.maxSessionBytes ?? REPARSE_MAX_SESSION_BYTES;
	const maxRunBytes = options.maxRunBytes ?? REPARSE_MAX_RUN_BYTES;
	return {
		async reparse(row, context) {
			if (!config.enabled) return { outcome: "failed", bytes: 0 };
			const remaining = context.deadline.deadlineAt - context.deadline.now();
			if (remaining < 2 * MIN_REMAINING_MS)
				return { outcome: "deferred", bytes: 0 };
			const controller = new AbortController();
			const timer = setTimeout(
				() => controller.abort(new Error("Run index heal deadline reached")),
				remaining - MIN_REMAINING_MS,
			);
			try {
				return await reparseOne(row, {
					context,
					controller,
					remaining,
				});
			} catch {
				return { outcome: "failed", bytes: 0 };
			} finally {
				clearTimeout(timer);
			}
		},
	};

	async function reparseOne(
		row: HealRow,
		input: {
			readonly context: {
				readonly deadline: MaintenanceDeadline;
				runBytes: number;
			};
			readonly controller: AbortController;
			readonly remaining: number;
		},
	): Promise<{ outcome: ReparseOutcome; bytes: number }> {
		const target = {
			organizationId: row.organization_id,
			userId: row.user_id,
			sessionId: row.session_id,
			source: row.source as TranscriptSource,
			revision: row.revision_text,
			sessionDate: row.session_date,
		};
		const bytes = await readRawBytes(executor, target, input.controller.signal);
		if (bytes === null) return { outcome: "missing", bytes: 0 };
		if (bytes > maxSessionBytes) return { outcome: "oversized", bytes: 0 };
		if (input.context.runBytes + bytes > maxRunBytes)
			return { outcome: "deferred", bytes: 0 };
		const raw = await readRawRevision(
			executor,
			target,
			input.controller.signal,
		);
		if (raw === undefined) return { outcome: "missing", bytes: 0 };
		const outcome = await persistTranscriptRecordsBestEffort(executor, {
			assertWritable: () =>
				assertNoClickHousePurgeTombstone(
					{ organizationId: target.organizationId, userId: target.userId },
					{ database: sql },
				),
			config: {
				...config,
				timeoutMs: Math.min(
					config.timeoutMs,
					input.remaining - MIN_REMAINING_MS,
				),
			},
			content: raw.content,
			onWritten: (session) =>
				enqueueSessionEdgesBestEffort(session, { priority: 1 }),
			organizationId: target.organizationId,
			revision: target.revision,
			sessionDate: toIsoUtc(raw.raw_session_date),
			sessionId: target.sessionId,
			signal: input.controller.signal,
			source: target.source,
			subagents: raw.subagents ?? {},
			userId: target.userId,
		});
		return {
			outcome: outcome === "skipped" ? "deferred" : outcome,
			bytes,
		};
	}
}

async function readRawBytes(
	executor: ClickHouseExecutor,
	target: {
		readonly organizationId: string;
		readonly userId: string;
		readonly sessionId: string;
		readonly source: TranscriptSource;
		readonly revision: string;
		readonly sessionDate: string;
	},
	signal: AbortSignal,
): Promise<number | null> {
	const claude = target.source !== "codex";
	const [row] = await executor.query<{ content_bytes: number | string }>({
		abortSignal: signal,
		clickhouse_settings: PROBE_SETTINGS,
		query: `SELECT ${claude ? "length(content) + arraySum(subagents.values.size)" : "length(content)"} AS content_bytes
			FROM ${getSafeClickHouseTable(RAW_SESSION_TABLES[target.source])}
			WHERE organization_id = {organizationId:String}
				AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
				AND session_id = {sessionId:String} AND user_id = {userId:String}
				AND revision = {revision:UInt64}
			LIMIT 1`,
		query_params: {
			organizationId: target.organizationId,
			revision: target.revision,
			sessionDate: target.sessionDate,
			sessionId: target.sessionId,
			userId: target.userId,
		},
	});
	return row === undefined ? null : Number(row.content_bytes);
}
