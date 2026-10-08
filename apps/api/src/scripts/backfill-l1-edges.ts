import { parseArgs } from "node:util";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { backfillL1Edges } from "../services/l1-edges/l1-edge-backfill.service.js";

// Preview by default; --execute queues the scopes for the edge worker.
const { values } = parseArgs({
	args: Bun.argv.slice(2),
	strict: true,
	options: {
		execute: { type: "boolean", default: false },
		"max-sessions": { type: "string" },
		"organization-id": { type: "string" },
	},
});
const executor = getClickhouse();
try {
	const result = await backfillL1Edges(
		executor,
		sqlClient,
		{
			organizationId: values["organization-id"],
			maxSessions: values["max-sessions"]
				? Number(values["max-sessions"])
				: 100_000,
		},
		values.execute,
	);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await executor.close();
	await sqlClient.end();
}
