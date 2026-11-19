import type postgres from "postgres";
import {
	type IngestProcessingFailpoint,
	passIngestProcessingBoundary,
} from "./ingest-processing-boundary.js";
import {
	assertPostgresLeaseHeld,
	type PostgresLease,
	withPostgresLease,
} from "./postgres-lease.service.js";
import { UsageExtractionSupersededError } from "./usage-extraction-superseded.error.js";

// Renewed every 20 seconds while the upload is processed, so a processor that
// crashes (or whose function is killed) frees the identity within a minute.
const INGEST_PROCESSING_LEASE_TTL_MS = 60_000;

export interface IngestProcessingIdentity {
	readonly filteredContentSha256: string;
	readonly filterVersion: number;
	readonly organizationId: string;
	readonly sessionId: string;
}

export interface ClaimedIngestProcessingLedger {
	readonly connection: postgres.Sql;
	readonly id: string;
	readonly rawIngestedAt: Date;
	readonly recovering: boolean;
	/** Aborts when this processor can no longer prove it holds the identity's lease. */
	readonly signal: AbortSignal;
}

export interface IngestProcessingTargetReceipt {
	readonly expectedRowCount: number;
	readonly target: string;
}

export type IngestProcessingLedgerResult<TResult> =
	| { readonly status: "already_processing" }
	| { readonly result: TResult; readonly status: "completed" };

export interface IngestProcessingSemaphore {
	acquire: (signal?: AbortSignal) => Promise<() => void>;
}

export class IngestProcessingCapacityError extends Error {
	readonly code:
		| "INGEST_PROCESSING_QUEUE_FULL"
		| "INGEST_PROCESSING_QUEUE_TIMEOUT";

	constructor(
		code: "INGEST_PROCESSING_QUEUE_FULL" | "INGEST_PROCESSING_QUEUE_TIMEOUT",
		message: string,
	) {
		super(message);
		this.code = code;
		this.name = "IngestProcessingCapacityError";
	}
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
	readonly semaphore: IngestProcessingSemaphore;
	readonly signal: AbortSignal | undefined;
}

export async function withIngestProcessingLedger<TResult>(
	identity: IngestProcessingIdentity,
	parseCompletedResult: (value: unknown) => TResult,
	operation: (ledger: ClaimedIngestProcessingLedger) => Promise<TResult>,
	env: IngestProcessingLedgerEnvironment,
): Promise<IngestProcessingLedgerResult<TResult>> {
	const releasePermit = await env.semaphore.acquire(env.signal);
	try {
		const outcome = await withPostgresLease(
			buildLeaseName(identity),
			(lease) =>
				processClaimedLedger(
					identity,
					parseCompletedResult,
					operation,
					lease,
					env,
				),
			{ database: env.database, ttlMs: INGEST_PROCESSING_LEASE_TTL_MS },
		);
		return outcome.status === "busy"
			? { status: "already_processing" }
			: outcome.result;
	} finally {
		releasePermit();
	}
}

