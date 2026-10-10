import { getClickhouse } from "../clickhouse.js";
import { drainTranscriptRecordsRetirement } from "../services/transcript-records-retirement-drain.service.js";
import { parseRetireTranscriptRecordsArgs } from "./l1-script-args.js";

// Retires the transcript-records generations a backfill (or anything else)
// superseded, once their grace has passed. Preview by default; --execute
// deletes. Run it again until `sessionCount` is 0 and `hasMore` is false.
const args = parseRetireTranscriptRecordsArgs(Bun.argv.slice(2));
const executor = getClickhouse();
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
			"More sessions remain than --max-sessions; run the command again.",
		);
} finally {
	await executor.close();
}
