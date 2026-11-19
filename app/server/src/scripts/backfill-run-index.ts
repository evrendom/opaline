import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	backfillRunIndex,
	decodeRunIndexBackfillCursor,
	previewRunIndexBackfill,
} from "../services/l1-edges/run-index-backfill.service.js";
import { parseRunIndexBackfillArgs } from "./l1-script-args.js";

// Preview by default; --execute queues run index builds for the edge worker
// (L1_EDGES_WORKER_ENABLED), at backfill priority.
const args = parseRunIndexBackfillArgs(Bun.argv.slice(2));
const options = {
	organizationId: args.organizationId,
	maxSessions: args.maxSessions,
	after:
		args.after === undefined
			? undefined
			: decodeRunIndexBackfillCursor(args.after),
};
const executor = getClickhouse();
try {
	const result = args.execute
		? await backfillRunIndex(executor, sqlClient, options)
		: await previewRunIndexBackfill(executor, sqlClient, options);
	console.log(JSON.stringify(result, null, 2));
	if (result.next)
		console.error(
			`More sessions remain: run again with --after ${result.next}`,
		);
} finally {
	await executor.close();
	await sqlClient.end();
}