async function processClaimedLedger<TResult>(
	identity: IngestProcessingIdentity,
	parseCompletedResult: (value: unknown) => TResult,
	operation: (ledger: ClaimedIngestProcessingLedger) => Promise<TResult>,
	lease: PostgresLease,
	env: IngestProcessingLedgerEnvironment,
): Promise<IngestProcessingLedgerResult<TResult>> {
	const database = env.database;
	const inserted = await database.unsafe<Array<{ id: string }>>(
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

	const row = await readLedgerRow(identity, database);
	if (row.status === "completed") {
		return {
			result: parseCompletedResult(row.result),
			status: "completed",
		};
	}

	await database.unsafe(
		`UPDATE ingest_processing_ledger
	 SET status = 'processing', updated_at = NOW()
	 WHERE id = $1`,
		[row.id],
	);
	const result = await operation({
		connection: database,
		id: row.id,
		rawIngestedAt: toDate(row.rawIngestedAt),
		recovering: inserted.length === 0,
		signal: lease.signal,
	});
	// A successor that took over an expired lease owns this ledger row now;
	// the fence keeps a stalled processor from overwriting its result.
	const completed = await database.begin(async (transaction) => {
		await assertPostgresLeaseHeld(lease, transaction);
		return transaction.unsafe<Array<{ id: string }>>(
			`UPDATE ingest_processing_ledger
		 SET
			status = 'completed',
			result = $1,
			completed_at = NOW(),
			updated_at = NOW()
		 WHERE id = $2
		 RETURNING id`,
			[transaction.json(toJsonValue(result)), row.id],
		);
	});
	if (completed.length !== 1) {
		throw new Error("Ingest processing ledger completion failed");
	}
	await passIngestProcessingBoundary(env.failpoint, {
		store: "postgres",
		target: "ledger-completed",
	});
	return { result, status: "completed" };
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
		readonly expectedRevision: string;
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
					AND last_revision = $4::bigint
					AND EXISTS (
						SELECT 1
						FROM ingest_processing_ledger
						WHERE id = $5 AND usage_generation IS NULL
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
			WHERE id = $5
				AND EXISTS (
					SELECT 1
					FROM session_ownership
					WHERE organization_id = $1
						AND session_id = $2
						AND user_id = $3
						AND last_revision = $4::bigint
				)
			RETURNING usage_generation::text AS generation`,
		[
			identity.organizationId,
			identity.sessionId,
			identity.userId,
			identity.expectedRevision,
			ledger.id,
		],
	);
	if (!reserved?.generation) {
		throw new UsageExtractionSupersededError();
	}
	await passIngestProcessingBoundary(failpoint, {
		store: "postgres",
		target: "usage-generation",
	});
	return reserved.generation;
}

async function readLedgerRow(
	identity: IngestProcessingIdentity,
	connection: postgres.Sql,
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

interface IngestProcessingWaiter {
	cancel: (error: Error) => void;
	start: () => void;
}

export function createIngestProcessingSemaphore(input: {
	maxActive: number;
	maxQueued: number;
	waitTimeoutMs: number;
}): IngestProcessingSemaphore {
	for (const [name, value] of Object.entries(input)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`Ingest processing semaphore ${name} must be positive`);
		}
	}
	let active = 0;
	const queued: IngestProcessingWaiter[] = [];

	function createRelease(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			active -= 1;
			dispatch();
		};
	}

	function dispatch(): void {
		while (active < input.maxActive) {
			const next = queued.shift();
			if (!next) return;
			active += 1;
			next.start();
		}
	}

	return {
		acquire(signal?: AbortSignal) {
			if (signal?.aborted) {
				return Promise.reject(
					signal.reason instanceof Error
						? signal.reason
						: new Error("Ingest processing was cancelled"),
				);
			}
			if (active < input.maxActive) {
				active += 1;
				return Promise.resolve(createRelease());
			}
			if (queued.length >= input.maxQueued) {
				return Promise.reject(
					new IngestProcessingCapacityError(
						"INGEST_PROCESSING_QUEUE_FULL",
						"Ingest processing queue is full",
					),
				);
			}
			return new Promise<() => void>((resolve, reject) => {
				let waitTimer: ReturnType<typeof setTimeout> | undefined;
				let started = false;
				const abort = (): void => {
					waiter.cancel(
						signal?.reason instanceof Error
							? signal.reason
							: new Error("Ingest processing was cancelled"),
					);
				};
				function clearWait(): void {
					if (waitTimer) clearTimeout(waitTimer);
					waitTimer = undefined;
					signal?.removeEventListener("abort", abort);
				}
				const waiter: IngestProcessingWaiter = {
					cancel(error) {
						if (started) return;
						const index = queued.indexOf(waiter);
						if (index === -1) return;
						queued.splice(index, 1);
						clearWait();
						reject(error);
					},
					start() {
						started = true;
						clearWait();
						resolve(createRelease());
					},
				};
				queued.push(waiter);
				waitTimer = setTimeout(() => {
					waiter.cancel(
						new IngestProcessingCapacityError(
							"INGEST_PROCESSING_QUEUE_TIMEOUT",
							"Ingest processing queue wait timed out",
						),
					);
				}, input.waitTimeoutMs);
				waitTimer.unref();
				signal?.addEventListener("abort", abort, { once: true });
			});
		},
	};
}

export const ingestProcessingSemaphore = createIngestProcessingSemaphore({
	maxActive: 4,
	maxQueued: 32,
	waitTimeoutMs: 1_000,
});

function buildLeaseName(identity: IngestProcessingIdentity): string {
	return `ingest-processing:${JSON.stringify([
		identity.organizationId,
		identity.sessionId,
		identity.filteredContentSha256,
		identity.filterVersion,
	])}`;
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
