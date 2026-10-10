import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	backfillL1Edges,
	decodeL1EdgeBackfillCursor,
} from "../services/l1-edges/l1-edge-backfill.service.js";
import { parseL1EdgeBackfillArgs } from "./l1-script-args.js";

// Preview by default; --execute queues the scopes for the edge worker
// (L1_EDGES_WORKER_ENABLED), at backfill priority.
const args = parseL1EdgeBackfillArgs(Bun.argv.slice(2));
const executor = getClickhouse();
try {
	const result = await backfillL1Edges(
		executor,
		sqlClient,
		{
			organizationId: args.organizationId,
			maxSessions: args.maxSessions,
			after:
				args.after === undefined
					? undefined
					: decodeL1EdgeBackfillCursor(args.after),
		},
		args.execute,
	);
	console.log(JSON.stringify(result, null, 2));
	if (result.next)
		console.error(
			`More sessions remain: run again with --after ${result.next}`,
		);
} finally {
	await executor.close();
	await sqlClient.end();
}
