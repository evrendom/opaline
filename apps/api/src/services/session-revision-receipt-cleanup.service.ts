import type postgres from "postgres";

export const SESSION_REVISION_RECEIPT_RETENTION_DAYS = 30;
export const SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE = 1_000;

interface DeletedReceiptCountRow {
	deletedCount: string;
}

export interface SessionRevisionReceiptCleanupPassResult {
	readonly deleted: number;
	readonly hasMore: boolean;
}

export function getSessionRevisionReceiptCutoff(now: Date): Date {
	if (Number.isNaN(now.getTime())) {
		throw new Error("Session revision receipt cleanup clock is invalid");
	}
	return new Date(
		now.getTime() -
			SESSION_REVISION_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
	);
}

export async function runSessionRevisionReceiptCleanupPass(
	now: Date = new Date(),
	database?: postgres.Sql | postgres.ReservedSql,
): Promise<SessionRevisionReceiptCleanupPassResult> {
	const cutoff = getSessionRevisionReceiptCutoff(now);
	const activeDatabase = database ?? (await import("../db.js")).sqlClient;
	const [row] = await activeDatabase.unsafe<DeletedReceiptCountRow[]>(
		`
		WITH expired AS (
			SELECT
				organization_id,
				session_id,
				operation_id,
				content_sha256
			FROM session_ingest_revision
			WHERE created_at < $1::timestamptz
			ORDER BY created_at
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		), deleted AS (
			DELETE FROM session_ingest_revision AS receipt
			USING expired
			WHERE receipt.organization_id = expired.organization_id
				AND receipt.session_id = expired.session_id
				AND receipt.operation_id = expired.operation_id
				AND receipt.content_sha256 = expired.content_sha256
			RETURNING 1
		)
		SELECT count(*)::text AS "deletedCount"
		FROM deleted
		`,
		[cutoff.toISOString(), SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE],
	);
	const deleted = Number(row?.deletedCount ?? 0);
	if (!Number.isSafeInteger(deleted) || deleted < 0) {
		throw new Error(
			"Session revision receipt cleanup returned an invalid count",
		);
	}
	return {
		deleted,
		hasMore: deleted === SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE,
	};
}
