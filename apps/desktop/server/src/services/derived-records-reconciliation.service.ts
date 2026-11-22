import { getLogger } from "@logtape/logtape";
import { RAW_SESSION_TABLES } from "@rudel/api-routes";
import type { TranscriptSource } from "@rudel/api-routes/transcript-records";
import {
	type ClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import type { MaintenanceDeadline } from "../lib/bounded-maintenance.js";
import {
	persistGitObservationsBestEffort,
	SESSION_GIT_OBSERVATIONS_TABLE,
} from "./git-observation-extraction.service.js";
import { GIT_OBSERVATION_PARSER_VERSION } from "./git-observation-parser.js";
import { newestGenerations } from "./transcript-generations/generations.js";
import {
	persistTranscriptRecordsBestEffort,
	readTranscriptRecordsExtractionConfig,
	type TranscriptRecordsExtractionConfig,
} from "./transcript-records-extraction.service.js";

/**
 * Repairs derived transcript data that ingest accepted but did not finish.
 *
 * Transcript-record and git-observation extraction are best-effort at ingest:
 * a full queue, a timeout, a crash or a failed receipt lookup leaves the newest
 * raw revision without a current receipt, and nothing would revisit it unless
 * the same content is uploaded again. This sweep finds recently ingested
 * sessions whose newest raw revision has no transcript-records receipt, or
 * whose committed records generation has no git-observation receipt, and
 * extracts them again through the same bounded paths ingest uses.
 *
 * Bounds: sessions ingested in the last `LOOKBACK_DAYS` (and started at most
 * `SESSION_START_SLACK_DAYS` before that), quiet for `SETTLE_MS` so in-flight
 * ingest finishes first; at most `MAX_CENSUS` candidates per source, ordered by
 * a hash that rotates daily so a session that keeps failing cannot block the
 * rest; at most `MAX_SESSIONS` repairs, `MAX_SESSION_BYTES` per session and
 * `MAX_RUN_BYTES` per run, all inside the caller's maintenance deadline. Bytes
 * are the main transcript plus every subagent stream, which is what a repair
 * reads, and both repairs (records, and git observations alone) are charged.
 * Sessions above `MAX_SESSION_BYTES` never enter the census: they are left to
 * the backfills and only counted, so they cannot cost work every day.
 */

const LOOKBACK_DAYS = 14;
const SESSION_START_SLACK_DAYS = 30;
/** Longer than ingest's own extraction deadlines, so this never races it. */
const SETTLE_MS = 15 * 60_000;
const MAX_CENSUS = 200;
const MAX_SESSIONS = 25;
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_RUN_BYTES = 256 * 1024 * 1024;
/** Leave this much of the deadline for the response; never start a repair without it. */
const MIN_REMAINING_MS = 5_000;
const CENSUS_SETTINGS = {
	join_use_nulls: 0,
	max_execution_time: 30,
	max_rows_to_read: "100000000",
	max_bytes_to_read: String(16 * 1024 * 1024 * 1024),
	max_result_rows: String(MAX_CENSUS),
	result_overflow_mode: "throw",
} as const;

const logger = getLogger(["rudel", "api", "derived-records-reconciliation"]);

export interface DerivedRecordsReconciliationOptions {
	/** Deletion fence, awaited before every write. */
	readonly assertWritable: (target: {
		readonly organizationId: string;
		readonly userId: string;
	}) => Promise<void>;
	readonly deadline: MaintenanceDeadline;
	readonly executor?: ClickHouseExecutor;
	readonly config?: TranscriptRecordsExtractionConfig;
	readonly maxSessions?: number;
	/** Overrides `MAX_SESSION_BYTES` (tests). */
	readonly maxSessionBytes?: number;
	/** Overrides `MAX_RUN_BYTES` (tests). */
	readonly maxRunBytes?: number;
	/** Narrows the census (tests and operators). */
	readonly organizationId?: string;
}

export interface DerivedRecordsReconciliationResult {
	readonly candidates: number;
	readonly transcriptRecords: Record<"failed" | "skipped" | "written", number>;
	readonly gitObservations: Record<"failed" | "skipped" | "written", number>;
	/** Sessions needing repair left for the backfill: larger than `MAX_SESSION_BYTES`. */
	readonly oversized: number;
	readonly hasMore: boolean;
}

interface Candidate {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
	readonly source: TranscriptSource;
	readonly revision: string;
	readonly sessionDate: string;
	readonly contentBytes: number;
	/** Newest raw revision has no transcript-records receipt. */
	readonly needsRecords: boolean;
	readonly recordsGeneration: { revision: string; parserVersion: number };
}

interface CensusRow {
	organization_id: string;
	user_id: string;
	session_id: string;
	revision: string;
	session_date: string;
	content_bytes: number | string;
	records_revision: string;
	records_parser_version: number;
	observations_revision: string;
	observations_parser_version: number;
}

export interface RawRow {
	content: string;
	raw_session_date: string;
	subagents: Record<string, string> | null;
}

export async function reconcileDerivedTranscriptRecords(
	options: DerivedRecordsReconciliationOptions,
): Promise<DerivedRecordsReconciliationResult> {
	const executor = options.executor ?? getClickhouse();
	const config = options.config ?? readTranscriptRecordsExtractionConfig();
	const gitEnabled = process.env.GIT_OBSERVATION_EXTRACTION_ENABLED !== "false";
	const now = options.deadline.now();
	const maxSessionBytes = options.maxSessionBytes ?? MAX_SESSION_BYTES;
	const maxRunBytes = options.maxRunBytes ?? MAX_RUN_BYTES;
	const census = { ...options, maxSessionBytes };
	const [claude, codex, oversizedClaude, oversizedCodex] = await Promise.all([
		listCandidates(executor, "claude_code", now, census),
		listCandidates(executor, "codex", now, census),
		countOversizedCandidates(executor, "claude_code", now, census),
		countOversizedCandidates(executor, "codex", now, census),
	]);
	const candidates = interleave(claude, codex).filter(
		(candidate) =>
			(candidate.needsRecords && config.enabled) ||
			(!candidate.needsRecords && gitEnabled),
	);
	const result = {
		candidates: candidates.length,
		transcriptRecords: { failed: 0, skipped: 0, written: 0 },
		gitObservations: { failed: 0, skipped: 0, written: 0 },
		oversized: oversizedClaude + oversizedCodex,
		hasMore: claude.length >= MAX_CENSUS || codex.length >= MAX_CENSUS,
	};
	const maxSessions = options.maxSessions ?? MAX_SESSIONS;
	let repaired = 0;
	let runBytes = 0;
	for (const candidate of candidates) {
		const remaining = options.deadline.deadlineAt - options.deadline.now();
		if (repaired >= maxSessions || remaining < MIN_REMAINING_MS) {
			result.hasMore = true;
			break;
		}
		const assertWritable = () => options.assertWritable(candidate);
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(new Error("Reconciliation deadline reached")),
			remaining - MIN_REMAINING_MS,
		);
		try {
			// Checked before either repair: the census already excludes these.
			if (candidate.contentBytes > maxSessionBytes) {
				result.oversized++;
				continue;
			}
			if (runBytes + candidate.contentBytes > maxRunBytes) {
				result.hasMore = true;
				break;
			}
			runBytes += candidate.contentBytes;
			repaired++;
			if (!candidate.needsRecords) {
				const outcome = await persistGitObservationsBestEffort(executor, {
					...candidate,
					assertWritable,
					deadlineAt: options.deadline.deadlineAt - MIN_REMAINING_MS,
					expectedGeneration: candidate.recordsGeneration,
					signal: controller.signal,
				});
				result.gitObservations[outcome]++;
				continue;
			}
			const raw = await readRawRevision(executor, candidate, controller.signal);
			if (raw === undefined) {
				// A newer revision replaced it since the census; the next run sees that one.
				result.transcriptRecords.skipped++;
				continue;
			}
			const outcome = await persistTranscriptRecordsBestEffort(executor, {
				assertWritable,
				config: {
					...config,
					timeoutMs: Math.min(config.timeoutMs, remaining - MIN_REMAINING_MS),
				},
				content: raw.content,
				organizationId: candidate.organizationId,
				revision: candidate.revision,
				sessionDate: toIsoUtc(raw.raw_session_date),
				sessionId: candidate.sessionId,
				signal: controller.signal,
				source: candidate.source,
				subagents: raw.subagents ?? {},
				userId: candidate.userId,
			});
			result.transcriptRecords[outcome]++;
		} catch (error) {
			// One session must not stop the sweep; the next run retries it.
			result.transcriptRecords.failed += candidate.needsRecords ? 1 : 0;
			result.gitObservations.failed += candidate.needsRecords ? 0 : 1;
			logger.warn(
				"Derived transcript data reconciliation failed for a session (organization_id={organizationId} session_id={sessionId} error={error})",
				{
					error: error instanceof Error ? error.message : String(error),
					organizationId: candidate.organizationId,
					sessionId: candidate.sessionId,
				},
			);
		} finally {
			clearTimeout(timer);
		}
	}
	return result;
}

