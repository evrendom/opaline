import type postgres from "postgres";
import {
	type IngestProcessingFailpoint,
	passIngestProcessingBoundary,
} from "./ingest-processing-boundary.js";

export interface IngestProcessingIdentity {
	readonly filteredContentSha256: string;
	readonly filterVersion: number;
	readonly organizationId: string;
	readonly sessionId: string;
}

export interface ClaimedIngestProcessingLedger {
	readonly connection: postgres.ReservedSql;
	readonly id: string;
	readonly rawIngestedAt: Date;
	readonly recovering: boolean;
}

export interface IngestProcessingTargetReceipt {
	readonly expectedRowCount: number;
	readonly target: string;
}

interface IngestProcessingLedgerRow {
	id: string;
	rawIngestedAt: Date | string;
	result: unknown;
	status: "completed" | "processing";
	usageGeneration: string | null;
}

interface IngestProcessingLedgerEnvironment {
	readonly disposableDatabase: postgres.Sql;
	readonly failpoint: IngestProcessingFailpoint | undefined;
	readonly now: () => Date;
	readonly randomUUID: () => `${string}-${string}-${string}-${string}-${string}`;
}

export async function withIngestProcessingLedger<TResult>(
	identity: IngestProcessingIdentity,
	parseCompletedResult: (value: unknown) => TResult,
	operation: (ledger: ClaimedIngestProcessingLedger) => Promise<TResult>,
	env: IngestProcessingLedgerEnvironment,
): Promise<TResult> {
	const connection = await env.disposableDatabase.reserve();
	const lockIdentity = buildLockIdentity(identity);
	let locked = false;
	try {
		await connection.unsafe(
			"SELECT pg_advisory_lock(hashtextextended($1, 0))",
			[lockIdentity],
		);
		locked = true;

		const inserted = await connection.unsafe<Array<{ id: string }>>(
			`INSERT INTO ingest_processing_ledger (
				id,
				organization_id,
				session_id,
				filtered_content_sha256,
				filter_version,
				raw_ingested_at
			)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (
				organization_id,
				session_id,
				filtered_content_sha256,
				filter_version
			) DO NOTHING
			RETURNING id`,
			[
				env.randomUUID(),
				identity.organizationId,
				identity.sessionId,
				identity.filteredContentSha256,
				identity.filterVersion,
				env.now().toISOString(),
			],
		);

		const row = await readLedgerRow(identity, connection);
		if (row.status === "completed") {
			return parseCompletedResult(row.result);
		}

		await connection.unsafe(
			`UPDATE ingest_processing_ledger
			 SET status = 'processing', updated_at = NOW()
			 WHERE id = $1`,
			[row.id],
		);
		const result = await operation({
			connection,
			id: row.id,
			rawIngestedAt: toDate(row.rawIngestedAt),
			recovering: inserted.length === 0,
		});
		const completed = await connection.unsafe<Array<{ id: string }>>(
			`UPDATE ingest_processing_ledger
			 SET
				status = 'completed',
				result = $1,
				completed_at = NOW(),
				updated_at = NOW()
			 WHERE id = $2
			 RETURNING id`,
			[connection.json(toJsonValue(result)), row.id],
		);
		if (completed.length !== 1) {
			throw new Error("Ingest processing ledger completion failed");
		}
		await passIngestProcessingBoundary(env.failpoint, {
			store: "postgres",
			target: "ledger-completed",
		});
		return result;
	} finally {
		let destroyDatabase = false;
		if (locked) {
			let unlockConfirmed = false;
			try {
				await passIngestProcessingBoundary(env.failpoint, {
					store: "postgres",
					target: "advisory-unlock",
				});
				const [unlocked] = await connection.unsafe<
					Array<{ unlocked: boolean }>
				>("SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked", [
					lockIdentity,
				]);
				unlockConfirmed = unlocked?.unlocked === true;
			} catch {}
			if (!unlockConfirmed) {
				destroyDatabase = true;
			}
		}
		if (destroyDatabase) {
			await env.disposableDatabase.end({ timeout: 0 });
		} else {
			connection.release();
			await env.disposableDatabase.end();
		}
	}
}

