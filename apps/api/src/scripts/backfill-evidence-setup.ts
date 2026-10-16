import { parseArgs } from "node:util";
import { sqlClient } from "../db.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "../services/r2-ingest-storage.service.js";
import { backfillEvidenceSetup } from "../services/repository-evidence-setup-backfill.service.js";
import {
	parseOrganizationScope,
	parsePositiveIntegerFlag,
} from "./l1-script-args.js";

// Preview by default; --execute re-reads each capture's stored manifest from
// R2, adds its setup to the prepared index row and leaves publishing to the
// evidence index publisher (the API's minute maintenance pass).
const { values } = parseArgs({
	args: Bun.argv.slice(2),
	strict: true,
	options: {
		after: { type: "string" },
		"all-organizations": { type: "boolean", default: false },
		execute: { type: "boolean", default: false },
		"max-captures": { type: "string" },
		"organization-id": { type: "string" },
	},
});
const { organizationId } = parseOrganizationScope(values);
const availability = readR2IngestAvailability();
if (values.execute && !availability.enabled)
	throw new Error(
		`R2 is not configured: ${availability.missingVariables.join(", ")}`,
	);
const r2 = availability.enabled
	? createR2MultipartUploadClient(availability.configuration)
	: undefined;
try {
	const result = await backfillEvidenceSetup({
		database: sqlClient,
		getObject: (objectKey) => {
			if (!r2) throw new Error("R2 is not configured");
			return r2.getObject(objectKey);
		},
		organizationId,
		maxCaptures: parsePositiveIntegerFlag(
			values["max-captures"],
			500,
			"--max-captures",
			10_000,
		),
		after: values.after?.trim() || undefined,
		execute: values.execute,
	});
	console.log(JSON.stringify(result, null, 2));
	if (result.next)
		console.error(
			`More captures remain: run again with --after '${result.next}'`,
		);
} finally {
	await sqlClient.end();
}
