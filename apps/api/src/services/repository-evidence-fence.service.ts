import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

/**
 * Deletion fence for repository evidence.
 *
 * Account and organization deletion must never be undone by a request that was
 * already in flight, and no R2 object or multipart upload may exist without a
 * durable record that lets deletion (or a sweeper) find it. The pattern is
 * deliberately small and is applied identically by every evidence writer:
 *
 * 1. Check before write. Immediately before each external publication
 *    (multipart creation, multipart completion, ClickHouse insert) call
 *    `assertNoClickHousePurgeTombstone` (clickhouse-purge.service.ts, where the
 *    full pattern is documented). `clickhouse_purge_job` rows act as the
 *    tombstones: they are inserted in the same transaction that deletes the
 *    account or organization and are retained after success.
 * 2. Register intent before PUT. `repository_evidence_upload_intent` rows are
 *    committed before `CreateMultipartUpload` (the upload ID is attached
 *    afterwards) and are released only when the upload is completed or aborted.
 *    Object keys are generation-versioned (see `createEvidenceObjectKey`), so
 *    deleting the key of a deleted row can never hit a re-acquired object.
 * 3. Second purge pass. The purge job re-runs once after a grace period that
 *    exceeds the maximum bounded write duration. It re-deletes ClickHouse rows,
 *    aborts remaining intents and re-deletes the snapshotted keys, which closes
 *    the check-then-write race without distributed locks.
 *
 * The sweeper below aborts uploads whose intents expired, expires abandoned
 * uploads and removes stale pending objects that no live upload references.
 */

const logger = getLogger(["rudel", "api", "repository-evidence-fence"]);

export const EVIDENCE_UPLOAD_TTL_MS = 60 * 60_000;
export const EVIDENCE_INTENT_GRACE_MS = 10 * 60_000;
const EVIDENCE_STALE_PENDING_OBJECT_MS = 2 * EVIDENCE_UPLOAD_TTL_MS;
const UNKNOWN_UPLOAD_ID_WINDOW_MS = 2 * 60_000;
const MAX_SWEEP_ITEMS = 20;
const INTENT_RETRY_DELAY_MS = 5 * 60_000;

type EvidenceDatabase = postgres.Sql | postgres.TransactionSql;

export interface EvidenceIntentScope {
	readonly organizationId: string;
	readonly uploadReceiptId: string;
	readonly userId: string;
}

export interface EvidenceSweepResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
}

interface IntentRow {
	readonly createdAt: Date | string;
	readonly deleteObject: boolean;
	readonly id: string;
	readonly objectKey: string;
	readonly uploadId: string | null;
}

export async function registerMultipartIntent(
	database: EvidenceDatabase,
	scope: EvidenceIntentScope,
	objectKey: string,
	dueAt: Date,
): Promise<string> {
	const id = crypto.randomUUID();
	await database.unsafe(
		`INSERT INTO repository_evidence_upload_intent (
			id, organization_id, user_id, upload_receipt_id, object_key, due_at
		) VALUES ($1, $2, $3, $4, $5, $6)`,
		[
			id,
			scope.organizationId,
			scope.userId,
			scope.uploadReceiptId,
			objectKey,
			dueAt.toISOString(),
		],
	);
	return id;
}

export async function attachMultipartUploadId(
	database: EvidenceDatabase,
	intentId: string,
	uploadId: string,
): Promise<void> {
	await database.unsafe(
		`UPDATE repository_evidence_upload_intent
		 SET upload_id = $2
		 WHERE id = $1`,
		[intentId, uploadId],
	);
}

/**
 * Makes every intent of an upload due immediately. Commit uses this instead of
 * deleting intents: a multipart upload that commit did not complete (because
 * identical content was already materialized) is still open and must be
 * aborted before its intent is released.
 */
export async function expediteReceiptIntents(
	database: EvidenceDatabase,
	uploadReceiptId: string,
	now: Date,
): Promise<void> {
	await database.unsafe(
		`UPDATE repository_evidence_upload_intent
		 SET due_at = $2
		 WHERE upload_receipt_id = $1`,
		[uploadReceiptId, now.toISOString()],
	);
}

