import { parseArgs } from "node:util";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import { backfillGitObservations } from "../services/git-observation-backfill.service.js";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	strict: true,
	options: {
		execute: { type: "boolean", default: false },
		cutoff: { type: "string" },
		"max-sessions": { type: "string" },
		"organization-id": { type: "string" },
	},
});
if (values.execute && !values.cutoff)
	throw new Error(
		"Execution requires the exact --cutoff value printed by a prior preview.",
	);
const executor = getClickhouse();
try {
	const result = await backfillGitObservations(
		executor,
		{
			cutoff: values.cutoff ? new Date(values.cutoff) : new Date(),
			maxSessions: values["max-sessions"]
				? Number(values["max-sessions"])
				: 10_000,
			organizationId: values["organization-id"],
			assertWritable: (target) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
		},
		values.execute,
	);
	console.log(JSON.stringify(result, null, 2));
	if (result.failedCount) process.exitCode = 2;
} finally {
	await executor.close();
	await sqlClient.end();
}
