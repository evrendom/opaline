import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { sqlClient } from "../db.js";
import {
	type ClickHousePurgeFailureAlertData,
	type ResendConfig,
	sendClickHousePurgeFailureAlert,
} from "../email.js";
import { isVercelRuntime } from "../lib/api-runtime.js";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { readPositiveSafeIntegerEnv } from "../lib/env.js";
import { readResendConfig } from "../resend-config.js";
import { createPostgresSqlResultStore } from "./analysis/sql-results.js";
import { purgeAnalysisLogs } from "./analysis-log/config.js";
import { purgeFindingImpact } from "./analysis-log/finding-impact-clickhouse.js";
import { purgeGitHubObjectIntents } from "./github-evidence-object-fence.service.js";
import {
	type LiveSessionR2Cleaner,
	purgeLiveSessionObjectsOfOrganization,
} from "./live-session/live-session-cleanup.service.js";
import {
	deleteOrgSessions,
	deleteUserSessions,
} from "./org-session.service.js";
import {
	createR2MultipartUploadClient,
	type R2MultipartUploadClient,
	type R2StorageClient,
	readR2IngestAvailability,
} from "./r2-ingest-storage.service.js";
import {
	holdIntentsForPurge,
	runIntentsForPurgeTarget,
} from "./repository-evidence-fence.service.js";
import { purgeRunQuestionJobs } from "./run-questions/jobs.js";

const logger = getLogger(["rudel", "api", "clickhouse-purge"]);

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 60 * 60_000;
const DEFAULT_LEASE_DURATION_MS = 3 * 60_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 5_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 15 * 60_000;
const DEFAULT_ALERT_RETRY_BASE_DELAY_MS = 30_000;
const DEFAULT_ALERT_RETRY_MAX_DELAY_MS = 60 * 60_000;
const SUCCEEDED_JOB_RETENTION_MS = 30 * 24 * 60 * 60_000;
const SUCCEEDED_JOB_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;
const MAX_WORK_ITEMS_PER_PASS = 20;
const MIN_DUE_WORK_DELAY_MS = 100;
const MAX_ERROR_SEGMENTS = 8;
const MAX_ERROR_DEPTH = 4;
const MAX_SANITIZED_ERROR_LENGTH = 800;
const MAX_R2_DELETE_OBJECTS = 1_000;
const CONFIGURED_MAX_ATTEMPTS = readPositiveSafeIntegerEnv(
	"CLICKHOUSE_PURGE_MAX_ATTEMPTS",
	DEFAULT_MAX_ATTEMPTS,
);
const CONFIGURED_POLL_INTERVAL_MS = readPositiveSafeIntegerEnv(
	"CLICKHOUSE_PURGE_POLL_INTERVAL_MS",
	DEFAULT_POLL_INTERVAL_MS,
);
// Longer than the longest bounded write that can race a deletion, so the
// follow-up pass removes whatever such a write published after the first pass.
const DEFAULT_FOLLOWUP_DELAY_MS = 15 * 60_000;
const PURGE_INTENT_HOLD_MARGIN_MS = 10 * 60_000;
const CONFIGURED_FOLLOWUP_DELAY_MS = readPositiveSafeIntegerEnv(
	"CLICKHOUSE_PURGE_FOLLOWUP_DELAY_MS",
	DEFAULT_FOLLOWUP_DELAY_MS,
);

export type ClickHousePurgeTarget =
	| { targetId: string; targetType: "account" }
	| { targetId: string; targetType: "organization" };

export type EvidencePurgeR2Client = Pick<
	R2MultipartUploadClient,
	"abortMultipartUpload" | "deleteObjects" | "listMultipartUploads"
>;

export type ClickHousePurgeFailureAlert = ClickHousePurgeFailureAlertData;

/**
 * Describes which pass is running. The first pass keeps the snapshotted R2
 * keys and the multipart intents so the follow-up pass can still find objects
 * that an in-flight write published after it; only the follow-up removes them.
 */
export interface ClickHousePurgePass {
	readonly finalPass: boolean;
	readonly purgeJobId: string;
}

export interface ClickHousePurgeProcessorEnv {
	executePurge: (
		target: ClickHousePurgeTarget,
		pass?: ClickHousePurgePass,
	) => Promise<void>;
	/** Delay before the follow-up purge pass (default 15 minutes). */
	followUpDelayMs?: number;
	leaseDurationMs: number;
	now: () => Date;
	random: () => number;
	sendFailureAlert?: (alert: ClickHousePurgeFailureAlert) => Promise<void>;
	sqlClient: postgres.Sql;
}

export interface ClickHousePurgeWorker {
	wake: () => Promise<void>;
	stop: () => Promise<void>;
}

interface ClaimedPurgeJob {
	attemptCount: number;
	id: string;
	leaseToken: string;
	maxAttempts: number;
	targetId: string;
	targetType: ClickHousePurgeTarget["targetType"];
}

interface ClaimedPurgeAlert extends ClickHousePurgeFailureAlert {
	alertAttemptCount: number;
	leaseToken: string;
}

interface ClaimedPurgeAlertRow {
	alertAttemptCount: number;
	attemptCount: number;
	createdAt: Date | string;
	failedAt: Date | string | null;
	id: string;
	lastAttemptAt: Date | string | null;
	lastError: string | null;
	leaseToken: string;
	targetId: string;
	targetType: ClickHousePurgeTarget["targetType"];
}

interface PurgeJobCandidate {
	attemptCount: number;
	id: string;
	maxAttempts: number;
	status: "pending" | "retrying" | "running";
}

type PurgeJobClaimResult =
	| { status: "claimed"; job: ClaimedPurgeJob }
	| { status: "empty" }
	| { status: "terminalized" };

interface NextPurgeWorkDueRow {
	nextDueAt: Date | string | null;
}

export interface StartClickHousePurgeWorkerOptions {
	enabled?: boolean;
	pollIntervalMs?: number;
	repairR2IngestCleanup?: () => Promise<{
		attempted: number;
		completed: number;
		hasMore: boolean;
		nextDueAt?: Date | null;
	}>;
	resend: ResendConfig;
	r2?: EvidencePurgeR2Client;
	/** Lists and deletes a purged workspace's live session objects. */
	liveSessionR2?: LiveSessionR2Cleaner;
	sqlClient?: postgres.Sql;
}