/**
 * Recently ingested sessions of one source whose newest raw revision has no
 * transcript-records receipt, or whose committed records generation has no
 * git-observation receipt for the current extractor, up to the session cap.
 */
async function listCandidates(
	executor: ClickHouseExecutor,
	source: TranscriptSource,
	now: number,
	options: CensusOptions,
): Promise<Candidate[]> {
	const census = buildCensus(source, now, options);
	const rows = await executor.query<CensusRow>({
		clickhouse_settings: CENSUS_SETTINGS,
		query: `${census.query}
				AND raw.content_bytes <= {maxSessionBytes:UInt64}
			ORDER BY cityHash64(raw.session_id, {seed:String})
			LIMIT {limit:UInt32}`,
		query_params: census.params,
	});
	return rows.map((row) => ({
		contentBytes: Number(row.content_bytes),
		needsRecords: BigInt(row.records_revision || "0") < BigInt(row.revision),
		organizationId: row.organization_id,
		recordsGeneration: {
			parserVersion: Number(row.records_parser_version),
			revision: row.records_revision,
		},
		revision: row.revision,
		sessionDate: row.session_date,
		sessionId: row.session_id,
		source,
		userId: row.user_id,
	}));
}

/** Sessions the census would select but for the session cap (backfill-only). */
async function countOversizedCandidates(
	executor: ClickHouseExecutor,
	source: TranscriptSource,
	now: number,
	options: CensusOptions,
): Promise<number> {
	const census = buildCensus(source, now, options);
	const [row] = await executor.query<{ oversized: number | string }>({
		clickhouse_settings: { ...CENSUS_SETTINGS, max_result_rows: "1" },
		query: `SELECT count() AS oversized FROM (${census.query}
				AND raw.content_bytes > {maxSessionBytes:UInt64})`,
		query_params: census.params,
	});
	return Number(row?.oversized ?? 0);
}