export async function expediteUploadIntents(
	database: EvidenceDatabase,
	uploadReceiptId: string,
	uploadIds: readonly string[],
	now: Date,
): Promise<void> {
	if (uploadIds.length === 0) return;
	await database.unsafe(
		`UPDATE repository_evidence_upload_intent
		 SET due_at = $3
		 WHERE upload_receipt_id = $1 AND upload_id = ANY($2::text[])`,
		[uploadReceiptId, uploadIds, now.toISOString()],
	);
}

/**
 * Holds every intent of a deleted target until the purge job's final pass so
 * the ordinary sweeper cannot consume an intent that the purge still needs in
 * order to delete the intent's object key.
 */
export async function holdIntentsForPurge(
	database: EvidenceDatabase,
	target: { readonly targetId: string; readonly targetType: string },
	holdUntil: Date,
): Promise<void> {
	const column =
		target.targetType === "account" ? "user_id" : "organization_id";
	await database.unsafe(
		`UPDATE repository_evidence_upload_intent
		 SET due_at = GREATEST(due_at, $2)
		 WHERE ${column} = $1`,
		[target.targetId, holdUntil.toISOString()],
	);
}

/** Aborts (and with `deleteObjectKeys` also deletes the key of) every intent. */
export async function runIntentsForPurgeTarget(input: {
	readonly database: postgres.Sql;
	readonly finalPass: boolean;
	readonly holdUntil: Date;
	readonly r2: Pick<
		R2MultipartUploadClient,
		"abortMultipartUpload" | "deleteObjects" | "listMultipartUploads"
	>;
	readonly target: { readonly targetId: string; readonly targetType: string };
}): Promise<number> {
	const column =
		input.target.targetType === "account" ? "user_id" : "organization_id";
	let processed = 0;
	let cursor = "";
	while (true) {
		const rows = await input.database.unsafe<IntentRow[]>(
			`SELECT id, object_key AS "objectKey", upload_id AS "uploadId",
				delete_object AS "deleteObject", created_at AS "createdAt"
			 FROM repository_evidence_upload_intent
			 WHERE ${column} = $1 AND id > $2
			 ORDER BY id
			 LIMIT 100`,
			[input.target.targetId, cursor],
		);
		const last = rows.at(-1);
		if (!last) return processed;
		cursor = last.id;
		for (const row of rows) {
			await executeIntent(input.database, input.r2, row, {
				deleteObjectKey: true,
				forceAbortUnknown: true,
			});
			processed += 1;
			if (input.finalPass) {
				await input.database.unsafe(
					"DELETE FROM repository_evidence_upload_intent WHERE id = $1",
					[row.id],
				);
			} else {
				await input.database.unsafe(
					"UPDATE repository_evidence_upload_intent SET due_at = $2 WHERE id = $1",
					[row.id, input.holdUntil.toISOString()],
				);
			}
		}
	}
}

export async function abortUploadIntents(input: {
	readonly database: postgres.Sql;
	readonly r2: Pick<
		R2MultipartUploadClient,
		"abortMultipartUpload" | "deleteObjects" | "listMultipartUploads"
	>;
	/** Limits the abort to these upload IDs; every intent of the receipt when omitted. */
	readonly uploadIds?: readonly string[];
	readonly uploadReceiptId: string;
}): Promise<void> {
	if (input.uploadIds?.length === 0) return;
	const rows = await input.database.unsafe<IntentRow[]>(
		`SELECT id, object_key AS "objectKey", upload_id AS "uploadId",
			delete_object AS "deleteObject", created_at AS "createdAt"
		 FROM repository_evidence_upload_intent
		 WHERE upload_receipt_id = $1
			AND ($2::text[] IS NULL OR upload_id = ANY($2::text[]))`,
		[input.uploadReceiptId, input.uploadIds ?? null],
	);
	for (const row of rows) {
		try {
			await executeIntent(input.database, input.r2, row, {
				deleteObjectKey: false,
				forceAbortUnknown: false,
			});
			await input.database.unsafe(
				"DELETE FROM repository_evidence_upload_intent WHERE id = $1",
				[row.id],
			);
		} catch (error) {
			logger.warn(
				"Evidence multipart abort will be retried by the sweeper (intent_id={intentId} error={error})",
				{ error: safeErrorCode(error), intentId: row.id },
			);
		}
	}
}

