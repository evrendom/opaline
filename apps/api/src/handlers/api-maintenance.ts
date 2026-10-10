import { getLogger } from "@logtape/logtape";
import { sqlClient } from "../db.js";
import {
	createMaintenanceQueueDeadline,
	drainMaintenancePasses,
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
	type MaintenanceDrainResult,
	type MaintenancePassResult,
} from "../lib/bounded-maintenance.js";
import { isAuthorizedCronRequest } from "../lib/cron-auth.js";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";
import { readResendConfig } from "../resend-config.js";
import { runClickHousePurgeWorkerPass } from "../services/clickhouse-purge.service.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import { reconcileDerivedTranscriptRecords } from "../services/derived-records-reconciliation.service.js";
import { requeueStaleL1EdgeScopes } from "../services/l1-edges/l1-edge-census.service.js";
import { requeueStaleRunIndexScopes } from "../services/l1-edges/run-index-census.service.js";
import { runRunIndexRetirementPass } from "../services/l1-edges/run-index-retirement.service.js";
import { pruneExpiredPostgresLeases } from "../services/postgres-lease.service.js";
import { runR2IngestRepairPass } from "../services/r2-ingest-repair.service.js";
import {
	createR2MultipartUploadClient,
	readR2IngestAvailability,
} from "../services/r2-ingest-storage.service.js";
import { runRepositoryEvidenceIndexPublisherPass } from "../services/repository-evidence-index-publication.service.js";
import { reconcileSessionLanguageSignalsUntilCaughtUp } from "../services/session-language-signal-reconciliation.service.js";
import { runSessionRevisionReceiptCleanupPass } from "../services/session-revision-receipt-cleanup.service.js";
import { runTranscriptRecordsRetirementPass } from "../services/transcript-records-retirement.service.js";

const logger = getLogger(["rudel", "api", "maintenance"]);
const DEFAULT_LANGUAGE_SIGNAL_BATCH_SIZE = 25;
const MAINTENANCE_MAX_PASSES_PER_STEP = 50;
// Keep the invocation deadline 30 seconds below the configured 300-second
// Vercel Function maximum so deadline logging and the HTTP response can flush.
const MAINTENANCE_INVOCATION_BUDGET_MS = 270_000;
const CLICKHOUSE_PURGE_BUDGET_MS = 90_000;
const R2_INGEST_BUDGET_MS = 90_000;
const REPOSITORY_EVIDENCE_INDEX_BUDGET_MS = 60_000;
const SESSION_REVISION_RECEIPT_BUDGET_MS = 10_000;
const LANGUAGE_SIGNAL_BUDGET_MS = 60_000;
const TRANSCRIPT_RECORDS_RETIREMENT_BUDGET_MS = 10_000;
const RUN_INDEX_RETIREMENT_BUDGET_MS = 10_000;
const RUN_INDEX_CENSUS_BUDGET_MS = 30_000;
const L1_EDGE_CENSUS_BUDGET_MS = 30_000;
const DERIVED_RECORDS_RECONCILIATION_BUDGET_MS = 60_000;
const COORDINATION_LEASE_BUDGET_MS = 10_000;

export async function handleApiMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const result = await runApiMaintenance();
		return Response.json(result, { status: result.ok ? 200 : 500 });
	} catch (error) {
		logger.error("Daily API maintenance failed: {error}", {
			error: String(error),
		});
		return Response.json({ error: "Maintenance failed" }, { status: 500 });
	}
}

export async function handleR2IngestMaintenanceRequest(
	request: Request,
): Promise<Response> {
	if (!isAuthorizedCronRequest(request)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const invocationDeadline = {
			deadlineAt: Date.now() + MAINTENANCE_INVOCATION_BUDGET_MS,
			now: Date.now,
		};
		// Transcript ingest retries come first; the evidence index is derived.
		const result = await runR2Maintenance(invocationDeadline);
		const repositoryEvidenceIndex = await runMaintenanceStep(
			"repository-evidence-index",
			() =>
				runRepositoryEvidenceIndexPublisherPass({
					deadline: createMaintenanceQueueDeadline(
						invocationDeadline,
						REPOSITORY_EVIDENCE_INDEX_BUDGET_MS,
					),
				}),
		);
		return Response.json(
			{ ...result, repositoryEvidenceIndex },
			{
				status: repositoryEvidenceIndex.status === "ok" ? 200 : 500,
			},
		);
	} catch (error) {
		logger.error("R2 ingest maintenance failed: {error}", {
			error: String(error),
		});
		return Response.json(
			{ error: "R2 ingest maintenance failed" },
			{ status: 500 },
		);
	}
}

