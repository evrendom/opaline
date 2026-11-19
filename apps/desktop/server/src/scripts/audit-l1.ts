import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	auditL1,
	compareL1Audits,
	formatL1Audit,
	formatL1AuditChanges,
	readOnlyClickHouse,
} from "../services/l1-audit.service.js";
import { parseAuditL1Args } from "./l1-script-args.js";

// Read-only report of the L1 layers for one organization (or all). Writes
// nothing anywhere, prints to stdout. --json for a report to keep and diff;
// --compare <before.json> prints what changed since that report.
const args = parseAuditL1Args(Bun.argv.slice(2));
const before =
	args.compare === undefined
		? undefined
		: ((await Bun.file(args.compare).json()) as unknown);
const executor = readOnlyClickHouse(getClickhouse());
try {
	const report = await auditL1(executor, sqlClient, {
		organizationId: args.organizationId,
	});
	if (before !== undefined) {
		const changes = compareL1Audits(before, report);
		console.log(
			args.json
				? JSON.stringify(changes, null, 2)
				: formatL1AuditChanges(changes),
		);
	} else {
		console.log(
			args.json ? JSON.stringify(report, null, 2) : formatL1Audit(report),
		);
	}
} finally {
	await executor.close();
	await sqlClient.end();
}