export async function sweepRepositoryEvidence(input: {
	readonly database: postgres.Sql;
	readonly deadline?: MaintenanceDeadline;
	readonly now?: Date;
	readonly r2: Pick<
		R2MultipartUploadClient,
		"abortMultipartUpload" | "deleteObjects" | "listMultipartUploads"
	>;
}): Promise<EvidenceSweepResult> {
	const now = input.now ?? new Date();
	let attempted = 0;
	let completed = 0;
	let hasMore = false;

	const expired = await input.database.unsafe<Array<{ id: string }>>(
		`WITH candidates AS (
			SELECT id
			FROM repository_evidence_upload
			WHERE status = 'initialized' AND expires_at <= $1
			ORDER BY expires_at ASC, id ASC
			FOR UPDATE SKIP LOCKED
			LIMIT $2
		)
		UPDATE repository_evidence_upload upload
		SET status = 'expired', updated_at = $1
		FROM candidates
		WHERE upload.id = candidates.id
		RETURNING upload.id`,
		[now.toISOString(), MAX_SWEEP_ITEMS],
	);
	attempted += expired.length;
	completed += expired.length;
	hasMore ||= expired.length === MAX_SWEEP_ITEMS;

	if (hasMaintenanceTimeRemaining(input.deadline)) {
		// An object row is stale when no live upload references it. The row is
		// deleted first and its unique generation key is queued for deletion, so
		// shared content that was re-acquired under a new row is never touched.
		const released = await input.database.unsafe<Array<{ objectKey: string }>>(
			`WITH candidates AS (
				SELECT object.organization_id, object.object_id
				FROM repository_evidence_object object
				WHERE object.status = 'pending'
					AND object.updated_at < $1
					AND NOT EXISTS (
						SELECT 1
						FROM repository_evidence_upload_object reference
						INNER JOIN repository_evidence_upload upload
							ON upload.id = reference.upload_id
						WHERE reference.organization_id = object.organization_id
							AND reference.object_id = object.object_id
							AND upload.status = 'initialized'
							AND upload.expires_at > $2
					)
				ORDER BY object.updated_at ASC
				FOR UPDATE OF object SKIP LOCKED
				LIMIT $3
			), deleted AS (
				DELETE FROM repository_evidence_object object
				USING candidates
				WHERE object.organization_id = candidates.organization_id
					AND object.object_id = candidates.object_id
				RETURNING object.organization_id, object.object_key
			), queued AS (
				INSERT INTO repository_evidence_upload_intent (
					id, organization_id, user_id, upload_receipt_id, object_key,
					delete_object, due_at
				)
				SELECT gen_random_uuid()::text, organization_id, '', '', object_key,
					true, $2
				FROM deleted
				RETURNING object_key
			)
			SELECT object_key AS "objectKey" FROM queued`,
			[
				new Date(
					now.getTime() - EVIDENCE_STALE_PENDING_OBJECT_MS,
				).toISOString(),
				now.toISOString(),
				MAX_SWEEP_ITEMS,
			],
		);
		attempted += released.length;
		completed += released.length;
		hasMore ||= released.length === MAX_SWEEP_ITEMS;
	}

	if (hasMaintenanceTimeRemaining(input.deadline)) {
		const due = await input.database.unsafe<IntentRow[]>(
			`SELECT id, object_key AS "objectKey", upload_id AS "uploadId",
				delete_object AS "deleteObject", created_at AS "createdAt"
			 FROM repository_evidence_upload_intent
			 WHERE due_at <= $1
			 ORDER BY due_at ASC, id ASC
			 LIMIT $2`,
			[now.toISOString(), MAX_SWEEP_ITEMS],
		);
		hasMore ||= due.length === MAX_SWEEP_ITEMS;
		for (const row of due) {
			if (!hasMaintenanceTimeRemaining(input.deadline)) {
				hasMore = true;
				break;
			}
			attempted += 1;
			try {
				await executeIntent(input.database, input.r2, row, {
					deleteObjectKey: row.deleteObject,
					forceAbortUnknown: row.deleteObject,
				});
				await input.database.unsafe(
					"DELETE FROM repository_evidence_upload_intent WHERE id = $1",
					[row.id],
				);
				completed += 1;
			} catch (error) {
				await input.database.unsafe(
					`UPDATE repository_evidence_upload_intent
					 SET attempt_count = attempt_count + 1, last_error = $2, due_at = $3
					 WHERE id = $1`,
					[
						row.id,
						safeErrorCode(error),
						new Date(now.getTime() + INTENT_RETRY_DELAY_MS).toISOString(),
					],
				);
				logger.warn(
					"Evidence intent cleanup will be retried (intent_id={intentId} error={error})",
					{ error: safeErrorCode(error), intentId: row.id },
				);
			}
		}
	}

	return { attempted, completed, hasMore };
}