let registeredClickHousePurgeWorker: ClickHousePurgeWorker | undefined;

export function registerClickHousePurgeWorker(
	worker: ClickHousePurgeWorker,
): void {
	registeredClickHousePurgeWorker = worker;
}

export async function wakeClickHousePurgeWorker(): Promise<void> {
	if (registeredClickHousePurgeWorker) {
		void registeredClickHousePurgeWorker.wake();
		return;
	}
	if (isVercelRuntime()) {
		try {
			await runClickHousePurgeWorkerPass({ resend: readResendConfig() });
		} catch (error) {
			logger.error(
				"Inline ClickHouse purge pass failed; the daily repair will retry: {error}",
				{ error: sanitizeClickHousePurgeError(error) },
			);
		}
	}
}

export async function enqueueClickHousePurge(
	target: ClickHousePurgeTarget,
	transaction: postgres.TransactionSql,
	maxAttempts = CONFIGURED_MAX_ATTEMPTS,
): Promise<void> {
	if (!target.targetId.trim()) {
		throw new Error("ClickHouse purge target ID must not be empty");
	}
	if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
		throw new Error("ClickHouse purge max attempts must be a positive integer");
	}

	await transaction.unsafe(
		`
			INSERT INTO clickhouse_purge_job (
				id,
				target_type,
				target_id,
				max_attempts
			)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (target_type, target_id) DO UPDATE
			SET
				id = EXCLUDED.id,
				status = 'pending',
				attempt_count = 0,
				max_attempts = EXCLUDED.max_attempts,
				last_error = NULL,
				next_attempt_at = NOW(),
				last_attempt_at = NULL,
				succeeded_at = NULL,
				failed_at = NULL,
				alert_status = 'not_required',
				alert_attempt_count = 0,
				alert_last_error = NULL,
				alert_next_attempt_at = NULL,
				alert_sent_at = NULL,
				lease_token = NULL,
				lease_expires_at = NULL,
				followup_due_at = NULL,
				followup_completed_at = NULL,
				created_at = NOW(),
				updated_at = NOW()
			WHERE clickhouse_purge_job.status IN ('succeeded', 'failed')
		`,
		[crypto.randomUUID(), target.targetType, target.targetId, maxAttempts],
	);
	await holdIntentsForPurge(
		transaction,
		target,
		new Date(
			Date.now() + CONFIGURED_FOLLOWUP_DELAY_MS + PURGE_INTENT_HOLD_MARGIN_MS,
		),
	);
	const [job] = await transaction.unsafe<Array<{ id: string }>>(
		`SELECT id FROM clickhouse_purge_job
		 WHERE target_type = $1 AND target_id = $2
		 LIMIT 1
		 FOR UPDATE`,
		[target.targetType, target.targetId],
	);
	if (!job) throw new Error("ClickHouse purge job was not persisted");
	await snapshotR2PurgeObjects(target, job.id, transaction);
}

async function snapshotR2PurgeObjects(
	target: ClickHousePurgeTarget,
	purgeJobId: string,
	transaction: postgres.TransactionSql,
): Promise<void> {
	await snapshotLiveSessionPurgeObjects(target, purgeJobId, transaction);
	if (target.targetType === "account") {
		await transaction.unsafe(
			`
				SELECT evidence_object.organization_id, evidence_object.object_id
				FROM repository_evidence_object evidence_object
				WHERE EXISTS (
					SELECT 1
					FROM repository_evidence_upload_object object_reference
					INNER JOIN repository_evidence_upload evidence_upload
						ON evidence_upload.id = object_reference.upload_id
					WHERE object_reference.organization_id = evidence_object.organization_id
						AND object_reference.object_id = evidence_object.object_id
						AND evidence_upload.user_id = $1
				)
				ORDER BY evidence_object.organization_id, evidence_object.object_id
				FOR UPDATE OF evidence_object
			`,
			[target.targetId],
		);
		await transaction.unsafe(
			`
				INSERT INTO clickhouse_purge_object (purge_job_id, object_key)
				SELECT $1, evidence_object.object_key
				FROM repository_evidence_object evidence_object
				WHERE EXISTS (
					SELECT 1
					FROM repository_evidence_upload_object object_reference
					INNER JOIN repository_evidence_upload evidence_upload
						ON evidence_upload.id = object_reference.upload_id
					WHERE object_reference.organization_id = evidence_object.organization_id
						AND object_reference.object_id = evidence_object.object_id
						AND evidence_upload.user_id = $2
				)
				AND NOT EXISTS (
					SELECT 1
					FROM repository_evidence_upload_object surviving_reference
					INNER JOIN repository_evidence_upload surviving_upload
						ON surviving_upload.id = surviving_reference.upload_id
					WHERE surviving_reference.organization_id = evidence_object.organization_id
						AND surviving_reference.object_id = evidence_object.object_id
						AND surviving_upload.user_id <> $2
				)
				ON CONFLICT (purge_job_id, object_key) DO NOTHING
			`,
			[purgeJobId, target.targetId],
		);
		return;
	}

	await transaction.unsafe(
		`
			INSERT INTO clickhouse_purge_object (purge_job_id, object_key)
			SELECT $1, object_key
			FROM (
				SELECT object_key
				FROM repository_evidence_object
				WHERE organization_id = $2

				UNION

				SELECT metadata_object_key AS object_key
				FROM github_evidence_collection
				WHERE organization_id = $2
					AND metadata_object_key IS NOT NULL

				UNION

				SELECT object_key
				FROM github_ci_log_receipt
				WHERE organization_id = $2
					AND object_key IS NOT NULL

				UNION

				SELECT chunk->>'objectKey' AS object_key
				FROM github_evidence_collection collection,
				 jsonb_array_elements(collection.metadata_chunks) chunk
				WHERE collection.organization_id = $2
			) evidence_objects
			ON CONFLICT (purge_job_id, object_key) DO NOTHING
		`,
		[purgeJobId, target.targetId],
	);
}

