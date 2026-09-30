import { sqlClient } from "../db.js";
import { isVercelRuntime } from "../lib/api-runtime.js";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { readBooleanEnv } from "../lib/env.js";
import {
	createBackgroundIngestErrorFactories,
	processIngestSession,
} from "../router.js";
import {
	getNextGitHubObjectWorkDueAt,
	sweepGitHubEvidenceObjects,
} from "./github-evidence-object-fence.service.js";
import {
	getNextR2IngestWorkDueAt,
	repairR2IngestCleanupJobs,
	sweepExpiredR2IngestJobs,
} from "./r2-ingest-cleanup.service.js";
import { repairRecoverableR2IngestJobs } from "./r2-ingest-commit.service.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";
import {
	getNextEvidenceWorkDueAt,
	sweepRepositoryEvidence,
} from "./repository-evidence-fence.service.js";

export interface R2IngestRepairPassResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
	readonly nextDueAt: Date | null;
}

export async function runR2IngestRepairPass(
	r2: R2MultipartUploadClient,
	deadline: MaintenanceDeadline | undefined = undefined,
): Promise<R2IngestRepairPassResult> {
	const sessionIngestQuiesced = readBooleanEnv(
		"SESSION_INGEST_QUIESCED",
		false,
	);
	if (sessionIngestQuiesced) {
		return {
			attempted: 0,
			completed: 0,
			hasMore: false,
			nextDueAt: null,
		};
	}
	const expired = hasMaintenanceTimeRemaining(deadline)
		? await sweepExpiredR2IngestJobs({
				database: sqlClient,
				deadline,
				r2,
			})
		: { attempted: 0, completed: 0, hasMore: true };
	const recovered = hasMaintenanceTimeRemaining(deadline)
		? await repairRecoverableR2IngestJobs({
				database: sqlClient,
				deadline,
				process: (sessionInput, identity, signal) =>
					processIngestSession({
						// Vercel has no resident reconciler, so recovered jobs must attempt
						// their derived signals before completing. Best-effort persistence
						// still keeps scanner availability outside the recovery contract.
						awaitBestEffortLanguageSignals: isVercelRuntime(),
						awaitLanguageSignals: false,
						context: {
							apiKeyId: null,
							session: null,
							user: { id: identity.userId },
						},
						durableProcessing: {
							failpoint: undefined,
							operationId: identity.operationId,
						},
						enforceRateLimits: false,
						errorFactories: createBackgroundIngestErrorFactories(),
						input: sessionInput,
						signal,
					}),
				r2,
				sessionIngestQuiesced,
			})
		: { attempted: 0, completed: 0, hasMore: true };
	const cleanup = hasMaintenanceTimeRemaining(deadline)
		? await repairR2IngestCleanupJobs({
				database: sqlClient,
				deadline,
				r2,
			})
		: { attempted: 0, completed: 0, hasMore: true };
	const evidence = hasMaintenanceTimeRemaining(deadline)
		? await sweepRepositoryEvidence({ database: sqlClient, deadline, r2 })
		: { attempted: 0, completed: 0, hasMore: true };
	const githubObjects = hasMaintenanceTimeRemaining(deadline)
		? await sweepGitHubEvidenceObjects({
				database: sqlClient,
				deadline,
				r2,
			})
		: { attempted: 0, completed: 0, hasMore: true };
	const deadlineReached = !hasMaintenanceTimeRemaining(deadline);

	return {
		attempted:
			expired.attempted +
			recovered.attempted +
			cleanup.attempted +
			evidence.attempted +
			githubObjects.attempted,
		completed:
			expired.completed +
			recovered.completed +
			cleanup.completed +
			evidence.completed +
			githubObjects.completed,
		hasMore:
			deadlineReached ||
			expired.hasMore ||
			recovered.hasMore ||
			cleanup.hasMore ||
			evidence.hasMore ||
			githubObjects.hasMore,
		nextDueAt: deadlineReached
			? null
			: earliest(
					earliest(
						await getNextR2IngestWorkDueAt(sqlClient),
						await getNextEvidenceWorkDueAt(sqlClient),
					),
					await getNextGitHubObjectWorkDueAt(sqlClient),
				),
	};
}

function earliest(first: Date | null, second: Date | null): Date | null {
	if (!first) return second;
	if (!second) return first;
	return first.getTime() <= second.getTime() ? first : second;
}
