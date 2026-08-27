import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
	type ClaimedIngestProcessingLedger,
	createIngestProcessingSemaphore,
	IngestProcessingCapacityError,
	reserveLedgerUsageGeneration,
} from "./ingest-processing-ledger.service.js";
import { UsageExtractionSupersededError } from "./usage-extraction-superseded.error.js";

describe("ingest processing semaphore", () => {
	test("describes supersession as terminal convergence", () => {
		const error = new UsageExtractionSupersededError();

		expect(error.message).toContain("newer raw session revision");
		expect(error.message.toLowerCase()).not.toContain("retry");
	});

	test("bounds queued work and admits it after active work releases", async () => {
		const semaphore = createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 1_000,
		});
		const releaseActive = await semaphore.acquire();
		const queued = semaphore.acquire();
		await expect(semaphore.acquire()).rejects.toMatchObject({
			code: "INGEST_PROCESSING_QUEUE_FULL",
		});
		releaseActive();
		const releaseQueued = await queued;
		releaseQueued();
	});

	test("times out a bounded waiter", async () => {
		const semaphore = createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 20,
		});
		const releaseActive = await semaphore.acquire();
		await expect(semaphore.acquire()).rejects.toBeInstanceOf(
			IngestProcessingCapacityError,
		);
		releaseActive();
	});

	test("cancels a queued waiter", async () => {
		const semaphore = createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 1_000,
		});
		const releaseActive = await semaphore.acquire();
		const controller = new AbortController();
		const queued = semaphore.acquire(controller.signal);
		controller.abort(new Error("request cancelled"));
		await expect(queued).rejects.toThrow("request cancelled");
		releaseActive();
	});

	test("rejects a recovered ledger generation when its raw revision is stale", async () => {
		let statement = "";
		let parameters: readonly unknown[] = [];
		const connection = {
			unsafe(sql: string, values: readonly unknown[]) {
				statement = sql;
				parameters = values;
				// Models an existing ledger generation whose ownership revision no
				// longer matches: the outer CAS returns no ledger row.
				return Promise.resolve([]);
			},
		} as unknown as postgres.ReservedSql;
		const ledger: ClaimedIngestProcessingLedger = {
			connection,
			id: "ledger-id",
			rawIngestedAt: new Date("2026-08-27T00:00:00.000Z"),
			recovering: true,
		};

		await expect(
			reserveLedgerUsageGeneration(
				ledger,
				{
					expectedRevision: "100",
					organizationId: "org-id",
					sessionId: "session-id",
					userId: "user-id",
				},
				undefined,
			),
		).rejects.toBeInstanceOf(UsageExtractionSupersededError);
		expect(statement.match(/last_revision = \$4::bigint/gu)).toHaveLength(2);
		expect(parameters).toEqual([
			"org-id",
			"session-id",
			"user-id",
			"100",
			"ledger-id",
		]);
	});
});