/**
 * Live session chunk objects of the account's or workspace's live sessions;
 * their rows go with the deletion's foreign-key cascade. Locking the sessions
 * first waits for appends in flight (each holds its session's row lock across
 * its R2 write), so their chunks are captured. A new session's first append
 * holds a key-share lock on the organization and user rows, which the
 * deletion locks before it enqueues, so it either commits before this
 * snapshot or fails its foreign key after the deletion.
 */
async function snapshotLiveSessionPurgeObjects(
	target: ClickHousePurgeTarget,
	purgeJobId: string,
	transaction: postgres.TransactionSql,
): Promise<void> {
	const ownerColumn =
		target.targetType === "account" ? "user_id" : "organization_id";
	await transaction.unsafe(
		`SELECT 1 FROM live_session WHERE ${ownerColumn} = $1
		 ORDER BY organization_id, source, session_id
		 FOR UPDATE`,
		[target.targetId],
	);
	await transaction.unsafe(
		`
			INSERT INTO clickhouse_purge_object (purge_job_id, object_key)
			SELECT $1, chunk.object_key
			FROM live_session_chunk chunk
			INNER JOIN live_session live
				ON live.organization_id = chunk.organization_id
				AND live.source = chunk.source
				AND live.session_id = chunk.session_id
			WHERE live.${ownerColumn} = $2
			ON CONFLICT (purge_job_id, object_key) DO NOTHING
		`,
		[purgeJobId, target.targetId],
	);
}

export async function deleteSnapshottedRepositoryEvidenceObjects(
	userId: string,
	transaction: postgres.TransactionSql,
): Promise<void> {
	await transaction.unsafe(
		`
			DELETE FROM repository_evidence_object evidence_object
			USING clickhouse_purge_job purge_job, clickhouse_purge_object purge_object
			WHERE purge_job.target_type = 'account'
				AND purge_job.target_id = $1
				AND purge_object.purge_job_id = purge_job.id
				AND purge_object.object_key = evidence_object.object_key
				AND NOT EXISTS (
					SELECT 1
					FROM repository_evidence_upload_object object_reference
					WHERE object_reference.organization_id = evidence_object.organization_id
						AND object_reference.object_id = evidence_object.object_id
				)
		`,
		[userId],
	);
}

export function startClickHousePurgeWorker(
	options: StartClickHousePurgeWorkerOptions,
): ClickHousePurgeWorker {
	if (options.enabled === false) {
		return {
			async stop() {},
			async wake() {},
		};
	}

	const pollIntervalMs = options.pollIntervalMs ?? CONFIGURED_POLL_INTERVAL_MS;
	if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
		throw new Error(
			"ClickHouse purge poll interval must be a positive integer",
		);
	}

	const env = createClickHousePurgeProcessorEnv(options);

	let activeRun = Promise.resolve();
	let isRunning = false;
	let nextCleanupAt = 0;
	let runAgain = false;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function clearScheduledRun(): void {
		if (!timer) {
			return;
		}
		clearTimeout(timer);
		timer = undefined;
	}

	function scheduleNextRun(delayMs = pollIntervalMs): void {
		if (stopped) {
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			startWorkerPass();
		}, delayMs);
		timer.unref();
	}

	async function runWorkerPass(): Promise<number> {
		try {
			let nextR2IngestDueAt: Date | null = null;
			const now = Date.now();
			if (now >= nextCleanupAt) {
				nextCleanupAt = now + SUCCEEDED_JOB_CLEANUP_INTERVAL_MS;
				try {
					await deleteExpiredSucceededPurgeJobs(env.sqlClient);
				} catch (error) {
					logger.error(
						"ClickHouse purge job retention cleanup failed: {error}",
						{ error: sanitizeClickHousePurgeError(error) },
					);
				}
			}
			if (options.repairR2IngestCleanup) {
				try {
					const cleanup = await options.repairR2IngestCleanup();
					nextR2IngestDueAt = cleanup.nextDueAt ?? null;
					if (cleanup.hasMore) {
						runAgain = true;
					}
				} catch (error) {
					logger.error("R2 ingest cleanup repair pass failed: {error}", {
						error: sanitizeClickHousePurgeError(error),
					});
				}
			}

			let processed = 0;
			for (; processed < MAX_WORK_ITEMS_PER_PASS; processed++) {
				if (stopped || !(await runClickHousePurgeWorkerOnce(env))) {
					break;
				}
			}
			if (processed === MAX_WORK_ITEMS_PER_PASS) {
				runAgain = true;
			}

			if (stopped || runAgain) {
				return pollIntervalMs;
			}

			const nextClickHouseDueAt = await getNextClickHousePurgeWorkDueAt(
				env.sqlClient,
				env.sendFailureAlert !== undefined,
			);
			return calculateNextWorkerDelayMs(
				getEarlierDate(nextClickHouseDueAt, nextR2IngestDueAt),
				pollIntervalMs,
			);
		} catch (error) {
			logger.error("ClickHouse purge worker pass failed: {error}", {
				error: sanitizeClickHousePurgeError(error),
			});
			return pollIntervalMs;
		}
	}

	function startWorkerPass(): void {
		if (stopped) {
			return;
		}
		if (isRunning) {
			runAgain = true;
			return;
		}

		clearScheduledRun();
		isRunning = true;
		activeRun = runWorkerPass().then((nextRunDelayMs) => {
			isRunning = false;
			if (stopped) {
				return;
			}
			if (runAgain) {
				runAgain = false;
				startWorkerPass();
				return;
			}
			scheduleNextRun(nextRunDelayMs);
		});
	}

	startWorkerPass();

	return {
		async stop() {
			stopped = true;
			runAgain = false;
			clearScheduledRun();
			await activeRun;
		},
		async wake() {
			if (stopped) {
				return;
			}

			const currentRun = activeRun;
			startWorkerPass();
			if (currentRun === activeRun) {
				await currentRun;
				await activeRun;
				return;
			}
			await activeRun;
		},
	};
}

