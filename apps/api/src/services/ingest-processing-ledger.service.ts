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
}

interface IngestProcessingLedgerRow {
	id: string;
	rawIngestedAt: Date | string;
	result: unknown;
	status: "completed" | "processing";
	usageGeneration: string | null;
}

interface IngestProcessingLedgerEnvironment {
	readonly database: postgres.Sql;
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
	const connection = await env.database.reserve();
	const lockIdentity = buildLockIdentity(identity);
	let locked = false;
	try {
		await connection.unsafe(
			"SELECT pg_advisory_lock(hashtextextended($1, 0))",
			[lockIdentity],
		);
		locked = true;

		await connection.unsafe(
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
			) DO NOTHING`,
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
			[JSON.stringify(result), row.id],
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
		if (locked) {
			await connection
				.unsafe("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
					lockIdentity,
				])
				.catch(() => undefined);
		}
		connection.release();
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
	const generation = await ledger.connection.begin(async (transaction) => {
		const [existing] = await transaction.unsafe<
			Array<{ usageGeneration: string | null }>
		>(
			`SELECT usage_generation::text AS "usageGeneration"
			 FROM ingest_processing_ledger
			 WHERE id = $1
			 FOR UPDATE`,
			[ledger.id],
		);
		if (!existing) {
			throw new Error("Ingest processing ledger disappeared");
		}
		if (existing.usageGeneration) {
			return existing.usageGeneration;
		}

		const [reserved] = await transaction.unsafe<Array<{ generation: string }>>(
			`UPDATE session_ownership
			 SET usage_extraction_generation = GREATEST(
				usage_extraction_generation + 1,
				FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint
			 )
			 WHERE organization_id = $1
				AND session_id = $2
				AND user_id = $3
			 RETURNING usage_extraction_generation::text AS generation`,
			[identity.organizationId, identity.sessionId, identity.userId],
		);
		if (!reserved) {
			throw new Error("Usage extraction generation reservation failed");
		}

		await transaction.unsafe(
			`UPDATE ingest_processing_ledger
			 SET usage_generation = $1, updated_at = NOW()
			 WHERE id = $2`,
			[reserved.generation, ledger.id],
		);
		return reserved.generation;
	});
	await passIngestProcessingBoundary(failpoint, {
		store: "postgres",
		target: "usage-generation",
	});
	return generation;
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