export async function getNextEvidenceWorkDueAt(
	database: postgres.Sql,
): Promise<Date | null> {
	const [row] = await database.unsafe<
		Array<{ nextDueAt: Date | string | null }>
	>(
		`SELECT MIN(due_at) AS "nextDueAt"
		 FROM (
			SELECT due_at FROM repository_evidence_upload_intent
			UNION ALL
			SELECT expires_at AS due_at FROM repository_evidence_upload
			WHERE status = 'initialized'
			UNION ALL
			SELECT GREATEST(
				updated_at + $1::bigint * INTERVAL '1 millisecond',
				NOW() + INTERVAL '1 minute'
			) AS due_at
			FROM repository_evidence_object
			WHERE status = 'pending'
		 ) AS due_work`,
		[EVIDENCE_STALE_PENDING_OBJECT_MS],
	);
	if (!row?.nextDueAt) return null;
	const nextDueAt =
		row.nextDueAt instanceof Date ? row.nextDueAt : new Date(row.nextDueAt);
	return Number.isNaN(nextDueAt.getTime()) ? null : nextDueAt;
}

async function executeIntent(
	database: postgres.Sql,
	r2: Pick<
		R2MultipartUploadClient,
		"abortMultipartUpload" | "deleteObjects" | "listMultipartUploads"
	>,
	intent: IntentRow,
	options: {
		readonly deleteObjectKey: boolean;
		readonly forceAbortUnknown: boolean;
	},
): Promise<void> {
	if (intent.uploadId !== null) {
		await abortIgnoringMissing(r2, intent.objectKey, intent.uploadId);
	} else {
		const createdAt =
			intent.createdAt instanceof Date
				? intent.createdAt
				: new Date(intent.createdAt);
		const uploads = await r2.listMultipartUploads(intent.objectKey);
		for (const upload of uploads) {
			// Without a recorded upload ID only uploads started by the intent's own
			// request can be identified, so other live uploads for the same key are
			// left alone unless the key itself is being deleted.
			if (
				options.forceAbortUnknown ||
				upload.initiatedAt.getTime() <=
					createdAt.getTime() + UNKNOWN_UPLOAD_ID_WINDOW_MS
			) {
				await abortIgnoringMissing(r2, intent.objectKey, upload.uploadId);
			}
		}
	}
	if (!options.deleteObjectKey) return;
	const [live] = await database.unsafe<Array<{ objectKey: string }>>(
		`SELECT object_key AS "objectKey"
		 FROM repository_evidence_object
		 WHERE object_key = $1
		 LIMIT 1`,
		[intent.objectKey],
	);
	// A surviving row owns the key; only keys without a row are garbage.
	if (!live) await r2.deleteObjects([intent.objectKey]);
}

async function abortIgnoringMissing(
	r2: Pick<R2MultipartUploadClient, "abortMultipartUpload">,
	objectKey: string,
	uploadId: string,
): Promise<void> {
	try {
		await r2.abortMultipartUpload({ objectKey, uploadId });
	} catch (error) {
		if (!isNoSuchUploadError(error)) throw error;
	}
}

function isNoSuchUploadError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	for (const key of ["name", "code", "Code"] as const) {
		if (Reflect.get(error, key) === "NoSuchUpload") return true;
	}
	return false;
}

function safeErrorCode(error: unknown): string {
	if (typeof error !== "object" || error === null) return "UNKNOWN";
	for (const key of ["name", "code", "Code"] as const) {
		const value = Reflect.get(error, key);
		if (typeof value === "string" && value.length > 0) {
			return value.slice(0, 100);
		}
	}
	return "UNKNOWN";
}