export async function runClickHousePurgeWorkerPass(
	options: StartClickHousePurgeWorkerOptions,
	deadline: MaintenanceDeadline | undefined = undefined,
): Promise<{ readonly hasMore: boolean; readonly processed: number }> {
	if (options.enabled === false) {
		return { hasMore: false, processed: 0 };
	}
	if (!hasMaintenanceTimeRemaining(deadline)) {
		return { hasMore: true, processed: 0 };
	}

	const env = createClickHousePurgeProcessorEnv(options);
	await deleteExpiredSucceededPurgeJobs(env.sqlClient);
	let processed = 0;
	for (; processed < MAX_WORK_ITEMS_PER_PASS; processed += 1) {
		if (
			!hasMaintenanceTimeRemaining(deadline) ||
			!(await runClickHousePurgeWorkerOnce(env, deadline))
		) {
			break;
		}
	}

	return {
		hasMore:
			!hasMaintenanceTimeRemaining(deadline) ||
			processed === MAX_WORK_ITEMS_PER_PASS,
		processed,
	};
}

function createClickHousePurgeProcessorEnv(
	options: StartClickHousePurgeWorkerOptions,
): ClickHousePurgeProcessorEnv {
	const r2 = options.r2 ?? createOptionalPurgeR2Client();
	const liveSessionR2 = options.liveSessionR2 ?? createOptionalPurgeR2Client();
	const database = options.sqlClient ?? sqlClient;
	return {
		executePurge: async (target, pass) => {
			if (target.targetType === "organization") {
				await deleteOrgSessions(target.targetId);
			} else {
				await deleteUserSessions(target.targetId);
			}
			await purgeAnalysisLogs(target);
			// Saved findings' cited runs of the account's analyses and of those
			// its deletion deletes (`quoted_owners`); its own runs' rows went above.
			await purgeFindingImpact(target);
			// Stored sql results: the account's own and those whose rows quoted
			// the sessions it read are deleted, the rest that counted them
			// removed, or the whole workspace's deleted. The
			// follow-up pass catches results stored by queries that were running
			// during the first.
			await createPostgresSqlResultStore(database).purge(target);
			// Run question jobs naming the account's sessions (cascades cover
			// the requester and the workspace).
			await purgeRunQuestionJobs(database, target);
			if (pass)
				await purgeRepositoryEvidenceObjects(target, pass, database, r2);
			// Live session objects by the workspace's key prefix, whether or not
			// their rows committed (an account's are in the snapshot). Without R2
			// no live session can have been stored.
			if (target.targetType === "organization" && liveSessionR2)
				await purgeLiveSessionObjectsOfOrganization(
					target.targetId,
					liveSessionR2,
				);
		},
		leaseDurationMs: DEFAULT_LEASE_DURATION_MS,
		now: () => new Date(),
		random: Math.random,
		sendFailureAlert:
			options.resend.apiKey &&
			options.resend.fromEmail &&
			options.resend.clickHousePurgeAlertRecipient
				? (alert) => sendClickHousePurgeFailureAlert(options.resend, alert)
				: undefined,
		sqlClient: database,
	};
}

function createOptionalPurgeR2Client(): R2StorageClient | undefined {
	const availability = readR2IngestAvailability();
	return availability.enabled
		? createR2MultipartUploadClient(availability.configuration)
		: undefined;
}

export async function purgeRepositoryEvidenceObjects(
	target: ClickHousePurgeTarget,
	pass: ClickHousePurgePass,
	database: postgres.Sql,
	r2: EvidencePurgeR2Client | undefined,
): Promise<void> {
	await deleteCapturedR2PurgeObjects(pass.purgeJobId, database, r2, {
		retainRows: !pass.finalPass,
	});
	await purgeEvidenceIntents(target, pass, database, r2);
	if (target.targetType === "organization") {
		await purgeGitHubObjectIntents({
			database,
			finalPass: pass.finalPass,
			organizationId: target.targetId,
			r2,
		});
	}
}

async function purgeEvidenceIntents(
	target: ClickHousePurgeTarget,
	pass: ClickHousePurgePass,
	database: postgres.Sql,
	r2: EvidencePurgeR2Client | undefined,
): Promise<void> {
	if (!r2) {
		const [pending] = await database.unsafe<Array<{ id: string }>>(
			`SELECT id FROM repository_evidence_upload_intent
			 WHERE ${target.targetType === "account" ? "user_id" : "organization_id"} = $1
			 LIMIT 1`,
			[target.targetId],
		);
		if (pending) {
			throw new Error(
				"R2 evidence purge is required but its storage client is unavailable",
			);
		}
		return;
	}
	await runIntentsForPurgeTarget({
		database,
		finalPass: pass.finalPass,
		holdUntil: new Date(
			Date.now() + CONFIGURED_FOLLOWUP_DELAY_MS + PURGE_INTENT_HOLD_MARGIN_MS,
		),
		r2,
		target,
	});
}

/**
 * Deletes the snapshotted R2 keys. Every pass deletes them; only the final pass
 * removes the rows, so the second pass can delete objects that an in-flight
 * commit materialized after the first pass.
 */
export async function deleteCapturedR2PurgeObjects(
	purgeJobId: string,
	database: postgres.Sql,
	r2: Pick<R2MultipartUploadClient, "deleteObjects"> | undefined,
	options: { readonly retainRows: boolean } = { retainRows: false },
): Promise<number> {
	let deleted = 0;
	let cursor = "";
	while (true) {
		const rows = await database.unsafe<Array<{ objectKey: string }>>(
			`
				SELECT object_key AS "objectKey"
				FROM clickhouse_purge_object
				WHERE purge_job_id = $1 AND object_key > $3
				ORDER BY object_key
				LIMIT $2
			`,
			[purgeJobId, MAX_R2_DELETE_OBJECTS, cursor],
		);
		const objectKeys = rows.map((row) => row.objectKey);
		const last = objectKeys.at(-1);
		if (last === undefined) return deleted;
		if (!r2) {
			throw new Error(
				"R2 evidence purge is required but its storage client is unavailable",
			);
		}
		await r2.deleteObjects(objectKeys);
		if (!options.retainRows) {
			await database.unsafe(
				`DELETE FROM clickhouse_purge_object
				 WHERE purge_job_id = $1 AND object_key = ANY($2::text[])`,
				[purgeJobId, objectKeys],
			);
		}
		cursor = last;
		deleted += objectKeys.length;
	}
}

