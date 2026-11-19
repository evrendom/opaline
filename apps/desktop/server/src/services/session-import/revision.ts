import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import * as databases from "../../db.js";
import { recordUserCliVersion } from "../cli-version.service.js";
import { timedIngestPhase } from "../ingest-phase-timings.js";
import { passIngestProcessingBoundary } from "../ingest-processing-boundary.js";
import { getNextIngestedAt } from "../ingest-timestamp.service.js";
import {
	buildSessionRevisionDeduplicationToken,
	buildSessionRevisionOperationId,
} from "../session-revision.service.js";
import type { ImportRun, StoredRevision } from "./scope.js";

export async function storeRevision(run: ImportRun): Promise<StoredRevision> {
	const { claimedLedger, clickhouse, deps, prepared, request } = run;
	const { adapter, contentHash, contentShape, filteredInput, orgId } = prepared;
	const { context, durableProcessing, input } = request;
	const revisionIdentity = {
		allowReceiptPromotion:
			input.force_replace === true &&
			input.operationId === undefined &&
			durableProcessing === undefined,
		contentSha256: contentHash,
		operationId: buildSessionRevisionOperationId(
			filteredInput.source,
			durableProcessing?.operationId,
			input.operationId,
		),
		organizationId: orgId,
		sessionId: input.sessionId,
		userId: context.user.id,
	};
	const revision = await deps.control.allocateRevision(revisionIdentity);
	const ingestedAt = claimedLedger?.rawIngestedAt ?? getNextIngestedAt();
	await timedIngestPhase("server.raw_insert", () =>
		adapter.ingest(
			{
				insert: ({ table, values }) =>
					clickhouse.insert({
						deduplicationToken: buildSessionRevisionDeduplicationToken(
							revisionIdentity,
							revision,
							table,
						),
						table,
						values,
					}),
			},
			filteredInput,
			{
				ingestedAt,
				organizationId: orgId,
				revision,
				timestamps: prepared.timestamps,
				userId: context.user.id,
			},
		),
	);
	await deps.control.recordContent(
		orgId,
		input.sessionId,
		contentHash,
		contentShape,
		SESSION_INGEST_FILTER_VERSION,
		new Date(prepared.timestamps.sessionDate),
		ingestedAt,
		revision,
	);
	await passIngestProcessingBoundary(durableProcessing?.failpoint, {
		store: "postgres",
		target: "raw-receipt",
	});
	// Feeds the web app's CLI update notice; direct and R2 uploads both pass here.
	await recordUserCliVersion(
		databases.sqlClient,
		context.user.id,
		input.cli_version,
	);
	return { ingestedAt, revision };
}
