import { getLogger } from "@logtape/logtape";
import type { IngestSessionInput } from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { readBooleanEnv } from "../lib/env.js";
import {
	getNextGitHubObjectWorkDueAt,
	sweepGitHubEvidenceObjects,
} from "./github-evidence-object-fence.service.js";
import { awaitsDurableLanguageSignals } from "./ingest-derived-fact-policy.js";
import {
	getNextR2IngestWorkDueAt,
	repairR2IngestCleanupJobs,
	sweepExpiredR2IngestJobs,
	wakeR2IngestWorker,
} from "./r2-ingest-cleanup.service.js";
import {
	hasDueLargeR2IngestWork,
	type R2IngestProcessor,
	repairRecoverableR2IngestJobs,
} from "./r2-ingest-commit.service.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";
import {
	getNextEvidenceWorkDueAt,
	sweepRepositoryEvidence,
} from "./repository-evidence-fence.service.js";
import {
	createBackgroundIngestErrorFactories,
	processIngestSession,
} from "./session-import/index.js";

const logger = getLogger(["rudel", "api", "r2-ingest-repair"]);
const LARGE_INGEST_WATCH_INTERVAL_MS = 15_000;

export interface LargeR2IngestWatcher {
	readonly stop: () => void;
}

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
				process: processRecoveredR2IngestJob,
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

/**
 * Materializes one recovered R2 job. Shared by the recovery pass (Vercel cron,
 * resident worker) and the large-session worker, so every path runs the same
 * processing with background error factories and no rate limits.
 */
export function processRecoveredR2IngestJob(
	sessionInput: IngestSessionInput,
	identity: { operationId: string; userId: string },
	signal: AbortSignal,
): ReturnType<R2IngestProcessor> {
	return processIngestSession({
		// Vercel and self-hosted servers have no resident reconciler, so
		// recovered jobs must attempt their derived signals before completing.
		// Best-effort persistence still keeps scanner availability outside the
		// recovery contract.
		awaitBestEffortLanguageSignals: awaitsDurableLanguageSignals(),
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
	});
}

function earliest(first: Date | null, second: Date | null): Date | null {
	if (!first) return second;
	if (!second) return first;
	return first.getTime() <= second.getTime() ? first : second;
}

/**
 * Large sessions are materialized only by the resident worker, which otherwise
 * learns of new work at its next scheduled pass. This polls one indexed row
 * every 15 seconds and wakes the worker when a large job is due.
 */
export function startLargeR2IngestWatcher(): LargeR2IngestWatcher {
	let checking = false;
	const timer = setInterval(() => {
		if (checking) return;
		checking = true;
		hasDueLargeR2IngestWork(sqlClient, new Date())
			.then((due) => {
				if (due) wakeR2IngestWorker();
			})
			.catch((error: unknown) => {
				logger.warn("Large R2 ingest watch failed: {error}", {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				checking = false;
			});
	}, LARGE_INGEST_WATCH_INTERVAL_MS);
	timer.unref();
	return {
		stop() {
			clearInterval(timer);
		},
	};
}