async function runApiMaintenance() {
	const invocationDeadline: MaintenanceDeadline = {
		deadlineAt: Date.now() + MAINTENANCE_INVOCATION_BUDGET_MS,
		now: Date.now,
	};
	const clickHousePurge = await runMaintenanceStep("clickhouse-purge", () =>
		runClickHouseMaintenance(invocationDeadline),
	);
	const repositoryEvidenceIndex = await runMaintenanceStep(
		"repository-evidence-index",
		() =>
			runRepositoryEvidenceIndexPublisherPass({
				deadline: createMaintenanceQueueDeadline(
					invocationDeadline,
					REPOSITORY_EVIDENCE_INDEX_BUDGET_MS,
				),
			}),
	);
	const r2Ingest = await runMaintenanceStep("r2-ingest", () =>
		runR2Maintenance(invocationDeadline),
	);
	const sessionRevisionReceipts = await runMaintenanceStep(
		"session-revision-receipts",
		() => runSessionRevisionReceiptMaintenance(invocationDeadline),
	);
	const languageSignals = await runMaintenanceStep("language-signals", () =>
		runLanguageSignalMaintenance(invocationDeadline),
	);
	const transcriptRecords = await runMaintenanceStep("transcript-records", () =>
		runTranscriptRecordsRetirementPass({
			deadline: createMaintenanceQueueDeadline(
				invocationDeadline,
				TRANSCRIPT_RECORDS_RETIREMENT_BUDGET_MS,
			),
		}),
	);
	const runIndex = await runMaintenanceStep("run-index", () =>
		runRunIndexRetirementPass({
			deadline: createMaintenanceQueueDeadline(
				invocationDeadline,
				RUN_INDEX_RETIREMENT_BUDGET_MS,
			),
		}),
	);
	const runIndexCensus = await runMaintenanceStep("run-index-census", () =>
		requeueStaleRunIndexScopes({
			sql: sqlClient,
			deadline: createMaintenanceQueueDeadline(
				invocationDeadline,
				RUN_INDEX_CENSUS_BUDGET_MS,
			),
		}),
	);
	const l1EdgeCensus = await runMaintenanceStep("l1-edge-census", () =>
		requeueStaleL1EdgeScopes({
			sql: sqlClient,
			deadline: createMaintenanceQueueDeadline(
				invocationDeadline,
				L1_EDGE_CENSUS_BUDGET_MS,
			),
		}),
	);
	const derivedRecords = await runMaintenanceStep("derived-records", () =>
		reconcileDerivedTranscriptRecords({
			assertWritable: (target) =>
				assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
			deadline: createMaintenanceQueueDeadline(
				invocationDeadline,
				DERIVED_RECORDS_RECONCILIATION_BUDGET_MS,
			),
		}),
	);
	const coordinationLeases = await runMaintenanceStep(
		"coordination-leases",
		() => runCoordinationLeaseMaintenance(invocationDeadline),
	);
	if (!hasMaintenanceTimeRemaining(invocationDeadline)) {
		logger.warn(
			"Daily API maintenance reached its invocation deadline; returning with queued work left for the next cron",
		);
	}

	return {
		clickHousePurge,
		coordinationLeases,
		derivedRecords,
		l1EdgeCensus,
		languageSignals,
		repositoryEvidenceIndex,
		ok:
			clickHousePurge.status === "ok" &&
			repositoryEvidenceIndex.status === "ok" &&
			r2Ingest.status === "ok" &&
			sessionRevisionReceipts.status === "ok" &&
			languageSignals.status === "ok" &&
			transcriptRecords.status === "ok" &&
			runIndex.status === "ok" &&
			runIndexCensus.status === "ok" &&
			l1EdgeCensus.status === "ok" &&
			derivedRecords.status === "ok" &&
			coordinationLeases.status === "ok",
		r2Ingest,
		runIndex,
		runIndexCensus,
		sessionRevisionReceipts,
		transcriptRecords,
	};
}

async function runSessionRevisionReceiptMaintenance(
	invocationDeadline: MaintenanceDeadline,
) {
	const deadline = createMaintenanceQueueDeadline(
		invocationDeadline,
		SESSION_REVISION_RECEIPT_BUDGET_MS,
	);
	const drain = await runMaintenancePassLoop(
		"session-revision-receipts",
		deadline,
		() => runSessionRevisionReceiptCleanupPass(),
	);
	return {
		deleted: drain.results.reduce((total, result) => total + result.deleted, 0),
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		stopReason: drain.stopReason,
	};
}

