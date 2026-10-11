import { parseArgs } from "node:util";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	backfillUsageEvents,
	previewUsageEventsBackfill,
	type UsageEventsBackfillOptions,
} from "../services/usage-event-backfill.service.js";

const DEFAULT_MAX_SESSIONS = 2_000;
const DEFAULT_MAX_SESSION_MIB = 512;
const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		cutoff: { type: "string" },
		execute: { default: false, type: "boolean" },
		"max-session-mib": { type: "string" },
		"max-sessions": { type: "string" },
		"organization-id": { type: "string" },
		shard: { type: "string" },
	},
	strict: true,
});

if (values.execute && !values.cutoff) {
	throw new Error(
		"Execution requires the exact --cutoff value printed by a prior preview.",
	);
}

const cutoff = values.cutoff ? new Date(values.cutoff) : new Date();
const maxSessions = parsePositiveInteger(
	values["max-sessions"],
	DEFAULT_MAX_SESSIONS,
	"--max-sessions",
);
const maxSessionMib = parsePositiveInteger(
	values["max-session-mib"],
	DEFAULT_MAX_SESSION_MIB,
	"--max-session-mib",
);
const executor = getClickhouse();
const startedAt = Date.now();

try {
	const options: UsageEventsBackfillOptions = {
		cutoff,
		maxSessionBytes: maxSessionMib * 1024 * 1024,
		maxSessions,
		onProgress(progress) {
			console.error(
				`usage-event backfill progress: ${progress.processedCandidateCount}/${progress.totalCandidateCount} sessions (${progress.completedBatchCount}/${progress.batchCount} batches, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed)`,
			);
		},
		organizationId: values["organization-id"],
		shard: parseShard(values.shard),
	};
	const result = values.execute
		? await backfillUsageEvents(executor, options)
		: await previewUsageEventsBackfill(executor, options);
	console.log(JSON.stringify(result, null, 2));
	if (result.failedCount > 0 || result.supersededCount > 0) {
		process.exitCode = 2;
	}
} finally {
	await Promise.all([executor.close(), sqlClient.end({ timeout: 5 })]);
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

/** `--shard <index>/<count>`, for example `--shard 0/4`. */
function parseShard(
	value: string | undefined,
): { index: number; count: number } | undefined {
	if (value === undefined) return undefined;
	const match = /^(\d+)\/(\d+)$/u.exec(value);
	const index = Number(match?.[1]);
	const count = Number(match?.[2]);
	if (!match || count < 1 || count > 64 || index >= count) {
		throw new Error(
			"--shard must be <index>/<count> with 0 <= index < count <= 64.",
		);
	}
	return { index, count };
}
