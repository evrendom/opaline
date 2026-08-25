import { sqlClient } from "../db.js";
import {
	createBackgroundIngestErrorFactories,
	processIngestSession,
} from "../router.js";
import {
	getNextR2IngestWorkDueAt,
	repairR2IngestCleanupJobs,
	sweepExpiredR2IngestJobs,
} from "./r2-ingest-cleanup.service.js";
import { repairRecoverableR2IngestJobs } from "./r2-ingest-commit.service.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

export interface R2IngestRepairPassResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
	readonly nextDueAt: Date | null;
}

export async function runR2IngestRepairPass(
	r2: R2MultipartUploadClient,
): Promise<R2IngestRepairPassResult> {
	const expired = await sweepExpiredR2IngestJobs({
		database: sqlClient,
		r2,
	});
	const recovered = await repairRecoverableR2IngestJobs({
		database: sqlClient,
		process: (sessionInput, identity, signal) =>
			processIngestSession({
				awaitLanguageSignals: true,
				context: {
					session: null,
					user: { id: identity.userId },
				},
				durableProcessing: { failpoint: undefined },
				enforceRateLimits: false,
				errorFactories: createBackgroundIngestErrorFactories(),
				input: sessionInput,
				signal,
			}),
		r2,
	});
	const cleanup = await repairR2IngestCleanupJobs({
		database: sqlClient,
		r2,
	});

	return {
		attempted: expired.attempted + recovered.attempted + cleanup.attempted,
		completed: expired.completed + recovered.completed + cleanup.completed,
		hasMore: expired.hasMore || recovered.hasMore || cleanup.hasMore,
		nextDueAt: await getNextR2IngestWorkDueAt(sqlClient),
	};
}