async function runCoordinationLeaseMaintenance(
	invocationDeadline: MaintenanceDeadline,
) {
	const deadline = createMaintenanceQueueDeadline(
		invocationDeadline,
		COORDINATION_LEASE_BUDGET_MS,
	);
	const drain = await runMaintenancePassLoop(
		"coordination-leases",
		deadline,
		() => pruneExpiredPostgresLeases(sqlClient),
	);
	return {
		deleted: drain.results.reduce((total, result) => total + result.deleted, 0),
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		stopReason: drain.stopReason,
	};
}

async function runClickHouseMaintenance(
	invocationDeadline: MaintenanceDeadline,
) {
	const deadline = createMaintenanceQueueDeadline(
		invocationDeadline,
		CLICKHOUSE_PURGE_BUDGET_MS,
	);
	const resend = readResendConfig();
	const drain = await runMaintenancePassLoop("clickhouse-purge", deadline, () =>
		runClickHousePurgeWorkerPass({ resend }, deadline),
	);

	return {
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		processed: drain.results.reduce(
			(total, result) => total + result.processed,
			0,
		),
		stopReason: drain.stopReason,
	};
}

async function runMaintenanceStep<TResult>(
	name: string,
	run: () => Promise<TResult>,
): Promise<
	| { readonly result: TResult; readonly status: "ok" }
	| { readonly status: "error" }
> {
	try {
		return { result: await run(), status: "ok" };
	} catch (error) {
		logger.error("Daily API maintenance step failed ({name}): {error}", {
			error: String(error),
			name,
		});
		return { status: "error" };
	}
}

async function runR2Maintenance(invocationDeadline: MaintenanceDeadline) {
	const availability = readR2IngestAvailability();
	if (!availability.enabled) {
		return {
			attempted: 0,
			completed: 0,
			enabled: false,
			hasMore: false,
			iterations: 0,
			nextDueAt: null,
			stopReason: "complete",
		};
	}

	const deadline = createMaintenanceQueueDeadline(
		invocationDeadline,
		R2_INGEST_BUDGET_MS,
	);
	const r2 = createR2MultipartUploadClient(availability.configuration);
	const drain = await runMaintenancePassLoop("r2-ingest", deadline, () =>
		runR2IngestRepairPass(r2, deadline),
	);

	return {
		attempted: drain.results.reduce(
			(total, result) => total + result.attempted,
			0,
		),
		completed: drain.results.reduce(
			(total, result) => total + result.completed,
			0,
		),
		enabled: true,
		hasMore: drain.hasMore,
		iterations: drain.iterations,
		nextDueAt: drain.results.at(-1)?.nextDueAt ?? null,
		stopReason: drain.stopReason,
	};
}

async function runLanguageSignalMaintenance(
	invocationDeadline: MaintenanceDeadline,
) {
	const deadline = createMaintenanceQueueDeadline(
		invocationDeadline,
		LANGUAGE_SIGNAL_BUDGET_MS,
	);
	const result = await reconcileSessionLanguageSignalsUntilCaughtUp(
		readPositiveSafeIntegerEnv(
			"LANGUAGE_SIGNAL_RECONCILE_BATCH_SIZE",
			DEFAULT_LANGUAGE_SIGNAL_BATCH_SIZE,
		),
		undefined,
		deadline,
	);
	const hasMore = result.remainingLag > 0;
	if (hasMore) {
		logger.warn(
			"Daily API maintenance left queued work (language-signals) after reconciliation; the next cron will continue",
			{ remainingLag: result.remainingLag },
		);
	}
	return {
		...result,
		hasMore,
		stopReason: hasMore
			? hasMaintenanceTimeRemaining(deadline)
				? "max-iterations"
				: "deadline"
			: "complete",
	};
}

async function runMaintenancePassLoop<TResult extends MaintenancePassResult>(
	name: string,
	deadline: MaintenanceDeadline,
	runPass: () => Promise<TResult>,
): Promise<MaintenanceDrainResult<TResult>> {
	const drain = await drainMaintenancePasses({
		deadline,
		maxIterations: MAINTENANCE_MAX_PASSES_PER_STEP,
		onIncomplete: (incomplete) => {
			logger.warn(
				"Daily API maintenance left queued work ({name}) after {iterations} passes ({stopReason}); the next cron will continue",
				{
					iterations: incomplete.iterations,
					name,
					stopReason: incomplete.stopReason,
				},
			);
		},
		runPass,
	});

	return drain;
}
