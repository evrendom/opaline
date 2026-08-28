import { describe, expect, test } from "bun:test";
import {
	shouldPersistUsageExtractionFailureReceipt,
	shouldStartBestEffortLanguageSignals,
} from "./ingest-derived-fact-policy.js";

describe("ingest derived-fact policy", () => {
	test("defers language signals during durable processing", () => {
		expect(
			shouldStartBestEffortLanguageSignals({
				awaitLanguageSignals: false,
				durableProcessing: true,
			}),
		).toBe(false);
		expect(
			shouldStartBestEffortLanguageSignals({
				awaitLanguageSignals: false,
				durableProcessing: false,
			}),
		).toBe(true);
	});

	test("never consumes a durable target receipt for diagnostic usage output", () => {
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: true,
				extractionAllowsReceipt: true,
			}),
		).toBe(false);
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: true,
				extractionAllowsReceipt: false,
			}),
		).toBe(false);
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: false,
				extractionAllowsReceipt: true,
			}),
		).toBe(true);
		expect(
			shouldPersistUsageExtractionFailureReceipt({
				durableProcessing: false,
				extractionAllowsReceipt: false,
			}),
		).toBe(false);
	});
});