function getEarlierDate(first: Date | null, second: Date | null): Date | null {
	if (!first) return second;
	if (!second) return first;
	return first.getTime() <= second.getTime() ? first : second;
}

export async function runClickHousePurgeWorkerOnce(
	env: ClickHousePurgeProcessorEnv,
	deadline: MaintenanceDeadline | undefined = undefined,
): Promise<boolean> {
	if (!hasMaintenanceTimeRemaining(deadline)) {
		return false;
	}
	const purgeJobClaim = await claimNextPurgeJob(env);
	if (purgeJobClaim.status === "claimed") {
		await processClaimedPurgeJob(purgeJobClaim.job, env);
	}
	const handledFollowUp =
		purgeJobClaim.status === "empty" && (await runNextFollowUpPurge(env));
	const handledPurgeWork = purgeJobClaim.status !== "empty" || handledFollowUp;

	const sendFailureAlert = env.sendFailureAlert;
	if (!sendFailureAlert || !hasMaintenanceTimeRemaining(deadline)) {
		return handledPurgeWork;
	}

	const purgeAlert = await claimNextPurgeAlert(env);
	if (purgeAlert) {
		await processClaimedPurgeAlert(purgeAlert, sendFailureAlert, env);
	}

	return handledPurgeWork || purgeAlert !== null;
}

export function calculateExponentialBackoffWithJitter(
	attemptCount: number,
	randomValue: number,
	baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
	maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
): number {
	const safeAttemptCount = Math.max(1, attemptCount);
	const exponentialDelay = Math.min(
		maxDelayMs,
		baseDelayMs * 2 ** (safeAttemptCount - 1),
	);
	const boundedRandomValue = Math.min(1, Math.max(0, randomValue));
	const jitter = Math.floor(exponentialDelay * 0.25 * boundedRandomValue);
	return Math.min(maxDelayMs, exponentialDelay + jitter);
}

export function sanitizeClickHousePurgeError(error: unknown): string {
	const rawMessage = collectErrorSegments(error).join("; ");

	return rawMessage
		.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu, "[redacted-url]")
		.replace(
			/\bauthorization\b(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?[^\r\n\u0085\u2028\u2029]*/giu,
			"authorization=[redacted]",
		)
		.replace(
			/\b([\w-]*(?:credential|password|secret|token|key)[\w-]*)\b(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?[^\s,;}\]"'\u0085\u2028\u2029]+/giu,
			"$1=[redacted]",
		)
		.replace(
			/\[[0-9a-f:.]+(?:%[a-z0-9_.-]+)?\]:\d{1,5}\b/giu,
			"[redacted-host]",
		)
		.replace(
			/\b(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):\d{1,5}\b/giu,
			"[redacted-host]",
		)
		.replace(/[\r\n\t\u0085\u2028\u2029]+/gu, " ")
		.replace(/\s{2,}/gu, " ")
		.trim()
		.slice(0, MAX_SANITIZED_ERROR_LENGTH);
}

function collectErrorSegments(error: unknown): string[] {
	const segments: string[] = [];
	const seen = new Set<Error>();

	const visit = (value: unknown, depth: number): void => {
		if (depth > MAX_ERROR_DEPTH || segments.length >= MAX_ERROR_SEGMENTS) {
			return;
		}
		if (typeof value === "string") {
			segments.push(value);
			return;
		}
		if (!(value instanceof Error) || seen.has(value)) {
			return;
		}

		seen.add(value);
		segments.push(`${value.name}: ${value.message}`);

		if (value instanceof AggregateError) {
			for (const nestedError of value.errors) {
				visit(nestedError, depth + 1);
				if (segments.length >= MAX_ERROR_SEGMENTS) {
					break;
				}
			}
		}
		visit(value.cause, depth + 1);
	};

	visit(error, 0);
	return segments.length > 0 ? segments : ["Unknown ClickHouse purge error"];
}

async function deleteExpiredSucceededPurgeJobs(
	database: postgres.Sql,
): Promise<void> {
	await database`
		DELETE FROM clickhouse_purge_job
		WHERE status = 'succeeded'
			AND followup_due_at IS NULL
			AND COALESCE(followup_completed_at, succeeded_at) < NOW() - ${SUCCEEDED_JOB_RETENTION_MS}::bigint * INTERVAL '1 millisecond'
	`;
}

async function getNextClickHousePurgeWorkDueAt(
	database: postgres.Sql,
	alertsEnabled: boolean,
): Promise<Date | null> {
	const [row] = await database<NextPurgeWorkDueRow[]>`
		SELECT MIN(due_at) AS "nextDueAt"
		FROM (
			SELECT
				CASE
					WHEN status IN ('pending', 'retrying') THEN next_attempt_at
					WHEN status = 'running' THEN lease_expires_at
				END AS due_at
			FROM clickhouse_purge_job
			WHERE (
				status IN ('pending', 'retrying')
				AND next_attempt_at IS NOT NULL
			) OR (
				status = 'running'
				AND lease_expires_at IS NOT NULL
			)

			UNION ALL

			SELECT followup_due_at AS due_at
			FROM clickhouse_purge_job
			WHERE status = 'succeeded'
				AND followup_due_at IS NOT NULL

			UNION ALL

			SELECT
				CASE
					WHEN alert_status IN ('pending', 'retrying') THEN alert_next_attempt_at
					WHEN alert_status = 'sending' THEN lease_expires_at
				END AS due_at
			FROM clickhouse_purge_job
			WHERE ${alertsEnabled}
				AND status = 'failed'
				AND alert_sent_at IS NULL
				AND (
					(
						alert_status IN ('pending', 'retrying')
						AND alert_next_attempt_at IS NOT NULL
					) OR (
						alert_status = 'sending'
						AND lease_expires_at IS NOT NULL
					)
				)
		) AS due_work
	`;

	if (!row?.nextDueAt) {
		return null;
	}
	const nextDueAt =
		row.nextDueAt instanceof Date ? row.nextDueAt : new Date(row.nextDueAt);
	return Number.isNaN(nextDueAt.getTime()) ? null : nextDueAt;
}

