import { createClickHouseExecutorFromEnv } from "../clickhouse.js";
import {
	drainTranscriptRecordsRetirement,
	RETIREMENT_DRAIN_REQUEST_TIMEOUT_MS,
} from "../services/transcript-records-retirement-drain.service.js";
import { parseRetireTranscriptRecordsArgs } from "./l1-script-args.js";

const args = parseRetireTranscriptRecordsArgs(Bun.argv.slice(2));
const executor = createClickHouseExecutorFromEnv({
	requestTimeoutMs: RETIREMENT_DRAIN_REQUEST_TIMEOUT_MS,
});
const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new Error("Interrupted")));
try {
	const result = await drainTranscriptRecordsRetirement(executor, {
		...args,
		signal: controller.signal,
		onProgress(progress) {
			console.error(
				`transcript records retirement: ${progress.processedSessions}/${progress.totalSessions} sessions, ${progress.generations} generations`,
			);
		},
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.hasMore)
		console.error(
			"More remain: more sessions than --max-sessions, or a DELETE was deferred behind a pending mutation or left unsettled. Run the command again.",
		);
} finally {
	await executor.close();
}