interface CensusOptions
	extends Pick<DerivedRecordsReconciliationOptions, "organizationId"> {
	readonly maxSessionBytes: number;
}

/**
 * The census without its size filter, order and limit. `content_bytes` is the
 * main transcript plus every subagent stream (from the size subcolumns, so the
 * strings are not read): what a repair reads and extracts.
 */
function buildCensus(
	source: TranscriptSource,
	now: number,
	options: CensusOptions,
): { query: string; params: Record<string, number | string> } {
	const rawTable = getSafeClickHouseTable(RAW_SESSION_TABLES[source]);
	const sessionBytes =
		source !== "codex"
			? "length(content) + arraySum(subagents.values.size)"
			: "length(content)";
	const organizationFilter =
		options.organizationId === undefined
			? ""
			: "AND organization_id = {organizationId:String}";
	const identities =
		"(organization_id, user_id, session_id) IN (SELECT organization_id, user_id, session_id FROM raw)";
	return {
		query: `WITH raw AS (
				SELECT organization_id, user_id, session_id,
					max(revision) AS raw_revision,
					argMax(session_date, revision) AS raw_session_date,
					argMax(${sessionBytes}, revision) AS content_bytes,
					max(ingested_at) AS last_ingested_at
				FROM ${rawTable}
				WHERE ingested_at >= fromUnixTimestamp64Milli({since:Int64}, 'UTC')
					AND session_date >= fromUnixTimestamp64Milli({startedSince:Int64}, 'UTC')
					${organizationFilter}
				GROUP BY organization_id, user_id, session_id
				HAVING last_ingested_at <= fromUnixTimestamp64Milli({settledBefore:Int64}, 'UTC')
			),
			records AS (
				${newestGenerations({ and: `AND source = {source:String} AND ${identities}` })}
			),
			observations AS (
				${newestGenerations({ table: SESSION_GIT_OBSERVATIONS_TABLE, and: `AND source = {source:String} AND ${identities}` })}
			)
			SELECT raw.organization_id AS organization_id, raw.user_id AS user_id, raw.session_id AS session_id,
				toString(raw.raw_revision) AS revision, toString(raw.raw_session_date) AS session_date,
				raw.content_bytes AS content_bytes,
				toString(records.generation.1) AS records_revision, records.generation.2 AS records_parser_version,
				toString(observations.generation.1) AS observations_revision, observations.generation.2 AS observations_parser_version
			FROM raw
			LEFT JOIN records ON raw.organization_id = records.organization_id AND raw.user_id = records.user_id AND raw.session_id = records.session_id
			LEFT JOIN observations ON raw.organization_id = observations.organization_id AND raw.user_id = observations.user_id AND raw.session_id = observations.session_id
			WHERE (records.generation.1 < raw.raw_revision
				OR observations.generation < tuple(records.generation.1, ${GIT_OBSERVATION_PARSER_VERSION * 256} + records.generation.2))`,
		params: {
			limit: MAX_CENSUS,
			maxSessionBytes: options.maxSessionBytes,
			organizationId: options.organizationId ?? "",
			seed: new Date(now).toISOString().slice(0, 10),
			settledBefore: now - SETTLE_MS,
			since: now - LOOKBACK_DAYS * 86_400_000,
			source,
			startedSince:
				now - (LOOKBACK_DAYS + SESSION_START_SLACK_DAYS) * 86_400_000,
		},
	};
}

