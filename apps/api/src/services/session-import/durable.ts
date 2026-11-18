import { ORPCError } from "@orpc/server";
import { IngestSessionOutputSchema } from "@rudel/api-routes";
import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import {
	type ClickHouseExecutor,
	createIdempotentClickHouseExecutor,
} from "../../clickhouse.js";
import * as databases from "../../db.js";
import {
	type IngestProcessingFailpoint,
	passIngestProcessingBoundary,
} from "../ingest-processing-boundary.js";
import {
	type ClaimedIngestProcessingLedger,
	IngestProcessingCapacityError,
	ingestProcessingSemaphore,
	readIngestProcessingTargetReceipt,
	recordIngestProcessingTargetReceipt,
	withIngestProcessingLedger,
} from "../ingest-processing-ledger.service.js";
import { getNextIngestedAt } from "../ingest-timestamp.service.js";
import type { R2IngestProcessorResult } from "../r2-ingest-commit.service.js";

export async function processInLedger(
	identity: {
		readonly contentHash: string;
		readonly failpoint: IngestProcessingFailpoint | undefined;
		readonly organizationId: string;
		readonly sessionId: string;
		readonly signal: AbortSignal | undefined;
	},
	process: (
		ledger: ClaimedIngestProcessingLedger,
		signal: AbortSignal,
	) => Promise<R2IngestProcessorResult>,
): Promise<R2IngestProcessorResult> {
	const { signal } = identity;
	try {
		const ledgerResult = await withIngestProcessingLedger(
			{
				filteredContentSha256: identity.contentHash,
				filterVersion: SESSION_INGEST_FILTER_VERSION,
				organizationId: identity.organizationId,
				sessionId: identity.sessionId,
			},
			parseStoredIngestProcessorResult,
			(ledger) =>
				process(
					ledger,
					signal ? AbortSignal.any([signal, ledger.signal]) : ledger.signal,
				),
			{
				database: databases.ingestProcessingSqlClient,
				failpoint: identity.failpoint,
				now: getNextIngestedAt,
				randomUUID: () => crypto.randomUUID(),
				semaphore: ingestProcessingSemaphore,
				signal,
			},
		);
		if (ledgerResult.status === "already_processing") {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "ingest_already_processing", retryAfterMs: 1_000 },
				message: "An identical transcript is already being processed",
			});
		}
		return ledgerResult.result;
	} catch (error) {
		if (error instanceof IngestProcessingCapacityError) {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: {
					reason: error.code.toLowerCase(),
					retryAfterMs: 1_000,
				},
				message: error.message,
			});
		}
		throw error;
	}
}

export function ledgerExecutor(
	executor: ClickHouseExecutor,
	ledger: ClaimedIngestProcessingLedger,
	failpoint: IngestProcessingFailpoint | undefined,
): ClickHouseExecutor {
	return createIdempotentClickHouseExecutor(
		executor,
		{
			id: ledger.id,
			readReceipt: (target) =>
				readIngestProcessingTargetReceipt(ledger, target),
			recordReceipt: (target, expectedRowCount) =>
				recordIngestProcessingTargetReceipt(ledger, {
					expectedRowCount,
					target,
				}),
			recovering: ledger.recovering,
		},
		(table) =>
			passIngestProcessingBoundary(failpoint, {
				store: "clickhouse",
				target: table,
			}),
	);
}

function parseStoredIngestProcessorResult(
	value: unknown,
): R2IngestProcessorResult {
	if (
		typeof value !== "object" ||
		value === null ||
		!("contentSha256" in value) ||
		typeof value.contentSha256 !== "string" ||
		!/^[a-f0-9]{64}$/u.test(value.contentSha256) ||
		!("result" in value)
	) {
		throw new Error("Completed ingest processing ledger has an invalid result");
	}
	return {
		contentSha256: value.contentSha256,
		result: IngestSessionOutputSchema.parse(value.result),
	};
}