function calculateNextWorkerDelayMs(
	nextDueAt: Date | null,
	pollIntervalMs: number,
): number {
	if (!nextDueAt) {
		return pollIntervalMs;
	}
	return Math.min(
		pollIntervalMs,
		Math.max(MIN_DUE_WORK_DELAY_MS, nextDueAt.getTime() - Date.now()),
	);
}

async function claimNextPurgeJob(
	env: ClickHousePurgeProcessorEnv,
): Promise<PurgeJobClaimResult> {
	const leaseToken = crypto.randomUUID();

	return env.sqlClient.begin(
		async (transaction): Promise<PurgeJobClaimResult> => {
			const [candidate] = await transaction.unsafe<PurgeJobCandidate[]>(
				`
				SELECT
					id,
					status,
					attempt_count AS "attemptCount",
					max_attempts AS "maxAttempts"
				FROM clickhouse_purge_job
				WHERE (
					status IN ('pending', 'retrying')
					AND next_attempt_at <= NOW()
				) OR (
					status = 'running'
					AND lease_expires_at <= NOW()
				)
				ORDER BY
					COALESCE(next_attempt_at, lease_expires_at) ASC,
					created_at ASC
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			`,
			);

			if (!candidate) {
				return { status: "empty" };
			}

			if (candidate.attemptCount >= candidate.maxAttempts) {
				const alertsEnabled = env.sendFailureAlert !== undefined;
				const lastError =
					candidate.status === "running"
						? "ClickHouse purge worker lease expired after the final attempt"
						: "ClickHouse purge job reached its maximum attempts before execution";
				await transaction.unsafe(
					`
					UPDATE clickhouse_purge_job
					SET
						status = 'failed',
						last_error = $1,
						failed_at = NOW(),
						alert_status = CASE
							WHEN $2 THEN 'pending'
							ELSE 'not_required'
						END,
						alert_next_attempt_at = CASE
							WHEN $2 THEN NOW()
							ELSE NULL
						END,
						lease_token = NULL,
						lease_expires_at = NULL,
						updated_at = NOW()
					WHERE id = $3
				`,
					[lastError, alertsEnabled, candidate.id],
				);
				return { status: "terminalized" };
			}

			const [claimed] = await transaction.unsafe<ClaimedPurgeJob[]>(
				`
				UPDATE clickhouse_purge_job
				SET
					status = 'running',
					attempt_count = attempt_count + 1,
					last_attempt_at = NOW(),
					next_attempt_at = NULL,
					lease_token = $1,
					lease_expires_at = NOW() + $2::bigint * INTERVAL '1 millisecond',
					updated_at = NOW()
				WHERE id = $3
				RETURNING
					id,
					target_type AS "targetType",
					target_id AS "targetId",
					attempt_count AS "attemptCount",
					max_attempts AS "maxAttempts",
					lease_token AS "leaseToken"
			`,
				[leaseToken, env.leaseDurationMs, candidate.id],
			);

			return claimed
				? { status: "claimed", job: claimed }
				: { status: "empty" };
		},
	);
}

async function processClaimedPurgeJob(
	job: ClaimedPurgeJob,
	env: ClickHousePurgeProcessorEnv,
): Promise<void> {
	const heartbeat = startPurgeLeaseHeartbeat(job, env);
	let purgeError: unknown;

	try {
		await env.executePurge(
			{
				targetId: job.targetId,
				targetType: job.targetType,
			},
			{ finalPass: false, purgeJobId: job.id },
		);
	} catch (error) {
		purgeError = error;
	}

	const heartbeatError = await heartbeat.stop();
	if (purgeError !== undefined && purgeError !== null) {
		await handleClickHousePurgeFailure(job, purgeError, env);
		return;
	}
	if (heartbeatError) {
		logger.warn(
			"ClickHouse purge completed after a lease heartbeat error; the lease-guarded update will confirm ownership (job_id={jobId} error={error})",
			{
				error: sanitizeClickHousePurgeError(heartbeatError),
				jobId: job.id,
			},
		);
	}

	const markedSucceeded = await markPurgeSucceeded(job, env);
	if (!markedSucceeded) {
		logger.warn(
			"ClickHouse purge completed after its lease was lost; a current worker will confirm the idempotent purge (job_id={jobId})",
			{ jobId: job.id },
		);
		return;
	}

	logger.info(
		"ClickHouse purge succeeded (job_id={jobId} target_type={targetType} target_id={targetId} attempts={attemptCount})",
		{
			attemptCount: job.attemptCount,
			jobId: job.id,
			targetId: job.targetId,
			targetType: job.targetType,
		},
	);
}

async function handleClickHousePurgeFailure(
	job: ClaimedPurgeJob,
	error: unknown,
	env: ClickHousePurgeProcessorEnv,
): Promise<void> {
	const sanitizedError = sanitizeClickHousePurgeError(error);
	const exhausted = job.attemptCount >= job.maxAttempts;
	const nextAttemptAt = exhausted
		? null
		: new Date(
				env.now().getTime() +
					calculateExponentialBackoffWithJitter(job.attemptCount, env.random()),
			);
	const markedFailed = await markPurgeFailedAttempt(
		job,
		sanitizedError,
		nextAttemptAt,
		env,
	);

	if (!markedFailed) {
		logger.warn(
			"ClickHouse purge attempt finished after its lease was lost; state was left to the current worker (job_id={jobId})",
			{ jobId: job.id },
		);
		return;
	}

	if (exhausted) {
		logger.error(
			"ClickHouse purge permanently failed (job_id={jobId} target_type={targetType} target_id={targetId} attempts={attemptCount} error={error})",
			{
				attemptCount: job.attemptCount,
				error: sanitizedError,
				jobId: job.id,
				targetId: job.targetId,
				targetType: job.targetType,
			},
		);
		return;
	}

	logger.warn(
		"ClickHouse purge attempt failed and will retry (job_id={jobId} target_type={targetType} target_id={targetId} attempt={attemptCount}/{maxAttempts} error={error})",
		{
			attemptCount: job.attemptCount,
			error: sanitizedError,
			jobId: job.id,
			maxAttempts: job.maxAttempts,
			targetId: job.targetId,
			targetType: job.targetType,
		},
	);
}

