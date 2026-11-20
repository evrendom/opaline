import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import { createSearchAccess } from "../services/transcript-search/access.js";
import {
	readEmbeddingQuotaLimits,
	transcriptEmbedder,
} from "../services/transcript-search/config.js";
import {
	backfillTranscriptSearch,
	decodeTranscriptSearchBackfillCursor,
	previewTranscriptSearchBackfill,
	type TranscriptSearchBackfillEnv,
} from "../services/transcript-search/history-backfill.service.js";
import { createPostgresEmbeddingQuota } from "../services/transcript-search/quota.js";
import { parseTranscriptSearchBackfillArgs } from "./l1-script-args.js";

// Preview by default (no OpenAI calls); --execute indexes history for search
// through the upload's indexing pass, paced, newest sessions first. Ctrl-C
// stops it before its next session and still prints the summary.
const args = parseTranscriptSearchBackfillArgs(Bun.argv.slice(2));
const embedder = args.execute ? transcriptEmbedder() : null;
if (args.execute && !embedder)
	throw new Error(
		"OPENAI_API_KEY is not set: --execute would store chunks without embedding them.",
	);
const options = {
	organizationId: args.organizationId,
	maxSessions: args.maxSessions,
	after:
		args.after === undefined
			? undefined
			: decodeTranscriptSearchBackfillCursor(args.after),
	sessionsPerMinute: args.sessionsPerMinute,
	maxLoad: args.maxLoad,
};
const controller = new AbortController();
process.on("SIGINT", () => {
	if (controller.signal.aborted) process.exit(130);
	console.error("Stopping before the next session (Ctrl-C again to quit now)");
	controller.abort();
});
const executor = getClickhouse();
const env: TranscriptSearchBackfillEnv = {
	executor,
	access: createSearchAccess(),
	quota: createPostgresEmbeddingQuota(sqlClient, readEmbeddingQuotaLimits()),
	listWorkspaces: async () =>
		(
			await sqlClient<{ id: string }[]>`SELECT id FROM organization ORDER BY id`
		).map((row) => row.id),
	assertWritable: (target) =>
		assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
	log: (line) => console.error(line),
};
try {
	const result = embedder
		? await backfillTranscriptSearch(
				{ ...env, embedder },
				{ ...options, signal: controller.signal },
			)
		: await previewTranscriptSearchBackfill(env, options);
	console.log(JSON.stringify(result, null, 2));
	if (result.message) console.error(result.message);
	else if (result.next)
		console.error(
			`More sessions remain: run again with --after ${result.next}`,
		);
	if (result.status === "executed" && result.failed > 0) process.exitCode = 2;
} finally {
	await executor.close();
	await sqlClient.end();
}
