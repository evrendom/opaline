import { parseArgs } from "node:util";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge.service.js";
import {
	backfillTranscriptRecords,
	previewTranscriptRecordsBackfill,
	type TranscriptRecordsBackfillOptions,
} from "../services/transcript-records-backfill.service.js";

const DEFAULT_MAX_SESSIONS = readPositiveSafeIntegerEnv(
	"TRANSCRIPT_RECORDS_BACKFILL_MAX_SESSIONS",
	10_000,
);
const DEFAULT_MAX_ROWS = readPositiveSafeIntegerEnv(
	"TRANSCRIPT_RECORDS_MAX_ROWS",
	1_000_000,
);
const DEFAULT_SESSION_TIMEOUT_MS = readPositiveSafeIntegerEnv(
	"TRANSCRIPT_RECORDS_TIMEOUT_MS",
	120_000,
);
const DEFAULT_MAX_SESSION_BYTES = readPositiveSafeIntegerEnv(
	"TRANSCRIPT_RECORDS_BACKFILL_MAX_SESSION_BYTES",
	512 * 1024 * 1024,
);
const DEFAULT_BATCH_MAX_ROWS = readPositiveSafeIntegerEnv(
	"TRANSCRIPT_RECORDS_BACKFILL_BATCH_MAX_ROWS",
	64,
);
const DEFAULT_BATCH_MAX_BYTES = readPositiveSafeIntegerEnv(
	"TRANSCRIPT_RECORDS_BACKFILL_BATCH_MAX_BYTES",
	128 * 1024 * 1024,
);
const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		"batch-max-bytes": { type: "string" },
		"batch-max-rows": { type: "string" },
		cutoff: { type: "string" },
		execute: { default: false, type: "boolean" },
		"max-rows": { type: "string" },
		"max-session-bytes": { type: "string" },
		"max-sessions": { type: "string" },
		"organization-id": { type: "string" },
		"session-timeout-ms": { type: "string" },
	},
	strict: true,
});

if (values.execute && !values.cutoff) {
	throw new Error(
		"Execution requires the exact --cutoff value printed by a prior preview.",
	);
}

const options: TranscriptRecordsBackfillOptions = {
	// The deletion fence reads Postgres, so PG_CONNECTION_STRING is required.
	assertWritable: (target) => assertNoClickHousePurgeTombstone(target),
	batchMaxBytes: parsePositiveInteger(
		values["batch-max-bytes"],
		DEFAULT_BATCH_MAX_BYTES,
		"--batch-max-bytes",
	),
	batchMaxRows: parsePositiveInteger(
		values["batch-max-rows"],
		DEFAULT_BATCH_MAX_ROWS,
		"--batch-max-rows",
	),
	cutoff: values.cutoff ? new Date(values.cutoff) : new Date(),
	maxRows: parsePositiveInteger(
		values["max-rows"],
		DEFAULT_MAX_ROWS,
		"--max-rows",
	),
	maxSessionBytes: parsePositiveInteger(
		values["max-session-bytes"],
		DEFAULT_MAX_SESSION_BYTES,
		"--max-session-bytes",
	),
	maxSessions: parsePositiveInteger(
		values["max-sessions"],
		DEFAULT_MAX_SESSIONS,
		"--max-sessions",
	),
	onProgress(progress) {
		console.error(
			`transcript records backfill progress: ${progress.processedCandidateCount}/${progress.totalCandidateCount} sessions (${progress.completedBatchCount}/${progress.batchCount} batches)`,
		);
	},
	organizationId: values["organization-id"],
	sessionTimeoutMs: parsePositiveInteger(
		values["session-timeout-ms"],
		DEFAULT_SESSION_TIMEOUT_MS,
		"--session-timeout-ms",
	),
};
const executor = getClickhouse();

try {
	const result = values.execute
		? await backfillTranscriptRecords(executor, options)
		: await previewTranscriptRecordsBackfill(executor, options);
	console.log(JSON.stringify(result, null, 2));
	if (result.failedCount > 0) process.exitCode = 2;
} finally {
	await executor.close();
	await sqlClient.end();
}

function parsePositiveInteger(
	value: string | undefined,
	fallback: number,
	flag: string,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer.`);
	}
	return parsed;
}