function startPurgeLeaseHeartbeat(
	job: ClaimedPurgeJob,
	env: ClickHousePurgeProcessorEnv,
): { stop: () => Promise<Error | null> } {
	const intervalMs = Math.max(25, Math.floor(env.leaseDurationMs / 3));
	let activeHeartbeat = Promise.resolve();
	let heartbeatError: Error | null = null;

	const timer = setInterval(() => {
		activeHeartbeat = activeHeartbeat.then(async () => {
			if (heartbeatError) {
				return;
			}
			try {
				const renewed = await renewClickHousePurgeJobLease(
					job,
					env.leaseDurationMs,
					env,
				);
				if (!renewed) {
					heartbeatError = new Error(
						"ClickHouse purge lease was lost during execution",
					);
				}
			} catch (error) {
				heartbeatError =
					error instanceof Error
						? error
						: new Error("ClickHouse purge lease renewal failed");
			}
		});
	}, intervalMs);
	timer.unref();

	return {
		async stop() {
			clearInterval(timer);
			await activeHeartbeat;
			return heartbeatError;
		},
	};
}

async function renewClickHousePurgeJobLease(
	job: ClaimedPurgeJob,
	leaseDurationMs: number,
	env: ClickHousePurgeProcessorEnv,
): Promise<boolean> {
	const renewed = await env.sqlClient<Array<{ id: string }>>`
		UPDATE clickhouse_purge_job
		SET
			lease_expires_at = NOW() + ${leaseDurationMs}::bigint * INTERVAL '1 millisecond',
			updated_at = NOW()
		WHERE id = ${job.id}
			AND status = 'running'
			AND lease_token = ${job.leaseToken}
		RETURNING id
	`;
	return renewed.length === 1;
}

interface ClaimedFollowUpPurge {
	id: string;
	targetId: string;
	targetType: ClickHousePurgeTarget["targetType"];
}

/**
 * Runs the follow-up pass of one succeeded purge whose delay has elapsed. The
 * claim pushes `followup_due_at` out by the lease, so concurrent workers skip
 * it and a crashed worker's pass becomes due again; success clears it.
 */
async function runNextFollowUpPurge(
	env: ClickHousePurgeProcessorEnv,
): Promise<boolean> {
	const [claimed] = await env.sqlClient<ClaimedFollowUpPurge[]>`
		UPDATE clickhouse_purge_job
		SET
			followup_due_at = NOW() + ${env.leaseDurationMs}::bigint * INTERVAL '1 millisecond',
			updated_at = NOW()
		WHERE id = (
			SELECT id
			FROM clickhouse_purge_job
			WHERE status = 'succeeded'
				AND followup_due_at <= NOW()
			ORDER BY followup_due_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id, target_type AS "targetType", target_id AS "targetId"
	`;
	if (!claimed) {
		return false;
	}
	try {
		await env.executePurge(
			{
				targetId: claimed.targetId,
				targetType: claimed.targetType,
			},
			{ finalPass: true, purgeJobId: claimed.id },
		);
	} catch (error) {
		logger.warn(
			"ClickHouse follow-up purge pass failed and will retry (job_id={jobId} error={error})",
			{ error: sanitizeClickHousePurgeError(error), jobId: claimed.id },
		);
		await env.sqlClient`
			UPDATE clickhouse_purge_job
			SET
				followup_due_at = NOW() + ${DEFAULT_RETRY_MAX_DELAY_MS}::bigint * INTERVAL '1 millisecond',
				updated_at = NOW()
			WHERE id = ${claimed.id}
				AND status = 'succeeded'
				AND followup_due_at IS NOT NULL
		`;
		return true;
	}
	await env.sqlClient`
		UPDATE clickhouse_purge_job
		SET
			followup_due_at = NULL,
			followup_completed_at = NOW(),
			updated_at = NOW()
		WHERE id = ${claimed.id}
			AND status = 'succeeded'
	`;
	logger.info(
		"ClickHouse follow-up purge pass succeeded (job_id={jobId} target_type={targetType} target_id={targetId})",
		{
			jobId: claimed.id,
			targetId: claimed.targetId,
			targetType: claimed.targetType,
		},
	);
	return true;
}

async function markPurgeSucceeded(
	job: ClaimedPurgeJob,
	env: ClickHousePurgeProcessorEnv,
): Promise<boolean> {
	const updated = await env.sqlClient<Array<{ id: string }>>`
		UPDATE clickhouse_purge_job
		SET
			status = 'succeeded',
			last_error = NULL,
			succeeded_at = NOW(),
			followup_due_at = NOW() + ${env.followUpDelayMs ?? CONFIGURED_FOLLOWUP_DELAY_MS}::bigint * INTERVAL '1 millisecond',
			lease_token = NULL,
			lease_expires_at = NULL,
			updated_at = NOW()
		WHERE id = ${job.id}
			AND status = 'running'
			AND lease_token = ${job.leaseToken}
		RETURNING id
	`;
	return updated.length === 1;
}

async function markPurgeFailedAttempt(
	job: ClaimedPurgeJob,
	sanitizedError: string,
	nextAttemptAt: Date | null,
	env: ClickHousePurgeProcessorEnv,
): Promise<boolean> {
	if (nextAttemptAt === null) {
		const alertsEnabled = env.sendFailureAlert !== undefined;
		const updated = await env.sqlClient<Array<{ id: string }>>`
			UPDATE clickhouse_purge_job
			SET
				status = 'failed',
				last_error = ${sanitizedError},
				failed_at = NOW(),
				alert_status = CASE
					WHEN ${alertsEnabled} THEN 'pending'
					ELSE 'not_required'
				END,
				alert_next_attempt_at = CASE
					WHEN ${alertsEnabled} THEN NOW()
					ELSE NULL
				END,
				lease_token = NULL,
				lease_expires_at = NULL,
				updated_at = NOW()
			WHERE id = ${job.id}
				AND status = 'running'
				AND lease_token = ${job.leaseToken}
			RETURNING id
		`;
		return updated.length === 1;
	}

	const updated = await env.sqlClient<Array<{ id: string }>>`
		UPDATE clickhouse_purge_job
		SET
			status = 'retrying',
			last_error = ${sanitizedError},
			next_attempt_at = ${nextAttemptAt.toISOString()}::timestamptz,
			lease_token = NULL,
			lease_expires_at = NULL,
			updated_at = NOW()
		WHERE id = ${job.id}
			AND status = 'running'
			AND lease_token = ${job.leaseToken}
		RETURNING id
	`;
	return updated.length === 1;
}