export async function readIngestProcessingTargetReceipt(
	ledger: ClaimedIngestProcessingLedger,
	target: string,
): Promise<IngestProcessingTargetReceipt | null> {
	const [receipt] = await ledger.connection.unsafe<
		IngestProcessingTargetReceipt[]
	>(
		`SELECT
			target,
			expected_row_count AS "expectedRowCount"
		 FROM ingest_processing_target_receipt
		 WHERE ledger_id = $1 AND target = $2`,
		[ledger.id, target],
	);
	return receipt ?? null;
}

export async function recordIngestProcessingTargetReceipt(
	ledger: ClaimedIngestProcessingLedger,
	receipt: IngestProcessingTargetReceipt,
): Promise<void> {
	const acknowledged = await ledger.connection.unsafe<
		Array<{ target: string }>
	>(
		`INSERT INTO ingest_processing_target_receipt (
			ledger_id,
			target,
			expected_row_count
		 )
		 VALUES ($1, $2, $3)
		 ON CONFLICT (ledger_id, target) DO UPDATE
		 SET acknowledged_at = ingest_processing_target_receipt.acknowledged_at
		 WHERE ingest_processing_target_receipt.expected_row_count = EXCLUDED.expected_row_count
		 RETURNING target`,
		[ledger.id, receipt.target, receipt.expectedRowCount],
	);
	if (acknowledged.length !== 1) {
		throw new Error("Ingest processing target receipt conflicts with recovery");
	}
}

export async function reserveLedgerUsageGeneration(
	ledger: ClaimedIngestProcessingLedger,
	identity: {
		readonly organizationId: string;
		readonly sessionId: string;
		readonly userId: string;
	},
	failpoint: IngestProcessingFailpoint | undefined,
): Promise<string> {
	const [reserved] = await ledger.connection.unsafe<
		Array<{ generation: string | null }>
	>(
		`WITH reserved_generation AS (
			UPDATE session_ownership
			 SET usage_extraction_generation = GREATEST(
				usage_extraction_generation + 1,
				FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
			 )
			 WHERE organization_id = $1
				AND session_id = $2
				AND user_id = $3
				AND EXISTS (
					SELECT 1
					FROM ingest_processing_ledger
					WHERE id = $4 AND usage_generation IS NULL
				)
			 RETURNING usage_extraction_generation
		)
		UPDATE ingest_processing_ledger
		SET
			usage_generation = COALESCE(
				(SELECT usage_extraction_generation FROM reserved_generation),
				usage_generation
			),
			updated_at = NOW()
		WHERE id = $4
		RETURNING usage_generation::text AS generation`,
		[identity.organizationId, identity.sessionId, identity.userId, ledger.id],
	);
	if (!reserved?.generation) {
		throw new Error("Usage extraction generation reservation failed");
	}
	await passIngestProcessingBoundary(failpoint, {
		store: "postgres",
		target: "usage-generation",
	});
	return reserved.generation;
}

async function readLedgerRow(
	identity: IngestProcessingIdentity,
	connection: postgres.ReservedSql,
): Promise<IngestProcessingLedgerRow> {
	const [row] = await connection.unsafe<IngestProcessingLedgerRow[]>(
		`SELECT
			id,
			status,
			raw_ingested_at AS "rawIngestedAt",
			usage_generation::text AS "usageGeneration",
			result
		 FROM ingest_processing_ledger
		 WHERE organization_id = $1
			AND session_id = $2
			AND filtered_content_sha256 = $3
			AND filter_version = $4`,
		[
			identity.organizationId,
			identity.sessionId,
			identity.filteredContentSha256,
			identity.filterVersion,
		],
	);
	if (!row) {
		throw new Error("Ingest processing ledger acquisition failed");
	}
	return row;
}

function buildLockIdentity(identity: IngestProcessingIdentity): string {
	return JSON.stringify([
		identity.organizationId,
		identity.sessionId,
		identity.filteredContentSha256,
		identity.filterVersion,
	]);
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function toJsonValue(value: unknown): postgres.JSONValue {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new Error("Ingest processing result is not JSON serializable");
	}
	return JSON.parse(serialized) as postgres.JSONValue;
}
