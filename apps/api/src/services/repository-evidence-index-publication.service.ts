import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import type { MaintenanceDeadline } from "../lib/bounded-maintenance.js";
import { hasClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";
import {
	persistRepositoryEvidenceIndexRows,
	type RepositoryEvidenceIndexRow,
	RepositoryEvidenceIndexRowSchema,
} from "./repository-evidence-index.service.js";

const logger = getLogger(["rudel", "api", "repository-evidence-index"]);
const INLINE_BUDGET_MS = 3_000;
const PASS_BUDGET_MS = 60_000;
const RETRY_DELAY_MS = 60_000;
// One ClickHouse insert publishes the whole batch, so slow inserts do not
// limit how many captures a pass can drain.
const BATCH_SIZE = 500;

interface PublicationDependencies {
	readonly database: postgres.Sql;
	readonly clickhouse: ClickHouseExecutor;
}

interface PendingCapture {
	readonly organizationId: string;
	readonly contextId: string;
	readonly userId: string;
	readonly indexRow: unknown;
}

// The capture and its prepared index row are already durable in Postgres, so
// the CLI never waits on a slow ClickHouse insert. Rows not published within
// the inline budget are published by the minute maintenance pass.
export async function publishRepositoryEvidenceIndexAfterCommit(
	input: PublicationDependencies & {
		readonly organizationId: string;
		readonly contextId: string;
	},
): Promise<void> {
	try {
		const captures = await selectPendingCaptures(input.database, {
			organizationId: input.organizationId,
			contextId: input.contextId,
		});
		await publishCaptures(
			captures,
			AbortSignal.timeout(INLINE_BUDGET_MS),
			input,
		);
	} catch (error) {
		logger.warn("Inline evidence index publication deferred: {error}", {
			error: String(error),
		});
	}
}

export async function runRepositoryEvidenceIndexPublisherPass(
	options: Partial<PublicationDependencies> & {
		readonly deadline?: MaintenanceDeadline;
	} = {},
) {
	const env: PublicationDependencies = {
		database: options.database ?? sqlClient,
		clickhouse: options.clickhouse ?? getClickhouse(),
	};
	const remainingMs = options.deadline
		? options.deadline.deadlineAt - options.deadline.now()
		: PASS_BUDGET_MS;
	if (remainingMs <= 0) return { attempted: 0, published: 0, hasMore: true };
	const captures = await selectPendingCaptures(env.database);
	const published = await publishCaptures(
		captures,
		AbortSignal.timeout(Math.min(PASS_BUDGET_MS, remainingMs)),
		env,
	);
	return {
		attempted: captures.length,
		published,
		hasMore: captures.length === BATCH_SIZE,
	};
}

async function selectPendingCaptures(
	database: postgres.Sql,
	only?: { readonly organizationId: string; readonly contextId: string },
): Promise<PendingCapture[]> {
	return database.unsafe<PendingCapture[]>(
		`SELECT organization_id AS "organizationId", context_id AS "contextId",
			user_id AS "userId", index_row AS "indexRow"
		 FROM repository_evidence_capture
		 WHERE index_row IS NOT NULL AND index_published_at IS NULL
		   AND ($1::text IS NULL OR (organization_id = $1 AND context_id = $2))
		   AND ($1::text IS NOT NULL OR index_next_attempt_at <= NOW())
		 ORDER BY created_at, organization_id, context_id
		 LIMIT $3`,
		[only?.organizationId ?? null, only?.contextId ?? null, BATCH_SIZE],
	);
}

async function publishCaptures(
	captures: readonly PendingCapture[],
	signal: AbortSignal,
	env: PublicationDependencies,
): Promise<number> {
	const publishable: Array<{
		readonly capture: PendingCapture;
		readonly row: RepositoryEvidenceIndexRow;
	}> = [];
	for (const capture of captures) {
		// Never publish evidence of an account or workspace being purged; the
		// purge also deletes the capture row itself.
		if (await hasClickHousePurgeTombstone(capture, env)) {
			await env.database.unsafe(
				`UPDATE repository_evidence_capture SET index_row = NULL
				 WHERE organization_id = $1 AND context_id = $2`,
				[capture.organizationId, capture.contextId],
			);
			continue;
		}
		// Rows stored before retirement step 3 still carry skill_assessments;
		// parsing strips it.
		const parsed = RepositoryEvidenceIndexRowSchema.safeParse(capture.indexRow);
		if (!parsed.success) {
			// A stored row that can never be valid must not hold back the batch.
			await deferCaptures(env.database, [capture], "infinity");
			logger.error(
				"Quarantined an invalid evidence index row ({contextId}): {error}",
				{ contextId: capture.contextId, error: parsed.error.message },
			);
			continue;
		}
		publishable.push({ capture, row: parsed.data });
	}
	if (publishable.length === 0) return 0;
	try {
		await persistRepositoryEvidenceIndexRows({
			clickhouse: env.clickhouse,
			rows: publishable.map((item) => item.row),
			signal,
		});
		await markPublished(
			env.database,
			publishable.map((item) => item.capture),
		);
		return publishable.length;
	} catch (error) {
		if (publishable.length === 1 || signal.aborted) {
			await deferCaptures(
				env.database,
				publishable.map((item) => item.capture),
			);
			logger.warn(
				"Evidence index publication deferred for {count} captures: {error}",
				{ count: publishable.length, error: String(error) },
			);
			return 0;
		}
	}
	// The batch was rejected: publish rows one by one so a single bad row only
	// defers itself.
	let published = 0;
	for (const item of publishable) {
		if (signal.aborted) {
			await deferCaptures(env.database, [item.capture]);
			continue;
		}
		try {
			await persistRepositoryEvidenceIndexRows({
				clickhouse: env.clickhouse,
				rows: [item.row],
				signal,
			});
			await markPublished(env.database, [item.capture]);
			published += 1;
		} catch (error) {
			await deferCaptures(env.database, [item.capture]);
			logger.warn(
				"Evidence index publication deferred ({contextId}): {error}",
				{
					contextId: item.capture.contextId,
					error: String(error),
				},
			);
		}
	}
	return published;
}

async function markPublished(
	database: postgres.Sql,
	captures: readonly PendingCapture[],
): Promise<void> {
	await database.unsafe(
		`UPDATE repository_evidence_capture SET index_published_at = NOW()
		 FROM unnest($1::text[], $2::text[]) AS target(organization_id, context_id)
		 WHERE repository_evidence_capture.organization_id = target.organization_id
		   AND repository_evidence_capture.context_id = target.context_id`,
		[
			captures.map((capture) => capture.organizationId),
			captures.map((capture) => capture.contextId),
		],
	);
}

async function deferCaptures(
	database: postgres.Sql,
	captures: readonly PendingCapture[],
	until: "infinity" | "retry" = "retry",
): Promise<void> {
	await database.unsafe(
		`UPDATE repository_evidence_capture
		 SET index_next_attempt_at = CASE WHEN $3::text = 'infinity'
			THEN 'infinity'::timestamptz
			ELSE NOW() + $4::bigint * INTERVAL '1 millisecond' END
		 FROM unnest($1::text[], $2::text[]) AS target(organization_id, context_id)
		 WHERE repository_evidence_capture.organization_id = target.organization_id
		   AND repository_evidence_capture.context_id = target.context_id
		   AND repository_evidence_capture.index_published_at IS NULL`,
		[
			captures.map((capture) => capture.organizationId),
			captures.map((capture) => capture.contextId),
			until,
			RETRY_DELAY_MS,
		],
	);
}