async function claimNextPurgeAlert(
	env: ClickHousePurgeProcessorEnv,
): Promise<ClaimedPurgeAlert | null> {
	const leaseToken = crypto.randomUUID();

	return env.sqlClient.begin(async (transaction) => {
		const [candidate] = await transaction.unsafe<Array<{ id: string }>>(
			`
				SELECT id
				FROM clickhouse_purge_job
				WHERE status = 'failed'
					AND alert_sent_at IS NULL
					AND (
						(
							alert_status IN ('pending', 'retrying')
							AND alert_next_attempt_at <= NOW()
						) OR (
							alert_status = 'sending'
							AND lease_expires_at <= NOW()
						)
					)
				ORDER BY
					COALESCE(alert_next_attempt_at, lease_expires_at) ASC,
					failed_at ASC NULLS LAST
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			`,
		);

		if (!candidate) {
			return null;
		}

		const [claimed] = await transaction.unsafe<ClaimedPurgeAlertRow[]>(
			`
					UPDATE clickhouse_purge_job
					SET
						alert_status = 'sending',
						alert_attempt_count = alert_attempt_count + 1,
						alert_next_attempt_at = NULL,
						lease_token = $1,
						lease_expires_at = NOW() + $2::bigint * INTERVAL '1 millisecond',
						updated_at = NOW()
					WHERE id = $3
					RETURNING
						id,
						target_type AS "targetType",
						target_id AS "targetId",
						attempt_count AS "attemptCount",
						last_error AS "lastError",
						created_at AS "createdAt",
						last_attempt_at AS "lastAttemptAt",
						failed_at AS "failedAt",
						alert_attempt_count AS "alertAttemptCount",
						lease_token AS "leaseToken"
				`,
			[leaseToken, env.leaseDurationMs, candidate.id],
		);

		if (!claimed) {
			return null;
		}

		const fallbackTimestamp = env.now();
		const createdAt = readTimestamp(claimed.createdAt, fallbackTimestamp);
		const lastAttemptAt = readTimestamp(claimed.lastAttemptAt, createdAt);

		return {
			alertAttemptCount: claimed.alertAttemptCount,
			attemptCount: claimed.attemptCount,
			createdAt,
			failedAt: readTimestamp(claimed.failedAt, lastAttemptAt),
			id: claimed.id,
			lastAttemptAt,
			lastError:
				claimed.lastError ?? "No sanitized error details were recorded",
			leaseToken: claimed.leaseToken,
			targetId: claimed.targetId,
			targetType: claimed.targetType,
		};
	});
}

async function processClaimedPurgeAlert(
	alert: ClaimedPurgeAlert,
	sendFailureAlert: (alert: ClickHousePurgeFailureAlert) => Promise<void>,
	env: ClickHousePurgeProcessorEnv,
): Promise<void> {
	try {
		await sendFailureAlert(alert);
		const updated = await env.sqlClient<Array<{ id: string }>>`
			UPDATE clickhouse_purge_job
			SET
				alert_status = 'sent',
				alert_last_error = NULL,
				alert_sent_at = NOW(),
				lease_token = NULL,
				lease_expires_at = NULL,
				updated_at = NOW()
			WHERE id = ${alert.id}
				AND status = 'failed'
				AND alert_status = 'sending'
				AND lease_token = ${alert.leaseToken}
			RETURNING id
		`;
		if (updated.length === 0) {
			logger.warn(
				"ClickHouse purge alert was accepted after its lease was lost; the stable provider idempotency key will deduplicate recovery (job_id={jobId})",
				{ jobId: alert.id },
			);
			return;
		}
		logger.info("ClickHouse purge failure alert sent (job_id={jobId})", {
			jobId: alert.id,
		});
	} catch (error) {
		const sanitizedError = sanitizeClickHousePurgeError(error);
		const retryDelayMs = calculateExponentialBackoffWithJitter(
			alert.alertAttemptCount,
			env.random(),
			DEFAULT_ALERT_RETRY_BASE_DELAY_MS,
			DEFAULT_ALERT_RETRY_MAX_DELAY_MS,
		);
		const nextAttemptAt = new Date(
			env.now().getTime() + retryDelayMs,
		).toISOString();
		const updated = await env.sqlClient<Array<{ id: string }>>`
			UPDATE clickhouse_purge_job
			SET
				alert_status = 'retrying',
				alert_last_error = ${sanitizedError},
				alert_next_attempt_at = ${nextAttemptAt}::timestamptz,
				lease_token = NULL,
				lease_expires_at = NULL,
				updated_at = NOW()
			WHERE id = ${alert.id}
				AND status = 'failed'
				AND alert_status = 'sending'
				AND lease_token = ${alert.leaseToken}
			RETURNING id
		`;
		if (updated.length === 0) {
			logger.warn(
				"ClickHouse purge alert attempt finished after its lease was lost; state was left to the current worker (job_id={jobId})",
				{ jobId: alert.id },
			);
			return;
		}
		logger.error(
			"ClickHouse purge failure alert delivery failed and will retry (job_id={jobId} error={error})",
			{ error: sanitizedError, jobId: alert.id },
		);
	}
}

function readTimestamp(value: Date | string | null, fallback: Date): Date {
	if (value === null) {
		return fallback;
	}
	const timestamp = value instanceof Date ? value : new Date(value);
	return Number.isNaN(timestamp.getTime()) ? fallback : timestamp;
}
