import { describe, expect, test } from "bun:test";
import {
	SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE,
	SESSION_REVISION_RECEIPT_RETENTION_DAYS,
} from "./session-revision-receipt-cleanup.service.js";

describe("session revision receipt retention", () => {
	test("keeps a 30-day retry horizon and deletes in bounded batches", () => {
		expect(SESSION_REVISION_RECEIPT_RETENTION_DAYS).toBe(30);
		expect(SESSION_REVISION_RECEIPT_DELETE_BATCH_SIZE).toBe(1_000);
	});
});
