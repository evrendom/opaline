import type { TranscriptSource } from "@rudel/api-routes/transcript-records";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { extractGitObservations } from "./git-observation-extraction.service.js";
import { gitObservationGenerationVersion } from "./git-observation-parser.js";

export interface GitObservationBackfillOptions {
	cutoff: Date;
	maxSessions: number;
	organizationId?: string;
	signal?: AbortSignal;
	assertWritable: (target: {
		organizationId: string;
		userId: string;
	}) => Promise<void>;
}

interface Candidate {
	organization_id: string;
	user_id: string;
	source: TranscriptSource;
	session_id: string;
	revision: string;
	parser_version: number;
	observation_revision: string;
	observation_parser_version: number;
}

export async function backfillGitObservations(
	executor: ClickHouseExecutor,
	options: GitObservationBackfillOptions,
	execute = false,
) {
	if (
		!Number.isFinite(options.cutoff.getTime()) ||
		!Number.isSafeInteger(options.maxSessions) ||
		options.maxSessions < 1 ||
		options.maxSessions > 100_000
	)
		throw new Error("Invalid bounded git observation backfill options");
	if (execute && process.env.GIT_OBSERVATION_EXTRACTION_ENABLED === "false")
		throw new Error("Git observation extraction is disabled");
	const cutoff = options.cutoff.toISOString();
	const candidates = await executor.query<Candidate>({
		abortSignal: options.signal,
		clickhouse_settings: {
			max_execution_time: 60,
			timeout_before_checking_execution_speed: 0,
			max_rows_to_read: "10000000",
			max_bytes_to_read: String(512 * 1024 * 1024),
			max_result_bytes: String(32 * 1024 * 1024),
			result_overflow_mode: "throw",
		},
		query: `WITH records AS (
			SELECT organization_id, user_id, source, session_id,
				max(tuple(revision, parser_version, parseDateTime64BestEffortOrZero(JSONExtractString(head, 'publishedAt'), 3, 'UTC'))) AS generation
			FROM rudel.transcript_records WHERE kind = 'receipt' ${options.organizationId ? "AND organization_id = {organizationId:String}" : ""}
			GROUP BY organization_id, user_id, source, session_id
		), observations AS (
			SELECT organization_id, user_id, source, session_id, max(tuple(revision, parser_version)) AS generation
			FROM rudel.session_git_observations WHERE kind = 'receipt' ${options.organizationId ? "AND organization_id = {organizationId:String}" : ""}
			GROUP BY organization_id, user_id, source, session_id
		)
		SELECT records.organization_id AS organization_id, records.user_id AS user_id, records.source AS source, records.session_id AS session_id,
			toString(records.generation.1) AS revision, records.generation.2 AS parser_version,
			toString(observations.generation.1) AS observation_revision, observations.generation.2 AS observation_parser_version
		FROM records LEFT JOIN observations USING (organization_id, user_id, source, session_id)
		WHERE records.generation.3 > toDateTime64(0, 3, 'UTC') AND records.generation.3 <= parseDateTime64BestEffort({cutoff:String}, 3, 'UTC')
		ORDER BY organization_id, user_id, source, session_id LIMIT {limit:UInt32}`,
		query_params: {
			organizationId: options.organizationId ?? "",
			cutoff,
			limit: options.maxSessions + 1,
		},
	});
	if (candidates.length > options.maxSessions)
		throw new Error(
			"Git observation backfill census cap exceeded; narrow --organization-id or increase --max-sessions",
		);
	const result = {
		status: execute ? "completed" : "preview",
		cutoff,
		sessionCount: candidates.length,
		alreadyCompleteCount: 0,
		wouldWriteCount: 0,
		completedCount: 0,
		skippedCount: 0,
		fencedCount: 0,
		failedCount: 0,
	};
	for (const candidate of candidates) {
		options.signal?.throwIfAborted();
		const parserVersion = gitObservationGenerationVersion(
			candidate.parser_version,
		);
		if (
			BigInt(candidate.observation_revision || "0") >
				BigInt(candidate.revision) ||
			(candidate.observation_revision === candidate.revision &&
				candidate.observation_parser_version >= parserVersion)
		) {
			result.alreadyCompleteCount++;
			continue;
		}
		result.wouldWriteCount++;
		if (!execute) continue;
		try {
			const outcome = await extractGitObservations(executor, {
				organizationId: candidate.organization_id,
				userId: candidate.user_id,
				source: candidate.source,
				sessionId: candidate.session_id,
				signal: options.signal,
				expectedGeneration: {
					revision: candidate.revision,
					parserVersion: candidate.parser_version,
				},
				assertWritable: () =>
					options.assertWritable({
						organizationId: candidate.organization_id,
						userId: candidate.user_id,
					}),
			});
			if (outcome === "written") result.completedCount++;
			else result.skippedCount++;
		} catch (error) {
			options.signal?.throwIfAborted();
			if (error instanceof ClickHouseWriteFencedError) result.fencedCount++;
			else result.failedCount++;
		}
	}
	return result;
}
