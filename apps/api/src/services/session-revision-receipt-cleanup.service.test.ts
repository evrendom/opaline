import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
	getSessionRevisionReceiptCutoff,
	runSessionRevisionReceiptCleanupPass,
	SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE,
	SESSION_REVISION_RECEIPT_RETENTION_DAYS,
} from "./session-revision-receipt-cleanup.service.js";

describe("session revision receipt retention", () => {
	test("keeps a 30-day retry horizon and deletes in bounded batches", () => {
		expect(SESSION_REVISION_RECEIPT_RETENTION_DAYS).toBe(30);
		expect(SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE).toBe(1_000);
		expect(
			getSessionRevisionReceiptCutoff(
				new Date("2026-08-26T12:00:00.000Z"),
			).toISOString(),
		).toBe("2026-07-27T12:00:00.000Z");
	});

	test("rejects an invalid maintenance clock", () => {
		expect(() => getSessionRevisionReceiptCutoff(new Date("invalid"))).toThrow(
			"cleanup clock is invalid",
		);
	});

	test("deletes one oldest-first batch and reports remaining work", async () => {
		let capturedQuery = "";
		let capturedParameters: readonly unknown[] = [];
		const database = {
			unsafe: (query: string, parameters: readonly unknown[]) => {
				capturedQuery = query;
				capturedParameters = parameters;
				return Promise.resolve([{ deletedCount: "1000" }]);
			},
		} as unknown as postgres.Sql;

		await expect(
			runSessionRevisionReceiptCleanupPass(
				new Date("2026-08-26T12:00:00.000Z"),
				database,
			),
		).resolves.toEqual({ deleted: 1_000, hasMore: true });
		expect(capturedQuery).toContain("FOR UPDATE SKIP LOCKED");
		expect(capturedQuery).toContain("ORDER BY created_at");
		expect(capturedParameters).toEqual([
			"2026-07-27T12:00:00.000Z",
			SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE,
		]);
	});
});