export async function readRawRevision(
	executor: ClickHouseExecutor,
	candidate: Pick<
		Candidate,
		| "organizationId"
		| "userId"
		| "sessionId"
		| "source"
		| "revision"
		| "sessionDate"
	>,
	signal: AbortSignal,
): Promise<RawRow | undefined> {
	const table = getSafeClickHouseTable(RAW_SESSION_TABLES[candidate.source]);
	const subagents =
		candidate.source !== "codex"
			? "subagents"
			: "CAST(map(), 'Map(String, String)') AS subagents";
	const [row] = await executor.query<RawRow>({
		abortSignal: signal,
		clickhouse_settings: {
			max_execution_time: 60,
			max_bytes_to_read: String(4 * MAX_SESSION_BYTES),
			max_result_bytes: String(4 * MAX_SESSION_BYTES),
			result_overflow_mode: "throw",
		},
		query: `SELECT content, ${subagents}, toString(session_date) AS raw_session_date
			FROM ${table}
			WHERE organization_id = {organizationId:String}
				AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
				AND session_id = {sessionId:String} AND user_id = {userId:String}
				AND revision = {revision:UInt64}
			LIMIT 1`,
		query_params: {
			organizationId: candidate.organizationId,
			revision: candidate.revision,
			sessionDate: candidate.sessionDate,
			sessionId: candidate.sessionId,
			userId: candidate.userId,
		},
	});
	return row;
}

/** Alternates sources so one source's backlog cannot crowd out the other. */
function interleave<T>(left: readonly T[], right: readonly T[]): T[] {
	const merged: T[] = [];
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const a = left[index];
		const b = right[index];
		if (a !== undefined) merged.push(a);
		if (b !== undefined) merged.push(b);
	}
	return merged;
}

/** ClickHouse `toString(DateTime64)` output, read as UTC. */
export function toIsoUtc(value: string): string {
	return new Date(`${value.replace(" ", "T")}Z`).toISOString();
}
