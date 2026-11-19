import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import type { R2MultipartUploadClient } from "./r2-ingest-storage.service.js";

/**
 * Deletion fence for GitHub evidence objects. It applies the same pattern as
 * repository-evidence-fence.service.ts to content-addressed objects that are
 * written with a plain PUT:
 *
 * 1. Before any PUT the writer checks for organization and attributed account
 *    deletion tombstones (`clickhouse_purge_job`) and aborts when one exists.
 * 2. A durable intent row is committed before the object is checked or written
 *    and is released only when the owning collection commits the receipts that
 *    reference the key. Intents carry no tenant foreign keys, so they survive
 *    the organization cascade and stay discoverable for purge and cleanup.
 * 3. The purge job's second pass deletes every key still recorded by an intent
 *    of the deleted organization, which closes the check-then-write race.
 *
 * Because the keys are content addressed and shared, the sweeper takes the same
 * per-key advisory lock that writers take while registering an intent. A key is
 * deleted only when no live intent and no receipt references it.
 */

const logger = getLogger(["rudel", "api", "github-evidence-object-fence"]);

export const GITHUB_OBJECT_INTENT_GRACE_MS = 10 * 60_000;
const MAX_SWEEP_KEYS = 20;
const SWEEP_RETRY_DELAY_MS = 5 * 60_000;
const PURGE_PAGE_SIZE = 500;

type GitHubObjectR2 = Pick<R2MultipartUploadClient, "deleteObjects">;

export interface GitHubObjectSweepResult {
	readonly attempted: number;
	readonly completed: number;
	readonly hasMore: boolean;
}

export async function registerGitHubObjectIntent(
	database: postgres.Sql,
	input: {
		readonly collectionId: string;
		readonly dueAt: Date;
		readonly objectKey: string;
		readonly organizationId: string;
	},
): Promise<void> {
	await database.begin(async (transaction) => {
		await lockObjectKey(transaction, input.objectKey);
		await transaction.unsafe(
			`INSERT INTO github_evidence_object_intent (
				id, organization_id, collection_id, object_key, due_at
			) VALUES ($1, $2, $3, $4, $5)`,
			[
				crypto.randomUUID(),
				input.organizationId,
				input.collectionId,
				input.objectKey,
				input.dueAt.toISOString(),
			],
		);
	});
}

export async function releaseGitHubObjectIntents(
	transaction: postgres.TransactionSql,
	collectionId: string,
): Promise<void> {
	await transaction.unsafe(
		"DELETE FROM github_evidence_object_intent WHERE collection_id = $1",
		[collectionId],
	);
}

export async function sweepGitHubEvidenceObjects(input: {
	readonly database: postgres.Sql;
	readonly deadline?: MaintenanceDeadline;
	readonly now?: Date;
	readonly r2: GitHubObjectR2;
}): Promise<GitHubObjectSweepResult> {
	const now = input.now ?? new Date();
	const keys = await input.database.unsafe<Array<{ objectKey: string }>>(
		`SELECT object_key AS "objectKey"
		 FROM github_evidence_object_intent
		 WHERE due_at <= $1
		 GROUP BY object_key
		 ORDER BY MIN(due_at) ASC
		 LIMIT $2`,
		[now.toISOString(), MAX_SWEEP_KEYS],
	);
	let attempted = 0;
	let completed = 0;
	let hasMore = keys.length === MAX_SWEEP_KEYS;
	for (const { objectKey } of keys) {
		if (!hasMaintenanceTimeRemaining(input.deadline)) {
			hasMore = true;
			break;
		}
		attempted += 1;
		try {
			await input.database.begin(async (transaction) => {
				await lockObjectKey(transaction, objectKey);
				const [live] = await transaction.unsafe<Array<{ id: string }>>(
					`SELECT id FROM github_evidence_object_intent
					 WHERE object_key = $1 AND due_at > $2
					 LIMIT 1`,
					[objectKey, now.toISOString()],
				);
				const [referenced] = await transaction.unsafe<
					Array<{ present: boolean }>
				>(
					`SELECT (
						EXISTS (SELECT 1 FROM github_ci_log_receipt WHERE object_key = $1)
						OR EXISTS (
							SELECT 1 FROM github_evidence_collection
							WHERE metadata_object_key = $1
						)
						OR EXISTS (
							SELECT 1 FROM github_evidence_collection collection,
							 jsonb_array_elements(collection.metadata_chunks) chunk
							WHERE chunk->>'objectKey' = $1
						)
					) AS present`,
					[objectKey],
				);
				if (!live && !referenced?.present) {
					await input.r2.deleteObjects([objectKey]);
				}
				await transaction.unsafe(
					`DELETE FROM github_evidence_object_intent
					 WHERE object_key = $1 AND due_at <= $2`,
					[objectKey, now.toISOString()],
				);
			});
			completed += 1;
		} catch (error) {
			await input.database.unsafe(
				`UPDATE github_evidence_object_intent
				 SET due_at = $2
				 WHERE object_key = $1 AND due_at <= $3`,
				[
					objectKey,
					new Date(now.getTime() + SWEEP_RETRY_DELAY_MS).toISOString(),
					now.toISOString(),
				],
			);
			logger.warn(
				"GitHub evidence object cleanup will be retried (error={error})",
				{ error: error instanceof Error ? error.name : "UNKNOWN" },
			);
		}
	}
	return { attempted, completed, hasMore };
}

/**
 * Deletes every object key an intent of the deleted organization still names.
 * Every pass deletes the keys; only the final pass removes the intent rows so
 * the second pass can still find objects written after the first pass.
 */
export async function purgeGitHubObjectIntents(input: {
	readonly database: postgres.Sql;
	readonly finalPass: boolean;
	readonly organizationId: string;
	readonly r2: GitHubObjectR2 | undefined;
}): Promise<number> {
	let deleted = 0;
	let cursor = "";
	while (true) {
		const rows = await input.database.unsafe<
			Array<{ id: string; objectKey: string }>
		>(
			`SELECT id, object_key AS "objectKey"
			 FROM github_evidence_object_intent
			 WHERE organization_id = $1 AND id > $2
			 ORDER BY id
			 LIMIT $3`,
			[input.organizationId, cursor, PURGE_PAGE_SIZE],
		);
		const last = rows.at(-1);
		if (!last) return deleted;
		if (!input.r2) {
			throw new Error(
				"R2 evidence purge is required but its storage client is unavailable",
			);
		}
		await input.r2.deleteObjects([
			...new Set(rows.map((row) => row.objectKey)),
		]);
		if (input.finalPass) {
			await input.database.unsafe(
				"DELETE FROM github_evidence_object_intent WHERE id = ANY($1::text[])",
				[rows.map((row) => row.id)],
			);
		}
		cursor = last.id;
		deleted += rows.length;
	}
}

export async function getNextGitHubObjectWorkDueAt(
	database: postgres.Sql,
): Promise<Date | null> {
	const [row] = await database.unsafe<
		Array<{ nextDueAt: Date | string | null }>
	>('SELECT MIN(due_at) AS "nextDueAt" FROM github_evidence_object_intent');
	if (!row?.nextDueAt) return null;
	const nextDueAt =
		row.nextDueAt instanceof Date ? row.nextDueAt : new Date(row.nextDueAt);
	return Number.isNaN(nextDueAt.getTime()) ? null : nextDueAt;
}

async function lockObjectKey(
	transaction: postgres.TransactionSql,
	objectKey: string,
): Promise<void> {
	await transaction.unsafe(
		"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
		[`github-evidence-object:${objectKey}`],
	);
}
